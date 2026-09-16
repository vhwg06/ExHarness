# BB-039 — Artifact manifest and retention research

Status: **EVIDENCE / JUDGMENT CANDIDATE**

## Question

Can durable Backend -> QA continuation verify that a persisted artifact ref still resolves to the same producer revision and content after a restart, while preserving the existing ref-only handoff shape and keeping artifact availability separate from correctness?

## Scope

This research is bounded to one concrete consumer: the `artifactReader` injected into `resolveQaContext(...)` for durable Backend -> QA continuation.

It does not redesign Blackboard storage, copy artifact payloads into Board state, create a global artifact registry, or claim that every current artifact adapter is unsafe. A concrete adapter may already provide stronger guarantees internally; the current application contract simply does not require or expose them.

## Current source observations

### Ref identity is currently minimal

`ApplicationArtifactRef` contains only:

```text
ref
path? 
```

The Backend -> QA handoff separately carries producer work-order id, accepted Backend revision and acceptance-decision provenance.

`makeQaWorkOrder(...)` preserves those upstream fields and `resolveQaContext(...)` passes them to `artifactReader.readArtifact(...)` together with `ref/path`.

However, after the reader returns, the application accepts `resolved.content` and `resolved.sourceRef` and constructs QA provenance from the **requested upstream values**. The current application contract does not independently compare returned content identity or returned producer revision against a durable manifest.

Therefore a reader that resolves a stable ref to changed bytes, ignores the requested revision, or loses content can only be as trustworthy/diagnosable as that concrete adapter's own implementation.

### Session handoff preserves refs, not retention guarantees

`sessionHandoffFromBlackboard(...)` collects artifact/evidence refs from work items and submissions. This makes ref-only continuation inspectable, but the handoff does not state:

- immutable content digest;
- producer revision bound to the stored bytes;
- whether the payload is currently available;
- what active project lifecycle state pins retention.

This is appropriate for Blackboard authority: Board tracks lifecycle and refs, not artifact payload ownership. The missing piece, if needed, belongs at the artifact-source adapter boundary.

## Runnable deterministic probe

`bb039-artifact-manifest-probe.mjs` compares a deliberately weak baseline reader with a manifest-validating wrapper using repository-shaped requests.

The candidate manifest entry contains:

```text
ref + path
contentDigest
producerWorkOrderId
producerRevision
pinnedBy[]
```

The wrapper:

1. requires a manifest entry for the requested artifact;
2. verifies the requested producer revision against the manifest;
3. resolves the payload through the existing reader;
4. distinguishes unavailable content from integrity failure;
5. hashes returned content and compares it with immutable content identity;
6. returns the ordinary reader payload only after validation.

Checked-in deterministic output: `artifacts/bb039-artifact-manifest-probe.json`.

| Scenario | Current weak reader | Manifest wrapper |
| --- | --- | --- |
| unchanged content | accepts, identity not independently verified | accepts + content identity verified |
| changed bytes behind stable ref | accepts changed content | `ARTIFACT_CONTENT_MISMATCH` |
| deleted content | generic source error | `ARTIFACT_UNAVAILABLE` |
| requested producer revision differs from manifest | accepts if source ignores revision | `ARTIFACT_PRODUCER_REVISION_MISMATCH` |
| payload exists but manifest entry is missing | accepts unverifiable content | `ARTIFACT_MANIFEST_MISSING` |

The synthetic baseline records two direct false-acceptance cases (changed content and wrong producer revision) plus one accepted-unverifiable partial-manifest case. The candidate has zero false acceptances in this fixture and preserves the unchanged-valid case.

`productionEvidence=false`. These results establish contract behavior under controlled inputs; they do not establish production failure rate, storage reliability, latency improvement, or acceptable storage cost.

## Proposed application boundary

Use an **optional manifest-validating `artifactReader` adapter**. Do not change Core or make the Blackboard artifact ref itself a correctness claim.

Candidate manifest record:

```text
ARTIFACT_MANIFEST_ENTRY v1

artifact:
  ref
  path?
identity:
  contentDigest
producer:
  workOrderId
  revision
  acceptanceDecisionRef?
retention:
  pinnedBy[]
  availability: AVAILABLE | UNAVAILABLE | UNKNOWN
  policyRevision
createdAt
```

