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

Application semantic need -> ContextRequirement -> injected Core pre-prompt resolver -> ContextResolution -> Core context projection -> `renderAgentContext`. The contract, Core port, explicit SourceCatalog and deterministic RetrievalPlanner are implemented; production wiring remains future work. A development-only compatibility probe exercises the contract with fixed Backend/QA source fixtures. Core imports no Oracle implementation, and Oracle imports neither Core nor Agentic Application. Oracle has no acceptance, publication, scheduling or recovery authority.

The two moved source loops are compatibility providers, not the final Oracle API. Retained findings are physical source ownership, required-source failure behavior and provenance. The earlier thin-IO-only architecture and assumption that the existing Application adapter was sufficient for runtime context intelligence are superseded. Aider's bounded repo map informs the structural projector; Serena/SolidLSP symbols and Zoekt search inform injected adapters. No external backend is bundled. Serena application is GPL-3.0-or-later, while SolidLSP is MIT.

`@exharness/oracle` exports the ContextRequirement/ContextResolution v1 semantic schema and identity helpers. Core accepts requirement blocks through an injected resolver and does not import Oracle. SourceCatalog registers strict Oracle-internal provider descriptors and one authoritative current-snapshot observer per namespace. RetrievalPlanner emits bounded provider work before source calls. Automatic progressive re-resolution and durable resolution cache are not implemented.

The two implemented source classes intentionally remain distinct because repository reads and application-produced artifact lookup carry different identity/provenance semantics.

## MCP boundary

Current source has **no MCP adapter** and no MCP-owned Oracle lifecycle. MCP request ids, handles, MRTR state and task state therefore do not appear in the current runtime architecture.

Any later concrete MCP-backed source must remain a source/capability adapter below the application-owned context/work lifecycle boundary. MCP protocol support alone does not create a third Oracle source class.

Current source has a composition-time SourceCatalog and deterministic RetrievalPlanner. It has no background provider lifecycle, automatic refresh, MCP adapter framework, graph database or model-assisted planner.
