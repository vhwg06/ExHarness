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
        +-> extend bounded work/dependency graph for current coordination target
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

`extendWorkGraph(...)` is an Orchestrator-owned concrete mutation primitive. It may add fresh READY work and dependencies only for the current coordination target or work created in that extension. The exact expected target lifecycle tuple is rechecked inside the same Blackboard transaction; graph changes, artifact/evidence refs, blockers and grounded PM review requirements commit atomically; the full dependency graph is validated before persistence. Replaying the same canonically linked proposal is idempotent, conflicting duplicate work fails closed, and adding a PM review requirement never clears an existing blocker.

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

## Bounded PM / SA coordination

The application now has one concrete horizontal coordination slice rather than a generic role framework:

```text
session handoff + exact project identity
        |
        +-> SA context
        |     +-> target work
        |     +-> architecture facts
        |     +-> current evidence refs
        |     -> durable SA assessment ref
        |
        +-> PM context
              +-> intent
              +-> bounded relevant work/dependencies
              +-> coordination facts
              +-> optional SA assessment ref
              -> durable PM proposal ref
                    |
                    v
          createPmSaCoordinationController(...)
                    |
                    v
             ApplicationOrchestrator
              +-> extendWorkGraph(...)
              |     +-> exact-target fence
              |     +-> graph/refs/blockers
              |     +-> grounded PM review requirements
              |     -> one atomic Blackboard transaction
              +-> beginReview(...)
```

PM proposal and SA assessment are application-local, ref-only durable artifacts. They are proposal/judgment state, not lifecycle authority. The controller re-reads the project-bound handoff, rejects project/root/target-state drift, checks SA evidence refs against the current target and only then delegates canonical mutation to the Orchestrator.

PM may propose prerequisite work, dependency edges, blockers that optionally link existing unresolved work and PM-sourced review requirements grounded by a durable SA assessment. PM cannot rewrite user intent or carry architecture/completion/review-verdict authority. SA may assess architecture evidence and require architecture review, but cannot own project priority, dependency/timeline mutation or lifecycle transitions. Neither role writes Blackboard state directly.

A no-op PM proposal is a non-mutating fallback, but it is still checked against the exact current target lifecycle state. Reapplying the same accepted proposal is idempotent once its proposal ref is canonically linked. A PM review requirement never clears an existing blocker. Fresh-session recovery follows Blackboard artifact refs and reconstructs only coordination artifacts that have been canonically linked from the Board; orphan artifacts are not project lifecycle truth.

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
- bounded PM/SA components can propose or assess coordination state but cannot mutate Blackboard directly.
- PM and SA receive separate context projections; there is no universal horizontal-role context.
- PM coordination changes are fenced against exact project/root/target state at the canonical mutation boundary.
- SA assessment refs must remain grounded in evidence currently linked to the target work.
- partial checkpoints are continuation state, not acceptance state.
- review requirements distinguish Worker request from PM requirement; application orchestration must not fabricate either source.
- rejected/inconclusive review reopens current work; follow-up creation is a separate reconciliation decision.
- application checkpoint persistence does not prove external-effect completion; Core effect/recovery authority remains separate.

## Abstractions that still do not exist

There is no generic `Worker<C,R>`, generic `WorkOrder<C,R>`, generic Advisor, role registry, workflow graph, Teacher registry or Reviewer registry in current source.

The PM/SA implementation is a concrete application-local coordination controller plus concrete contracts/store; it is not a generic role runtime, generic horizontal-role framework or parallel lifecycle engine.

`ApplicationOrchestrator` is concrete Board/workflow control code, not a generic workflow graph/DSL or a second agent runtime.

Open implementation pressure lives in the Blackboard, not in this architecture document.
