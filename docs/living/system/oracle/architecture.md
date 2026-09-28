# Oracle current architecture

Oracle source IO now lives in the private infrastructure package `@exharness/oracle`. The Agentic Application compatibility adapter parses its WorkOrders and validates its context schemas; the package reads the requested sources through injected readers.

```text
BackendWorkOrder.requiredFiles
        -> resolveBackendContext
        -> @exharness/oracle.readRepositorySources
        -> repositoryReader
        -> BackendContext

QaWorkOrder.requiredArtifacts
        -> resolveQaContext
        -> @exharness/oracle.readApplicationArtifacts
        -> artifactReader
        -> QaContext
```

Application schemas/contracts stay above the source adapters. Oracle providers perform concrete reads and preserve source references; the compatibility adapter validates using Application-owned schemas.

## Semantic contract and runtime seam

Application semantic need -> ContextRequirement -> injected Core pre-prompt resolver -> ContextResolution -> Core context projection -> `renderAgentContext`. The contract and Core port are implemented; provider selection and production wiring remain future work. A development-only compatibility probe exercises the contract with fixed Backend/QA source fixtures. Core imports no Oracle implementation, and Oracle imports neither Core nor Agentic Application. Oracle has no acceptance, publication, scheduling or recovery authority.

The two moved source loops are compatibility providers, not the final Oracle API. Retained findings are physical source ownership, required-source failure behavior and provenance. The earlier thin-IO-only architecture and assumption that the existing Application adapter was sufficient for runtime context intelligence are superseded. Aider's budgeted repo map, Serena/SolidLSP's semantic symbols, and Zoekt's lexical retrieval remain comparison patterns for later provider experiments; no backend is selected. Serena application is GPL-3.0-or-later, while SolidLSP is MIT.

`@exharness/oracle` exports the ContextRequirement/ContextResolution v1 semantic schema and identity helpers. Core accepts requirement blocks through an injected resolver and does not import Oracle. Automatic progressive re-resolution, provider catalog/planner and durable resolution cache are not implemented.

The two implemented source classes intentionally remain distinct because repository reads and application-produced artifact lookup carry different identity/provenance semantics.

## MCP boundary

Current source has **no MCP adapter** and no MCP-owned Oracle lifecycle. MCP request ids, handles, MRTR state and task state therefore do not appear in the current runtime architecture.

Any later concrete MCP-backed source must remain a source/capability adapter below the application-owned context/work lifecycle boundary. MCP protocol support alone does not create a third Oracle source class.

Current source contains no generic source registry, generic Resolver interface, provider lifecycle, automatic refresh, MCP adapter framework or retrieval engine.
