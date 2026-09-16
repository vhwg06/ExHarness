# Living documentation pipelines

Status: **PROMOTED**

## Work pipeline

Every non-trivial shared work session follows:

```text
Blackboard
  -> read unresolved eligible items
  -> claim one item
  -> load smallest relevant worktree current-state docs
  -> inspect source/tests
  -> execute/investigate
  -> whenever implementation state materially changes:
       -> reconcile affected worktree docs immediately
       -> verify current source + docs still describe the same system
  -> verify implementation checkpoint
  -> write result/evidence/artifact refs to Blackboard
  -> DONE | BLOCKED | READY
```

The Blackboard is the roadmap/work queue. `docs/worktree/pipeline.md` describes only the execution pipeline that currently exists in source.

Living-doc reconciliation is **not** an end-of-work cleanup step. It happens at the same checkpoint that makes new behavior/architecture/contracts/workflow current.

## Continuous synchronization pipeline

```text
source/test/runtime state S0
        |
        | implementation changes current semantics
        v
source/test/runtime state S1
        |
        +--> update affected docs/worktree/* to projection(S1)
        |
        +--> verify no desired/future state leaked into worktree
        |
        v
checkpoint may enter review/acceptance
```

Invariant:

```text
accepted checkpoint
  => docs/worktree/* is the closest source-backed semantic projection
     of the system that exists at that checkpoint
```

A Blackboard item does not need to be `DONE` for this to apply. If only half of a larger objective is implemented, worktree docs describe the half that exists now and Blackboard tracks the half that remains.

A change is not review-complete when it materially changes current system semantics but leaves the affected worktree projection stale.

For every material change, review classifies living-doc impact:

```text
CURRENT_SYSTEM_CHANGED
  -> affected worktree docs changed in the same PR/change

CURRENT_SYSTEM_NOT_CHANGED
  -> no worktree rewrite required
  -> reviewer confirms the change is documentation-neutral
```

## Gap migration pipeline

When old/current documentation contains open material:

```text
old statement
  -> source already implements it?
       yes -> living current fact
  -> real unresolved gap/problem?
       yes -> Blackboard
  -> explicit non-goal / no concrete pressure?
       yes -> current constraint/non-goal, not backlog
  -> stale?
       yes -> remove/reconcile
```

No unresolved work remains embedded in source-synchronized worktree docs.

## Knowledge pipeline

Operational completion and epistemic promotion are separate:

```text
Board work result / runtime observation
  -> Evidence
  -> Judgment
  -> Audit/challenge when material
  -> Decision
  -> promoted documentation invariant/architecture when accepted
```

A Board item becoming `DONE` means the operational question/work was resolved. It does not automatically mean every design conclusion from that work is promoted knowledge.

## Reconciliation pipeline

```text
source/test/runtime change
  -> detect affected living docs
  -> rewrite current-state projection in the same implementation change
  -> remove resolved problem from current docs
  -> keep unresolved remainder on Blackboard
```

If source and living docs disagree, source wins **and the docs are stale until reconciled**. Staleness is not deferred documentation debt; it blocks claiming that implementation checkpoint as fully reviewed/current.
