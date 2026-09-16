# Decisions

This directory contains material architecture/governance decisions and their promotion state.

A decision is not a transcript and not a parking lot for unrelated ideas.

Decision lifecycle:

```text
PROPOSED
  -> evidence/review/audit as required
  -> ACCEPTED / PROMOTED
  -> SUPERSEDED when later accepted evidence replaces it
```

`docs/worktree/*` must never be used for proposed/future design merely because a decision is not accepted yet. Worktree is the source-synchronized projection of the system that exists now.

Unresolved operational work belongs on `../blackboard.md`. Evidence/judgment/audit material belongs under `../knowledge/`. A decision proposal may live here as `PROPOSED` while it is being reviewed, but it must not be promoted into worktree current-state docs until accepted and applicable to current source-backed reality.

Each material decision should state:

```text
id
status: PROPOSED | ACCEPTED | PROMOTED | SUPERSEDED
proposed-at / accepted-at
accepted-by / acceptance boundary
context
choice
supporting evidence/judgment refs when applicable
rejected alternatives
consequences
promotion targets
what would reopen it
```

`PROMOTED` means the accepted decision has been materialized into the relevant authority view. Promotion into `docs/worktree/*` is valid only for constraints/facts that describe or constrain the current source-backed system; it must not make unimplemented desired state look current.
