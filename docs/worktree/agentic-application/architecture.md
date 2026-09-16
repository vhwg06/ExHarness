# Agentic Application current architecture

This file describes the application architecture implemented in `packages/agentic-system/` today.

## Concrete Backend -> QA execution

```text
BackendObjective
      |
      v
prepareBackendObjective
      |
      +----> BackendWorkOrder -----> resolveBackendContext -----> repositoryReader
      |                                      |
      |                                 BackendContext
      v                                      v
prepared { objective, order, context } ----> BackendWorker ----> ExHarness Core
                                                  |
                                                  v
                                         BackendWorkResult
                                                  |
                                                  v
                                      BackendCompletionPolicy
                                                  |
                          +-----------------------+------------------+
                          |                                          |
                 CONTINUE/BLOCK/FAIL                              ACCEPT
                                                                     |
                                                                     v
                                                       BackendQaHandoff
                                                  (refs + acceptance provenance)
                                                                     |
                                                                     v
                                                            QaWorkOrder
                                                                     |
                                                   resolveQaContext -> artifactReader
                                                                     |
                                                                  QaContext
                                                                     |
                                                                     v
                                                                  QaWorker
                                                                     |
                                                                     v
                                                             ExHarness Core
                                                                     |
                                                                     v
                                                          QaCompletionPolicy
```

`runBackendObjective(...)` and `recoverBackendObjective(...)` are compatibility wrappers over the same Backend-specific preparation boundary. `runBackendThenQaObjective(...)` still composes the direct one-session path.

Current Backend preparation/recovery details are documented in `backend-preparation.md`.

## Orchestrator-owned Blackboard lifecycle

The application has a durable Blackboard-control slice:

```text
createApplicationOrchestrator(...)
        |
        v
JSON-backed Blackboard store
        |
        +-> claim READY/REOPENED work
        +-> checkpoint partial progress
        |      +-> REOPENED for continuation
        |      +-> BLOCKED with exact checkpoint retained
        +-> resume BLOCKED -> REOPENED
        +-> supersede unfinished work
        +-> submit immutable result refs
        +-> record Worker-requested or PM-required review obligations
        +-> begin one explicit review
        +-> record assessment
        |      +-> all required accepted + no remaining work -> DONE
        |      +-> rejected/inconclusive -> REOPENED
        |
        +-> reconcile finding
               +-> CURRENT_WORK -> REOPEN
               +-> EXISTING_WORK -> LINK
               +-> NEW_WORK -> CREATE with origin provenance
               +-> NON_ACTIONABLE -> no Board work
```

`createJsonBlackboardStore(...)` persists durable Board state through its fenced revision chain so checkpoints, pending review and submitted refs survive a new Orchestrator instance/process session.

## Durable Backend -> QA composition

`createDurableBackendQaWorkflow(...)` is the concrete consumer of partial-work checkpoints.

```text
READY work item
   |
   v
initialize persisted workflow spec
   |
   v
BACKEND_PENDING
   |
   +---- Backend repository/context unavailable ---> BLOCKED
   |                                                 |
   |                                              resume
   |                                                 |
   +<------------------------------------------------+
   |
   | Backend ACCEPT
   v
QA_PENDING
  [ref-only BackendQaHandoff
   + Backend acceptance decision]
   |
   +---- artifact/context unavailable ------------> BLOCKED
   |                                                 |
   |                                              resume
   |                                                 |
   +<------------------------------------------------+
   |
   | QA ISSUES_FOUND
   v
BACKEND_REMEDIATION_PENDING
   |
   | remediation runs from last accepted revision
   +-------------------------------> QA_PENDING
   |
   | QA ACCEPT
   v
final submission
   |
   v
PENDING_REVIEW
   |
   +-> PM/project coordination may REQUIRE concrete review
```

Backend preparation happens after the exact work generation is claimed but before the Worker/Core boundary. A preparation failure is therefore persisted as application lifecycle state only when Worker/Core has not been entered.

The durable checkpoint carries `backendRecoveryRequired` so a source outage during interrupted Backend recovery cannot later resume as fresh mutating execution. When this flag is set, restored source context re-enters `BackendWorker.recover(...)` and Core effect/session truth remains the replay authority.

The workflow persists validated Backend and QA objectives before execution, so later sessions do not need previous conversation state to reconstruct the next application stage.

Backend completion and QA completion remain role-local decisions. QA acceptance creates a final application submission but does not authorize Blackboard `DONE` and does not impersonate a Worker review request. Project/PM review requirement remains a separate authority path.

## Boundaries visible in source

- Application contracts own required semantic context and completion semantics.
- Oracle functions perform concrete source IO/adaptation before Worker execution.
- Backend has an explicit read-only preparation phase before mutating Worker/Core execution.
- A Backend preparation failure may become durable `BLOCKED`; Worker/Core failures are not flattened into source-resolution blockers.
- Workers use ExHarness Core rather than owning a second model/runtime lifecycle.
- Backend mutates/promotes; QA inspects a fixed accepted revision and forbids mutation.
- Backend -> QA carries artifact references and acceptance provenance, not copied artifact contents.
- `BackendAdvisor` is a narrow bounded-judgment component; it is not dispatch or correctness authority.
- `ApplicationOrchestrator` owns durable Blackboard lifecycle transitions; Worker submission alone cannot produce `DONE`.
- partial checkpoints are continuation state, not acceptance state.
- review requirements distinguish Worker request from PM requirement; application orchestration must not fabricate either source.
- rejected/inconclusive review reopens current work; follow-up creation is a separate reconciliation decision.
- application checkpoint persistence does not prove external-effect completion; Core effect/recovery authority remains separate.

## Not yet implemented as current source roles

The promoted architecture decision D003 distinguishes horizontal PM and SA semantics and vertical context-bound reviewers. Concrete PM context/role execution, SA context/role execution and vertical reviewer slices are not implemented yet and therefore are not claimed here as current source behavior.

## Abstractions that still do not exist

There is no generic `Worker<C,R>`, generic `WorkOrder<C,R>`, generic Advisor, role registry, workflow graph, Teacher registry or Reviewer registry in current source.

`ApplicationOrchestrator` is concrete Board/workflow control code, not a generic workflow graph/DSL or a second agent runtime.

Open implementation pressure lives in the Blackboard, not in this architecture document.
