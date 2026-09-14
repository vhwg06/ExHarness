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
- `packages/agentic-system/` contains the concrete Backend Application + Oracle composition delivered through Waves A and B.
- `pipeline.md` remains the accepted active delivery order.

Waves A and B are complete.

Delivered Backend path:

```text
BackendObjective
 -> BackendWorkOrder
 -> resolveBackendContext(...)
 -> BackendWorker
 -> ExHarness Core
 -> grounded BackendWorkResult
 -> BackendCompletionPolicy
 -> ACCEPT | CONTINUE | BLOCK | FAIL
```

Current delivered completion facts:

- `APPLIED` requires actual ExHarness lineage promotion.
- Worker-returned evidence is not trusted as completion evidence.
- Backend completion requires grounded mutation, typecheck and tests evidence plus artifact presence.
- completion produces an ExHarness acceptance-boundary `DecisionArtifact`.
- missing/inconclusive/failed evidence is deterministic application logic and does not invoke Advisor.
- Advisor is invoked only after objective evidence passes but unresolved semantic gaps remain.
- BackendAdvisor may propose only retry implementation, request context, or escalation; application code validates the proposal and Advisor cannot ACCEPT work.

Source/public exports remain authority for the exact implementation checkpoint.

## ACTIVE DELIVERY — WAVE C

Wave C is the accepted next delivery sequence:

```text
S7 Second real role + extract only proven common abstractions
 -> S8 Artifact handoff / dereference / context chaining
```

The delivery order is accepted. Concrete second-role shapes, cross-work contracts and any resulting common abstractions are candidates until real implementation/evidence supports them.

Do not generalize Backend Worker/WorkOrder/completion/Advisor shapes before the second real role demonstrates common semantics. Do not introduce a Claim Manager, Blackboard schema, lease protocol or coordination service merely because the living-doc architecture names a coordination plane.

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
