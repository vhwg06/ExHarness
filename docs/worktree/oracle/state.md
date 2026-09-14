# Oracle convergence state

Durable convergence material for the Oracle boundary. This subtree preserves previously agreed direction plus unresolved implementation choices; its path does not automatically make every target detail desired-state authority.

Read `../README.md` and `../../living/contracts.md` before promotion.

## ACCEPTED PURPOSE

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

## ACCEPTED SEMANTIC DIRECTION

- application decides what context is needed, why it is needed and what shape it must have;
- Oracle decides where that data lives and how to retrieve/adapt it;
- context resolution is single-pass and explicit: resolve before Worker execution;
- Oracle does not own a run loop, session lifecycle, provider state or before/after hooks;
- Oracle must satisfy the application requirement, not invent broader relevance semantics or silently expand scope.

## CANDIDATE / IMPLEMENTATION-SENSITIVE DETAILS

Concrete schema library, source-adapter composition, direct-vs-specialized source access and future retrieval/MCP boundaries must be validated by real source requirements. Historical worktree wording that names a preferred implementation is not enough to promote it.

Current candidate flow remains:

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

- `semantics.md` — prior semantic invariants and candidate details.
- `architecture.md` — layer placement and dependency direction.
- `workflow.md` — current resolution-flow candidate.
- `decisions.md` — previously accepted/working constraints; reconcile against promoted living decisions when conflicts appear.
- `gaps.md` — unresolved implementation choices and exit conditions.

## NOT ORACLE

Oracle is not an agent, advisor, orchestrator, worker, semantic-memory system, runtime context lifecycle, generic RAG platform or correctness authority.

It does not choose the Worker context contract. It does not participate in Worker reasoning after resolved context has been handed off.
