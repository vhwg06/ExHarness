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
- an optional application-owned manifest-validating artifactReader can verify ref/path + producer/revision/acceptance provenance + content digest before QA receives bytes; the default artifactReader path remains unchanged;
- the optional manifest store is durable filesystem state and the validating reader returns the existing { content, sourceRef } shape after validation;
- Oracle has no agent loop, session lifecycle, generic resolver registry, MCP-first layer, retrieval framework or cache lifecycle in current source;
- no MCP client/adapter, MCP request state, MRTR continuation or Tasks handle is implemented or persisted today.

D006 is an accepted architecture boundary: if a concrete MCP-backed source appears later, MCP remains a source/capability adapter below application-owned work/lifecycle authority and protocol support alone does not count as a third source class. That non-current mapping lives in `../../living/decisions/D006-mcp-is-an-oracle-adapter-boundary.md` rather than this current-state projection.

Caching/RAG are not missing features merely because they are absent. If concrete pressure makes them necessary, that work must first appear on the Blackboard.

## Routing

- current semantic meaning -> `semantics.md`
- current dependency placement -> `architecture.md`
- current concrete resolution flow -> `workflow.md`
- optional artifact-manifest boundary -> `artifact-manifest.md`
- current invariants -> `decisions.md`
- accepted MCP boundary decision -> `../../living/decisions/D006-mcp-is-an-oracle-adapter-boundary.md`
- all open Oracle questions -> `../../living/blackboard.md`
