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

## IMPLEMENTED CHECKPOINT — WAVE A

Wave A is implemented concretely in `packages/agentic-system/`:

```text
BackendObjective
 -> BackendWorkOrder
 -> resolveBackendContext(...)
 -> BackendWorker
 -> ExHarness
 -> BackendWorkResult
 -> deterministic Backend run decision
```

The concrete slice established these current facts:

- Backend context need is carried by the concrete order as explicit required repository files.
- Oracle resolves those files once through a repository-reader source boundary and returns validated Backend context with source references.
- BackendWorker receives resolved context and uses ExHarness for execution; it does not resolve external context or choose another Worker.
- An `APPLIED` Backend result is rejected unless ExHarness actually advanced committed lineage to the reported revision.
- S4 composition is a direct `runBackendObjective(...)` path, not a generic Orchestrator abstraction.

No generic `Worker<C,R>`, generic `WorkOrder<C,R>`, dynamic role registry or workflow graph has been introduced. Common abstractions remain deferred until S7 demonstrates them with a second real role.

## CURRENT ACTIVE TARGET — WAVE B

Implementation follows `../pipeline.md`.

Next is Backend-specific trustworthiness, not generalization:

```text
S5 BackendWorkResult
   -> BackendCompletionPolicy
   -> ACCEPT | CONTINUE | BLOCK | FAIL

S6 deterministic path known
      -> application code
   judgment gap observed
      -> bounded Advisor proposal/assessment
```

S5 must determine real Backend evidence requirements from the concrete Wave-A slice. S6 introduces Advisor only for an observed judgment gap; Advisor never becomes dispatch or correctness authority.

## ROUTING

- semantic meaning of roles/control -> `semantics.md`
- layer/component boundaries -> `architecture.md`
- authority/dependency bounds -> `boundaries.md`
- semantic execution topology -> `workflow.md`
- concrete-first contract/extraction policy -> `contracts.md`
- active constraints -> `decisions.md`
- unresolved application seams -> `gaps.md`
- implementation order -> `../pipeline.md`
