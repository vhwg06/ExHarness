# Documentation router

Use this file to choose the smallest context/authority surface for the question at hand. Do not load every documentation tree by default.

## Start here

For every non-trivial shared work session:

1. `living/blackboard.md` — read current work state and claim an eligible item.
2. `living/README.md` — authority/promotion rules when needed.
3. Load only the context required for the claimed board item.
4. Write the operational result back to the Blackboard before leaving.

Do not choose work directly from `worktree/` while bypassing the Blackboard.

## Living surfaces

- `living/blackboard.md` — active questions/work, claims, dependencies, blockers, results and refs.
- `living/architecture.md` — promoted accepted architecture.
- `living/pipelines.md` — board/session lifecycle plus knowledge-promotion lifecycle.
- `living/contracts.md` — coordination, authority, evidence and promotion invariants.
- `living/knowledge/state.md` — durable knowledge snapshot.
- `living/knowledge/evidence.md` — observation/provenance ledger.
- `living/knowledge/judgment.md` — evidence-derived conclusions and uncertainty.
- `living/knowledge/audit.md` — independent challenge.
- `living/decisions/` — accepted/promoted choices.

## Supporting convergence material

`worktree/` contains design/delivery context used after work has been claimed:

- `worktree/state.md` — top-level convergence and delivered checkpoint.
- `worktree/pipeline.md` — larger delivery ordering.
- `worktree/agentic-application/` — application-layer convergence material.
- `worktree/oracle/` — Oracle convergence material.
- `worktree/core-harness/` — Core continuation material.

Historical wording such as `desired`, `target` or `next` does not itself promote a claim.

## Routing rules

```text
What can I work on now?
    -> living/blackboard.md

I claimed an application item; what context do I need?
    -> worktree/agentic-application/*
    -> relevant living promoted docs
    -> source/tests as needed

I claimed an Oracle/context item?
    -> worktree/oracle/*

I claimed a Core/runtime item?
    -> worktree/core-harness/*

Why is something believed?
    -> living/knowledge/evidence.md
    -> living/knowledge/judgment.md
    -> relevant living/decisions/*

What architecture/pipeline/contract is accepted?
    -> living/architecture.md | living/pipelines.md | living/contracts.md

What is actually implemented/observed?
    -> source/public exports | runtime/executable evidence
```

## Typed authority

```text
living/blackboard.md
    = operational authority for current work selection/ownership/status

source/public exports
    = implemented behavior now

runtime/executable evidence
    = observed behavior

living/architecture.md
living/pipelines.md
living/contracts.md
    = promoted accepted views

living/knowledge/*
    = durable observations/conclusions/challenge by type

living/decisions/*
    = accepted/promoted choices

worktree/*
    = supporting convergence/candidate material for claimed work
```

There is no single global source of truth. The Blackboard is nevertheless mandatory for operational coordination: work selection begins there.
