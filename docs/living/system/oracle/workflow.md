# Oracle current workflow

## Backend repository context

```text
parse BackendWorkOrder
 -> for each requiredFiles path
    -> @exharness/oracle.readRepositorySources(...)
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
    -> @exharness/oracle.readApplicationArtifacts(...)
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

## Opt-in Oracle path for Backend/QA context

`resolveBackendContext` and `resolveQaContext` take an optional `oracleResolution: { maxMaterializedBytes }` option. Without it, the compatibility path above runs unchanged: no Oracle catalog, planner or resolver is constructed. `prepareBackendObjective`, `runBackendObjective`, `recoverBackendObjective` and `runQaObjective` accept the same option and pass it through unchanged.

```text
parse BackendWorkOrder | QaWorkOrder
 -> backendContextRequirement | qaContextRequirement   (oracle-context-requirements.js)
    one REQUIRED EXACT evidence per declared file/artifact, in declared order
    Backend: file-<i>, REPOSITORY <repositoryRef>, snapshot EXACT <revision>, itemRefs [path]
    QA:      artifact-<i>, APPLICATION_ARTIFACT <ref>, snapshot EXACT <upstream.revision>, itemRefs [path],
             requiredProvenance PRODUCER_WORK_ORDER + ACCEPTANCE_DECISION (id, digest)
    budget: maxItems n, maxProviderCalls n, maxResolutionSteps 1, maxMaterializedBytes (caller value)
 -> per-call composition from @exharness/oracle root exports:
    createSourceCatalog with one exact provider (createExactRepositoryProvider | createExactArtifactProvider)
      + an EXACT snapshot authority that returns the order's pinned revision
    -> createRetrievalPlanner -> createOracleContextResolver.resolve(requirement)
 -> status COMPLETE + assertConsumableContextResolution, else OracleContextBlockedError
 -> projectBackendContext | projectQaContext -> BackendContextSchema | QaContextSchema -> Worker
```

- **Exact declared context only.** Requirements come only from `BackendWorkOrder.requiredFiles` and `QaWorkOrder.requiredArtifacts`. The Oracle path never adds, drops or reorders context. It uses EXACT snapshots and claims no currentness. CURRENT, semantic, lexical and graph retrieval are not used for Backend/QA.
- **Equivalence.** On identical inputs the Oracle path returns a context deep-equal to the compatibility path: path, content, `sourceRef`, order and QA `APPLICATION_ARTIFACT` provenance. This holds for a direct reader and for `createManifestArtifactReader`, whose manifest checks run unchanged because the exact artifact provider calls `readApplicationArtifacts` with the same producer, revision and acceptance arguments.
- **Fail closed before any Worker call.** Any unresolved declared item throws `OracleContextBlockedError {domain BACKEND|QA, status, unresolved, failures}`. This covers a reader failure (`SOURCE_FAILURE`), a manifest digest or provenance mismatch, an over-budget item (`BUDGET_EXHAUSTED`) and a non-COMPLETE status (PARTIAL is rejected defensively). The error message lists each `evidenceId:reason` and the facade failure detail. The delivered planner records only `error.message`, so the Oracle path passes each read through unchanged and adds the reader's `error.code` (for example `ARTIFACT_CONTENT_MISMATCH`) to the front of the rethrown message.
- **Pathless artifacts.** A pathless QA artifact is rejected with a `TypeError` on the Oracle path and is supported only on the compatibility path.
- **Budget difference.** The Oracle path enforces `maxMaterializedBytes`; the compatibility path has no budget. A missing, zero, negative or fractional budget is rejected before any read. The delivered RetrievalPlanner reserves `min(8192, remaining)` materialized bytes per declared item, which has two consequences:
  - an order with n items needs a budget that covers n such reservations;
  - an item whose materialized form exceeds 8,192 bytes is `BUDGET_EXHAUSTED` under any budget.

  Over-budget declared context is blocked, never truncated.
- **Not threaded.** The durable Backend -> QA workflow (`durable-backend-qa.js`) and `runBackendThenQaObjective` (`composition.js`) still use the compatibility path. The compatibility adapter is not retired.

## MCP

There is no MCP-backed resolution path in current source. `oracle.js` does not issue `resources/read`, `tools/call`, MRTR retries or Tasks operations, and it persists no MCP continuation state.

Any later concrete MCP-backed source remains below application-owned work/lifecycle authority; this constraint does not make an MCP flow current implementation.

No implicit refresh, background provider lifecycle, cache or automatic production retrieval pass exists in the current workflow.

The development-only runtime seam probe resolves an Application semantic need through an injected resolver, projects the source and provenance into an ordinary bounded Core context block, and then calls `renderAgentContext`. No model-visible action is invoked. Its handoff record reports requirement and resolution ids, source reads, resolution/provider calls, materialized/rendered sizes, estimated tokens when available, provenance coverage, currentness checks, wall time and failure class.

The ContextRequirement/ContextResolution semantic contract and injected Core pre-prompt resolver hook are implemented. Backend/QA production flows use their compatibility adapter by default; the opt-in Oracle path above resolves the same declared EXACT context through the delivered facade. Composition-time SourceCatalog registration and deterministic RetrievalPlanner are implemented below this contract. For semantic repository needs the planner reserves bounded symbol and lexical work; exact refs select exact reads; graph/external work requires matching source kinds. Candidate validation checks source identity, provenance and authoritative CURRENT snapshot before materialization. Automatic progressive resolution is not implemented; durable resolution cache publishes immutable objects and no-overwrite reuse slots after pre/post fences. Reuse is keyed by reuseKey with ContextResolutionReceipt lineage; there is no mutable current head, no SQLite dependency, no garbage-collection correctness, and no power-loss guarantee beyond the implemented filesystem sync contract. The delivered facade resolves through the same injected port with pre/post fencing; graph productization, planner optimization, progressive runtime, adaptive budgeting and live profile acceptance remain not delivered.
