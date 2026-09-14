# Oracle workflow

Desired single-pass context-resolution workflow.

## RESOLUTION PATH

```text
1. Agentic Application selects a Worker/task
2. Application constructs the Worker-owned ContextRequirement
3. Oracle resolves that requirement once
4. Oracle delegates each declared part to the simplest fitting resolver
5. Resolvers pull and adapt source data
6. Oracle assembles the application-shaped context object
7. Application-owned schema validates the assembled context
8. The validated context is explicitly fed to the Worker
9. Worker executes using that snapshot
```

Expanded:

```text
objective / task
      |
      v
application ContextRequirement
      |
      v
Oracle.resolve(requirement)
      |
      +--> direct file/repo/API resolver
      +--> source-specific adapter when necessary
      +--> MCP client only when the source already benefits from MCP
      +--> retrieval/RAG only when the requirement is genuinely retrieval-shaped
      |
      v
adapted parts
      |
      v
assemble application ContextContract
      |
      v
runtime schema validation
      |
      v
explicit feed to Worker
      |
      v
Worker.execute(context)
```

## RESOLVE-ONCE BOUNDARY

Oracle does not remain attached to the Worker after handoff.

```text
resolve -> validate -> hand off -> done
```

No implicit context refresh occurs during the execution. A re-resolution is a new, explicit application action and produces a new context snapshot.

## FIELD RESOLUTION

The application requirement determines which parts are resolved. Oracle does not enumerate all available sources and then decide which are relevant.

For every declared part, implementation should start with the cheapest correct path:

```text
known exact source        -> direct read/parse
known external service   -> direct API/SDK when simple
existing useful MCP      -> MCP client adapter
unknown subset of corpus -> search/retrieval appropriate to that source
```

The mechanisms can coexist per context resolution. Architectural uniformity is not a reason to route simple reads through a heavier mechanism.

## VALIDATION

Validation happens after adaptation and before Worker handoff.

The schema belongs to the application. Oracle may report resolver/source diagnostics, but it cannot relax or rewrite the application contract to make an invalid context pass.

## OUT OF FLOW

The desired v0 workflow has no:

- `before_run` / `after_run` provider hooks;
- Oracle session state;
- automatic per-turn refresh;
- background context synchronization;
- autonomous source discovery outside the requirement;
- Worker reasoning inside Oracle;
- post-run mutation of application semantics.
