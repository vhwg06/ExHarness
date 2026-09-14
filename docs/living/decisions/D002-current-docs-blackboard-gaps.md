# D002 — Living docs mirror current source; Blackboard owns all gaps

Status: **PROMOTED**

Accepted at: 2026-09-14

Acceptance boundary: repository owner explicitly corrected the previous partition.

## Decision

ExHarness uses this documentation split:

```text
docs/worktree/*
    = living documents updated to match current source code
    = current state/architecture/semantics/contracts/workflow only

docs/living/blackboard.md
    = all unresolved gaps / problems / questions / blockers / next work
```

When the Blackboard is introduced or reconciled, open work must be migrated from existing docs rather than starting with an incomplete empty board.

## Migration semantics

For every old gap/candidate statement:

- if source already resolves it, rewrite it as a current living fact;
- if it is a real unresolved problem, create/merge a Blackboard item;
- if it is an explicit non-goal or has no concrete pressure, do not invent a backlog item;
- remove `gaps.md` and future-roadmap content from the source-synchronized projection.

## Consequences

- `worktree/*` may never be used as hidden backlog;
- project work selection begins with the Blackboard;
- living docs are reconciled after implementation changes;
- Blackboard completion reduces the later session's eligible action space;
- durable knowledge/evidence/promotion remains separate from operational work completion.

## Promotion targets

- `../blackboard.md`
- `../architecture.md`
- `../contracts.md`
- `../README.md`
- `../../worktree/README.md`
- `../../README.md`
