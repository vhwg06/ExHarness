# Agentic Application current state

Source-synchronized application-layer projection. All unresolved application work lives in `../../living/blackboard.md`.

## Current roles

### Backend

- concrete `BackendObjective`, `BackendWorkOrder`, `BackendContext`, `BackendWorkResult` and `BackendWorker`;
- context resolved before execution through `resolveBackendContext(...)`;
- Worker executes through ExHarness Core;
- `APPLIED` requires real committed-lineage advancement;
- completion evidence is grounded from ExHarness/runtime artifacts, not trusted from Worker prose;
- default completion requires mutation + typecheck + tests + artifact presence;
- completion emits an acceptance-boundary ExHarness decision artifact;
- bounded `BackendAdvisor` is available only after required objective evidence passes and semantic gaps remain.

### QA

- concrete QA objective/order/context/result/completion shapes;
- consumes only accepted Backend revision/artifact refs;
- context resolved through `artifactReader` before execution;
- mutation and lineage advancement are forbidden;
- grounded evidence claims are `qa.behavior` and `qa.regression`;
- QA issues deterministically request remediation/continuation.

## Current orchestration state

The package exposes `createApplicationOrchestrator(...)` for durable Blackboard lifecycle control and `createJsonBlackboardStore(...)` for JSON persistence.

Implemented Board semantics include:

- only `READY`/`REOPENED` work is claimable and dependencies must already be `DONE`;
- a claimed Worker owner may submit an immutable result payload and Worker-sourced review requests;
- PM-sourced review requirements can be added separately from Worker requests;
- submitted work becomes `PENDING_REVIEW`, never directly `DONE`;
- one explicit reviewer assessment is active at a time;
- all required reviews must be `ACCEPTED` and remaining work must be empty before `DONE` is derived;
- `REJECTED`/`INCONCLUSIVE` review reopens the same item and narrows remaining work;
- follow-up reconciliation distinguishes current obligation, existing work, genuine new work and non-actionable findings;
- `PENDING_REVIEW` state/submission/review requirements survive reconstruction through the JSON store.

The package also exposes a concrete session-handoff surface:

- `defineUserIntent(...)` validates the durable user-owned objective, bullets and constraints;
- `createSessionHandoffSurface(...).initialize(...)` seeds one durable intent root plus initial work traceable to that root;
- `createSessionHandoffSurface(...).read()` projects the current Board into fresh-session lifecycle buckets;
- the projection includes eligible/claimed/pending-review/reviewing/pending-reconciliation/blocked/done/superseded work plus artifact/evidence refs with item provenance;
- a Board without exactly one durable user-intent root fails closed as not handoff-safe;
- work that cannot trace directly or transitively to the durable user intent is rejected by the handoff projection.

The existing `runBackendThenQaObjective(...)` path is **not yet bound to this durable Orchestrator state**. Backend -> QA still composes directly, so one unified durable application dispatch/recovery path is not claimed.

## Current composition

`runBackendThenQaObjective(...)` composes Backend -> QA directly.

Shared shapes proven in source remain deliberately narrow:

- `ApplicationArtifactRef`;
- evidence integrity / required-claim state plumbing;
- Blackboard item/review/follow-up state required for durable orchestration;
- durable `UserIntent` plus read-only session-handoff projection over Blackboard state.

There is still no generic Worker/WorkOrder/Advisor/role registry/workflow graph/Teacher registry/Reviewer registry.

## Promoted but not yet source-implemented roles

D003 promotes the responsibility split:

- PM = horizontal project coordination/timeline/dependency/progress;
- SA = horizontal architecture only;
- remaining execution/review = vertical and context-bound.

Concrete PM context/role execution, SA context/role execution and vertical Reviewer implementations are not present in source yet. They remain implementation pressure on the Blackboard rather than current-state claims.

## Routing

- current application architecture -> `architecture.md`
- current ownership boundaries -> `boundaries.md`
- current workflow -> `workflow.md`
- current contracts -> `contracts.md`
- current decisions/invariants -> `decisions.md`
- all open application gaps/problems -> `../../living/blackboard.md`
