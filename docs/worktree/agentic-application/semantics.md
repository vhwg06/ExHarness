# Agentic Application semantics

Current implemented semantic model for the Agentic Application. These definitions describe concrete meanings already present in source, not desired generic APIs or future roles.

## Durable project intent

`UserIntent` is the durable user-owned project intent root used by session handoff. A handoff-safe project has exactly one root; current work must trace directly or transitively to it. Optional `projectId` binds that Board/root to one stable project identity.

User intent is project input, not a Worker prompt, Core runtime state, review verdict or completion claim.

## ApplicationOrchestrator

`ApplicationOrchestrator` is the concrete deterministic owner of Blackboard lifecycle transitions.

It owns eligibility/dependency checks; claim/checkpoint/block/submit; claim-generation fencing/recovery; Worker-requested and PM-required review obligations; review dispatch/generation fencing; trusted assessment application; finding reconciliation; and derived terminal/reopen/block state.

It does not execute model/runtime loops, resolve source bytes, decide Core effect truth or treat Worker/reviewer prose as correctness authority. It is an application/Board controller, not a generic workflow graph engine or DSL.

## Backend

Backend is the implemented mutating/promoting application role:

```text
BackendObjective
BackendWorkOrder
BackendContext
BackendWorkResult
BackendWorker
```

Context is resolved before execution through Oracle. Execution uses ExHarness Core. `APPLIED` requires committed-lineage advancement, and completion is grounded from required runtime/evidence artifacts rather than Worker prose.

Interrupted Backend execution is special: application generation fencing cannot prove external-effect truth, so recovery must consult the persisted Backend Core session/effect boundary before deciding whether execution may continue.

## QA

QA is the implemented non-mutating verification role over one accepted Backend target:

```text
QaObjective
QaWorkOrder
QaContext
QaWorkResult
QaWorker
```

QA consumes the exact accepted Backend revision/artifact handoff, cannot advance lineage or mutate the application environment, and grounds behavior/regression evidence.

QA issues request bounded remediation. QA acceptance is role-local and flows to review/acceptance; it does not make the Blackboard item `DONE`.

Because QA is non-mutating at the application environment boundary, interrupted QA may be redispatched against the exact accepted Backend target after the abandoned claim generation is fenced.

## BackendAdvisor

`BackendAdvisor` is the current bounded judgment surface for the concrete Backend slice. It is consulted only after required objective evidence passes and semantic gaps remain.

Advisor output may propose retry, context request or escalation. It is not execution, source-resolution, acceptance or lifecycle authority. `REQUEST_CONTEXT` / `ESCALATE` become durable application coordination state resolved through application-owned transitions.

No generic Advisor registry/API is implied.

## Work-order semantics

Backend and QA WorkOrders are explicit role-specific application artifacts that bind execution to objective, required semantic context, accepted upstream identity/revision where applicable, constraints and expected completion semantics.

Application contracts decide what context is semantically required. Oracle only satisfies that declared requirement. There is no implemented generic role-independent WorkOrder schema.

## Context semantics

```text
Application declares required context
  -> Oracle resolves declared sources
  -> concrete Context validation
  -> concrete Worker execution
```

Backend repository context and QA application-artifact context are distinct source/provenance boundaries. Hidden ambient context injection is not part of the application contract.

## Result and completion semantics

`BackendWorkResult` and `QaWorkResult` are role-specific results; returned prose/status alone is not completion authority.

```text
Worker result
  -> grounded evidence / lineage checks
  -> role completion decision
  -> application continuation
```

Role-local acceptance remains distinct from project acceptance. There is no implemented generic WorkResult contract.

## Backend -> QA handoff

```text
accepted Backend revision
+ application artifact refs
+ Backend acceptance-decision provenance
    -> BackendQaHandoff
    -> durable QA_PENDING
    -> Oracle-resolved QaContext
    -> QA
```

Artifact payload bodies are not copied into the handoff. With manifest protection, the exact producer manifest ref must be durable before protected `QA_PENDING`; that ref is continuation integrity/provenance, not acceptance authority.

## Review semantics

```text
Worker submission -> REQUEST review
PM obligation     -> REQUIRE review

REQUEST != REQUIRE != DISPATCH != ASSESS != ACCEPT
```

The Orchestrator owns review lifecycle. A trusted assessment must bind to the exact active review subject/generation and satisfy application trust policy before mutating Board state.

Current source supports PM-sourced review requirement transport. It does **not** implement a concrete PM runtime Worker or SA runtime Worker. The promoted PM/SA split is therefore an authority boundary, not a claim that both horizontal roles execute today.

## Control topology

```text
ApplicationOrchestrator
  -> concrete WorkOrder + resolved Context
  -> BackendWorker or QaWorker
  -> grounded role completion
  -> ApplicationOrchestrator
```

Worker-to-Worker conversation takeover is not control authority. A Worker cannot implicitly select the next Worker or transfer global lifecycle ownership.

## Boundary semantics

```text
Agentic Application = project/work/role meaning + Blackboard lifecycle + stage/review/acceptance ordering
Oracle              = declared source resolution / dereference / adaptation
ExHarness Core       = execution/runtime + cognition + evidence/trust/effect/recovery primitives
Infrastructure       = concrete repository/artifact/storage/executor/network/process authority
```

These states may reference one another but must not silently become another boundary's source of truth.

## Explicitly not implemented as generic semantics

Current source does not claim a generic Worker, WorkOrder/WorkResult, Advisor registry, PM runtime Worker, SA runtime Worker, Reviewer registry, role registry, workflow graph/DSL, group-chat speaker selection, or a second runtime/session/memory/recovery system around ExHarness.
