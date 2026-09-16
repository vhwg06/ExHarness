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
        +-> extend bounded work/dependency/review graph for current coordination target
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

`extendWorkGraph(...)` is an Orchestrator-owned concrete mutation primitive. It binds mutation to an exact expected target lifecycle tuple, then atomically applies fresh READY work, bounded dependency edges, coordination refs/evidence, blockers and PM-sourced review requirements in one Blackboard transaction. It permits dependency extension only for the current target or work created in that same extension, rejects forged fresh-work lifecycle history and conflicting duplicate work, and validates the complete dependency graph before commit.

`createJsonBlackboardStore(...)` remains the durable local Board store used by this lifecycle.

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
   |
   +-> PM/project coordination may REQUIRE concrete review
```

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
              |     [exact target fence
              |      + work/deps/refs/blockers/review requirements atomically]
              +-> beginReview(...)
```

PM proposal and SA assessment are application-local, ref-only durable artifacts. They are proposal/judgment state, not lifecycle authority. The controller reconstructs the project-bound handoff, validates project/root/target/evidence semantics, persists a content-addressed proposal and then asks the Orchestrator to re-check the exact target lifecycle state inside the canonical mutation transaction before publishing any graph/review change.

PM may propose prerequisite work, dependency edges, blockers that optionally link existing unresolved work and PM-sourced review requirements grounded by a durable SA assessment. PM cannot rewrite user intent or carry architecture/completion/review verdict authority. SA may assess architecture evidence and require architecture review, but cannot own project priority, dependency/timeline mutation or lifecycle transitions.

A no-op PM proposal is a non-mutating fallback, but it is still checked against the exact current target lifecycle state. For a mutating proposal, the proposal ref is linked in the same canonical transaction as its graph/review effects. A later retry that observes that exact ref already linked treats the original atomic application as complete instead of reapplying a now-stale lifecycle tuple. An artifact written without a successful Board mutation remains orphaned and is not project lifecycle truth.

Fresh-session recovery follows Blackboard artifact refs and reconstructs only coordination artifacts that have been canonically linked from the Board.

## Boundaries visible in source

- Application contracts own required semantic context and completion semantics.
- Oracle functions perform concrete source IO/adaptation before Worker execution.
- Workers use ExHarness Core rather than owning a second model/runtime lifecycle.
- Backend mutates/promotes; QA inspects a fixed accepted revision and forbids mutation.
- Backend -> QA carries artifact references and acceptance provenance, not copied artifact contents.
- `BackendAdvisor` is a narrow bounded-judgment component; it is not dispatch or correctness authority.
- `ApplicationOrchestrator` owns durable Blackboard lifecycle transitions; Worker submission alone cannot produce `DONE`.
- bounded PM/SA components can propose or assess coordination state but cannot mutate Blackboard directly.
- PM and SA receive separate context projections; there is no universal horizontal-role context.
- PM proposal validation outside the transaction is advisory; the Orchestrator re-fences the exact target lifecycle tuple inside the canonical mutation transaction.
- PM graph/ref/blocker/review-requirement effects are one atomic Board mutation, not a sequence of partially authoritative writes.
- SA context and persisted assessment refs must remain grounded in evidence currently linked to the target work.
- partial checkpoints are continuation state, not acceptance state.
- review requirements distinguish Worker request from PM requirement; application orchestration must not fabricate either source.
- rejected/inconclusive review reopens current work; follow-up creation is a separate reconciliation decision.
- application checkpoint persistence does not prove external-effect completion; Core effect/recovery authority remains separate.

## Abstractions that still do not exist

There is no generic `Worker<C,R>`, generic `WorkOrder<C,R>`, generic Advisor, role registry, workflow graph, Teacher registry or Reviewer registry in current source.

The PM/SA implementation is a concrete application-local coordination controller plus concrete contracts/stores; it is not a generic role runtime, generic horizontal-role framework or parallel lifecycle engine.

`ApplicationOrchestrator` is concrete Board/workflow control code, not a generic workflow graph/DSL or a second agent runtime.

Open implementation pressure lives in the Blackboard, not in this architecture document.
