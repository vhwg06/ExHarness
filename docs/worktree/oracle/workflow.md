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

No implicit refresh, background provider lifecycle, cache or retrieval pass exists in the current workflow.
