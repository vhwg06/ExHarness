# Oracle decisions

Current desired-state constraints for Oracle implementation. This is not an ADR archive.

## LAYERING

- Oracle belongs to infrastructure, not the Agentic Application Layer and not ExHarness Core.
- The Agentic Application Layer owns role/task semantics and context contracts.
- ExHarness Core remains the execution/runtime substrate; Oracle must not push infrastructure semantics into the kernel.
- MCP, when used, is a source/capability adapter below Oracle's application-facing context boundary; it is not an Oracle control plane.

## OWNERSHIP

- application owns what context is required, why it is required, its semantic scope and output schema;
- Oracle owns source location, retrieval and source-specific adaptation;
- Oracle must not invent additional context requirements or broaden semantic relevance beyond the application request;
- exact Backend/Frontend/QA/Design context schemas are not Oracle-owned;
- WorkOrder/Blackboard identity is application-owned and must not be replaced by MCP request ids, transport lifetime, state handles, MRTR requestState or task handles.

## LIFECYCLE

- Oracle is single-pass and resolve-once for a Worker execution unless the explicit source call returns continuation state;
- resolution happens explicitly before Worker execution;
- no provider lifecycle, hidden session state, automatic refresh or turn-by-turn context injection belongs in Oracle;
- a later refresh is another explicit application resolution, not hidden Oracle behavior;
- for a concrete MCP-backed source, `input_required`, explicit state handles or Tasks handles are source-call continuation artifacts referenced by the enclosing application workflow, not Oracle/project lifecycle authority.

## CONTRACTS

- context contracts must be typed and runtime-validatable;
- initial implementation should use Zod-compatible schemas instead of inventing a schema framework;
- Oracle may not weaken an application schema when source data is missing or malformed;
- MCP output schema / structuredContent validation is transport/source validation only; it does not establish semantic correctness;
- configured source identity/endpoint plus URI/operation refs may contribute provenance; self-reported MCP serverInfo/name is descriptive metadata, not stable source or security authority;
- MCP `ttlMs` is a freshness/cache hint, not correctness authority.

## IMPLEMENTATION POLICY

Use the simplest correct mechanism for each source.

```text
direct source access
    > source-specific adapter
        > specialized retrieval framework
```

- direct file/API/structured reads are the default;
- MCP is conditional: use an MCP client when a concrete source already exposes useful MCP capabilities and that path reduces integration cost;
- prefer `resources/read` for URI-addressed read context; use `tools/call` only for source-specific operations that resources cannot express cleanly;
- Oracle remains read-oriented by default; a future mutating MCP tool must compose with explicit effect identity/reconciliation rather than infer completion from transport retry/task state;
- semantic retrieval/RAG is conditional: use it when the relevant subset is not known in advance and corpus retrieval is actually required;
- do not add MCP, embeddings, vector stores or retrieval pipelines merely for uniformity;
- Oracle complexity should be proportional to the source being resolved, not to hypothetical future platform needs.

## ABSTRACTION

- begin with functions/resolvers and explicit composition;
- do not introduce `ContextProvider`, plugin lifecycle, session manager, provider graph or generic context engine without a concrete requirement;
- common abstractions are justified only after multiple real resolvers demonstrate the same stable contract;
- MCP protocol support itself is not a third Oracle source class; only a concrete MCP-backed source with materially distinct source/provenance/continuation semantics can create third-source pressure.

## AUTHORITY

- resolved context is a Worker input snapshot, not canonical source authority;
- Oracle is not an agent, advisor, orchestrator, evaluator or correctness authority;
- source systems remain authoritative for the data Oracle pulls and adapts;
- MCP authorization, task state, request state, schemas, cache hints and server metadata do not become correctness or application-completion authority.
