# Agentic Application current architecture

This file describes the application architecture implemented in `packages/agentic-system/` today.

```text
BackendObjective
      |
      v
BackendWorkOrder -----> resolveBackendContext -----> repositoryReader
      |                         |
      |                    BackendContext
      v                         v
BackendWorker --------------> ExHarness Core
      |
      v
BackendWorkResult
      |
      v
BackendCompletionPolicy
      |
      +---- CONTINUE/BLOCK/FAIL
      |
      +---- ACCEPT
              |
              v
        BackendQaHandoff (refs + acceptance provenance)
              |
              v
          QaWorkOrder -----> resolveQaContext -----> artifactReader
              |                    |
              |                 QaContext
              v                    v
           QaWorker -----------> ExHarness Core
              |
              v
        QaCompletionPolicy
```

## Boundaries visible in source

- Application contracts own required semantic context and completion semantics.
- Oracle functions perform concrete source IO/adaptation before Worker execution.
- Workers use ExHarness Core rather than owning a second model/runtime lifecycle.
- Backend mutates/promotes; QA inspects a fixed accepted revision and forbids mutation.
- Backend -> QA carries artifact references and acceptance provenance, not copied artifact contents.
- `BackendAdvisor` is a narrow bounded-judgment component; it is not dispatch or correctness authority.

## Abstractions that do not exist

There is no generic `Worker<C,R>`, generic `WorkOrder<C,R>`, generic Advisor, role registry, workflow graph or generic Orchestrator in current source.

Open questions about whether any such abstraction should ever be added live in the Blackboard, not in this architecture document.
