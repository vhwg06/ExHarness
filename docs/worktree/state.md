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
- `packages/agentic-system/` now contains the first concrete Agentic Application + Oracle composition proven by Wave A.
- `oracle/` and `agentic-application/` remain the desired-state projections for the larger layers; source implementation is authoritative for what has actually landed.
- `pipeline.md` is the canonical active delivery order that converges those layers into one system.

## CURRENT DELIVERY WAVE

Wave A is complete. The repository now has one concrete Backend vertical slice:

```text
BackendObjective
 -> BackendWorkOrder
 -> resolveBackendContext(...)
 -> BackendWorker
 -> ExHarness Core
 -> BackendWorkResult
 -> deterministic Backend run decision
```

Wave-A review result: the slice runs end-to-end without a generic Worker contract, role registry, workflow graph or generic Orchestrator. `APPLIED` results must correspond to an actual ExHarness lineage promotion rather than Worker prose alone.

Wave B is next:

```text
S5 Backend-specific completion and evidence semantics
 -> S6 Advisor judgment boundary
```

Do not generalize the concrete Backend shapes in Wave B. Common Worker/WorkOrder/orchestration abstractions remain deferred until the second real role in S7 proves repeated semantics.

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
