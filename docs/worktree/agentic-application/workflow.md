# Agentic Application workflow

Desired application-level coordination flow. This does not replace ExHarness internal execution lifecycle.

## PRIMARY PATH

```text
Objective
   |
   v
Orchestrator inspects application state
   |
   +--> deterministic next step known?
   |       |
   |       +--> yes: create WorkOrder
   |       |
   |       +--> no: request bounded Advisor judgment
   |                    |
   |                    v
   |               plan / assess / replan proposal
   |                    |
   +--------------------+
   |
   v
create typed WorkOrder<C,R>
   |
   v
resolve ContextRequirement<C> once through Oracle
   |
   v
validate resolved context C
   |
   v
Worker<C,R>.execute(order, context)
   |
   v
ExHarness performs bounded specialist execution
   |
   v
WorkResult<R>
   |
   v
Orchestrator updates application workflow state
   |
   +--> complete
   +--> dispatch next accepted WorkOrder
   +--> request Advisor assessment/replan
   +--> stop/escalate through explicit application policy
```

## CONTEXT FEEDING

Context resolution is explicit and single-pass per WorkOrder:

```text
WorkOrder
   -> ContextRequirement
   -> Oracle.resolve(...)
   -> application-shaped validated context
   -> Worker.execute(...)
```

There is no default provider lifecycle, automatic refresh, hidden pre-run hook or shared mutable context session.

If required context cannot be satisfied, execution must fail/return an explicit context gap according to the application contract. Oracle must not silently invent missing semantic content or widen scope without an application-defined rule.

A later WorkOrder may request newly resolved context explicitly. That is a new application decision, not an implicit refresh of an existing Worker execution.

## ADVISOR PATH

Advisor is invoked only where judgment is useful:

```text
application state + accepted evidence/progress
        -> Advisor
        -> structured proposal / assessment
        -> Orchestrator validates/applies/rejects
```

Advisor output never directly mutates workflow state or dispatches a Worker.

## PARALLELISM

Parallel Worker execution is permitted only when the application dependency model establishes independence.

```text
WorkOrder A ----\
                +--> deterministic join --> Orchestrator
WorkOrder B ----/
```

Concurrency is an Orchestrator decision, not an emergent group-chat behavior.

## COMPLETION

Application completion is decided from typed WorkResults plus application policy/accepted evidence. A Worker saying "done" in prose is not sufficient application state.

The application may use ExHarness verification/trust primitives when correctness evidence is required, but the application retains responsibility for defining what evidence/result contract is required for its domain workflow.
