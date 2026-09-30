# Oracle current state

Source-synchronized Oracle projection. Open Oracle questions live only in `../docs/blackboard/state.md`.

## Current implemented boundary

`packages/agentic-system/src/oracle.js` remains the compatibility adapter and exposes two concrete resolution functions. Their source loops now live in `@exharness/oracle`:

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
- production Backend/QA compatibility paths pull only declared files/artifacts;
- resolution happens explicitly before Worker execution;
- external repository IO and internal application-artifact IO remain distinct adapters;
- context carries stable source refs; internal artifacts also carry producer/acceptance provenance;
- source errors are wrapped with the concrete failing boundary and requested ref/path;
- an optional application-owned manifest-validating artifactReader can verify ref/path + producer/revision/acceptance provenance + content digest before QA receives bytes; the default artifactReader path remains unchanged;
- the optional manifest store is durable filesystem state and the validating reader returns the existing { content, sourceRef } shape after validation;
- manifest-protected durable Backend -> QA composition persists the exact manifest ref before QA_PENDING and scopes fresh QA reads to that ref; direct-reader mode remains supported;
- Oracle has no agent loop, session lifecycle, model-visible provider registry, MCP-first layer or cache lifecycle;
- no MCP client/adapter, MCP request state, MRTR continuation or Tasks handle is implemented or persisted today.

The provider-neutral ContextRequirement/ContextResolution v1 contract, canonical identity and consumability checks are implemented in `@exharness/oracle`. Core has an injected pre-render resolver port and freezes selected requirement blocks once per agent call. Existing Backend/QA production source paths still use their compatibility adapter. SourceCatalog, strict candidate/provider contracts, injected lexical/semantic/graph/external adapters and deterministic RetrievalPlanner are implemented below the caller-facing requirement. External runtimes and automatic progressive re-resolution are not implemented; durable resolution persistence with immutable objects and no-overwrite reuse slots is implemented with pre/post currentness fences. There is no mutable current head, no SQLite dependency, no garbage-collection correctness, and no power-loss guarantee beyond the implemented filesystem sync contract.

If a concrete MCP-backed source appears later, MCP remains a source/capability adapter below application-owned work/lifecycle authority; protocol support alone does not count as a third source class.

Caching/RAG are not missing features merely because they are absent. If concrete pressure makes them necessary, that work must first appear on the Blackboard.

## Delivered foundation

The delivered facade `createOracleContextResolver` resolves through pre-observation, deterministic planning, provider execution, post-observation fencing and optional exact-key reuse behind the Core injected port. `ORACLE_FOUNDATION_PROBE_V1` covers repository CURRENT and manifest-protected artifact flows; `O0_STATIC_CONTEXT_CONTROL` anchors the benchmark handoff with UNKNOWN accounting. Graph productization, planner optimization, progressive runtime, adaptive budgeting, async interaction and live profile acceptance remain not delivered.

### Facade budget accounting and typed failure

`createOracleContextResolver` collects candidates only through the delivered `RetrievalPlanner.execute()`, so per-work item/byte reservations over the SourceCatalog provider catalog apply and every provider failure is typed rather than thrown:

- `consumed` is truthful: `items` equals the returned items, `materializedBytes` equals the contract-computed `materialization.bytes`, `providerCalls` equals the planner-reserved provider calls (zero when no work is reserved; never floored), and `resolutionSteps` is 1. There is no constant or estimated counter, so small byte budgets resolve normally.
- Planner and execution unresolved reasons (`BUDGET_EXHAUSTED`, `SOURCE_FAILURE`, `UNSUPPORTED`, `STALE`, `CURRENTNESS_UNVERIFIABLE`, `AMBIGUOUS`, `MISSING`) are preserved verbatim; `MISSING` is used only when evidence has neither a candidate nor a typed reason.
- A provider failure on REQUIRED evidence yields an `UNSATISFIED` resolution and on OPTIONAL evidence a `PARTIAL` one; `ProviderFailure` no longer escapes `resolve()`. The fresh result additionally returns execution `failures` (evidenceId, providerId, reason, detail) as operational diagnostics outside ContextResolution identity.
- If the exact materialization would exceed `maxMaterializedBytes`, the facade drops the lowest-priority OPTIONAL evidence first, then REQUIRED evidence, marking each dropped evidence `BUDGET_EXHAUSTED` and recomputing status (REQUIRED dropped -> `UNSATISFIED`). It never constructs a resolution whose consumption exceeds its budget.
- Unchanged fail-closed behavior: `UNSATISFIED` remains non-consumable, pre/post currentness drift still throws `DurabilityFailure` `STALE_DURING_RESOLUTION` before any consumer receives context, durable `REUSED`/`PUBLISHED` results pass through without re-planning or re-accounting, and Core consumes the facade only through its injected resolver port. Thrown errors remain only for invalid requirement/contract input, currentness drift and catalog/planner misconfiguration.

## Routing

- **current Oracle capability semantics -> `capabilities.md`**
- current semantic meaning -> `semantics.md`
- current dependency placement -> `architecture.md`
- current concrete resolution flow -> `workflow.md`
- optional artifact-manifest boundary -> `artifact-manifest.md`
- current invariants -> `decisions.md`
- all open Oracle questions -> `../docs/blackboard/state.md`
