# Agentic System current state

Source-synchronized system checkpoint. Open work is intentionally excluded; see `../living/blackboard.md`.

## Current composition

```text
BackendObjective
 -> BackendWorkOrder
 -> repositoryReader / BackendContext
 -> BackendWorker / ExHarness Core
 -> grounded Backend completion
 -> ref-only BackendQaHandoff
 -> QaWorkOrder
 -> artifactReader / QaContext
 -> non-mutating QaWorker / ExHarness Core
 -> grounded QA completion
```

## Current ownership boundaries

- Agentic Application owns concrete objective/work/result/completion semantics and deterministic composition.
- Oracle owns explicit source pull/dereference/adaptation into application-shaped context.
- ExHarness Core owns agent execution mechanics, cognition, evidence/trust, lifecycle and recovery primitives.
- Concrete infrastructure owns repository/artifact access, executors, storage, filesystem/network/process authority and credentials.

## Delivered facts

- `packages/core-harness/` is the reusable Core.
- `packages/agentic-system/` contains concrete Backend and QA slices.
- Backend is mutating/promoting work; QA is non-mutating verification of an accepted Backend revision.
- Backend completion grounds mutation/typecheck/tests evidence rather than trusting Worker-returned claims.
- QA grounds behavior/regression evidence and cannot advance lineage.
- `ApplicationArtifactRef` is shared across Backend-produced and QA-consumed artifacts.
- Backend -> QA state carries refs plus Backend acceptance-decision provenance, not copied artifact payloads.
- Oracle keeps external repository reads and internal application-artifact reads distinct.
- No generic Worker, WorkOrder, Advisor, role registry, workflow graph or generic Orchestrator is implemented.

## Routing

- current delivered pipeline -> `pipeline.md`
- current application details -> `agentic-application/state.md`
- current Oracle details -> `oracle/state.md`
- current Core details -> `core-harness/state.md`
- all gaps/problems/next work -> `../living/blackboard.md`
