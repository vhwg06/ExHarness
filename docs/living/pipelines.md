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
  -> verify
  -> update source if applicable
  -> reconcile worktree living docs to source
  -> write result/evidence/artifact refs to Blackboard
  -> DONE | BLOCKED | READY
```

The Blackboard is the roadmap/work queue. `docs/worktree/pipeline.md` describes only the execution pipeline that currently exists in source.

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
  -> rewrite current-state projection
  -> remove resolved problem from current docs
  -> close/update Board item
```

If source and living docs disagree, source wins.
