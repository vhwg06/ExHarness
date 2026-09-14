# Agentic Application current state

Source-synchronized application-layer projection. All unresolved application work lives in `../../living/blackboard.md`.

## Current roles

### Backend

- concrete `BackendObjective`, `BackendWorkOrder`, `BackendContext`, `BackendWorkResult` and `BackendWorker`;
- context resolved before execution through `resolveBackendContext(...)`;
- Worker executes through ExHarness Core;
- `APPLIED` requires real committed-lineage advancement;
- completion evidence is grounded from ExHarness/runtime artifacts, not trusted from Worker prose;
- default completion requires mutation + typecheck + tests + artifact presence;
- completion emits an acceptance-boundary ExHarness decision artifact;
- bounded `BackendAdvisor` is available only after required objective evidence passes and semantic gaps remain.

### QA

- concrete QA objective/order/context/result/completion shapes;
- consumes only accepted Backend revision/artifact refs;
- context resolved through `artifactReader` before execution;
- mutation and lineage advancement are forbidden;
- grounded evidence claims are `qa.behavior` and `qa.regression`;
- QA issues deterministically request remediation/continuation.

## Current composition

`runBackendThenQaObjective(...)` composes Backend -> QA directly. There is no generic orchestration framework.

Shared shapes proven in source are narrow:

- `ApplicationArtifactRef`;
- evidence integrity / required-claim state plumbing.

Backend and QA do not share one lifecycle/authority model, so no generic Worker/WorkOrder/Advisor/Orchestrator exists in the current implementation.

## Routing

- current application architecture -> `architecture.md`
- current ownership boundaries -> `boundaries.md`
- current workflow -> `workflow.md`
- current contracts -> `contracts.md`
- current decisions/invariants -> `decisions.md`
- all open application gaps/problems -> `../../living/blackboard.md`
