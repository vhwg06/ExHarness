# Oracle current constraints

These are current source-backed Oracle invariants plus accepted boundary constraints. This is not an ADR archive or a future implementation plan.

## LAYERING

- Oracle belongs to infrastructure, not the Agentic Application Layer and not ExHarness Core.
- The Agentic Application Layer owns role/task semantics and context contracts.
- ExHarness Core remains the execution/runtime substrate; Oracle must not push infrastructure semantics into the kernel.
- no MCP control plane or MCP-owned Oracle lifecycle exists in current source.

## OWNERSHIP

- application owns what context is required, why it is required, its semantic scope and output schema;
- Oracle owns source location, retrieval and source-specific adaptation;
- Oracle must not invent additional context requirements or broaden semantic relevance beyond the application request;
- exact Backend/Frontend/QA/Design context schemas are not Oracle-owned;
- WorkOrder/Blackboard identity is application-owned.

## LIFECYCLE

- current Oracle resolution is single-pass and resolve-once before Worker execution;
- no provider lifecycle, session state, automatic refresh or turn-by-turn context injection exists;
- a later refresh is another explicit application resolution, not hidden Oracle behavior;
- current source persists no MCP request, handle, MRTR or Tasks continuation state.

## CONTRACTS

- context contracts are typed and runtime-validatable through the application schemas;
- Oracle may not weaken an application schema when source data is missing or malformed;
- resolved context carries source refs; QA application artifacts additionally carry producer/acceptance provenance;
- the optional D014 manifest adapter may fail closed on artifact identity/provenance drift before QA context assembly; hashes and availability remain identity/operational signals, not correctness authority.

## IMPLEMENTATION POLICY

Current implementation uses the simplest concrete mechanism for each source:

```text
repository source           -> repositoryReader
application artifact source -> artifactReader
optional D014 validation    -> manifest-validating artifactReader wrapper
```

There is no MCP client, retrieval framework, cache layer, embeddings/vector store or generic source-provider framework in current Oracle source.

D006 is an accepted constraint on any later concrete MCP-backed source: MCP must remain below application work/lifecycle authority and protocol support alone does not count as a third source. Detailed non-current MCP mapping remains in `../../living/decisions/D006-mcp-is-an-oracle-adapter-boundary.md`, not in this source-synchronized projection.

## ABSTRACTION

- current composition is concrete functions/resolvers;
- there is no `ContextProvider`, generic Resolver interface, plugin lifecycle, session manager, provider graph or context engine;
- the two implemented source classes still have materially different identity/provenance semantics.

## AUTHORITY

- resolved context is a Worker input snapshot, not canonical source authority;
- Oracle is not an agent, advisor, orchestrator, evaluator or correctness authority;
- source systems remain authoritative for the data Oracle pulls and adapts;
- transport/source metadata never becomes application correctness or completion authority merely by entering context.
