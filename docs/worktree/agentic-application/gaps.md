# Agentic Application gaps

Only unresolved seams that matter to the current desired application layer.

## FIRST VERTICAL SLICE

Current:

- architecture/semantics are defined;
- no application package or generic contracts exist yet;
- exact specialist schemas are intentionally not frozen.

Desired exit condition:

```text
Objective
 -> Orchestrator
 -> WorkOrder<C,R>
 -> Oracle context resolve
 -> one specialist Worker through ExHarness
 -> WorkResult<R>
 -> deterministic completion/next-step decision
```

The first slice should prove the boundaries before introducing registries, graph DSLs or dynamic routing.

## OBJECTIVE / APPLICATION STATE

Open:

- minimum Objective contract;
- minimum application workflow state required across multiple WorkOrders;
- whether application-state persistence is required in the first slice or only when long-running outer workflows demand it.

Constraint: application workflow state must remain distinct from ExHarness runtime/persistent work state.

## WORK ORDER / WORK RESULT

Open:

- exact required fields;
- status/gap/blocker vocabulary;
- artifact/evidence references;
- dependency representation;
- mutation/verification metadata required by downstream orchestration.

Exit condition: Orchestrator can make the next decision without parsing unstructured worker prose.

## WORKER SPECIALIZATIONS

Open:

- which specialist role should be implemented first;
- exact context/output schema for BackendWorker, FrontendWorker, QAWorker and DesignerWorker;
- which role capabilities belong to application semantics versus ExHarness/infrastructure injection.

Do not define all roles up front. Generalize only after concrete slices expose common structure.

## ADVISOR

Open:

- exact plan/assess/replan schemas;
- trigger conditions for invoking Advisor versus deterministic Orchestrator logic;
- how Advisor proposals reference current application state/evidence;
- whether one Advisor abstraction is sufficient or domain-specific advisors emerge from use cases.

Constraint: Advisor never becomes implicit dispatch/control authority.

## ORCHESTRATION

Open:

- dependency graph representation if multiple WorkOrders exist;
- retry/escalation policy location;
- deterministic join semantics for independent parallel work;
- final result aggregation contract.

Do not introduce a generic workflow/graph engine until these needs are demonstrated by application flows.

## ORACLE BINDING

Open:

- exact application-facing ContextResolver interface after Oracle desired-state implementation converges;
- how context-resolution failures map into application WorkResult/gap semantics;
- first concrete role ContextRequirement schema.

Constraint: context resolution remains one explicit step before each WorkOrder execution; no hidden refresh/provider lifecycle.

## EXHARNESS BINDING

Open:

- minimal adapter/composition that turns a Worker/Advisor contract into ExHarness execution;
- which ExHarness evidence/trust outputs become application-level evidence references;
- how application cancellation/escalation maps to ExHarness boundaries without duplicating lifecycle semantics.

## NON-GOALS UNTIL PROVEN

- group-chat architecture;
- shared global conversation state;
- model-selected worker handoff;
- generic Crew/Team framework;
- dynamic role registry;
- workflow graph DSL;
- application-owned model/session/runtime loop.
