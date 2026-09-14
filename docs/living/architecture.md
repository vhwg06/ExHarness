# Accepted living-knowledge architecture

Status: **PROMOTED**

Decision: `decisions/D001-living-docs-authority.md`

This document is a materialized view of the accepted ExHarness documentation/knowledge architecture. It is not the place where candidate architecture is invented.

## System model

```text
                    ┌──────────────────────┐
                    │ Coordination plane   │
                    │      BLACKBOARD      │
                    │                      │
                    │ work / claims        │
                    │ progress / signals   │
                    │ dependencies         │
                    │ discoveries          │
                    └──────────┬───────────┘
                               │ observations / refs
                               v
                    ┌──────────────────────┐
                    │  Knowledge pipeline  │
                    │                      │
                    │ Evidence             │
                    │   -> Judgment        │
                    │   -> Audit           │
                    │   -> Decision        │
                    └──────────┬───────────┘
                               │ promote
             ┌─────────────────┼─────────────────┐
             v                 v                 v
      architecture.md      pipelines.md      contracts.md
             │                 │                 │
             └─────────────────┼─────────────────┘
                               │ selective context
                               v
                         next session/agent

Artifact plane remains separate:
source / tests / configs / runtime observations / produced artifacts
```

## Blackboard boundary

The Blackboard is shared external operational state for asynchronous coordination. It may eventually carry work items, ownership/claims, progress, dependencies, artifact references, discoveries, blockers and signals.

These categories describe the responsibility of the coordination plane, not an already-selected runtime schema.

The following remain **unpromoted design questions**:

- storage and persistence mechanism;
- atomic claim/lease semantics;
- stale-state policy;
- event/subscription model;
- conflict resolution;
- retention/compaction;
- exact WorkItem schema;
- relationship to application persistence and ExHarness runtime persistence.

Do not infer a `ClaimManager`, lease service, event bus, database or file format from this architecture until those components have evidence and an accepted decision.

## Living knowledge boundary

Living knowledge is durable, reviewable and lower-frequency than coordination state.

- `knowledge/state.md` is a current knowledge snapshot, not a progress transcript.
- `knowledge/evidence.md` records observations with provenance.
- `knowledge/judgment.md` records conclusions derived from evidence, including assumptions and what would change them.
- `knowledge/audit.md` records independent challenge; an audit finding is not automatically truth.
- `decisions/` records accepted choices and promotion rationale.
- `architecture.md`, `pipelines.md`, `contracts.md` are promoted materialized views.

## Artifact boundary

Artifacts remain authority for existence and executable behavior within their type.

Source code can establish what implementation exists. Tests and runtime observations can establish evidence about behavior. Neither automatically establishes product intent, architectural acceptance or universal correctness.

## Context routing

Agents should load the smallest authority surface required for the question.

```text
accepted architecture question
  -> living/architecture.md

accepted lifecycle/delivery question
  -> living/pipelines.md

invariant question
  -> living/contracts.md

why is this believed?
  -> living/knowledge/evidence.md
  -> living/knowledge/judgment.md
  -> relevant decision

what are we still exploring?
  -> worktree/

what is actually implemented?
  -> source/public exports
```

The architecture is designed so an agent/session can die while durable work and knowledge survive outside its local context.
