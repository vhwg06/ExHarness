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

## Conditional MCP-backed source flow

No MCP adapter is implemented today. When a concrete source justifies one, the accepted flow is source-specific and explicit:

```text
application declares exact context need
 -> Oracle invokes concrete MCP-backed adapter
 -> resources/read for URI-addressed context
    OR source-specific tools/call when read-style computation is required
 -> resultType:
      complete
        -> validate/adapt payload
        -> sourceRef/provenance
        -> application context schema

      input_required
        -> preserve opaque requestState + required-input description as source-call continuation
        -> enclosing application workflow decides when/how to resume
        -> retry source operation with a new MCP request id

      task (when Tasks extension is negotiated by a concrete adapter)
        -> preserve task handle as source-call continuation provenance
        -> enclosing application workflow later drives get/update/cancel through that adapter
```

MCP continuation does not create an Oracle session. Oracle WorkOrder/Blackboard identity survives independently from transport requests/tasks/handles.

A transport retry does not prove whether a mutating external effect completed. Oracle stays read-oriented by default; any future mutating MCP tool integration must compose with explicit effect identity/reconciliation rather than infer outcome from request/task state.

`ttlMs` may inform a concrete adapter's cache/freshness handling, but it is not an application correctness or acceptance signal.

No implicit refresh, background provider lifecycle, cache or retrieval pass exists in the current implemented workflow.
