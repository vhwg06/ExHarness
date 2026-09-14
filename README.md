# ExHarness — Agentic System

ExHarness is evolving from a reusable agent-harness kernel into a complete **agentic system** with three explicit layers:

- **Agentic Application Layer** — owns objectives, work decomposition, deterministic orchestration, bounded Advisor judgment, specialist Worker semantics, context requirements and application completion policy.
- **Oracle Infrastructure Layer** — resolves application-owned context requirements by pulling/dereferencing concrete sources and adapting them into application-shaped context. Resolution is explicit and resolve-once before Worker execution.
- **ExHarness Core** — the delivered AVO + NOOA-style execution kernel: long-horizon control, agent runtime, cognition, evidence/trust, persistence, recovery and authority boundaries.

The repository target is the composed system, while the `exharness` package remains the reusable core runtime/kernel.

## Target architecture

```text
Objective
   |
   v
Agentic Application
  Orchestrator -----> Advisor
      |
      v
  concrete WorkOrder / context need
      |
      +------> Oracle ------> external sources
      |          |           Git / docs / OpenAPI / Figma / ...
      |          +---------> application-produced artifacts/state
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

Core boundary:

```text
Application owns WHAT / WHY / semantic contracts.
Oracle owns WHERE / pull / dereference / adaptation.
ExHarness Core owns agent execution mechanics and runtime authority.
Infrastructure owns concrete IO, sandboxing, storage and source access.
```

## Current delivery state

### Delivered core

`packages/core-harness` publishes `exharness` and currently provides:

- AVO variation, lineage, verification/evaluation, supervision and adaptive search investment;
- typed judgments, Predict/CodeAct, object agents, live objects and progressive discovery;
- bounded context/history, model routing, tracing and runtime snapshot/resume;
- semantic memory and separate NOOA-style retrieval/ranking;
- evidence/decision/attestation trust primitives;
- interrupted-variation recovery and separate effect reconciliation primitives.

Important core invariants remain:

```text
working candidate ancestry != committed lineage
Observation != SemanticMemory != Evaluation
AgentEvent != TurnEvent != TraceSpan != EffectJournal
retrieval/ranking != correctness authority
candidate state != proof of external side effect
search investment != promotion correctness
supervision != correctness verdict
```

### Desired outer system

Agentic Application and Oracle semantics/architecture are specified under `docs/worktree/` and are intentionally not presented as already-delivered runtime features.

The active delivery plan is a concrete-first 10-stage pipeline. Wave A begins with one real Backend slice and forbids generic Worker/WorkOrder orchestration abstractions before a second concrete slice proves a common shape.

## Delivery pipeline

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

Stages are dependency/learning steps, **not ten sign-off checkpoints**. S1–S4 are one continuous vertical-slice implementation wave with one review after the slice works end-to-end.

See `docs/worktree/pipeline.md` for the canonical desired delivery sequence.

## Documentation routing

Start at `docs/README.md`.

```text
docs/
├── README.md                         # documentation router
├── worktree/
│   ├── state.md                      # agentic-system desired-state router
│   ├── pipeline.md                   # active 10-stage delivery sequence
│   ├── agentic-application/          # application semantics / boundaries
│   ├── oracle/                       # context-resolution infrastructure
│   └── core-harness/                 # ExHarness Core continuation state
├── architecture/                     # deeper implemented/core design records
└── development/                      # development/verification process
```

Source/public exports are authority for what is implemented now. `docs/worktree/` is authority for the active desired delivery state. `docs/architecture/` contains deeper design/history and must not silently override current worktree decisions.

## Core package entry point

Normal core consumers can use `createHarness()`:

```js
import {
  AVOCapability,
  EvaluationValidity,
  EvaluationVerdict,
  createHarness
} from "exharness";

const harness = createHarness({
  strategy: {
    async run({ invoke }) {
      await invoke(AVOCapability.ACT, { nextVersion: "v1" });
      await invoke(AVOCapability.EVALUATE);
      await invoke(AVOCapability.PROMOTE);
    }
  },
  environment: {
    async observe({ candidate, request }) {
      return inspect(candidate, request);
    },
    async act({ candidate, action }) {
      return applyAction(candidate, action);
    }
  },
  objective: {
    async evaluate() {
      return {
        validity: EvaluationValidity.VALID,
        verdict: EvaluationVerdict.PASS
      };
    }
  }
});
```

Low-level `createAVOHarness()`, `createCoreHarness()` and `createAgentRuntime()` remain available for custom composition.

## Verification

Requires Node.js 20 or newer.

```bash
npm run verify
```

The current verification gate covers the delivered repository/core implementation. Future Agentic Application/Oracle slices must add their own concrete verification as they become implemented rather than being implied by desired-state docs.

## Package

`packages/core-harness` publishes `exharness`.

Current public subpaths include:

```text
exharness
exharness/testing
exharness/effects
exharness/memory-retrieval
```

The workspace root remains private so the outer agentic system can evolve without prematurely expanding the core package surface.
