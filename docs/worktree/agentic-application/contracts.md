# Agentic Application contract policy

This file defines how application contracts are discovered and promoted. It intentionally does **not** freeze generic Worker/WorkOrder APIs before concrete slices exist.

## PRINCIPLE

Application boundaries must become explicit, typed and runtime-validatable where external/model-produced data crosses a semantic boundary.

But abstraction follows evidence:

> No generic abstraction before at least two concrete slices prove the common shape.

## WAVE A — CONCRETE CONTRACTS ONLY

The first Backend slice should define only concrete application types/functions actually needed by that use case, for example:

```text
BackendObjective
BackendContext
BackendContextSchema
BackendWorkOrder
BackendWorkResult
BackendWorker
resolveBackendContext(...)
runBackendObjective(...)
BackendCompletionPolicy
```

Exact fields come from execution pressure, not from a pre-designed generic framework.

Do not introduce these merely because they seem inevitable:

```text
Worker<C,R>
WorkOrder<C,R>
ContextRequirement<C>
WorkResult<R>
WorkerRegistry
GenericOrchestrator
WorkflowGraph
```

## CONTEXT CONTRACT

The invariant is semantic ownership, not where a schema property is stored:

```text
Application decides WHAT context is required and its semantic shape.
Oracle resolves/dereferences that context before execution.
```

Whether context requirements are role-level, order-level or represented another way must be learned from real slices. Do not encode one form in a generic API before a concrete need demonstrates it.

Runtime validation should use a normal schema mechanism such as Zod-compatible schemas rather than a custom schema framework when validation is required.

## RESULT / COMPLETION CONTRACT

The first result contract is Backend-specific.

It must expose enough machine-inspectable information that application code can decide completion/continuation/blockage without parsing Worker prose.

Backend evidence such as tests, typecheck/build status, mutation state or Backend artifacts remains Backend-specific until another role proves a common evidence envelope.

## SECOND SLICE — EXTRACTION POINT

S7 introduces a second real role such as Frontend or QA.

Only then compare concrete types:

```text
Backend* shapes
vs
Frontend/QA* shapes
```

A common `Worker`, `WorkOrder`, `WorkResult`, dependency or orchestration abstraction may be introduced only for semantics repeated across both slices.

If the common shape is weak or accidental, keep concrete/duplicated application code.

## ADVISOR CONTRACT

Advisor is a later bounded judgment boundary, not a Wave-A generic dependency.

When S6 demonstrates a real judgment gap, define the smallest structured proposal/assessment schema required by that gap. Advisor output remains proposal state; Orchestrator retains control authority.

## ORACLE / EXHARNESS BINDING

Application contracts must not expose Oracle connector implementation details or ExHarness model/session/runtime internals.

```text
Application semantic contract
    -> Oracle resolves context
    -> Worker binds execution to ExHarness
```

The application remains stable across infrastructure/runtime implementation changes while avoiding premature framework abstractions.
