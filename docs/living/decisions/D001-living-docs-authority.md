# D001 — Blackboard-first living docs with typed authority

Status: **PROMOTED**

Accepted at: 2026-09-14

Acceptance boundary: repository owner explicitly selected and corrected this architecture for ExHarness living documentation.

## Context

The old worktree model made newly drafted target shapes look like desired state too early.

The first revision of D001 overcorrected in the other direction: it described Blackboard as an architectural coordination plane while deferring the actual Blackboard surface. That fails the intended shared-work semantics because a session could still choose and perform work without first changing shared coordination state.

The required model is literal Blackboard coordination: shared questions/work are visible; a worker claims one; when it resolves that item the board changes; the next worker sees a smaller eligible set.

## Decision

`docs/living/blackboard.md` is the canonical active coordination surface now.

Every non-trivial shared work session must:

```text
read board
  -> choose eligible unresolved item
  -> claim item
  -> execute
  -> write result / refs / blockers / discoveries
  -> resolve, block or release item
```

A later session selects from the updated board rather than replanning the whole project independently.

Example:

```text
A READY
B READY
C READY

session-1 resolves A

A DONE
B READY
C READY

session-2 may choose B or C, not A
```

This operational lifecycle is distinct from knowledge promotion.

ExHarness living docs therefore contain:

1. **Blackboard** — current operational coordination and shared work state.
2. **Living knowledge** — evidence, judgments, audits, decisions and promoted views.
3. **Artifact reality** — source, tests, configs, runtime observations and produced artifacts.

There is no single global source of truth. Authority remains typed by question.

New design conclusions still progress independently through:

```text
DRAFT -> PROPOSED -> SUPPORTED -> AUDITED -> ACCEPTED -> PROMOTED
```

A board item becoming `DONE` does not automatically make its design conclusion desired state.

`architecture.md`, `pipelines.md` and `contracts.md` remain promoted views. `docs/worktree/` remains supporting convergence/context material for claimed work and does not grant authority by path.

## Current storage choice

The Blackboard is currently Git-backed as `docs/living/blackboard.md` because ExHarness needs persistent shared coordination now.

This decision promotes the Blackboard **semantics and current canonical surface**, not a generalized coordination subsystem.

If later multi-agent concurrency or write frequency proves Git-backed coordination insufficient, the storage/transport may be migrated while preserving the same board lifecycle.

## Deliberately not decided

D001 does not yet introduce:

- a generic Claim Manager service;
- leases/timeouts;
- event bus/subscription infrastructure;
- database/tuple-space storage;
- workflow DSL/engine;
- generalized conflict resolution;
- automatic stale-claim recovery.

Those require real contention/recovery evidence.

## Consequences

- `docs/living/blackboard.md` is read before work selection;
- all non-trivial shared work is added/claimed/updated there;
- resolving one item constrains later sessions and prevents accidental duplicate work;
- discoveries create/update board items before another session acts on them;
- worktree material is loaded only after a board item is claimed;
- evidence/judgment/promotion remain separate from board completion;
- source/public exports remain authority for implemented facts.

## Promotion targets

This decision is materialized in:

- `../blackboard.md`
- `../README.md`
- `../pipelines.md`
- `../contracts.md`

## Reopen when

Reopen this decision if real use shows the Blackboard lifecycle itself is insufficient. Storage migration alone does not reopen the coordination semantics.
