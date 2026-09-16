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
- a claimed owner may persist a partial-work checkpoint before final submission;
- checkpoints can release work as `REOPENED` or preserve exact continuation state while `BLOCKED`;
- blocked work can be resumed to `REOPENED`; unfinished work can be superseded/canceled;
- a claimed Worker owner may submit an immutable result payload and Worker-sourced review requests;
- PM-sourced review requirements can be added separately from Worker requests;
- submitted work becomes `PENDING_REVIEW`, never directly `DONE`;
- one explicit reviewer assessment is active at a time;
- all required reviews must be `ACCEPTED` and remaining work must be empty before `DONE` is derived;
- `REJECTED`/`INCONCLUSIVE` review reopens the same item and narrows remaining work;
- follow-up reconciliation distinguishes current obligation, existing work, genuine new work and non-actionable findings;
- checkpoints, submissions and pending review state survive reconstruction through the JSON store.

The package also exposes a concrete session-handoff surface:

- `defineUserIntent(...)` validates the durable user-owned objective, bullets and constraints;
- `createSessionHandoffSurface(...).initialize(...)` seeds one durable intent root plus initial work traceable to that root;
- `createSessionHandoffSurface(...).read()` projects the current Board into fresh-session lifecycle buckets;
- the projection includes current work checkpoints plus eligible/claimed/pending-review/reviewing/pending-reconciliation/blocked/done/superseded work and artifact/evidence refs with item provenance;
- a Board without exactly one durable user-intent root fails closed as not handoff-safe;
- work that cannot trace directly or transitively to the durable user intent is rejected by the handoff projection.

## Durable Backend -> QA application path

`createDurableBackendQaWorkflow(...)` binds the concrete Backend/QA verticals to Blackboard checkpoints.

Current state transitions are:

- initialization persists validated Backend + QA objectives before Worker execution;
- `BACKEND_PENDING` executes Backend from the persisted spec;
- accepted Backend completion persists a ref-only `BackendQaHandoff` plus acceptance-decision provenance as `QA_PENDING`;
- a fresh process/session can reconstruct the same Board and continue QA without prior conversation state;
- QA issues persist as `BACKEND_REMEDIATION_PENDING`; remediation uses the last accepted Backend revision as its new repository base;
- artifact/context lookup failure blocks while preserving the exact `QA_PENDING` checkpoint; resume retries from that checkpoint;
- QA acceptance clears the partial checkpoint and creates a final Blackboard submission with Backend/QA decision refs and artifact refs;
- final application submission requests independent acceptance and therefore remains `PENDING_REVIEW` rather than self-authorizing `DONE`.

The older `runBackendThenQaObjective(...)` direct composition remains available as an in-session path. It is not the durable cross-session workflow surface.

Application checkpoints do not prove whether an external side effect completed across a crash window. Core effect/persistence authority remains separate and unresolved under the Core recovery work.

## Current composition

Shared shapes proven in source remain deliberately narrow:

- `ApplicationArtifactRef`;
- evidence integrity / required-claim state plumbing;
- Blackboard item/review/follow-up/checkpoint state required for durable orchestration;
- durable `UserIntent` plus read-only session-handoff projection over Blackboard state;
- concrete Backend -> QA workflow checkpoint semantics earned by the existing Backend and QA slices.

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
