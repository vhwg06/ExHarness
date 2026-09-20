# Living Docs

Status: **CURRENT SYSTEM / DURABLE PROJECT KNOWLEDGE**

Living Docs are the clearest explicit description of the system that exists now.

They answer:

> What does ExHarness currently do, what boundaries/contracts exist, and what durable knowledge is true for the current project state?

They do not track active development work, blockers, next actions, pipeline stage or fresh-session ownership. Those belong to `../blackboard/`.

## Current system

`system/` is the source-synchronized current-system projection:

- `system/state.md` — current composition checkpoint;
- `system/capabilities.md` — explicit delivered capability semantics;
- `system/pipeline.md` — currently delivered execution topology;
- `system/agentic-application/` — application semantics/contracts;
- `system/oracle/` — current Oracle boundary;
- `system/core-harness/` — current Core boundary.

```text
living/system/*
  = what exists now
  != desired future state
  != active implementation plan
  != backlog
```

When source semantics materially change, the affected `living/system/*` projection is reconciled in the same durable change.

## Durable knowledge

- `knowledge/` — evidence, judgment and retained research already promoted into project knowledge;
- `decisions/` — accepted/promoted decisions and provenance;
- `reference/architecture/` — deeper historical/reference architecture records.

These are not the default fresh-session loading surface. The current Blackboard context selects the minimum relevant refs.

For current development state, read `../blackboard/state.md`. Do not infer open work from Living Docs.

## Canonical mutable documents

For current mutable project knowledge such as the active integration roadmap, keep one canonical path and update it in place. Git history is the revision history. Do not create sibling `vN` files for ordinary corrections unless the document is intentionally frozen as historical evidence and is clearly marked non-current.
