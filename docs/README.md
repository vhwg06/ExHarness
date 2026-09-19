# Documentation router

The documentation surface has two top-level domains:

```text
docs/
  living/       current system truth and durable project knowledge
  blackboard/   development state, context, artifacts and pipeline routing
```

For non-trivial development work, start at `blackboard/state.md`, select the exact active work item, then follow its `current-context` pointer. Load only the Living Docs, source and artifact refs declared by that context.

A fresh session must not reconstruct project state by reading all docs, Board history or previous chat context.

## Living Docs

`living/` answers: **what system exists now, and what do we explicitly know about it?**

Primary current-system projection:

- `living/system/state.md`
- `living/system/capabilities.md`
- `living/system/pipeline.md`
- `living/system/agentic-application/`
- `living/system/oracle/`
- `living/system/core-harness/`

Durable supporting knowledge remains under `living/knowledge/`, `living/decisions/` and `living/reference/`.

Living Docs are not a work queue. They do not own blockers, next actions, active pipeline stage or fresh-session routing.

## Outer Blackboard

`blackboard/` answers: **how is the system currently being developed?**

It owns active work, pipeline/stage routing, exact fresh-session context pointers, development artifacts and operational history.

## Authority

```text
implemented behavior       -> source/public exports + executable tests/runtime
current documented system  -> docs/living/system/* reconciled to source
development state          -> docs/blackboard/state.md
fresh-session inputs       -> exact current WORK_CONTEXT_SPEC
development work products  -> docs/blackboard/artifacts/*
durable knowledge          -> docs/living/knowledge/* + decisions/*
```

Blackboard may reference Living Docs, but must not duplicate current-system semantics.
