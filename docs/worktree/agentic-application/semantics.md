# Agentic Application semantics

Semantic ownership for the application layer. These definitions describe responsibilities, not final TypeScript APIs.

## OBJECTIVE

Objective is the application-level goal being pursued. It is not a model prompt and is not an ExHarness runtime state object.

The application may decompose one Objective into one or more WorkOrders.

## ORCHESTRATOR

Orchestrator is deterministic application control code.

It owns:

- application workflow state;
- task/work decomposition decisions that are deterministic or already accepted;
- creation and dispatch of WorkOrders;
- dependency/order/parallelism enforcement;
- deciding whether to continue, request Advisor judgment, retry through an explicit policy, stop or complete.

Orchestrator is not assumed to be an agent and should not require model reasoning for control decisions that can be expressed deterministically.

## ADVISOR

Advisor is a bounded judgment capability used when the Orchestrator needs semantic reasoning rather than deterministic control.

Typical responsibilities:

- propose a plan;
- assess progress or gaps;
- propose a replan;
- compare alternatives or recommend a next step.

Advisor returns structured advice. It does not directly dispatch Workers, mutate application workflow state, certify correctness or take over orchestration authority.

## WORKER

Worker is a specialist application role with a typed input/context/output contract.

Examples may later include BackendWorker, FrontendWorker, QAWorker and DesignerWorker, but the generic architecture does not require those exact roles.

A Worker:

- receives one bounded WorkOrder;
- receives context explicitly resolved for that WorkOrder;
- executes only the authority/capabilities granted to it;
- returns a bounded WorkResult;
- does not own the global application workflow or select the next Worker by implicit handoff.

Worker execution may use ExHarness internally. Application semantics do not depend on how long or how many internal agent turns ExHarness uses to produce the WorkResult.

## WORK ORDER

WorkOrder is the explicit unit of delegated application work.

Conceptually it answers:

```text
what should be done?
who should do it?
what context is required?
what constraints apply?
what output/completion contract is expected?
what upstream dependencies must already be satisfied?
```

It is an application artifact, not a generic conversation message.

## CONTEXT REQUIREMENT

ContextRequirement is owned by the application/Worker contract.

The application decides:

```text
WHAT context is required
WHY it is required
HOW the resulting context is shaped
which parts are required vs optional
what relevance/budget constraints apply
```

Oracle decides only how those requirements are satisfied from infrastructure sources.

## WORK RESULT

WorkResult is the explicit returned result of a Worker execution.

It must be structured enough for the Orchestrator to make the next deterministic application decision without reconstructing state from model prose or a shared chat transcript.

Exact fields remain open until the first vertical slice, but result semantics may include output, status, produced artifacts/evidence, explicit gaps/blockers and execution-relevant metadata.

## COORDINATION TOPOLOGY

Desired topology is manager-style delegation:

```text
Orchestrator
    -> bounded WorkOrder
    -> Worker
    -> bounded WorkResult
    -> Orchestrator
```

Not handoff-style conversation takeover:

```text
Orchestrator -> Worker A takes global conversation -> Worker B takes over -> ...
```

Shared group-chat/speaker-selection semantics are not part of the default application architecture.
