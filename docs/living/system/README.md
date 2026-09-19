# Worktree — source-synchronized living system docs

`docs/living/system/` is the current materialized documentation of the Agentic System **as implemented now**.

Despite the legacy directory name, it is not a backlog, planning tree or candidate-design area.

## Invariant

```text
worktree/*
    = current source-backed state / architecture / semantics / contracts / workflow

docs/blackboard/state.md
    = unresolved gaps / problems / questions / blockers / next work
```

A worktree document must be reconciled when source changes. It must not contain future desired APIs, open gaps, next-stage plans or speculative abstractions.

If a source-backed fact exposes a problem, write the fact here and create/update the corresponding Blackboard item. Do not leave the problem embedded in this tree.

## Routing

- **system capability semantics -> `capabilities.md`**
- system checkpoint/composition inventory -> `state.md`
- current delivered execution topology -> `pipeline.md`
- current application layer -> `agentic-application/`
- current Oracle boundary -> `oracle/`
- current Core boundary -> `core-harness/`

For any question of **what remains to do**, read `docs/blackboard/state.md`, not this tree.

## Source authority

Source/public exports and executable tests are authority for implemented behavior. These documents are living projections of that source and should be corrected when they drift.
