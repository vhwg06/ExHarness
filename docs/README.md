# Documentation router

## Work selection

For every non-trivial session, start at:

- `living/blackboard.md` — canonical gaps/problems/open-work surface.

Claim eligible work there before execution.

## Current system documentation

After claiming work, load the smallest relevant current-state document:

- `worktree/state.md` — current system checkpoint.
- `worktree/pipeline.md` — current delivered Backend -> QA pipeline.
- `worktree/agentic-application/` — current application architecture/semantics/contracts/workflow.
- `worktree/oracle/` — current source-resolution boundary.
- `worktree/core-harness/` — current Core boundary.

`docs/worktree/` is source-synchronized living documentation despite its legacy directory name. It contains no open gaps/backlog by contract.

## Durable knowledge

- `living/knowledge/evidence.md`
- `living/knowledge/judgment.md`
- `living/knowledge/audit.md`
- `living/decisions/`
- `living/architecture.md`
- `living/contracts.md`
- `living/pipelines.md`

## Deeper references

- `architecture/` — deeper historical/reference implementation records.
- `development/` — development/verification process.

## Authority

```text
implemented behavior       -> source/public exports + executable tests/runtime
current documented system  -> worktree/* reconciled to source
open gap/problem/next work -> living/blackboard.md
knowledge provenance       -> living/knowledge/*
accepted doc invariants    -> living/decisions + living/contracts
```

If `worktree/*` and source disagree, source wins and the living document must be reconciled. If an unresolved problem appears in `worktree/*`, migrate it to the Blackboard.
