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

The two source classes intentionally remain distinct because repository reads and application-produced artifact lookup carry different identity/provenance semantics.

Current source contains no generic source registry, generic Resolver interface, provider lifecycle, automatic refresh, MCP adapter framework or retrieval engine.
