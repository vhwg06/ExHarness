# Implementable-value research: durable payloads and Advisor continuation

Status: reproduced behavior; proposed fixes pending implementation and review.

Source revision: `ca6a7697d82c43bec075317b83b6a5449f4bd92e`.
Reproduce: `node docs/living/knowledge/value-probes-2026-09-16.mjs`.
The probe imports current application modules and uses an injected in-memory filesystem implementing the JSON store's actual write/read behavior. It does not modify real project state or contact providers. Assertions describe the observed defects; after fixes they should fail and be replaced by proper regression expectations in the relevant test suites.

## V1: acknowledged checkpoint differs from persisted checkpoint

`checkpoint(...)` accepts cloneable objects, and `normalizeItem(...)` clones them. `saveUnlocked(...)` serializes them with JSON without ensuring that serialization preserves their meaning. Its returned snapshot/result still contains the pre-serialization values.

Observed through the actual Orchestrator and JSON store:

```text
returned pending: Map { experiment-1 => needs-review }
reloaded pending: {}
returned score: NaN
reloaded score: null
```

This proves silent data loss for accepted generic checkpoint payloads. It does not establish a failure in the current built-in Backend/QA checkpoint, which uses plain JSON values. It matters directly for BB-026/027 research continuation and external users of the public checkpoint API.

Implementation handoff: validate persisted payloads before mutation/save, using an explicit JSON-safe value contract or an explicitly versioned codec. Prefer rejection with a field path over lossy implicit conversion. Check all arbitrary persisted fields, preserve valid existing JSON snapshots, and keep the returned acknowledged state semantically identical to what a fresh load sees. Map/Set/Date, non-finite numbers, undefined, cycles and BigInt require explicit handling tests. Rejected input must not release ownership or change the prior durable snapshot.

Value gate: every acknowledged supported payload survives a save/load comparison unchanged; unsupported payloads fail before state transition. This is data-integrity value measurable without real-provider infrastructure.

Disposition: BB-041; link the consumer requirement to BB-026/027 without duplicating their research scope.

## V2: Advisor continuation instructions are lost at the durable boundary

`runBackendObjective(...)` converts valid Advisor proposals into `decision.action` values including ESCALATE and REQUEST_CONTEXT. `runBackendStage(...)` branches only on `completion.action`, persists the old stage checkpoint and returns REOPENED for CONTINUE.

The probe deliberately uses a synthetic Worker and a completion policy with no required evidence claims/artifacts to isolate continuation routing. It does not prove real task quality or bypass default production acceptance requirements. Review trust callbacks reject all trust, and QA is never invoked.

Observed for both Advisor actions:

```text
completion: CONTINUE; decision: ESCALATE or REQUEST_CONTEXT
persisted status: REOPENED; blockers: []
requested client contract: absent from persisted item
second advance: Backend executes again with the same objective
```

Implementation handoff: define the application-owned transition for each existing BackendRunAction. Persist the relevant gap IDs, context request and decision rationale/provenance when coordination is required. Validate an Orchestrator decision before dispatch; Advisor remains a proposal source. Supply an explicit resolution/resume path and keep retry behavior for accepted retry decisions. Preserve fail/block handling and QA's accepted-Backend prerequisite.

Value gate: the escalation/context-request scenarios survive reconstruction, do not blindly execute Backend again, and resume exactly the intended stage after the requirement is explicitly resolved. Count dispatches and inspect retained request data; no speculative efficiency percentage is required.

Disposition: BB-042. BB-018/020 still own broader review and PM/SA design; this is a concrete gap in the already implemented Advisor-to-durable-workflow composition.

## Selection outcome

Only these two grounded, bounded fixes are added by this review. Both name an existing consumer, a code integration point and a pass/fail value gate. No new framework or optional provider dependency is needed to begin implementation. No runtime fix has been applied by this research.
