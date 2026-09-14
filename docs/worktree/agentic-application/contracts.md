# Agentic Application contracts

Generic semantic contract shapes for the application layer. These examples are intentionally not final public APIs.

## PRINCIPLE

Application contracts must be explicit, typed and runtime-validatable where external/model-produced data crosses a boundary.

Exact Backend/Frontend/QA/Designer schemas are not defined here. They belong to the application role that owns them.

## WORKER

Conceptual shape:

```ts
interface Worker<C, R> {
  execute(order: WorkOrder<C, R>, context: C): Promise<WorkResult<R>>;
}
```

A Worker contract binds a specialist role to the exact context and result types that application semantics require.

## WORK ORDER

Conceptual shape:

```ts
type WorkOrder<C, R> = {
  id: WorkOrderId;
  objective: Objective;
  worker: WorkerRef;
  context: ContextRequirement<C>;
  constraints: WorkConstraints;
  expectedOutput: Schema<R>;
  dependencies?: WorkDependency[];
};
```

Fields may change during implementation. The invariant is that delegated work, required context, constraints, expected output and dependencies are explicit rather than hidden in a shared conversation.

## CONTEXT REQUIREMENT

Conceptual shape:

```ts
type ContextRequirement<C> = {
  schema: Schema<C>;
  selection: ApplicationContextSelection;
};
```

The application owns both the output shape and selection semantics. Oracle owns only source resolution/adaptation.

Context schemas should be expressible using the project-selected runtime validation mechanism; current desired implementation direction is Zod-compatible schemas rather than a custom schema system.

## WORK RESULT

Conceptual shape:

```ts
type WorkResult<R> = {
  status: WorkStatus;
  output?: R;
  artifacts?: ArtifactRef[];
  evidence?: EvidenceRef[];
  gaps?: WorkGap[];
};
```

This is a semantic sketch, not a frozen field list. The invariant is that the Orchestrator receives machine-inspectable result state rather than reconstructing progress from free-form worker prose.

## ADVISOR

Conceptual boundary:

```ts
interface Advisor {
  plan(input: PlanningInput): Promise<PlanProposal>;
  assess(input: ProgressInput): Promise<Assessment>;
  replan(input: ReplanInput): Promise<PlanProposal>;
}
```

Not every application must implement all operations. Advisor methods return proposals/assessment only; Orchestrator retains application control authority.

## ORACLE PORT

Application consumes an infrastructure port conceptually equivalent to:

```ts
interface ContextResolver {
  resolve<C>(requirement: ContextRequirement<C>): Promise<C>;
}
```

The exact Oracle API remains owned by Oracle implementation worktree. The application-level invariant is one explicit resolve step per WorkOrder before Worker execution.

## EXHARNESS BINDING

Worker/Advisor implementations may bind to ExHarness internally, but the generic application contracts do not expose ExHarness turn/session/model details.

```text
Application contract
      |
      v
Worker / Advisor implementation
      |
      v
ExHarness
```

This keeps application semantics stable if ExHarness runtime composition changes internally.
