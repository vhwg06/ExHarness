# ExHarness — Agentic System

ExHarness is an **agentic system** composed from three explicit boundaries:

- **Agentic Application** — owns concrete objective/work/result semantics, deterministic composition, bounded Advisor judgment and application completion policy.
- **Oracle** — resolves application-declared context through concrete external/internal source adapters before Worker execution.
- **ExHarness Core** — reusable execution kernel for agent/runtime mechanics, cognition, evidence/trust, persistence, recovery and authority boundaries.

The published `exharness` package is the reusable Core. `packages/agentic-system/` contains the current concrete Backend + QA application composition.

## Current delivered system

```text
BackendObjective
  -> BackendWorkOrder
  -> resolveBackendContext
     -> repositoryReader.readFile(...)
  -> BackendWorker
  -> ExHarness Core
  -> grounded BackendWorkResult
  -> mutation + typecheck + tests evidence
  -> BackendCompletionPolicy
  -> ACCEPT | CONTINUE | BLOCK | FAIL

Backend ACCEPT
  -> BackendQaHandoff
     artifact refs + accepted revision + acceptance decision provenance
  -> QaWorkOrder
  -> resolveQaContext
     -> artifactReader.readArtifact(...)
  -> QaWorker
     non-mutating ExHarness execution
  -> qa.behavior + qa.regression evidence
  -> QaCompletionPolicy
```

Waves A, B and C are delivered in source/tests.

Current implementation facts:

- Backend mutation/promotion and QA non-mutating verification are materially different lifecycles.
- Worker-returned evidence is not completion authority; completion is grounded from ExHarness/runtime state.
- QA cannot mutate or advance lineage and is dispatched only after Backend acceptance.
- Backend -> QA handoff carries references and acceptance-decision provenance, not copied artifact payloads.
- Oracle keeps external repository reads and internal application-artifact reads as distinct source boundaries.
- `ApplicationArtifactRef` plus evidence-integrity/claim-state plumbing are the narrow common shapes currently proven.
- no generic Worker/WorkOrder/Advisor/Orchestrator, role registry or workflow graph exists in current source.

## Context feeding

```text
application contract declares required context
  -> Oracle reads only declared source refs
  -> adapts + preserves source/provenance
  -> validates application-owned schema
  -> Worker executes through ExHarness Core
```

Current Oracle source classes:

```text
External repository
  -> repositoryReader.readFile(...)

Internal application artifact
  -> artifactReader.readArtifact(...)
  -> APPLICATION_ARTIFACT provenance
```

There is no generic resolver registry, hidden provider lifecycle, MCP-first framework, retrieval framework or cache lifecycle in current source.

## Completion and evidence

```text
Backend evidence
  backend.mutation
  backend.typecheck
  backend.tests

QA evidence
  qa.behavior
  qa.regression
```

Application policy owns sufficiency. ExHarness trust/evidence primitives provide integrity/provenance; model/Worker prose cannot self-certify completion.

`BackendAdvisor` is intentionally narrow: it is consulted only after required objective evidence passes while explicit semantic gaps remain, and may propose retry implementation, request context or escalation. It cannot accept work or mutate workflow state directly.

## Core maturity

`packages/core-harness` currently includes:

- AVO variation/lineage/evaluation/supervision/search-investment control;
- typed judgments, Predict/CodeAct, object agents, live objects and progressive discovery;
- bounded context/history, routing, tracing and runtime snapshot/resume;
- semantic memory plus opt-in associative retrieval/ranking;
- evidence/decision/attestation trust primitives;
- interrupted-variation recovery and separate effect reconciliation;
- structured deliberation, ActionIntent and grounded reflection/intent;
- intent/reflection semantic calibration.

Important authority distinctions include:

```text
working candidate ancestry != committed lineage
Observation != SemanticMemory != Evaluation
AgentEvent != TurnEvent != TraceSpan != EffectJournal
SemanticMemory.INTENT != ActionIntent
IntentReflectionAlignment != Evaluation
candidate/trace state != proof of external effect completion
retrieval/ranking != correctness authority
search investment/supervision != promotion correctness
```

## Documentation model

The repository now has a strict partition:

```text
docs/worktree/*
    = source-synchronized living system docs
    = current state only

docs/living/blackboard.md
    = all unresolved gaps / problems / questions / blockers / next work
```

Every non-trivial work session starts from the Blackboard, claims eligible work, executes it, writes the result back, then reconciles source-backed living docs when implementation changed.

Do **not** use `docs/worktree/` as a hidden backlog. If a current-system document discovers an unresolved problem, keep the current fact in the document and move the problem to the Blackboard.

Documentation routing:

```text
docs/README.md
  -> docs/living/blackboard.md          what remains to do
  -> docs/worktree/state.md             what exists now
     -> worktree/pipeline.md             current delivered pipeline
     -> agentic-application/             current application docs
     -> oracle/                          current Oracle docs
     -> core-harness/                    current Core docs
  -> docs/living/knowledge/*            evidence / judgment / audit
  -> docs/living/decisions/*            accepted documentation decisions
```

Source/public exports and executable tests/runtime are implementation authority. `docs/worktree/*` must be reconciled to them.

## Core package

```js
import { createHarness } from "exharness";
```

Low-level `createAVOHarness()`, `createCoreHarness()` and `createAgentRuntime()` remain available for custom Core composition.

Current package subpaths include:

```text
exharness
exharness/testing
exharness/effects
exharness/memory-retrieval
```

## Verification

Requires Node.js 20 or newer.

```bash
npm run verify
```

The repository verification gate covers ExHarness Core plus delivered Wave A-C Agentic System behavior.
