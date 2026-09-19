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
  -> whenever implementation state materially changes before a durable checkpoint:
       -> reconcile affected worktree docs
       -> verify current source + docs still describe the same system
  -> verify implementation checkpoint
  -> checkpoint / handoff / review / continue
  -> write result/evidence/artifact refs to Blackboard
  -> DONE | BLOCKED | READY
```

The Blackboard is the roadmap/work queue. `docs/worktree/pipeline.md` describes only the execution pipeline that currently exists in source.

Living-doc reconciliation is **not** an end-of-work cleanup step. It happens before the implementation state becomes durable/reviewable/handoff-safe.

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
durable checkpoint / handoff / review may proceed
```

Invariant:

```text
durable/reviewable checkpoint
  => docs/worktree/* is the closest source-backed semantic projection
     of the system that exists at that checkpoint
```

A Blackboard item does not need to be `DONE` for this to apply. If only half of a larger objective is implemented, worktree docs describe the half that exists now and Blackboard tracks the half that remains.

Temporary local edit order inside one uninterrupted implementation step may transiently lead or lag docs; that transient state must not be checkpointed, handed off, submitted for review or represented as current project state.

A change is not review-complete when it materially changes current system semantics but leaves the affected worktree projection stale.

For every material change, review classifies living-doc impact:

```text
CURRENT_SYSTEM_CHANGED
  -> affected worktree docs changed in the same PR/change

CURRENT_SYSTEM_NOT_CHANGED
  -> no worktree rewrite required
  -> reviewer confirms the change is documentation-neutral
```

CI checks the declaration shape and requires a `docs/worktree/*` diff for `CURRENT_SYSTEM_CHANGED`. Review verifies whether that classification is semantically true and whether the projection itself is accurate.

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


## Research-to-implementation promotion pipeline

Research/SA artifacts may be promoted to `docs/living/knowledge/*` before their implementation slice is allocated. Promotion means the architecture input is canonical and recoverable on the current integration baseline; it does **not** create Board work or implementation authority.

```text
Researcher / SA
  -> evidence-backed architecture artifact
  -> accepted/promoted knowledge on current integration baseline
  -> wait for grounded integration trigger

grounded trigger
  -> allocate one Blackboard item
  -> create exact read-only REVIEW WORK_CONTEXT_SPEC
  -> review only implementation readiness / authority for that bounded slice
  -> ACCEPT decision bound to exact review context + candidate
  -> child IMPLEMENT WORK_CONTEXT_SPEC
       + then-current sourceBaseline
       + exact sourceScope.write
       + exact verification
  -> Board READY
  -> Worker claims and implements
```

The REVIEW gate does not mean Researcher/SA review every implementation request. Its purpose is repository authority/currentness: bind one implementation slice to an exact candidate, accepted knowledge, bounded write scope and deterministic verification. Accepted architecture is reopened only when grounded contradictory evidence or a new architecture obligation appears.

There is no separate `docs/living/work-artifacts/*` implementation-authority layer. For repository coordination, the native implementation artifact is the current `WORK_CONTEXT_SPEC` generation with `action.kind = IMPLEMENT`, backed by its exact accepted parent REVIEW decision.

### Canonical promotion and stacked branches

Merge state is branch-relative.

```text
PR merged into stacked parent branch
  != artifact promoted to current integration baseline

artifact present on current integration baseline (normally main)
  = canonical repository knowledge input
```

Before a Blackboard context declares a knowledge artifact as a required input, that artifact must resolve from the selected source baseline/current integration branch. A stacked research merge that has not propagated to the current integration baseline remains non-canonical for future work allocation.

This rule prevents a side branch from silently becoming a second roadmap or authority surface.

### Future research is not backlog

Promoted future-slice knowledge may exist on `main` without a corresponding active Board item.

```text
promoted knowledge
  != allocated work
  != READY
  != implementation authority
```

The Blackboard remains small and only allocates work when an Integration entry trigger exists.

## Reconciliation pipeline

```text
source/test/runtime change
  -> detect affected living docs
  -> rewrite current-state projection before durable checkpoint/handoff/review
  -> remove resolved problem from current docs
  -> keep unresolved remainder on Blackboard
```

If source and living docs disagree, source wins **and the docs are stale until reconciled**. Staleness is not deferred documentation debt; it blocks claiming that implementation checkpoint as handoff-safe/current.


## Repository context loading pipeline

For a migrated item:

```text
Blackboard item
  -> exact current-context ref + generation
  -> validate WORK_CONTEXT_SPEC
  -> verify exact Board binding
  -> resolve required current-system/input refs
  -> keep auditRefs lazy
  -> execute only the declared action/scope
  -> source/tests remain correctness truth
```

Failure of binding, required refs, review read-only scope, or implementation authority fails closed. A worker does not recover missing authority from prior chat or a neighboring generation file.

Context generation is separate from currentness:

```text
candidate gN+1 generated + validated
  != current

reviewed repository change updates Board pointer
  -> gN+1 becomes current

old gN
  -> historical / stale for new durable action
```

The first consumer is repository development coordination only. Runtime JSON Blackboard keeps its existing application lifecycle semantics.
