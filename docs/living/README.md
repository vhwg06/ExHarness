# Living Docs

Status: **CURRENT SYSTEM / CURRENT DURABLE KNOWLEDGE**

Living Docs are the explicit description of the system and project knowledge that is true now.

They do not track active development work, blockers, next actions or fresh-session ownership. Those belong to `../blackboard/`.

## Current system

`system/` is the source-synchronized current-system projection:

- `system/state.md` — current composition checkpoint;
- `system/capabilities.md` — delivered capability semantics;
- `system/pipeline.md` — delivered execution topology;
- `system/agentic-application/` — current application semantics/contracts;
- `system/oracle/` — current Oracle boundary;
- `system/core-harness/` — current Core boundary.

```text
living/*
  = what is currently true
  != backlog
  != old revision archive
```

When source semantics change, the affected Living Docs are corrected in place in the same durable change.

## No stale/version siblings

Current knowledge uses one canonical path per subject. Do not keep `v2/v3/vN` sibling documents or tombstone files in the working tree to represent revision history.

```text
current knowledge changes
  -> update canonical file in place

previous revision
  -> Git history only
```

Research or decisions remain under Living Docs only while they still provide current durable knowledge or constraints. Superseded material is removed from the working tree after its current semantics are incorporated.

For current development state, read `../blackboard/state.md`.

## Current knowledge boundary

`knowledge/` contains only durable knowledge that is directly current and needed to orient/deliver the present system. It is not a research notebook, review transcript, evidence ledger or probe directory.

Current integration roadmap:

`knowledge/integration-phase-research-to-implementation-readiness.md`

Research/probe execution belongs under `scripts/` and tests. Once research semantics are promoted into current system/decision/implementation-input surfaces, the research transcript is removed from the working tree; Git history preserves it.
