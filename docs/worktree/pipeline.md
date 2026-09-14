# Agentic System delivery pipeline

Canonical active delivery sequence for converging the desired Agentic Application + Oracle + ExHarness Core architecture into a working system.

This pipeline is ordered by **uncertainty reduction**, not by component ownership. Stages are dependency/learning steps, not ten bureaucratic sign-off checkpoints.

## EXECUTION MODEL

```text
WAVE A — prove one real Backend slice
  S1 -> S2 -> S3 -> S4
  one continuous implementation loop
  one review after S4

WAVE B — make success trustworthy
  S5 -> S6

WAVE C — compose real application work
  S7 -> S8

WAVE D — harden and generalize
  S9 -> S10
```

## GLOBAL RULES

1. **Concrete before generic.** No reusable abstraction is promoted before at least two real slices demonstrate the same shape.
2. **Wave A is fully concrete.** Backend-specific types/functions are preferred even when a generic interface looks obvious.
3. **No generic Orchestrator in Wave A.** S4 calls `BackendWorker` directly; rewriting orchestration around a common Worker abstraction belongs to S7 only if the second role proves it.
4. **Application owns semantic context.** Oracle resolves/dereferences it before execution; Oracle never invents role semantics.
5. **Serializer performs no IO.** Oracle resolves content; serializer only renders already-resolved application context for runtime/model consumption.
6. **Completion is not worker prose.** Application completion is derived from structured result/evidence plus application policy.
7. **Evidence remains role-specific until proven common.** Backend tests/typecheck/mutation semantics must not silently become a universal evidence schema.
8. **Stage gates are thinking tools, not mandatory pause points.** Review at wave boundaries unless a real blocker requires earlier intervention.

# WAVE A — ONE CONCRETE BACKEND VERTICAL SLICE

## S1 — Concrete Backend semantics

Start with the actual application objects needed by one real Backend task.

Desired artifacts are concrete, for example:

```text
BackendObjective
BackendContext
BackendContextSchema
BackendWorkOrder
BackendWorkResult
BackendWorker
```

Do not introduce `Worker<C,R>`, `WorkOrder<C,R>`, `ContextRequirement<C>` or a role registry here.

Questions to answer from the real use case:

- what exact information does Backend execution need?
- what must be explicit before dispatch?
- what machine-inspectable result is needed after execution?
- what artifacts/evidence are references rather than copied payloads?

Exit signal: the concrete Backend semantics are sufficient to implement the slice; no generic contract milestone is required.

## S2 — Concrete Backend context resolution

Implement Oracle only for the context the Backend slice actually needs.

```text
Backend request/order
   -> resolveBackendContext(...)
      -> direct source reads/adapters actually required
      -> adapt
      -> BackendContextSchema validation
   -> BackendContext
```

Default to direct/simple integration. MCP, retrieval/RAG, caches or registries are introduced only when a concrete source justifies them.

Resolution failure must identify the declared need/source boundary and must never fabricate missing required context.

## S3 — BackendWorker × ExHarness execution

Prove the actual execution seam:

```text
BackendWorkOrder + BackendContext
        -> BackendWorker
        -> ExHarness Core
        -> BackendWorkResult
```

Pressure-test the concrete shapes here. Change the Backend contracts when execution reveals missing/wrong semantics; do not preserve an abstraction merely because it was designed earlier.

BackendWorker does not resolve its own external context, choose the next Worker, or decide global application completion.

## S4 — Concrete deterministic Backend orchestration

Compose the first end-to-end application path with concrete code.

Conceptually:

```ts
async function runBackendObjective(objective) {
  const order = makeBackendOrder(objective);
  const context = await resolveBackendContext(order);
  const result = await backendWorker.execute(order, context);
  return decideBackendResult(result);
}
```

No generic Worker interface is required. No generic Orchestrator abstraction is required. Hardcoded Backend composition is the desired implementation until a second role exists.

### Wave A review

Review S1-S4 once as one slice.

Single question:

> Can one real Backend objective run end-to-end through Application -> Oracle -> BackendWorker -> ExHarness -> structured Backend result without framework magic?

# WAVE B — TRUSTWORTHY SUCCESS AND BOUNDED JUDGMENT

## S5 — Backend-specific completion and evidence semantics

