# ExHarness — Agentic System

ExHarness is an **agentic system** for building bounded, evidence-aware software engineering agents from three explicit layers:

- **Agentic Application** — owns objectives, work decomposition, deterministic orchestration, bounded Advisor judgment, specialist Worker semantics, context requirements and application completion policy.
- **Oracle** — infrastructure that resolves application-owned context requirements by pulling/dereferencing concrete sources and adapting them into application-shaped context before Worker execution.
- **ExHarness Core** — the reusable execution kernel providing long-horizon control, agent runtime, cognition, evidence/trust, persistence, recovery and authority boundaries.

The repository is organized around the composed **Agentic System**. The published `exharness` package is the reusable Core layer inside that system.

## System architecture

```text
Objective
   |
   v
Agentic Application
  Orchestrator ----------------> Advisor
      |                           plan / assess / replan
      |
      v
  concrete WorkOrder / context need
      |
      +------> Oracle
      |          |
      |          +------> external sources
      |          |        Git / docs / OpenAPI / Figma / ...
      |          |
      |          +------> application-produced artifacts/state
      |          |
      |       resolved context
      |          |
      v          v
  specialist Worker
      |
      v
  ExHarness Core
      |
      v
  structured WorkResult + evidence/artifact refs
      |
      +------> Orchestrator
```

Ownership is intentionally split:

```text
Application owns WHAT / WHY / semantic contracts.
Oracle owns WHERE / pull / dereference / adaptation.
ExHarness Core owns agent execution mechanics and runtime authority.
Infrastructure owns concrete IO, sandboxing, storage and source access.
```

## Delivery model

The system is developed **concrete-first**. Generic application abstractions are not introduced before multiple real slices prove a common shape.

Current canonical delivery pipeline:

```text
WAVE A — prove one real Backend slice
  S1 Concrete Backend semantics
  S2 Concrete Backend context resolution
  S3 BackendWorker × ExHarness execution
  S4 Concrete deterministic Backend orchestration

WAVE B — make success trustworthy
  S5 Backend-specific completion/evidence semantics
  S6 Advisor judgment boundary

WAVE C — compose real application work
  S7 Second real role + extract only proven common abstractions
  S8 Artifact handoff / dereference / context chaining

WAVE D — harden and generalize
  S9 Persistence / resilience / recovery composition
  S10 Production evaluation + evidence-based generalization
```

Stages are dependency/learning steps, not ten independent sign-off checkpoints. S1–S4 are one continuous vertical-slice wave with one review after Backend runs end-to-end.

Core execution rule for Wave A:

```text
BackendObjective
  -> BackendWorkOrder
  -> resolveBackendContext
  -> BackendWorker
  -> ExHarness Core
  -> BackendWorkResult
  -> concrete Backend completion decision
```

No generic `Worker<C,R>`, generic WorkOrder, role registry or generic Orchestrator is required in Wave A.

See `docs/worktree/pipeline.md` for the canonical desired delivery sequence.

## Context feeding

Context semantics belong to the Agentic Application. Oracle only satisfies those semantics.

```text
Application declares required semantic context
        |
        v
Oracle pulls / dereferences / adapts sources
        |
        v
validated application-shaped context
        |
        v
Serializer renders context for execution
        |
        v
Worker / ExHarness Core
```

The serializer performs **no IO**. Dereferencing belongs to Oracle.

Oracle may resolve two distinct source classes:

```text
External sources
  Git / Figma / docs / OpenAPI / APIs / ...

Application-produced sources
  prior WorkResult refs / artifact store / application state
```

Both cross the Oracle boundary, but their adapters and source semantics remain distinct.

## Completion and evidence

A Worker saying `done` is never sufficient application completion state.

```text
Worker execution
   -> structured WorkResult
   -> role-specific evidence / artifacts / gaps / blockers
   -> application completion policy
   -> ACCEPT | CONTINUE | BLOCK | FAIL
```

Evidence semantics stay concrete first. Backend verification may involve tests/typecheck/mutation evidence; Frontend, QA or Design may require different evidence. Common evidence abstractions are extracted only after real slices demonstrate them.

## Current maturity

### ExHarness Core — delivered

`packages/core-harness` publishes `exharness` and currently provides:

- AVO variation, lineage, verification/evaluation, supervision and adaptive search investment;
- typed judgments, Predict/CodeAct, object agents, live objects and progressive discovery;
- bounded context/history, model routing, tracing and runtime snapshot/resume;
- semantic memory and separate NOOA-style retrieval/ranking;
- evidence/decision/attestation trust primitives;
- interrupted-variation recovery and separate effect reconciliation primitives.

Important Core invariants include:

```text
working candidate ancestry != committed lineage
Observation != SemanticMemory != Evaluation
AgentEvent != TurnEvent != TraceSpan != EffectJournal
retrieval/ranking != correctness authority
candidate state != proof of external side effect
search investment != promotion correctness
supervision != correctness verdict
```

### Agentic Application + Oracle — desired state / active delivery

Their architecture, semantics, boundaries and active gaps are materialized under `docs/worktree/`. They are not described as already-delivered runtime features until source implementation converges.

## Documentation routing

Start at `docs/README.md`.

```text
docs/
├── README.md                         # documentation router
├── worktree/
│   ├── state.md                      # Agentic System desired-state router
│   ├── pipeline.md                   # active 10-stage / 4-wave delivery sequence
│   ├── agentic-application/          # application semantics and boundaries
│   ├── oracle/                       # context-resolution infrastructure
│   └── core-harness/                 # ExHarness Core continuation state
├── architecture/                     # deeper implemented/Core design records
└── development/                      # implementation/verification process
```

Routing authority:

```text
README.md
   -> docs/README.md
      -> docs/worktree/state.md
         -> docs/worktree/pipeline.md        for delivery order
         -> agentic-application/state.md     for application semantics
         -> oracle/state.md                  for context infrastructure
         -> core-harness/state.md            for Core continuation
```

Source/public exports are authority for what is implemented now. `docs/worktree/` is authority for active desired delivery state. `docs/architecture/` contains deeper design/history and must not silently override current worktree decisions.

## Core package

The published Core remains independently reusable:

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

The workspace root remains private so Agentic Application, Oracle and repository-level composition can evolve without prematurely expanding the Core package surface.

## Verification

Requires Node.js 20 or newer.

```bash
npm run verify
```

The current verification gate covers implemented repository/Core behavior. Application and Oracle verification must be added concretely as each delivery slice lands; desired-state documentation alone does not imply implementation completeness.
