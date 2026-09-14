# Agentic Application boundaries

Authority and dependency boundaries for the desired application layer.

## OWNERSHIP MATRIX

| Concern | Owner |
| --- | --- |
| Objective / domain goal | Agentic Application |
| Work decomposition | Orchestrator, optionally informed by Advisor |
| Which Worker executes | Orchestrator |
| Worker role semantics | Agentic Application |
| WorkOrder / WorkResult contracts | Agentic Application |
| Required context semantics/shape | Agentic Application |
| Context source resolution/adaptation | Oracle / infrastructure |
| Planning/progress judgment | Advisor |
| Application workflow control/state | Orchestrator |
| Agent/model execution mechanics | ExHarness |
| Turn/runtime lifecycle | ExHarness |
| Semantic memory / cognition substrate | ExHarness |
| Evidence/trust/runtime authority primitives | ExHarness |
| Filesystem/process/network/workspace enforcement | Infrastructure/executor |
| Source-specific transport/auth | Oracle/infrastructure adapter |

## APPLICATION -> ORACLE

```text
Application owns:
WHAT context is needed
WHY it is needed
HOW the result is shaped
required/optional/relevance/budget semantics

Oracle owns:
WHERE source data lives
HOW to retrieve it
HOW to adapt source representation
HOW to satisfy the declared contract
```

Oracle must not widen or invent semantic requirements that the application did not declare.

## APPLICATION -> EXHARNESS

```text
Application owns:
role/task/workflow meaning
WorkOrder and expected WorkResult
when a specialist should run
what application completion means

ExHarness owns:
how agent execution runs
model/tool/capability invocation mechanics
runtime lifecycle and bounded cognition
execution observation/trust/evidence primitives
```

The application must not create a second agent runtime, session loop, memory system or recovery model around ExHarness merely to coordinate Workers.

## ORCHESTRATOR -> ADVISOR

```text
Orchestrator = authority to control application workflow
Advisor      = authority to propose bounded judgment only
```

Advisor cannot dispatch Workers, commit application state or certify completion by self-report.

## ORCHESTRATOR -> WORKER

```text
Orchestrator
    -> explicit WorkOrder + resolved context
Worker
    -> explicit WorkResult
Orchestrator
    -> next deterministic decision
```

Worker cannot implicitly transfer control to another Worker through conversation handoff.

## WORKER -> INFRASTRUCTURE

Worker receives only the capabilities/resources/workspace authority explicitly bound for its execution. Infrastructure enforcement remains outside application semantics.

## STATE SEPARATION

These states must remain distinct:

```text
Application workflow state
!= ExHarness runtime/work state
!= semantic memory
!= trace/event history
!= evidence/trust artifacts
!= effect-recovery state
!= Oracle source/cache state
```

References between them may be explicit; one must not silently become the source of truth for another.

## DEFAULT EXCLUSIONS

Unless a concrete use case proves otherwise, the application layer does not own:

- group-chat/shared conversation coordination;
- speaker selection;
- hidden context refresh;
- source connector/retrieval frameworks;
- generic workflow graph engines;
- model routing/runtime loops already supplied by ExHarness.
