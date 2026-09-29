# Oracle post-foundation discovery — BB-087 / BB-088 / BB-089

Status: RESEARCH_SA brief. Research only; no product source is written by this brief.
Checked: 2026-09-29 against main `8a4ccd37` (BB-060..064 DONE).

## Discovery method

Sources scanned: every READY/DONE plan's continuation/handoff fields, `docs/living/system/**` limitation statements, and the delivered `@exharness/oracle` source. A candidate is registered only when (a) a canonical doc or plan declares it as later work or a limitation, or executed evidence shows delivered source contradicts its accepted plan, and (b) no existing task covers it.

| Candidate | Evidence | Existing coverage | Decision |
|---|---|---|---|
| Facade budget/failure defect | Executed probe `docs/blackboard/evidence/BB-087/facade-probe-result.json` against delivered `packages/oracle/src/context-resolution.js` | None; BB-064 is DONE and terminal work is not retrofitted | Register BB-087 (BUGFIX) |
| Authoritative Context Graph | BB-064 `continuationSchedule` ORACLE_CONTEXT_GRAPH ("requires BB-064 delivered"); BB-062 D9/D14/D18 | None | Register BB-088 |
| Backend/QA production adoption of the facade | Oracle Living `workflow.md` and `state.md`: "Existing Backend/QA production flows still use their compatibility adapter"; BB-061 D15 "production provider orchestration remains unchanged until later Oracle tasks" | None; BB-069 composes Oracle only inside a first-slice script harness | Register BB-089 |
| Planner optimization, progressive resolution, adaptive budgeting, Core interaction, profile acceptance | BB-064 `continuationSchedule` | None | Not registered this round: each requires the ORACLE_CONTEXT_GRAPH desired state first |
| Generic PM/SA runtime, Reviewer registry | Living docs state "not implemented" | Intentional non-goal ("no generic abstraction before concrete repeated semantics") | Not a gap |

## BB-087 — delivered facade defect (executed evidence)

The BB-064 plan promises hard item/byte/call/step bounds (D5), `BUDGET_EXHAUSTED` with no model dispatch, and "provider/source failure or ambiguity -> UNSATISFIED before model" (failureMatrix). The delivered facade instead:

1. Reports `consumed.materializedBytes: 40000` as a constant. A 361-byte materialization reports 40000 bytes, so accounting is fabricated.
2. Consequently every requirement with `maxMaterializedBytes < 40000` fails with `TypeError: materializedBytes budget exceeded`, even for a 5-byte item. Small budgets are unusable.
3. Re-implements provider execution over `retrievalPlanner.plan()` instead of the delivered `retrievalPlanner.execute()`, bypassing per-work byte/item reservations; a provider `ProviderFailure` escapes as a thrown error rather than a typed unresolved `SOURCE_FAILURE` / `UNSATISFIED`.
4. Drops planner reasons: planner reports `BUDGET_EXHAUSTED`, the resolution reports `MISSING`.

The contract layer is correct (`defineContextResolution` rejects consumed below materialization and above budget); the facade composes it incorrectly. The fix is confined to `packages/oracle/src/context-resolution.js` plus tests; no contract change.

## BB-088 — authoritative Context Graph desired state

BB-062 delivered only a typed `graphClient.traverse` seam and measured that explicit authoritative typed edges answer bounded cross-source questions exactly (mean Recall@3 1.000 on Q1–Q4; structured-edge projection 399 vs 48,983 bytes). It explicitly rejected a graph database for the foundation. Productization therefore means a native, deterministic, snapshot-bound graph client: edges extracted from exact repository snapshots (ES module import/export relations) and declared structured JSON edges, each edge carrying `AUTHORITATIVE_SOURCE` provenance with the exact snapshot and file digest. No Graphiti/Cognee/graph DB, no model-derived edges, no temporal store.

## BB-089 — Backend/QA production adoption desired state

Backend and QA keep their public `resolveBackendContext` / `resolveQaContext` entry points and schemas. An opt-in `contextResolver` path maps the declared `requiredFiles` / `requiredArtifacts` to an EXACT ContextRequirement, resolves through `createOracleContextResolver`, asserts consumability, and projects items back to the unchanged `BackendContextSchema` / `QaContextSchema`. The default compatibility path remains until a separate acceptance decision retires it; the Application still decides which context is required.

## Source classification

| Class | Sources |
|---|---|
| DELIVERED_TRUTH | `@exharness/oracle` root exports (createOracleContextResolver, createRetrievalPlanner.plan/execute, createSourceCatalog, createExactRepositoryProvider, createExactArtifactProvider, createContextGraphProvider, defineContextResolution, assertConsumableContextResolution, ProviderFailure); `packages/agentic-system/src/oracle.js`; Core `resolveContextRequirementBlocks` |
| PLANNED_CONTRACT | none for BB-087; BB-087 fixed facade for BB-088/BB-089 |
| RESEARCH_DESIRED_STATE | BB-064 continuationSchedule; BB-062 graph experiments; this brief |
