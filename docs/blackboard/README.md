# Outer Blackboard

Status: **DEVELOPMENT CONTEXT ROUTER**

The outer Blackboard exists so a fresh development session can understand **how the project is currently being developed** without first reconstructing the whole project.

It is not the system knowledge base. Current system truth belongs to `../living/`.

## Responsibilities

The Blackboard owns:

- active work id, pipeline, stage, status and dependencies;
- exact current context pointer for each active work item;
- bounded development artifacts;
- review / implementation authority refs;
- terminal operational history.

It does not duplicate architecture/capability semantics from Living Docs.

## Two independent pipelines

```text
RESEARCH_SA
  problem / question
    -> Researcher
    -> research artifact
    -> SA synthesis
    -> accepted implementation input
                         |
                         v
IMPLEMENTATION_WORKER
  accepted implementation input
    -> Worker
    -> verification / review / repair
    -> merge
    -> reconcile Living Docs when current system truth changed
```

The two pipelines are independent lanes. There is no implicit "first active Board item" and no single global session pipeline.

## Fresh-session contract

```text
fresh session
  -> read state.md
  -> select exact workId / pipeline / stage
  -> follow current-context.ref + generation
  -> resolve only required refs
  -> execute the declared role/action
  -> produce the declared output type
```

A fresh session must not need previous chat context, full Board history or a repository-wide documentation scan.

## Layout

- `state.md` — minimal current development projection;
- `contracts.md` — routing/context/pipeline invariants;
- `pipelines.md` — Research/SA and Implementation/Worker flows;
- `context/` — immutable WORK_CONTEXT_SPEC generations;
- `artifacts/` — development work products and pipeline handoffs;
- `history/` — terminal Board snapshots / closure records;
- `process/` — development verification process references.

Historical pre-migration context generations may retain original embedded path strings as provenance. They are audit history, never current authority.
