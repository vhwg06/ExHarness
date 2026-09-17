# BB-039: artifact identity across Backend to QA handoff

Status: **CALIBRATED EVIDENCE — REVIEW REQUIRED**. Runtime adoption is not implied.

Reproduce: `npm run eval:artifact-manifest-research`.
Evidence class: `DETERMINISTIC_FRESH_SESSION_FIXTURE`.
Production evidence: `false`.

## Review calibration

The executable BB-039 evidence proves reconstruction through a fresh `JsonBlackboardStore`, `ApplicationOrchestrator`, project-bound `SessionHandoffSurface`, and separately reconstructed filesystem-backed artifact/manifest reader inside the fixture process. It does **not** spawn a second OS process and therefore does not establish an OS process-restart boundary.

This revision narrows the research claim to the evidence actually exercised: **fresh-session / fresh-reader reconstruction from durable Blackboard and filesystem state**. It does not add a new experiment or widen the evidence class. Canonical BB-039 review remains open until an exact-head research-method review accepts this calibrated claim.

## Question

Can a fresh session continuing the durable Backend -> QA workflow distinguish verified, changed, missing and provenance-mismatched artifact content before QA uses it, while keeping the Blackboard ref-only and keeping artifact identity separate from correctness?

## Consumer and current behavior

The concrete consumer is the durable Backend -> QA continuation path. Accepted Backend state is persisted in the Blackboard checkpoint as `acceptedBackend.handoff`, while artifact refs and the Backend acceptance decision remain durable refs/provenance. A later QA session reconstructs the project through the project-bound session-handoff surface, builds a `QaWorkOrder`, and `resolveQaContext(...)` delegates bytes to the injected `artifactReader`.

The current reader contract does not itself require an immutable producer-side content identity. A concrete reader backed by immutable revision-bound storage may already provide stronger guarantees; BB-039 does not claim that all readers are defective.

## Review blocker closed by the executable fixture

The earlier canonical probe serialized a manifest but kept its artifact `Map` and resolver in the same process. That was insufficient for the Board criterion requiring a **fresh session** to distinguish verified, changed and unavailable content. It also relied on code inspection for producer-work-order and acceptance-decision provenance checks rather than executing negative cases.

The corrected probe now uses the existing durable boundaries directly:

```text
producer session
 -> project-bound SessionHandoffSurface.initialize(...)
 -> claim Backend/QA continuation item
 -> checkpoint QA_PENDING-like acceptedBackend.handoff
 -> persist artifact refs + acceptance decision in JSON Blackboard
 -> persist producer manifest + artifact records in filesystem fixture store

fresh session
 -> new JsonBlackboardStore + ApplicationOrchestrator instance
 -> new project-bound SessionHandoffSurface.read()
 -> recover acceptedBackend.handoff + artifact refs from durable Board
 -> makeQaWorkOrder(...)
 -> reconstruct filesystem-backed artifact/manifest reader
 -> resolveQaContext(...)
```

No producer-side in-memory record map or producer Orchestrator is reused by the QA-side check. The producer and fresh-session reconstruction still execute within one OS process; no stronger process-restart claim is made.

## Predeclared deterministic scenarios

Every scenario reconstructs a new session from the persisted Blackboard and filesystem-backed stores. The same QA objective and two-artifact handoff shape are used in baseline and manifest modes.

| Scenario | Current reader | Manifest reader |
| --- | --- | --- |
| unchanged content/provenance | PASS | PASS |
| changed content behind stable ref | PASS | `CONTENT_MISMATCH` |
| first artifact missing | `MISSING_ARTIFACT` | `MISSING_ARTIFACT` |
| same ref/content path with wrong stored producer revision | PASS | `REVISION_OR_PROVENANCE_MISMATCH` |
| partial artifact set | `MISSING_ARTIFACT` | `MISSING_ARTIFACT` |
| manifest unavailable | PASS | `MANIFEST_UNAVAILABLE` |
| wrong producer work-order id in durable handoff | PASS | `REVISION_OR_PROVENANCE_MISMATCH` |
| wrong acceptance-decision id in durable handoff | PASS | `REVISION_OR_PROVENANCE_MISMATCH` |
| wrong acceptance-decision digest in durable handoff | PASS | `REVISION_OR_PROVENANCE_MISMATCH` |

