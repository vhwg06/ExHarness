# Agentic System current delivered pipeline

This document describes the execution/verification pipeline that exists in source today. It is not the roadmap. Open stages and future work live only in `../living/blackboard.md`.

## Backend path

```text
BackendObjective
 -> BackendWorkOrder
 -> resolveBackendContext(...)
    -> repositoryReader.readFile(...)
    -> validated BackendContext + sourceRef
 -> BackendWorker
 -> ExHarness Core
 -> grounded BackendWorkResult
 -> mutation + typecheck + tests evidence
 -> BackendCompletionPolicy
 -> ACCEPT | CONTINUE | BLOCK | FAIL
```

`APPLIED` requires actual ExHarness lineage promotion. Worker-returned evidence is not completion authority.

When required objective evidence passes but semantic gaps are explicitly reported, the bounded `BackendAdvisor` may propose only retry implementation, request context or escalation. It cannot accept work or mutate workflow state directly.

## Backend -> QA path

```text
accepted Backend completion
 -> BackendQaHandoff
    -> producer work-order id
    -> accepted revision
    -> acceptance decision ref
    -> ApplicationArtifactRef[]
 -> QaWorkOrder
 -> resolveQaContext(...)
    -> artifactReader.readArtifact(...)
    -> validated QaContext
    -> sourceRef + APPLICATION_ARTIFACT provenance
 -> QaWorker
    -> ExHarness verification with mutation forbidden
 -> qa.behavior + qa.regression evidence
 -> QaCompletionPolicy
```

QA is dispatched only after Backend `ACCEPT`. QA issues produce deterministic remediation/continuation behavior rather than borrowing Backend mutation semantics.

## Current extraction result

Repeated source-backed shapes:

- `ApplicationArtifactRef`;
- evidence-artifact integrity / required-claim state plumbing.

Not implemented as generic abstractions:

- generic Worker / WorkOrder / WorkResult;
- generic Advisor;
- role registry;
- workflow graph/DSL;
- generic Orchestrator.

The absence of those abstractions is part of current implementation, not an open gap in this document.
