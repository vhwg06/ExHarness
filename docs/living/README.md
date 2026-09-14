# Living documentation router

ExHarness separates **current system truth** from **open work**.

## First read for any non-trivial work

1. `blackboard.md` — see what is unresolved, eligible, claimed, blocked or done.
2. After claiming an item, load only the relevant source-synchronized docs under `../worktree/`.
3. Inspect source/tests whenever implementation detail matters.
4. After source changes, update the relevant worktree docs and write the Board result back.

## Two surfaces

```text
../worktree/*
    = living documents kept up to date with source code
    = current state only

blackboard.md
    = gaps / problems / open questions / blockers / next work
```

If a worktree document contains a future desired component or unresolved problem, the documentation is incorrectly partitioned: move that item to the Blackboard and leave only current source-backed facts in the living projection.

## Durable knowledge

- `knowledge/evidence.md` — observations with provenance.
- `knowledge/judgment.md` — conclusions derived from evidence.
- `knowledge/audit.md` — independent challenge.
- `decisions/` — accepted/promoted choices.
- `architecture.md` / `contracts.md` / `pipelines.md` — documentation/knowledge-system invariants.

These do not replace the Board. A judgment may remain unresolved epistemically, but actionable project gaps/problems still need a Blackboard item if another session may work on them.

## Routing

```text
What should I work on?
    -> blackboard.md

What does the system currently do?
    -> ../worktree/state.md
    -> smallest relevant child
    -> source/tests when needed

Why do we believe a claim?
    -> knowledge/evidence.md
    -> knowledge/judgment.md

What documentation rules apply?
    -> architecture.md
    -> contracts.md
```
