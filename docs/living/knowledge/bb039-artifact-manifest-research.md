# BB-039: artifact identity across Backend to QA handoff

Status: submitted research result; application and method review pending. Runtime adoption is not implied.

Source revision: `dfc5249073ebfb1722047a3e4ac851caaee41d19`.
Reproduce: `node docs/living/knowledge/bb039-artifact-manifest-probe.mjs`.
Evidence class: deterministic, in-memory adapter fixture. It proves behavior at the current `makeQaWorkOrder` / `resolveQaContext` API boundary, not production artifact-store reliability or QA task correctness.

## Consumer and current behavior

The consumer is a fresh session continuing the durable Backend to QA workflow. `persistBackendRun` stores accepted Backend artifact refs and a decision reference in its checkpoint. `makeQaWorkOrder` resolves QA's declared paths from those refs. `resolveQaContext` asks the injected `artifactReader` for content and `sourceRef`, then copies the accepted decision into context provenance. The application does not currently compare returned content with a producer-side content identity or check the reader's producer revision. The existing fake readers in `wave-c.test.js` and `durable-backend-qa.test.js` return content from refs, with no immutable-content guarantee.

The application does reject a missing required path in the handoff and propagates artifact-read failures. A real reader backed by immutable, revision-bound content may already offer stronger guarantees than these fixtures; this experiment makes no claim about adapters not present in the repository.

## Experiment and predeclared gate

The fixed experiment budget is six deterministic scenarios with two artifacts each, one run per mode and no provider or external IO. Before evaluating the fixture, the probe declares: unchanged artifacts must pass in both modes; changed content behind an unchanged ref and wrong producer revision must pass through the current reader but fail through a manifest reader; missing content must fail in both. The same two-artifact handoff and mutable backing map are used in both modes. The prototype serializes and reloads the producer-side manifest before QA, and calls the actual `resolveQaContext` function. It does not dispatch QA Worker or perform external mutations. There is no learned policy or tuning split here; generalization to other adapters is unmeasured.

| Scenario | Current reader | Manifest reader |
| --- | --- | --- |
| Both artifacts unchanged | PASS | PASS |
| Content changed behind stable ref | PASS | CONTENT_MISMATCH |
| First artifact missing | MISSING_ARTIFACT | MISSING_ARTIFACT |
| Same content, wrong stored producer revision | PASS | REVISION_OR_PROVENANCE_MISMATCH |
| Second artifact missing | MISSING_ARTIFACT | MISSING_ARTIFACT |
| Manifest unavailable, content present | PASS | MANIFEST_UNAVAILABLE |

The two changed-or-wrong artifacts are caught before QA execution by the candidate and accepted into QA context by the baseline. Missing-artifact detection is existing value, not an improvement attributed to the manifest. The serialized two-entry manifest is 502 bytes versus 120 bytes for its ref/path list in this fixture; these are sample payload sizes, not a storage-cost forecast. The manifest carries refs, paths, producer revision, accepted decision and SHA-256 content digests; it contains no artifact bodies.

## Implementation handoff

Recommendation: **NARROW** to one opt-in, application-owned artifact adapter with a durable manifest store. The candidate adds an integrity check for mutable/ref-addressed storage; do not make it a universal requirement for readers whose immutability is already independently guaranteed.

1. Capture each artifact's bytes and trusted revision at the accepted Backend producer boundary, then persist a manifest keyed by the Backend acceptance decision and producer work order before making the `QA_PENDING` checkpoint visible. A reader must not create a manifest by re-reading possibly changed content for the first time in the later QA session. Define how a failed manifest write leaves the Board at Backend continuation, and how orphaned manifests are collected after a failed checkpoint.
2. Give the selected `artifactReader` access to this manifest through its injected adapter configuration. On `readArtifact(request)`, require an entry for the exact ref/path and compare requested work order, accepted decision, revision, stored producer revision and bytes digest before returning content. Use explicit missing, mismatch and unavailable outcomes. The application may retain the current `resolveQaContext` interface because it already passes these request fields; introduce a new handoff/checkpoint field only if the chosen store cannot locate the manifest by decision key. Version and migrate that field rather than relying on extra fields that `BackendQaHandoffSchema` currently strips.
3. Pin the manifest plus referenced bytes while the Board item is `QA_PENDING`, `BACKEND_REMEDIATION_PENDING`, `PENDING_REVIEW`, `REVIEWING` or `PENDING_RECONCILIATION`, including blocked continuation and live review references. Release only after terminal disposition and a declared audit-retention interval. A fresh session must resolve the pin and distinguish verified, missing, changed and unavailable content. Retain an inspectable manifest and decision trail for historical evidence; if bytes expire, surface that limitation instead of claiming they remain inspectable.
4. Preserve legacy ref-only handoff behavior when the addon is disabled. When enabled, a missing manifest fails closed for that adapter. Regression cases should include valid restart, content swap, same-content wrong revision, partial set, manifest absence, review delay, cancellation and a producer/checkpoint crash boundary. Accept only if valid handoff still reaches QA, corrupted content never does, and pin/release behavior survives restart.

The hash is an integrity comparison against a trusted producer-side manifest, not proof of the correctness or authenticity of the accepted Backend result. If the manifest and content can be rewritten together by the same untrusted actor, the check provides no independent protection. The experiment does not establish a retention period, repository-wide cost, provider availability, or real QA success rate. Those require a concrete durable artifact store and workload before adoption.

Disposition: the bounded implementation can be opened after research review for one adapter. Its value gate is the observed reduction from two undetected identity violations to zero on controlled restart cases, with valid content still accepted and no increase in incorrect QA acceptance. Do not count the already-detected missing-content cases as improvement.
