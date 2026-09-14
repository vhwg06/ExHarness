# Oracle current state

Source-synchronized Oracle projection. Open Oracle questions live only in `../../living/blackboard.md`.

## Current implemented boundary

`packages/agentic-system/src/oracle.js` exposes two concrete resolution functions:

```text
resolveBackendContext(order, { repositoryReader })
resolveQaContext(order, { artifactReader })
```

### External repository source

```text
BackendWorkOrder.requiredFiles
 -> repositoryReader.readFile({ repositoryRef, revision, path })
 -> { content, sourceRef }
 -> BackendContextSchema.parse(...)
```

### Internal application-artifact source

```text
QaWorkOrder.requiredArtifacts
 -> artifactReader.readArtifact({ ref, path, producerWorkOrderId, revision, acceptanceDecision })
 -> { content, sourceRef }
 -> APPLICATION_ARTIFACT provenance
 -> QaContextSchema.parse(...)
```

## Current semantics

- application contracts decide which context is required;
- Oracle pulls only declared files/artifacts;
- resolution happens explicitly before Worker execution;
- external repository IO and internal application-artifact IO remain distinct adapters;
- context carries stable source refs; internal artifacts also carry producer/acceptance provenance;
- source errors are wrapped with the concrete failing boundary and requested ref/path;
- Oracle has no agent loop, session lifecycle, generic resolver registry, MCP-first layer, retrieval framework or cache lifecycle in current source.

Caching/MCP/RAG are not missing features merely because they are absent. If concrete pressure makes them necessary, that work must first appear on the Blackboard.

## Routing

- current semantic meaning -> `semantics.md`
- current dependency placement -> `architecture.md`
- current concrete resolution flow -> `workflow.md`
- current invariants -> `decisions.md`
- all open Oracle questions -> `../../living/blackboard.md`
