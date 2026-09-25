# Oracle Context Intelligence research

Status: **ACTIVE RESEARCH INPUT**
Evidence check: 2026-09-25
Research baseline: `0e0b124153774ccbdab692a9cadad12ec51ae109`

## Research question

What is the smallest Oracle architecture that gives ExHarness runtime agents **current, provenance-bound, budgeted context on demand** while keeping application/domain authority outside Oracle and avoiding a giant model-visible tool surface?

The answer must be earned by source inspection and experiments. This document is evidence/input for BB-060..064; it is not implementation authority.

## Why the prior thin-IO boundary is insufficient

The current source has two useful concrete context flows, but the old READY plans froze those flows into the final architecture. That leaves Core with no semantic runtime contract for:

- symbol/relationship-aware code context;
- cross-source ownership/architecture/currentness context;
- progressive retrieval when initial context is insufficient;
- explicit context budgets;
- durable resolution/materialization identity;
- safe reuse/invalidation when repository, artifact, index or graph state changes.

The physical-ownership finding remains correct. The final abstraction assumption does not.

## External evidence

| Evidence | Observed role | What ExHarness can learn | What it does **not** prove |
|---|---|---|---|
| [Uber — Running a Software Factory Efficiently at Uber Scale](https://www.uber.com/gb/en/blog/efficient-software-factory/) | Cross-system Context Graph used to ground engineering agents | Context relationships, ownership and live system metadata can be runtime infrastructure, not prompt decoration | Uber scale/topology should be copied into ExHarness |
| [Aider](https://github.com/Aider-AI/aider) | Compact repository map from symbols/relationships under a token budget | Structural projection, relevance ranking and explicit context budget | A repo map alone solves currentness, artifacts or cross-system context |
| [Serena](https://github.com/oraios/serena) | Semantic code retrieval/editing using language-server/symbol capabilities | Symbol-level retrieval and relationship queries can be a provider below Oracle | LSP is sufficient for all repository languages or non-code sources |
| [Zoekt](https://github.com/sourcegraph/zoekt) | Indexed source-code search | Fast high-recall lexical baseline and multi-repository search provider | Lexical matches provide semantic ownership/currentness by themselves |
| [Graphiti](https://github.com/getzep/graphiti) | Temporal knowledge/context graph with provenance and validity concepts | Explicit temporal/currentness semantics and incremental graph updates | Graphiti is automatically the correct ExHarness persistence backend |
| [Cognee](https://github.com/topoteretes/cognee) | Persistent graph/vector contextual memory | Alternative graph/memory pipeline and relationship materialization | Agent memory semantics equal ExHarness product/source truth semantics |

At the 2026-09-25 check, each GitHub repository above was over the standing 1,000-star threshold. Before a READY decision, BB-062 must pin the exact selected source/release/license and re-check any repository used as implementation evidence.

## Working architecture hypothesis

```text
ContextRequirement
  semantic need
  required/optional evidence
  source/currentness constraints
  budget
  consumer identity
        |
        v
Oracle Resolution API
        |
        +-- Source Catalog
        |     repo/artifact/semantic-code/lexical/graph/external
        |
        +-- Retrieval Planner
        |     bounded provider work, no application authority
        |
        +-- Materializer
        |     dedupe/rank/project within budget
        |
        +-- Provenance + Currentness
        |
        v
ContextResolution
  requirement identity
  source identities
  materialization identity
  provenance
  currentness evidence
  budget consumed
  resolved items
  explicit missing/partial state
```

This is a hypothesis to test, not a commitment to a particular graph database, LSP stack or planner implementation.

## Experiment 1 — Code retrieval provider shootout

Use the same representative ExHarness code questions and known relevant files/symbols across:

1. current/direct file search baseline;
2. Zoekt-style indexed lexical search;
3. Serena/LSP symbol retrieval where the language/tooling permits;
4. Aider-style structural repo-map projection.

Pre-register the relevant symbol/file set before observing results. Record:

- Recall@k / relevant-symbol coverage;
- irrelevant context bytes and estimated tokens;
- first useful result latency;
- index/setup/update latency;
- provenance precision: exact file/revision/symbol identity;
- failure behavior on unsupported language, stale index and deleted/renamed symbol.

Decision rule: do not choose a semantic provider because it “looks smarter”. It must add measurable retrieval value or reduce context materialization for the representative corpus. Exact thresholds are calibrated and frozen before the implementation candidate is tested.

## Experiment 2 — Context Graph feasibility

Build a small disposable graph over a bounded ExHarness slice:

- source files and symbols;
- package/component ownership;
- Living architecture/contract refs;
- Blackboard objective/plan/delivery refs;
- source revision and provenance/currentness edges.

Ask cross-source questions that lexical/symbol search cannot answer directly, for example:

- Which current source implements an architectural responsibility and what Living contract grants it?
- Which context becomes stale when a source revision or accepted artifact changes?
- What is the shortest provenance path from an agent-visible context item to authoritative source?

Compare Graphiti/Cognee-inspired temporal/graph representations and the smallest in-house graph representation. Record answer correctness, provenance completeness, update/invalidation latency, storage/index cost and implementation complexity.

A graph backend is justified only when it provides cross-source/currentness value not obtainable at comparable cost from simpler retrieval composition.

## Experiment 3 — Durable ContextResolution identity/currentness

For a fixed ContextRequirement:

- same authoritative inputs/configuration -> stable reusable resolution identity;
- changed repository revision/artifact/currentness -> old resolution becomes non-current;
- crash after materialization before publication -> replay discovers/reuses only a compatible result;
- partial provider failure -> required context does not become silently current;
- concurrent refresh -> one logical current materialization, stale generation fenced.

Existing manifest-protected QA artifact semantics are the lower bound for artifact provenance checks.

## Experiment 4 — Progressive resolution and budget prototype

Compare a static “load all likely context” arm with a staged arm:

```text
initial requirement
  -> cheap/high-recall retrieval
  -> inspect unresolved need
  -> targeted semantic/graph expansion
  -> stop at satisfied requirement or budget
```

Measure context bytes/tokens, retrieval calls, wall time, useful-context ratio and deterministic task answer correctness. This experiment validates planner/budget semantics; it does not claim live coding-agent value.

## Experiment 5 — Live benchmark handoff

Only after BB-064 foundation acceptance, connect Oracle-grounded execution to the same-model/task/source/budget measurement discipline already used by BB-065 and BB-077/081.

Compare at minimum:

- direct/current context path;
- Oracle foundation path;
- later progressive/graph candidate when separately researched.

Report all attempts and failures. Agent exit is telemetry; independent task acceptance remains authoritative. No benchmark conclusion may reuse the old BB-060..064 JEV readiness.

## Reuse direction before experiments

Current preferred *research* topology is compositional:

- Zoekt or equivalent indexed lexical search as a high-recall provider baseline;
- Serena/LSP and Aider-style maps as semantic/structural code-context candidates;
- Graphiti/Cognee as context-graph design/backend candidates, not automatic dependencies;
- existing repository/artifact readers retained as first-class providers;
- Oracle owns provider coordination/materialization, but callers see only ContextRequirement/ContextResolution.

Do **not** integrate all projects. The expected outcome may be a small ExHarness-owned contract with one or two reusable providers and a graph seam whose backend is deferred until the graph experiment earns it.

## Handoff to BB-060..064

Each rebound task must convert this evidence into a DRAFT plan, close its task-specific `researchGaps`, pin exact source/release evidence, narrow source scope and define executable verification. Only a new `RESEARCH_SA` Jev `SATISFIED` judgment can restore `WORKER/EXECUTION`.

The historical READY/Jev artifacts are useful evidence about the old problem; because their objective/plan bindings no longer match the rebound semantics, they cannot authorize implementation.

## Control-plane authority check

While BB-060..064 are rebound to research, their task contracts must not carry the historical `evaluationRef`, `evidenceRef` or `lastEvaluatedInput` fields. The plans remain `DRAFT` without `readinessRef`. Historical evaluation files may stay in the repository for audit/evidence, but execution routing must be derivable only from the rebound objective/plan and a future new readiness publication.

