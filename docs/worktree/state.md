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

- `core-harness/` projects the delivered Core plus its active continuation gaps.
- `oracle/` projects the agreed desired semantics/architecture for resolve-once context infrastructure; implementation is not implied by docs.
- `agentic-application/` projects the agreed desired application semantics/architecture; implementation is not implied by docs.
- `pipeline.md` is the canonical active delivery order that converges those layers into one system.

## CURRENT DELIVERY WAVE

Wave A is next:

```text
S1 Concrete Backend semantics
 -> S2 Concrete Backend context resolution
 -> S3 BackendWorker × ExHarness execution
 -> S4 Concrete deterministic Backend orchestration
 -> one Wave-A review
```

Wave A is intentionally concrete. Do not introduce generic `Worker<C,R>`, generic `WorkOrder<C,R>`, worker registries or generic orchestration before a second real slice demonstrates a common shape.

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
