# Documentation router

Use this file to choose the smallest authority surface for the question at hand. Do not load every documentation tree by default.

## Start here

Read `living/README.md` first for the authority model and promotion lifecycle.

Then route by question:

- `living/architecture.md` — current **promoted** documentation/knowledge architecture.
- `living/pipelines.md` — promoted knowledge/promotion lifecycle and link to the active product delivery pipeline.
- `living/contracts.md` — authority, evidence, promotion and coordination invariants.
- `living/knowledge/state.md` — current durable knowledge snapshot.
- `living/knowledge/evidence.md` — observation/provenance ledger.
- `living/knowledge/judgment.md` — evidence-derived conclusions and uncertainty.
- `living/knowledge/audit.md` — independent challenge.
- `living/decisions/` — accepted/promoted choices.

## Active convergence material

`worktree/` contains current Agentic System design/delivery convergence material:

- `worktree/state.md` — top-level convergence router and delivered checkpoint.
- `worktree/pipeline.md` — accepted current 10-stage delivery ordering; stage-local component sketches remain candidates unless separately promoted.
- `worktree/agentic-application/` — application-layer convergence material.
- `worktree/oracle/` — Oracle convergence material.
- `worktree/core-harness/` — Core continuation material.

Read `worktree/README.md` before treating any worktree statement as authoritative. Historical wording such as `desired`, `target` or `next` does not itself promote a claim.

## Deeper references

- `architecture/` — deeper implemented/Core design records and historical/reference architecture material.
- `development/` — repository development and verification process.

These are supporting references. They do not silently override promoted living knowledge or executable implementation evidence.

## Routing rules

```text
Question about accepted knowledge/documentation architecture?
    -> living/architecture.md

Question about promotion / convergence lifecycle?
    -> living/pipelines.md
    -> living/contracts.md

Question about why something is believed?
    -> living/knowledge/evidence.md
    -> living/knowledge/judgment.md
    -> relevant living/decisions/*

Question about project delivery / what next?
    -> worktree/README.md
    -> worktree/state.md
    -> worktree/pipeline.md

Question about candidate application semantics?
    -> worktree/agentic-application/state.md
    -> smallest relevant child

Question about candidate Oracle semantics?
    -> worktree/oracle/state.md
    -> smallest relevant child

Question about Core continuation?
    -> worktree/core-harness/state.md
    -> source/public exports for implemented truth

Question about historical/deeper implementation design?
    -> architecture/

Question about implementation/verification process?
    -> development/
```

## Typed authority

```text
source/public exports
    = what is implemented now

runtime observation / executable evidence
    = what behavior actually occurred

living/architecture.md
living/pipelines.md
living/contracts.md
    = promoted accepted views for their respective questions

living/knowledge/*
    = durable observations, conclusions and challenge by type

living/decisions/*
    = accepted/promoted choices

worktree/*
    = convergence/candidate material plus delivered checkpoints;
      not automatic desired-state authority
```

There is no single global source of truth. Authority is typed by question, evidence and promotion state.
