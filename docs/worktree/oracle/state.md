# Oracle desired state

Living desired-state projection for the Oracle boundary. Read this first for Oracle work; load child files only when the task needs them.

## STATUS

Oracle semantics and architecture are agreed. Implementation is not yet authority.

## PURPOSE

Oracle is an infrastructure bridge for explicit context feeding into the Agentic Application Layer.

The application owns the semantic context requirement. Oracle satisfies that requirement by pulling from external/infrastructure sources, adapting the result and returning an application-shaped context object.

```text
Agentic Application Layer
    owns ContextRequirement / ContextContract
              |
              | resolve once
              v
            Oracle
      infrastructure boundary
              |
              | pull + adapt
              v
 repo / files / docs / OpenAPI / Figma / CI / other sources
              |
              v
      validated Context
              |
              v
            Worker
```

## TARGET SEMANTICS

- application decides what context is needed, why it is needed and what shape it must have;
- Oracle decides where that data lives and how to retrieve/adapt it;
- context resolution is single-pass and explicit: resolve once before the Worker executes;
- Oracle does not own a run loop, session lifecycle, provider state or before/after hooks;
- context contracts are typed and runtime-validatable; initial implementation target is Zod-compatible schemas;
- direct source access is the default implementation;
- specialized infrastructure such as MCP or retrieval/RAG is used only when a concrete source requirement needs that capability;
- Oracle must satisfy the application requirement, not invent broader relevance semantics or silently expand scope.

## TARGET FLOW

```text
application-owned requirement
        -> resolve fields
        -> pull from concrete sources
        -> adapt/normalize
        -> assemble
        -> validate application-owned schema
        -> explicit context feed
        -> Worker.execute(...)
```

## CHILDREN

- `semantics.md` — ownership and semantic invariants.
- `architecture.md` — layer placement and dependency direction.
- `workflow.md` — single-pass resolution path.
- `decisions.md` — constraints that implementation must preserve.
- `gaps.md` — unresolved implementation choices and exit conditions.

## NOT ORACLE

Oracle is not an agent, advisor, orchestrator, worker, semantic-memory system, runtime context lifecycle, generic RAG platform or correctness authority.

It does not choose the Worker context contract. It does not participate in Worker reasoning after the resolved context has been handed off.
