# Documentation router

Use this file to choose the smallest authoritative document for the question at hand. Do not load every documentation tree by default.

## Start here

For current repository direction and active desired state:

- `worktree/state.md` — top-level Agentic System state/router.
- `worktree/pipeline.md` — canonical active 10-stage delivery sequence.

Then route by layer:

- `worktree/agentic-application/state.md` — objectives, orchestration, Advisor, Workers, application completion and context requirements.
- `worktree/oracle/state.md` — resolve-once context infrastructure, source adapters and dereference semantics.
- `worktree/core-harness/state.md` — ExHarness Core/kernel continuation, cognition, evidence/trust, persistence and recovery semantics.

## Deeper references

- `architecture/` — deeper implementation/design records, primarily for the delivered ExHarness Core and historical/reference architecture decisions.
- `development/` — repository development and verification process.

These are supporting references. When they conflict with an active worktree decision, the current worktree projection wins for desired-state continuation; source/public exports remain authority for what is actually implemented.

## Routing rules

```text
Question about project target / what next?
    -> worktree/state.md
    -> worktree/pipeline.md

Question about application work semantics?
    -> worktree/agentic-application/state.md
    -> smallest relevant child: semantics / architecture / boundaries / workflow / contracts / decisions / gaps

Question about context feeding / source resolution / artifact dereference?
    -> worktree/oracle/state.md
    -> smallest relevant Oracle child

Question about ExHarness runtime/kernel semantics?
    -> worktree/core-harness/state.md
    -> smallest relevant Core child

Question about historical/deeper implementation design?
    -> architecture/

Question about implementation/verification process?
    -> development/
```

## Authority model

```text
source/public exports
    = implemented truth now

worktree/state + routed child
    = active desired delivery truth

worktree/pipeline
    = active implementation ordering / learning sequence

architecture/*
    = deeper design/reference/history; not current delivery authority by default
```

The worktree is a materialized engineering context tree, not a transcript. Keep current state, accepted decisions, gaps and desired convergence there; let Git retain superseded history.
