# Oracle detail phase input — 2026-09-17

Status: **PHASE INPUT / NOT ACTIVE WORK**

This artifact carries forward the source-backed Oracle constraints and unresolved evidence gates from the closed Blackboard phase. It is an input to the next Oracle-detail phase, not an operational backlog and not a claim that new Oracle behavior is already implemented.

## Current source-backed baseline

The delivered Oracle/application context path already establishes these concrete facts:

- Backend context resolves declared repository/source inputs through a concrete repository-facing boundary.
- QA can resolve internal application-artifact context produced by the preceding Backend stage.
- Resolved context carries stable `sourceRef` identity.
- Application-artifact provenance can identify `APPLICATION_ARTIFACT`, producer work-order identity and acceptance-decision provenance.
- Durable Backend -> QA coordination preserves source-resolution failure as blocked/recoverable workflow state rather than fabricating missing context.
- D006 accepts MCP as a conditional Oracle source/capability adapter and source-call continuation boundary. MCP is not an Oracle-first architecture, not project lifecycle authority and not a source class merely because protocol support exists.

The exact current implementation remains defined by source/tests and the source-synchronized documents under `docs/worktree/oracle/`.

## Carried constraint from BB-009 — resolver abstraction

The old Board asked whether Oracle needs a common resolver contract beyond the existing concrete functions/adapters.

Phase-close evidence did **not** justify that abstraction:

```text
two current source classes
+ materially different lifecycle/provenance semantics
+ no third concrete source
= insufficient pressure for a generic Resolver<I,O>, registry or provider lifecycle
```

The Oracle-detail phase may revisit this only after it first models the concrete source classes and their contracts precisely. A protocol such as MCP does not count as an additional source by itself.

## Carried constraint from BB-010 — structured diagnostics

The old Board also asked whether callers need a common machine-readable resolution diagnostic model.

Current evidence does not establish that requirement. If detailed Oracle design introduces concrete pressure, diagnostics should distinguish only categories demonstrated by real callers, for example:

```text
source unavailable
authentication/authorization failure
not found
adaptation failure
schema/contract mismatch
optional absence
freshness/provenance rejection
```

The taxonomy must not be invented first and imposed on every adapter. Required context must never be fabricated from an `optional absence` path.

## D006 / MCP boundary that must survive detail design

The Oracle-detail phase must preserve these accepted boundaries unless new evidence explicitly reopens them:

```text
MCP resource/tool/task capability
  -> may be adapted at an Oracle source/capability edge
  -> may carry source-call continuation semantics
  -> does not own project work lifecycle
  -> does not make Oracle MCP-first
  -> does not become correctness authority
```

Any MCP-backed implementation must still expose the source identity/provenance and failure semantics required by its concrete consumer.

## Detail-design questions to answer before implementation

The next phase should establish the concrete Oracle model before creating shared abstractions:

1. What are the actual source classes and capability classes in the current system, and which are read-only versus effectful?
2. What exact request, result, identity, provenance, freshness and continuation semantics does each source need?
3. Which semantics belong to Oracle, which belong to the Agentic Application, and which remain owned by Core trust/effect boundaries?
4. How does a caller distinguish source resolution from context adaptation and from evidence/correctness evaluation?
5. What is the source of truth for source identity, revisions, schemas and capability metadata?
6. Where do authentication, authorization, source availability, retry/continuation and cancellation live?
7. Which failures are currently observable enough to justify structured diagnostics, and which should remain source-specific errors?
8. What concrete third source or repeated adapter pressure would justify a common resolver/provider interface?
9. How should Oracle be benchmarked/evaluated: context correctness/coverage, provenance fidelity, false-context rate, stale-context rejection, resolution cost/latency and recovery behavior?
10. Which Oracle artifacts must survive a fresh session/process, and what exact storage/manifest boundary provides that durability?

## Admission rule for the Oracle-detail phase

Before adding a new Oracle abstraction, record:

```text
concrete consumer
current source contract
observed duplication/pressure
smallest proposed boundary
compatibility impact
failure semantics
benchmark/eval method
rollback path
```

A diagram, protocol feature or anticipated future provider is not sufficient evidence by itself.

## Phase handoff

The previous `BB-*` tasks are archived in `blackboard-phase-archive-2026-09-17.md`. The new Oracle-detail phase should seed a fresh intent/work graph from this artifact plus current `docs/worktree/oracle/*` and source/tests. Do not resurrect BB-009 or BB-010 by identifier; create new work only after the detail-phase scope is explicitly decomposed.