# Agentic System convergence state

Top-level durable convergence projection for the repository. This file preserves current checkpoint, active delivery direction and routing; it is not automatic desired-state authority.

Read `README.md` in this directory and `../living/README.md` before promoting any candidate statement from this tree.

## ACCEPTED SYSTEM TARGET

The repository target is a composed agentic system, not only a reusable core harness.

The high-level ownership split below is accepted system direction; concrete future components inside each layer remain candidates until separately grounded/promoted.

```text
Objective
   |
   v
Agentic Application
  Orchestrator -----> Advisor
      |
      v
  concrete specialist work
      |
      +------> Oracle ------> external sources
      |          |
      |          +---------> application-produced artifacts/state
      |          |
      |       resolved context
      v          v
  Worker --------+
      |
      v
ExHarness Core
      |
      v
structured result / evidence / artifacts
      |
      +------> Agentic Application
```

## ACCEPTED LAYER OWNERSHIP

- **Agentic Application** owns objectives, role/work semantics, deterministic control, bounded Advisor judgment, required semantic context and completion policy.
- **Oracle** is infrastructure: it pulls/dereferences sources and adapts them into application-owned context contracts. It does not invent application semantics.
- **ExHarness Core** owns agent/runtime execution mechanics, cognition, evidence/trust, lifecycle, persistence and recovery authority boundaries.
- **Concrete infrastructure** owns source access, storage, executors/sandboxes, filesystem/network/process enforcement and credentials.

These ownership boundaries do not imply that every future API/service shape already exists or is promoted.

## OBSERVED DELIVERY CHECKPOINT

- `packages/core-harness/` is the delivered reusable Core.
- `packages/agentic-system/` contains concrete Backend + QA application slices and Oracle composition delivered through Waves A, B and C.
- `pipeline.md` remains the accepted active delivery order.

Waves A, B and C are complete in source/tests.

Delivered multi-work path:

```text
BackendObjective
 -> BackendWorkOrder
 -> repositoryReader / BackendContext
 -> BackendWorker / ExHarness
 -> grounded Backend completion
 -> ref-only BackendQaHandoff
 -> QaWorkOrder
 -> artifactReader / QaContext
 -> non-mutating QaWorker / ExHarness
 -> grounded QA completion
```

Observed Wave-C facts:

- Backend and QA do not share one execution lifecycle: Backend mutates/promotes lineage; QA rejects mutation and verifies a fixed accepted Backend revision.
- no generic Worker, generic WorkOrder or generic Orchestrator was extracted after the second role because the common semantics remain too weak;
- `ApplicationArtifactRef` is now shared across Backend-produced artifacts and QA-required/inspected artifacts;
- evidence integrity + claim-state plumbing is shared while required evidence claims remain role-specific;
- Backend -> QA application state carries artifact refs plus Backend acceptance-decision provenance, not artifact payloads;
- Oracle keeps external repository reads and internal application-artifact lookup as distinct source boundaries;
- QA resolves only declared artifact needs and preserves `APPLICATION_ARTIFACT` provenance/source refs;
- QA is not dispatched unless Backend completion is `ACCEPT`.

Source/public exports and executable tests remain authority for the exact implementation checkpoint. Related living-knowledge judgments are recorded as supported, not silently promoted architecture.

## ACTIVE DELIVERY — WAVE D

Wave D is next:

```text
S9 Persistence / resilience / recovery composition
 -> S10 Production evaluation + evidence-based generalization
```

S9 now has real multi-work behavior to pressure-test durable application state. Keep application workflow state distinct from ExHarness runtime persistence and artifact storage. Do not invent a generic workflow engine, Blackboard schema or claim/lease service before concrete recovery/state pressure requires it.

S10 must evaluate the two real roles and artifact handoff before promoting broader Worker/WorkResult/context/orchestration APIs.

## ROUTING

- authority/promotion semantics -> `../living/README.md`
- accepted knowledge lifecycle -> `../living/pipelines.md`
- active delivery order / what next -> `pipeline.md`
- application convergence -> `agentic-application/state.md`
- context feeding / source resolution -> `oracle/state.md`
- ExHarness runtime/kernel continuation -> `core-harness/state.md`

Do not load all children by default.

## AUTHORITY

```text
source/public exports
    -> implemented behavior now

runtime/executable evidence
    -> observed behavior

../living/* promoted views
    -> accepted authority by knowledge type

this worktree
    -> convergence material and delivered checkpoints
       candidates remain candidates until promotion
```

When implementation or evidence contradicts this worktree, record/reconcile the contradiction rather than forcing source to match stale prose.
