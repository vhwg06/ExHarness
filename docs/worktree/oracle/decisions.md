# Oracle decisions

Current desired-state constraints for Oracle implementation. This is not an ADR archive.

## LAYERING

- Oracle belongs to infrastructure, not the Agentic Application Layer and not ExHarness Core.
- The Agentic Application Layer owns role/task semantics and context contracts.
- ExHarness Core remains the execution/runtime substrate; Oracle must not push infrastructure semantics into the kernel.

## OWNERSHIP

- application owns what context is required, why it is required, its semantic scope and output schema;
- Oracle owns source location, retrieval and source-specific adaptation;
- Oracle must not invent additional context requirements or broaden semantic relevance beyond the application request;
- exact Backend/Frontend/QA/Design context schemas are not Oracle-owned.

## LIFECYCLE

- Oracle is single-pass and resolve-once for a Worker execution;
- resolution happens explicitly before Worker execution;
- no provider lifecycle, session state, automatic refresh or turn-by-turn context injection belongs in Oracle v0;
- a later refresh is another explicit application resolution, not hidden Oracle behavior.

## CONTRACTS

- context contracts must be typed and runtime-validatable;
- initial implementation should use Zod-compatible schemas instead of inventing a schema framework;
- Oracle may not weaken an application schema when source data is missing or malformed.

## IMPLEMENTATION POLICY

Use the simplest correct mechanism for each source.

```text
direct source access
    > source-specific adapter
        > specialized retrieval framework
```

- direct file/API/structured reads are the default;
- MCP is conditional: use an MCP client when a concrete source already exposes useful MCP capabilities and that path reduces integration cost;
- semantic retrieval/RAG is conditional: use it when the relevant subset is not known in advance and corpus retrieval is actually required;
- do not add MCP, embeddings, vector stores or retrieval pipelines merely for uniformity;
- Oracle complexity should be proportional to the source being resolved, not to hypothetical future platform needs.

## ABSTRACTION

- begin with functions/resolvers and explicit composition;
- do not introduce `ContextProvider`, plugin lifecycle, session manager, provider graph or generic context engine without a concrete requirement;
- common abstractions are justified only after multiple real resolvers demonstrate the same stable contract.

## AUTHORITY

- resolved context is a Worker input snapshot, not canonical source authority;
- Oracle is not an agent, advisor, orchestrator, evaluator or correctness authority;
- source systems remain authoritative for the data Oracle pulls and adapts.
