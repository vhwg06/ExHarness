# Agentic Application state

Desired-state projection for the outer application layer that composes ExHarness into domain-specific agentic systems.

## PURPOSE

The Agentic Application Layer owns application semantics above ExHarness Core and above infrastructure adapters.

It defines what work exists, how work is decomposed, which specialist role should execute it, what context that role requires, what output is expected, and when application-level work is complete.

## DESIRED SHAPE

```text
Objective
   |
   v
Orchestrator --------> Advisor
   |                    plan / assess / replan
   |
   v
WorkOrder<C, R>
   |
   +--> ContextRequirement<C> --> Oracle --> resolved C
   |
   v
Worker<C, R>
   |
   v
ExHarness execution
   |
   v
WorkResult<R>
   |
   +------------------> Orchestrator
```

## OWNERSHIP

- Application owns Objective, WorkOrder, Worker role semantics, ContextRequirement, expected output and completion semantics.
- Orchestrator owns deterministic control flow, dispatch and application workflow state.
- Advisor provides bounded judgment such as plan, assess and replan; it does not own dispatch or correctness authority.
- Worker owns one specialist execution contract and returns a bounded WorkResult.
- Oracle resolves application-defined context requirements from external sources; it does not invent application semantics.
- ExHarness owns agent/runtime execution mechanics, lifecycle/authority primitives, cognition, evidence/trust and execution substrate concerns.

## ACTIVE TARGET

Define the minimum generic contracts and one vertical slice that proves:

```text
Objective
 -> deterministic Orchestrator
 -> typed WorkOrder
 -> resolve context once through Oracle
 -> specialist Worker executed through ExHarness
 -> typed WorkResult
 -> Orchestrator decides done / next work / bounded Advisor request
```

Exact Backend/Frontend/QA/Designer context and result schemas remain application-owned and intentionally unresolved until their first concrete vertical slices.

## ROUTING

- semantics and role meaning -> `semantics.md`
- layer/component architecture -> `architecture.md`
- authority/dependency boundaries -> `boundaries.md`
- execution/composition path -> `workflow.md`
- generic contract shapes -> `contracts.md`
- constraints that must shape implementation -> `decisions.md`
- unresolved application seams -> `gaps.md`
