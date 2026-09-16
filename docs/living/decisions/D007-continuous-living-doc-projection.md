# D007 — Living docs are a continuous current-system projection

Status: **PROPOSED**

Proposed: 2026-09-16

Acceptance boundary: repository owner explicitly requires living docs to be updated continuously so they describe the system as closely as possible at every implementation checkpoint.

## Question

Should `docs/worktree/*` be reconciled only after a work item/phase completes, or continuously as the implemented system changes?

## Proposed decision

`docs/worktree/*` is not an end-of-phase documentation task. It is the continuously maintained projection of the current implemented system.

The synchronization invariant is:

```text
at every accepted implementation checkpoint:

source + executable tests + runtime-observable behavior
    ~= docs/worktree/* current-state projection
```

The projection does not mechanically mirror source text. It must remain semantically aligned with the behavior, architecture, contracts, authority boundaries and workflow that actually exist now.

## Same-change rule

Any change that alters current behavior, architecture, contracts, authority boundaries, public surface or executable workflow must reconcile the affected `docs/worktree/*` documents in the same change before that checkpoint is eligible for review/acceptance/merge.

```text
implementation changes current system semantics
  -> identify affected worktree projection
  -> update source/tests
  -> update affected worktree docs
  -> verify source + docs describe the same current system
  -> only then review/accept/merge
```

Do not defer reconciliation until:

- the Blackboard item becomes `DONE`;
- the end of a phase/wave;
- a later documentation cleanup;
- a future session.

A work item may remain unresolved while its already-implemented partial state is reflected in living docs.

## Staleness rule

A stale worktree document is a system-state defect, not harmless documentation debt.

If source/runtime/tests and `docs/worktree/*` disagree:

1. source/runtime/tests remain implementation authority;
2. the affected living document is immediately considered stale;
3. the current change/session must reconcile it before claiming the relevant implementation checkpoint as complete.

The Blackboard must not be used to justify stale living docs. Blackboard stores unresolved work; worktree docs describe what exists now.

## Desired-state separation

Future design, proposed APIs, unresolved gaps, next steps and candidate behavior must not be inserted into `docs/worktree/*` to make it look current.

Those belong to:

- `docs/living/blackboard.md` for unresolved operational work;
- `docs/living/decisions/*` for proposed/accepted design decisions;
- `docs/living/knowledge/*` for evidence/judgment/audit artifacts.

## Review contract

Every material change must classify living-doc impact:

```text
CURRENT_SYSTEM_CHANGED
  -> affected worktree docs updated in the same change

CURRENT_SYSTEM_NOT_CHANGED
  -> no worktree rewrite required; reviewer verifies the change is documentation-neutral
```

A change that materially changes the current system while leaving the corresponding worktree projection stale is not review-complete.

## Consequences if accepted

- living docs evolve incrementally with implementation, not in cleanup batches;
- fresh sessions see the closest available source-backed description of the system;
- Board state and current-system docs remain distinct but synchronized to the same repository reality;
- `DONE` remains an operational acceptance state, not the trigger for documentation synchronization.