Define what **Backend completion** means using the real Backend result/evidence produced by Wave A.

Possible Backend-specific evidence includes mutation state, tests, typecheck/build verification, artifact references, gaps and blockers. These are examples for Backend only, not a system-wide evidence contract.

```text
BackendWorkResult
   -> BackendCompletionPolicy
   -> ACCEPT | CONTINUE | BLOCK | FAIL
```

A Worker saying “done” in prose is never sufficient completion authority.

Use ExHarness evidence/trust primitives where appropriate, but application policy owns what evidence is required for the domain work.

## S6 — Advisor judgment boundary

Introduce Advisor only for observed judgment gaps.

```text
deterministic next step known
    -> application code decides directly

planning/ambiguity/stagnation requires judgment
    -> Advisor returns structured proposal/assessment
    -> Orchestrator validates/applies/rejects
```

Advisor never directly mutates application workflow state, dispatches Workers or becomes correctness authority.

# WAVE C — SECOND REAL ROLE AND CONTEXT CHAINING

## S7 — Second real role + extract only proven common abstractions

Add a second concrete role such as Frontend or QA and run a real dependent/adjacent slice.

Only now compare the two slices:

```text
Backend concrete shapes
vs
Frontend/QA concrete shapes
```

Promote an abstraction only where both slices demonstrate the same semantic structure.

This is the first stage where rewriting the concrete S4 orchestration into a generic Worker/WorkOrder/dispatch shape is allowed. If the common shape is still weak, keep duplicated/concrete application code.

Dependency, join and parallel semantics are likewise extracted from real multi-work behavior, not invented in advance.

## S8 — Artifact handoff, dereference and context chaining

Make cross-work context flow explicit without copying large payloads through orchestration state.

```text
WorkResult
   -> ArtifactRef
   -> Application state
   -> next role's semantic context need
   -> Oracle dereference/adapt
   -> resolved next-role context
   -> Serializer
   -> Worker / ExHarness
```

Oracle now resolves two explicitly different source classes:

### External sources

Examples: Git, repository files, docs, OpenAPI endpoints/files, Figma, CI or other external systems.

### Internal application-produced sources

Examples: prior `WorkResult` references, application artifact store entries, produced API contracts, generated files or other artifacts created by earlier work.

These source classes share the Oracle IO/dereference boundary but must remain distinguishable in adapters/provenance because external pull and internal artifact lookup have different lifecycle/storage semantics.

Serializer performs no dereference and no IO. It receives resolved semantic objects and only shapes/renders them for ExHarness/model consumption.

# WAVE D — RESILIENCE AND EVIDENCE-BASED GENERALIZATION

## S9 — Persistence, resilience and recovery composition

After multiple work items exist, determine the minimal durable **application state** actually required, such as objective state, accepted work, dependency status, result/artifact references and pending work.

Keep authorities distinct:

```text
Application workflow state
    != ExHarness persistent/runtime state
    != artifact storage
    != Oracle cache/source state
```

Map retry, resume, cancellation, blockage, partial completion and Worker crash semantics onto existing ExHarness recovery/effect boundaries without duplicating runtime lifecycle machinery.

## S10 — Production evaluation and evidence-based generalization

With at least two real role slices, evaluate the composed system and promote only repeated semantics into reusable abstractions.

Candidate system metrics include:

- task success;
- verification success;
- false-completion rate;
- context precision/relevance;
- context/token cost;
- Oracle resolution failure rate;
- artifact handoff correctness;
- Advisor invocation rate and value-add;
- recovery correctness.

Compare role slices before promoting common Worker/WorkResult/context/dependency/orchestration APIs.

No workflow DSL, dynamic role registry, generic Crew/Team abstraction, MCP-first connector architecture or retrieval framework is added merely because it may be useful later.

## COMPLETION OF THIS PIPELINE

The pipeline is complete when the repository has a production-evaluated multi-role agentic application where:

- application semantics are explicit and typed where boundaries require it;
- deterministic control remains deterministic;
- judgment is bounded and inspectable;
- context is resolved/dereferenced explicitly through Oracle;
- Worker execution uses ExHarness rather than recreating a second runtime;
- completion is grounded in structured results/evidence rather than self-report;
- abstractions are justified by repeated concrete slices.