Minimum validation on read:

```text
requested ref/path
  -> manifest entry exists
  -> requested producer work-order/revision matches manifest
  -> payload resolves
  -> content digest matches manifest
  -> return ordinary { content, sourceRef }
```

The adapter should remain compatible with `resolveQaContext(...)`; no QA WorkOrder/Context schema expansion is required for the first pilot.

## Retention semantics

Retention is a storage obligation, not correctness evidence.

For one project-bound consumer, derive operational pins from durable Board refs while work may still need to continue or be independently reviewed. At minimum, artifact payloads referenced by nonterminal work should stay pinned across:

```text
READY / REOPENED
CLAIMED
PENDING_REVIEW
REVIEWING
PENDING_RECONCILIATION
BLOCKED
```

`DONE` or `SUPERSEDED` may release the **operational payload pin** according to a configured retention policy, but the immutable manifest/provenance record should remain inspectable for the policy's audit horizon. Releasing a pin does not delete history silently: the manifest can transition availability to `UNAVAILABLE` while retaining digest/producer identity.

The application should not promise infinite retention. Policy revision and retention reason must be explicit; storage quotas/TTL remain deployment configuration.

## Availability vs correctness

These states must stay separate:

```text
content identity verified + AVAILABLE
content identity known + UNAVAILABLE
content identity missing / manifest missing
content returned but digest/revision mismatch
```

`AVAILABLE` does not prove an artifact is correct. Conversely, an accepted historical decision can remain historically inspectable even when its payload is no longer retained, as long as the manifest makes unavailability explicit instead of serving substituted bytes.

## Compatibility and failure semantics

The first pilot should wrap one existing `artifactReader`; callers still invoke `readArtifact(...)` with the same request. Existing valid artifacts continue to resolve.

Suggested typed diagnostics:

```text
ARTIFACT_MANIFEST_MISSING
ARTIFACT_PRODUCER_MISMATCH
ARTIFACT_PRODUCER_REVISION_MISMATCH
ARTIFACT_UNAVAILABLE
ARTIFACT_CONTENT_MISMATCH
```

`resolveQaContext(...)` may continue wrapping source errors with the concrete artifact ref while preserving the cause/code for machine handling. Missing/unavailable content blocks continuation; identity mismatch fails closed as an integrity boundary.

No fallback should silently skip validation once the manifest adapter is enabled.

## Cost / experiment budget

Observed deterministic work per artifact in the prototype is one manifest lookup, one underlying read for manifest-valid requests, and one content hash. No network/storage latency measurement was performed.

For implementation evaluation, predeclare:

- maximum artifact count per QA handoff;
- manifest lookup/read overhead budget;
- payload size/hash overhead budget;
- retention policy revision and maximum operational pin horizon;
- restart scenarios: unchanged, changed, missing, wrong producer/revision and partial set.

If measured overhead exceeds the configured budget without preventing demonstrated integrity/continuation failures, the addon should remain opt-in or be rejected.

## Implementation handoff

If architecture/research review accepts this boundary, a bounded delivery slice should:

1. implement `createManifestArtifactReader({ reader, manifestStore, retentionPolicy })` in Agentic Application;
2. keep `ApplicationArtifactRef` and QA schemas compatible for the first pilot;
3. bind manifest identity to `ref/path + producerWorkOrderId + revision`, with immutable content digest;
4. fail closed on missing manifest or identity mismatch and return explicit unavailable diagnostics;
5. derive/persist operational retention pins for one durable Backend -> QA project from current Board lifecycle refs without copying payloads into Blackboard;
6. retain immutable manifest metadata after payload pin release for the configured audit horizon;
7. add restart tests covering all probe scenarios plus multi-artifact partial availability;
8. measure lookup/hash/storage overhead against the weak-reader baseline and report the evidence class.

## Conclusion

The current ref-only application contract is sufficient when a concrete artifact source already guarantees immutable revision-bound reads, but that guarantee is not currently explicit or portable across adapters. BB-039 therefore supports a narrow optional manifest adapter at the application artifact boundary.

The demonstrated value is fail-closed content/revision identity and explicit unavailability across restart scenarios. The proposal does **not** make availability correctness authority, does not move payloads into Blackboard, and does not justify a global artifact registry or new Core abstraction.
