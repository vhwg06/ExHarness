# Outer Blackboard

Status: **CURRENT DEVELOPMENT CONTEXT ROUTER**

The outer Blackboard exists so a fresh development session can enter the exact work that must be delivered now without reconstructing prior sessions or repository history.

It is not the system knowledge base. Current system truth belongs to `../living/`.

## Single current-state model

```text
state.md
  -> active work
  -> current-context.ref
  -> context/<WORK_ID>/current.json
       -> exact action/lane
       -> semantic input ref
       -> authority/result refs when required
       -> current-system/input refs
       -> source scope
       -> verification
```

`state.md` is the only current development-state SoT. Each active work item has one helpful context file named `current.json`; that file is updated in place.

There is no context generation chain, stale-context state, parent-context traversal, audit-ref chain, or "pick the newest file" rule. Git history already preserves previous revisions.

## Artifact / authority separation

Helpful context is routing and loading convenience only.

```text
current.json
  != authority
  != acceptance evidence
  != historical record

IMPLEMENTATION_INPUT
READINESS_DECISION
IMPLEMENTATION_RESULT
JUDGMENT
  = explicit pipeline artifacts bound to the work/semantic/candidate subjects they actually describe
```

Authority artifacts never derive trust from helper-context identity.

## Pipelines

```text
RESEARCH_SA
  problem/question
    -> research
    -> SA synthesis
    -> current IMPLEMENTATION_INPUT

IMPLEMENTATION_WORKER
  IMPLEMENTATION_INPUT
    -> JUDGMENT / READINESS
    -> READINESS_DECISION
    -> EXECUTION / INITIAL
    -> IMPLEMENTATION_RESULT
    -> JUDGMENT / CANDIDATE
         -> ACCEPT
         -> FINDINGS -> EXECUTION / REPAIR
```

The current helper context changes lane in place. Producer facts and independent correctness judgment remain separate authorities.

## Fresh-session contract

```text
fresh session
  -> read state.md
  -> select exact workId / pipeline / stage
  -> follow current-context.ref
  -> load only refs declared by current.json
  -> execute the declared role/action
```

A fresh session never needs previous chat context, old Blackboard context files, a history directory, or a repository-wide documentation scan.

## Layout

- `state.md` — single current development projection;
- `contracts.md` — stable coordination invariants;
- `pipelines.md` — current pipeline semantics;
- `context/<WORK_ID>/current.json` — one helpful context for each active item;
- `artifacts/` — current semantic/decision/result/judgment work products;
- `process/` — current verification process references.

Current mutable files are corrected in place. Git is the only revision history.
