# Oracle Context Intelligence Plane foundation

Status: **RESEARCH REBOUND — PRIOR READY AUTHORITY SUPERSEDED**

## Why this is still a phase

Oracle still has a real physical-ownership debt: its concrete implementation lives under `@exharness/agentic-system` even though Living architecture declares Oracle to be infrastructure. That finding remains valid.

What changed is the architectural premise used by the previous BB-060..064 readiness cycle. The previous plans treated Oracle as a thin IO extraction with two final concrete pulls and explicitly deferred a runtime resolution contract, retrieval lifecycle, context graph and planner. That boundary is no longer sufficient for the runtime-efficiency direction: Core needs a source-agnostic way to ask for the smallest current context required for the next action, and Oracle needs to resolve that requirement without giving source/provider mechanics or application authority to Core.

Therefore BB-060..064 return to `RESEARCH_SA/RESEARCH`. Existing readiness/Jev artifacts remain historical evidence, but they are not current implementation authority.

## Retained findings

The rebound does **not** discard prior research:

- Oracle must be physically owned by infrastructure, not Agentic Application or Core implementation.
- Application/domain controllers retain work semantics, acceptance, publication, recovery and product authority.
- Dependency direction must be acyclic and mechanically checkable.
- Source identity, provenance, accepted-artifact validation and fail-closed error semantics remain required.
- Existing Backend repository and QA accepted-artifact flows are compatibility cases the new foundation must preserve.

## Superseded assumptions

These previous assumptions are no longer implementation constraints:

- Oracle is finalized by exactly two concrete pull functions.
- A source-agnostic ContextRequirement / ContextResolution contract is premature.
- Retrieval lifecycle, progressive runtime resolution and context budgeting belong outside the Oracle boundary.
- Semantic-code/indexed-search and graph-backed context can be postponed until after package extraction.
- Phase acceptance is satisfied by package movement plus current Backend/QA flow preservation.

## Target authority and runtime boundary

```text
Application / domain controller
        |
        | semantic context need
        v
ContextRequirement
        |
        v
Core Runtime
        |
        | resolve bounded context
        v
Oracle — Context Intelligence Plane
        |
        +--> Resolution API
        +--> Source Catalog / capability metadata
        +--> Repository + accepted-artifact providers
        +--> Semantic-code / lexical-search providers
        +--> Context-graph seam
        +--> Retrieval Planner seam
        +--> provenance + currentness mapping
        +--> context budget accounting
        +--> durable ContextResolution / materialization
        |
        v
Core consumes ContextResolution
```

Authority remains deliberately asymmetric:

```text
Application owns WHAT work means and whether product output is accepted/current.
Core owns execution strategy and asks for semantic context.
Oracle owns HOW bounded context is resolved from governed sources.

Oracle != task scheduler
Oracle != product acceptance
Oracle != publication authority
Oracle != domain recovery authority
Oracle != model-visible generic tool registry
```

## Rebound workstreams

### BB-060 — Runtime architecture + physical ownership

Define Oracle as an infrastructure-owned runtime Context Intelligence Plane, its Core seam, package/dependency direction, retained findings and superseded assumptions. Prove the boundary with a minimal requirement -> resolution prototype before restoring Worker authority.

### BB-061 — ContextRequirement / ContextResolution semantic contract

Define source-agnostic requirement, resolution identity, budget, provenance, currentness, materialization and fail-closed semantics. Preserve current Backend/QA compatibility without encoding those two sources as the final abstraction.

### BB-062 — Source-provider topology

Research repository, accepted artifact, semantic-code, lexical-search, context-graph and future external providers. Compare reusable OSS patterns and define the Retrieval Planner seam below the caller-facing semantic contract.

### BB-063 — Durable resolution identity + currentness

Define deterministic ContextResolution identity, materialization, cache/replay validity, source provenance, selective invalidation and recovery. Existing manifest-protected accepted-artifact semantics remain a lower bound.

### BB-064 — Oracle foundation acceptance

Accept the foundation only after 060–063 converge and an executable prototype demonstrates bounded runtime resolution, provenance/currentness enforcement, negative stale/failure cases and a benchmark/profile handoff.

## Research evidence to inspect

The detailed evidence ledger and experiments live in `docs/blackboard/process/oracle-context-intelligence-research.md`.

The current research set intentionally covers complementary mechanisms rather than choosing a single framework up front:

- Uber Context Graph — evidence that cross-system graph grounding can materially change agent correctness and latency at large scale.
- Aider repo-map — compact structural code maps, tree-sitter symbols, graph ranking and token-budgeted projection.
- Serena — semantic symbol/code retrieval over language-server capabilities.
- Zoekt — fast indexed lexical/source search suitable as a high-recall provider baseline.
- Graphiti — temporal knowledge graph concepts, source provenance and validity/currentness windows.
- Cognee — graph/vector memory pipeline and persistent contextual relationships.

Public GitHub repositories used as examples must meet the standing 1,000-star rule at the evidence check. A technology is not selected merely because it is popular; each must survive the task-specific experiment and integration/license review.

## Scheduling

Research can run ahead across all five rebound objectives. Worker execution remains unauthorized until each task has a rebound DRAFT plan, resolved research gaps and a **new** SATISFIED readiness judgment.

```text
RESEARCH_SA
  BB-060 runtime architecture / ownership
  BB-061 semantic contract
  BB-062 provider topology
  BB-063 durable resolution semantics
  BB-064 foundation acceptance

WORKER
  Oracle: NONE until rebound readiness

future delivery order after readiness:
  BB-060 -> BB-061 -> BB-062 -> BB-063 -> BB-064
```

## Efficiency continuation after foundation

BB-064 is intentionally **not** the full Oracle product. Once the foundation semantics are stable, the Oracle continuation joins the efficiency roadmap as separately allocated work:

```text
Context Graph
  -> Retrieval Planner
  -> Progressive runtime resolution
  -> Context budgeting
  -> Runtime async integration
  -> Benchmark / profile acceptance
```

These continuation tasks should use `BB-082+` only after 060–064 research stabilizes their boundaries; do not overload the already-defined Core async-efficiency BB-077..081 semantics. BB-077/081 measurement contracts are upstream evidence/constraints for the later Oracle benchmark, not hidden Oracle implementation work.

## Foundation acceptance

The rebound topic is not closed by creating `packages/oracle`. Closure requires:

- infrastructure-owned Oracle package/dependency topology;
- explicit ContextRequirement / ContextResolution contract;
- provider topology with semantic-code, lexical and graph seams researched against representative tasks;
- exact provenance/currentness/materialization identity;
- current Backend repository and QA accepted-artifact behavior preserved as compatibility cases;
- deterministic stale/failure/authority negative tests;
- an executable bounded runtime-resolution prototype;
- a predeclared measurement handoff compatible with delivery/Core efficiency baselines;
- Living Oracle architecture/state matching delivered source;
- a new readiness judgment bound to the rebound objective and plan.

