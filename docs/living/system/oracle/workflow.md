# Oracle current workflow

## Backend repository context

```text
parse BackendWorkOrder
 -> for each requiredFiles path
    -> repositoryReader.readFile(...)
    -> capture content + sourceRef
 -> BackendContextSchema.parse(...)
 -> BackendWorker
```

A repository read error is rethrown with repository/ref/revision/path boundary context.

## QA application-artifact context

```text
parse QaWorkOrder
 -> for each required artifact
    -> artifactReader.readArtifact(...)
    -> capture content + sourceRef
    -> attach APPLICATION_ARTIFACT provenance
 -> QaContextSchema.parse(...)
 -> QaWorker
```

An artifact read error is rethrown with the application-artifact boundary/ref context.

When the optional manifest adapter is enabled, the injected `artifactReader` is wrapped before Oracle sees it:

```text
QaWorkOrder request
 -> manifest lookup
 -> producer/revision/acceptance/stored-revision checks
 -> payload read
 -> content-digest check
 -> { content, sourceRef }
 -> resolveQaContext(...)
```

Missing manifest, unavailable payload and identity/provenance mismatches fail closed. The adapter is optional and does not change the default QA resolver or QA context schema.

## MCP

There is no MCP-backed resolution path in current source. `oracle.js` does not issue `resources/read`, `tools/call`, MRTR retries or Tasks operations, and it persists no MCP continuation state.

Any later concrete MCP-backed source remains below application-owned work/lifecycle authority; this constraint does not make an MCP flow current implementation.

No implicit refresh, background provider lifecycle, cache or retrieval pass exists in the current workflow.
