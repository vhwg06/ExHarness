# Oracle architecture

Desired layer placement and dependency direction.

## LAYERS

```text
+------------------------------------------------------+
| Agentic Application Layer                           |
|                                                      |
| Orchestrator / Advisor / Workers                     |
| application-owned ContextRequirement/ContextContract |
+---------------------------+--------------------------+
                            |
                            | resolve(contract)
                            v
+------------------------------------------------------+
| Infrastructure                                       |
|                                                      |
| Oracle                                               |
|   thin resolution/composition boundary               |
|                                                      |
|   direct resolvers / source-specific adapters        |
|       |           |           |          |           |
|      repo        files      OpenAPI     Figma   ...   |
+------------------------------------------------------+
                            |
                            | validated context
                            v
+------------------------------------------------------+
| Agentic Application Layer                           |
| Worker.execute(context)                              |
+---------------------------+--------------------------+
                            |
                            v
+------------------------------------------------------+
| ExHarness Core                                       |
| execution/runtime substrate                          |
+------------------------------------------------------+
```

Oracle is infrastructure used by the Agentic Application Layer. ExHarness Core remains the execution/runtime substrate and does not own Oracle semantics.

## DEPENDENCY INVERSION

The application defines the semantic port. Oracle implements it.

```text
application:
    ContextContract
    ContextRequirement

infrastructure:
    resolve requirement
    pull external data
    adapt source data
    validate/return application contract
```

Infrastructure concerns must not leak upward into the contract. An application contract should not need to know whether a source was reached through `fetch`, filesystem access, a vendor SDK, MCP, code search or a retrieval engine.

## IMPLEMENTATION SHAPE

The initial implementation should remain function-oriented and explicit.

Conceptually:

```ts
type Resolver<I, O> = (input: I) => Promise<O>;

async function resolveContext(requirement) {
  const parts = await resolveDeclaredParts(requirement);
  const context = assemble(parts);
  return ContextSchema.parse(context);
}
```

Do not introduce a provider runtime, service lifecycle, session object, plugin graph or generic context engine unless a concrete requirement proves that abstraction necessary.

## RESOLVER BOUNDARY

Resolvers are source-facing infrastructure units, not semantic policy owners.

A resolver may be as small as a direct read/parse function. A larger adapter is justified only when the source itself requires one.

```text
Oracle
  -> file resolver
  -> repository resolver
  -> OpenAPI resolver
  -> Figma resolver
  -> other source resolvers as required
```

MCP and semantic retrieval are optional implementation techniques behind a resolver, not architectural layers that every source must traverse.

## ROLE BOUNDARY

Backend, frontend, QA and design are Worker/application specializations. Their exact context schemas remain application-owned and are intentionally outside Oracle architecture.

Oracle must be reusable across those roles without becoming aware of role reasoning policy.
