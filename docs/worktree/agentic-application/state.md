# Agentic Application state

Desired-state projection for the application layer above ExHarness Core and beside Oracle infrastructure.

## PURPOSE

The Agentic Application Layer owns what work exists, how work is decomposed, which specialist role executes it, what semantic context that role requires, what structured result is expected and when application work is complete.

## DESIRED SHAPE

```text
Objective
   |
   v
Orchestrator --------> Advisor
   |                    bounded plan / assess / replan
   |
   v
concrete specialist work
   |
   +--> application-owned context need --> Oracle --> resolved context
   |
   v
specialist Worker
   |
   v
ExHarness execution
   |
   v
structured role-specific WorkResult
   |
   +------------------> Orchestrator
```

## OWNERSHIP

- Application owns Objective, role/work semantics, required semantic context, result/completion semantics and deterministic workflow control.
- Orchestrator owns dispatch/application workflow state and remains deterministic where next actions are known.
- Advisor supplies bounded judgment only where planning/assessment/replanning is genuinely needed.
- Worker owns one specialist execution responsibility and returns machine-inspectable role-specific result state.
- Oracle resolves/dereferences application-defined context; it does not decide what context a role should need.
- ExHarness owns agent/runtime execution mechanics, cognition, evidence/trust and recovery/lifecycle primitives.

## CURRENT ACTIVE TARGET

Implementation follows `../pipeline.md`.

Wave A is deliberately concrete-first:

```text
BackendObjective
 -> BackendWorkOrder
 -> resolveBackendContext(...)
 -> BackendWorker
 -> ExHarness
 -> BackendWorkResult
 -> concrete deterministic Backend decision
```

Do not create generic `Worker<C,R>`, generic `WorkOrder<C,R>`, generic orchestration or a dynamic role registry in Wave A.

Common abstractions may be extracted only when a second real role in S7 demonstrates the same semantic shape.

## ROUTING

- semantic meaning of roles/control -> `semantics.md`
- layer/component boundaries -> `architecture.md`
- authority/dependency bounds -> `boundaries.md`
- semantic execution topology -> `workflow.md`
- concrete-first contract/extraction policy -> `contracts.md`
- active constraints -> `decisions.md`
- unresolved application seams -> `gaps.md`
- implementation order -> `../pipeline.md`
