# Agentic System current state

Source-synchronized system checkpoint. Open work is intentionally excluded; see `../living/blackboard.md`.

## Current composition

Concrete execution path:

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

Durable application coordination path:

```text
ApplicationOrchestrator
 -> JSON-backed Blackboard state
 -> claim / submit
 -> Worker-requested or PM-required review obligation
 -> pending/reviewing assessment state
 -> DONE or REOPENED
 -> grounded follow-up reconciliation
```

The concrete `createDurableBackendQaWorkflow(...)` path binds Backend -> QA execution to the durable Blackboard lifecycle. It persists validated workflow objectives and stage checkpoints, carries accepted Backend handoffs by reference, supports QA remediation and blocked-source resume, and submits accepted QA to the separate review/acceptance path. The older `runBackendThenQaObjective(...)` path remains a direct one-session composition.

## Current ownership boundaries

- Agentic Application owns concrete objective/work/result/completion semantics, deterministic composition and Blackboard lifecycle control.
- Oracle owns explicit source pull/dereference/adaptation into application-shaped context.
- ExHarness Core owns agent execution mechanics, cognition, evidence/trust, lifecycle and recovery primitives.
- Concrete infrastructure owns repository/artifact access, executors, storage, filesystem/network/process authority and credentials.

## Delivered facts

- `packages/core-harness/` is the reusable Core.
- `packages/agentic-system/` contains concrete Backend and QA slices plus a durable `ApplicationOrchestrator` Blackboard state slice.
- Backend is mutating/promoting work; QA is non-mutating verification of an accepted Backend revision.
- Backend completion grounds mutation/typecheck/tests evidence rather than trusting Worker-returned claims.
- QA grounds behavior/regression evidence and cannot advance lineage.
- `ApplicationArtifactRef` is shared across Backend-produced and QA-consumed artifacts.
- Backend -> QA state carries refs plus Backend acceptance-decision provenance, not copied artifact payloads.
- durable Backend -> QA execution persists `BACKEND_PENDING`, `QA_PENDING`, `BACKEND_REMEDIATION_PENDING` and blocked checkpoints through the JSON store.
- a fresh Orchestrator can resume the same QA checkpoint after artifact lookup failure, and QA acceptance produces a final `PENDING_REVIEW` submission.
- Oracle keeps external repository reads and internal application-artifact reads distinct.
- Worker submission cannot directly authorize Board `DONE`.
- Review request and PM review requirement are separate paths; explicit reviewer assessment is required before review-gated completion.
- rejected/inconclusive review reopens current work; an accepted review also reopens when unrelated current obligations remain.
- resubmission can explicitly identify addressed current obligations, which are still subject to required review before `DONE`.
- follow-up findings require a provenance ref before current/existing/new-work reconciliation.
- JSON-backed Board state survives a new Orchestrator instance.
- No generic Worker, WorkOrder, Advisor, role registry, workflow graph, Teacher registry, Reviewer registry or generic workflow Orchestrator/DSL is implemented.

The concrete `ApplicationOrchestrator` is application workflow/Board control, not a generic workflow engine.

## Routing

- current delivered pipeline -> `pipeline.md`
- current application details -> `agentic-application/state.md`
- current Oracle details -> `oracle/state.md`
- current Core details -> `core-harness/state.md`
- all gaps/problems/next work -> `../living/blackboard.md`
