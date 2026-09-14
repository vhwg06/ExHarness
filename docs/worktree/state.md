# Agentic System desired state

Top-level living projection for the repository target. Read this first, then load only the smallest relevant subtree.

## TARGET

The repository target is a composed agentic system, not only a reusable core harness.

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

## LAYER OWNERSHIP

- **Agentic Application** owns objectives, role/work semantics, deterministic control, bounded Advisor judgment, required semantic context and completion policy.
- **Oracle** is infrastructure: it pulls/dereferences sources and adapts them into application-owned context contracts. It does not invent application semantics.
- **ExHarness Core** owns agent/runtime execution mechanics, cognition, evidence/trust, lifecycle, persistence and recovery authority boundaries.
- **Concrete infrastructure** owns source access, storage, executors/sandboxes, filesystem/network/process enforcement and credentials.

## CURRENT DELIVERY

- `packages/core-harness/` is the delivered reusable Core.
- `packages/agentic-system/` contains the concrete Backend Application + Oracle composition delivered through Waves A and B.
- `oracle/` and `agentic-application/` remain desired-state projections for the larger layers; source implementation is authority for what has actually landed.
- `pipeline.md` remains the canonical delivery order.

## CURRENT DELIVERY WAVE

Wave A and Wave B are complete.

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

Current completion facts:

- `APPLIED` still requires actual ExHarness lineage promotion.
- Worker-returned evidence is not trusted as completion evidence.
- Backend completion requires grounded mutation, typecheck and tests evidence plus artifact presence.
- completion produces an ExHarness acceptance-boundary `DecisionArtifact`.
- missing/inconclusive/failed evidence is deterministic application logic and does not invoke Advisor.
- Advisor is invoked only after objective evidence passes but unresolved semantic gaps remain.
- BackendAdvisor may propose only retry implementation, request context, or escalation; application code validates the proposal and Advisor cannot ACCEPT work.

Wave C is next:

```text
S7 Second real role + extract only proven common abstractions
 -> S8 Artifact handoff / dereference / context chaining
```

Do not generalize Backend Worker/WorkOrder/completion/Advisor shapes before the second real role demonstrates common semantics.

## ROUTING

- active delivery order / what next -> `pipeline.md`
- application semantics / orchestrator / advisor / workers -> `agentic-application/state.md`
- context feeding / source resolution / artifact dereference -> `oracle/state.md`
- ExHarness runtime/kernel continuation -> `core-harness/state.md`

Do not load all children by default. Each subtree `state.md` routes to its smallest relevant child.

## AUTHORITY

```text
source/public exports
    -> authority for implemented behavior now

worktree desired-state projections
    -> authority for accepted target semantics

pipeline.md
    -> authority for active implementation sequence

implementation
    -> must converge source toward desired state

reconciliation
    -> update worktree back to current delivered truth after convergence
```

`docs/architecture/` and Git history retain deeper/reference/history material; they do not silently override current worktree decisions.
