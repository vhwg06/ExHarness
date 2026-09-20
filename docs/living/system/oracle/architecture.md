# Oracle current architecture

Oracle is the concrete infrastructure boundary between application-declared context needs and source IO.

```text
BackendWorkOrder.requiredFiles
        -> resolveBackendContext
        -> repositoryReader
        -> BackendContext

QaWorkOrder.requiredArtifacts
        -> resolveQaContext
        -> artifactReader
        -> QaContext
```

Application schemas/contracts stay above the source adapters. Oracle performs pull/adapt/assemble and then validates using those application-owned schemas.

The two implemented source classes intentionally remain distinct because repository reads and application-produced artifact lookup carry different identity/provenance semantics.

## MCP boundary

Current source has **no MCP adapter** and no MCP-owned Oracle lifecycle. MCP request ids, handles, MRTR state and task state therefore do not appear in the current runtime architecture.

Any later concrete MCP-backed source must remain a source/capability adapter below the application-owned context/work lifecycle boundary. MCP protocol support alone does not create a third Oracle source class.

Current source contains no generic source registry, generic Resolver interface, provider lifecycle, automatic refresh, MCP adapter framework or retrieval engine.
