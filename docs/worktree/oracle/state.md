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

MCP 2026-07-28 is now an accepted **conditional adapter/continuation boundary**, not a required Oracle layer:

- use MCP only when a concrete source already exposes useful MCP resources/tools and it is simpler than direct integration;
- MCP request ids, transport lifetime, explicit state handles, MRTR `requestState` and task handles remain source-call continuation metadata, never WorkOrder/Blackboard identity or completion authority;
- `resources/read` is compatible with read-oriented context resolution; mutating `tools/call` would require explicit effect identity/reconciliation rather than retry inference;
- configured source identity plus URI/operation refs may contribute provenance; self-reported server metadata is descriptive only;
- `ttlMs` is a freshness/cache hint, not correctness authority;
- MCP itself is not a third Oracle source class and does not reopen the generic resolver/diagnostics questions without a concrete MCP-backed adapter demonstrating source pressure.

No MCP runtime adapter is implemented by this evaluation. Direct readers remain the current implementation.

Caching/RAG are not missing features merely because they are absent. If concrete pressure makes them necessary, that work must first appear on the Blackboard.

## Routing

- current semantic meaning -> `semantics.md`
- current dependency placement -> `architecture.md`
- current concrete resolution flow -> `workflow.md`
- current invariants -> `decisions.md`
- accepted MCP boundary decision -> `../../living/decisions/D006-mcp-is-an-oracle-adapter-boundary.md`
- all open Oracle questions -> `../../living/blackboard.md`
