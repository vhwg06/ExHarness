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

## MCP placement

MCP is a conditional source transport/capability adapter, not a new Oracle control plane:

```text
Application context contract
        -> concrete Oracle resolver
             -> direct source adapter
             OR
             -> concrete MCP-backed source adapter
                  -> resources/read
                  -> source-specific tools/call when justified
                  -> explicit source-call continuation refs
        -> validated application context snapshot
```

The protocol does not own application work identity or project lifecycle. MCP JSON-RPC request ids, transport lifetime, explicit state handles, MRTR `requestState` and Tasks extension handles remain below the Oracle/application lifecycle boundary.

A configured MCP endpoint/source registration plus resource URI or concrete operation ref may contribute source provenance. Self-reported MCP server names/info are not stable source authority.

MCP itself is not a third source class. A third source exists only when a concrete MCP-backed integration demonstrates materially distinct identity/provenance/continuation/adaptation semantics in source and tests.

Current source contains no generic source registry, generic Resolver interface, provider lifecycle, automatic refresh, MCP adapter framework or retrieval engine.