The five identity/provenance violations that remain invisible to the weak baseline are rejected by the manifest reader. Existing missing-content behavior remains existing value and is not counted as manifest improvement.

The fixture asserts that every case reconstructed its artifact refs and accepted Backend handoff through a fresh `SessionHandoffSurface`. The manifest contains identity/provenance metadata and content digests only; it never embeds artifact bodies.

## What the result establishes

The result supports one narrow application boundary:

> For mutable/ref-addressed artifact storage, an opt-in application-owned reader can fail closed on content/provenance drift after fresh-session reconstruction when it resolves a durable producer-side manifest before returning QA context.

The manifest binds:

```text
ref + path
producer work-order id
producer revision
acceptance-decision id + digest
stored artifact revision
content digest
```

The executable fixture establishes fresh-session reconstruction plus explicit work-order/acceptance-decision negative coverage. The application/architecture-boundary review on PR #108 accepted this boundary, and the prior research-method review was explicitly scoped to `DETERMINISTIC_FRESH_SESSION_FIXTURE`. This calibration requires a new exact-head research-method review only to verify that the durable prose no longer exceeds that executable evidence. It still does not deliver a runtime manifest adapter.

## Implementation handoff

Recommendation remains **NARROW** to one optional application-owned artifact adapter with a durable manifest store.

1. Capture each accepted Backend artifact's identity at the producer boundary and durably persist the manifest before making the QA continuation visible. Do not construct the first trusted manifest by re-reading mutable bytes in the later QA session.
2. At `readArtifact(request)`, locate the exact manifest and require exact producer work order, acceptance decision, producer/stored revision and content digest before returning ordinary `{ content, sourceRef }`.
3. Distinguish missing bytes, unavailable manifest and identity/provenance mismatch. Enabling the manifest adapter must not silently fall back to an unvalidated read.
4. Pin the manifest plus referenced bytes while durable nonterminal execution/review/reconciliation work still needs them. Payload retention is an operational obligation, not correctness evidence; after configured release, historical metadata may remain while bytes explicitly become unavailable.
5. Preserve current ref-only behavior when the addon is disabled. Readers with independently guaranteed immutable/revision-bound storage do not need to be forced through this adapter by BB-039 alone.
6. A delivery follow-up must measure lookup/hash/storage overhead and producer/checkpoint crash behavior on one real artifact store before runtime-default adoption.

## Retention boundary

Pending execution and acceptance states may pin payloads, including `QA_PENDING`, Backend remediation, blocked continuation, `PENDING_REVIEW`, `REVIEWING` and `PENDING_RECONCILIATION`. Terminal disposition may release the operational payload pin according to configured retention policy while immutable manifest/provenance metadata remains for the configured audit horizon.

Retention does not prove availability forever, content correctness, Backend acceptance correctness, or QA correctness.

## Limitations

- deterministic local filesystem fixture only;
- fresh-session / fresh-reader reconstruction occurs within one OS process; process-restart behavior is not established by this evidence;
- no production artifact store, outage distribution, latency or storage-cost measurement;
- no external model/provider calls;
- no statistical generalization claim;
- the digest is useful only relative to a producer-side manifest with an appropriate trust boundary;
- if an attacker can rewrite both manifest and content under the same authority, this check is not independent authenticity evidence;
- manifest verification establishes identity/provenance consistency, not semantic correctness or acceptance.

Disposition: **NARROW / REVIEW REQUIRED** as calibrated research support for D014. Runtime adoption remains separately gated.