# Agentic Application current architecture

This file describes the application architecture implemented in `packages/agentic-system/` today.

## Concrete Backend -> QA execution

```text
BackendObjective
      |
      v
BackendWorkOrder -----> resolveBackendContext -----> repositoryReader
      |                         |
      |                    BackendContext
      v                         v
BackendWorker --------------> ExHarness Core
      |
      v
BackendWorkResult
      |
      v
BackendCompletionPolicy
      |
      +---- CONTINUE/BLOCK/FAIL
      |
      +---- ACCEPT
              |
              v
        BackendQaHandoff (refs + acceptance provenance)
              |
              v
          QaWorkOrder -----> resolveQaContext -----> artifactReader
              |                    |
              |                 QaContext
              v                    v
           QaWorker -----------> ExHarness Core
              |
              v
        QaCompletionPolicy
```

`runBackendThenQaObjective(...)` still composes this path directly for one-session execution.

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

`createJsonBlackboardStore(...)` serializes mutations and persists Board state through temp-file write + rename so checkpoints, pending review and submitted refs survive a new Orchestrator instance/process session.

## Durable Backend -> QA composition

`createDurableBackendQaWorkflow(...)` is the first concrete consumer of partial-work checkpoints.

```text
READY work item
   |
   v
initialize persisted workflow spec
   |
   v
BACKEND_PENDING
   |
   | Backend ACCEPT
   v
QA_PENDING
  [ref-only BackendQaHandoff
   + Backend acceptance decision]
   |
   +---- artifact/context unavailable ----> BLOCKED
   |                                         |
   |                                      resume
   |                                         |
   +<----------------------------------------+
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
```

The workflow persists validated Backend and QA objectives before execution, so later sessions do not need previous conversation state to reconstruct the next application stage.

Backend completion and QA completion remain role-local decisions. QA acceptance creates a final application submission but does not authorize Blackboard `DONE`; independent application acceptance remains a separate review boundary.

## Boundaries visible in source

- Application contracts own required semantic context and completion semantics.
- Oracle functions perform concrete source IO/adaptation before Worker execution.
- Workers use ExHarness Core rather than owning a second model/runtime lifecycle.
- Backend mutates/promotes; QA inspects a fixed accepted revision and forbids mutation.
- Backend -> QA carries artifact references and acceptance provenance, not copied artifact contents.
- `BackendAdvisor` is a narrow bounded-judgment component; it is not dispatch or correctness authority.
- `ApplicationOrchestrator` owns durable Blackboard lifecycle transitions; Worker submission alone cannot produce `DONE`.
- partial checkpoints are continuation state, not acceptance state.
- review requirements distinguish Worker request from PM requirement, while reviewer identity/assessment stays explicit.
- rejected/inconclusive review reopens current work; follow-up creation is a separate reconciliation decision.
- application checkpoint persistence does not prove external-effect completion; Core effect/recovery authority remains separate.

## Not yet implemented as current source roles

The promoted architecture decision D003 distinguishes horizontal PM and SA semantics and vertical context-bound reviewers. Concrete PM context/role execution, SA context/role execution and vertical reviewer slices are not implemented yet and therefore are not claimed here as current source behavior.

## Abstractions that still do not exist

There is no generic `Worker<C,R>`, generic `WorkOrder<C,R>`, generic Advisor, role registry, workflow graph, Teacher registry or Reviewer registry in current source.

`ApplicationOrchestrator` is concrete Board/workflow control code, not a generic workflow graph/DSL or a second agent runtime.

Open implementation pressure lives in the Blackboard, not in this architecture document.
