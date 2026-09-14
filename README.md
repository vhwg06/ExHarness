# ExHarness

ExHarness is a reusable autonomous-agent harness kernel with two complementary layers:

- **AVO control plane** — long-horizon variation, candidate/lineage state, verification/evaluation, supervision, recovery and adaptive search investment.
- **NOOA-style agent substrate** — typed judgments, Predict/CodeAct, object agents, live-object authority, progressive discovery, bounded context/history, model routing, tracing and resumable runtime state.

The kernel intentionally contains no backend, frontend, QA, design-system or product semantics. Consumers inject domain objectives, environment/effect semantics, models, executors, stores, verifiers and trust authorities.

## Architecture

```text
consumer/domain semantics
        ↓
createHarness()
  persistence + recovery gates + supervision
  search investment + observability + trust
        ↓
AVO control plane
  candidate / variation / evidence / lineage
        ↓
AgentRuntime / ObjectAgent
  judgments + capabilities + context + events
  Predict / CodeAct / JavaScript CodeAct
  resources + live objects + discovery + routing
        ↓
injected infrastructure
  model / environment / executor / durable store / tracer / authorities
```

The layering rule is:

```text
AVO  = what autonomous search does over time
NOOA = how the agent acts programmatically inside a variation
```

Deterministic kernel code owns lifecycle and authority invariants. Models own bounded local judgment, never correctness authority by self-report.

## What is delivered

### Long-horizon control

- persistent candidate ancestry and committed lineage;
- explicit variation lifecycle and capability budgets;
- observations, objective verifications and evaluations;
- evaluation-freshness checks before promotion;
- trajectory-aware supervision;
- adaptive search-investment decisions for CONTINUE / STOP / ESCALATE;
- explicit interrupted-variation recovery.

### Agent runtime

- typed judgments and capability contracts;
- Predict and finite action-protocol CodeAct;
- language-native JavaScript CodeAct sessions with persistent per-call locals;
- agent-as-object ergonomics;
- live object identity, mutation and bounded authority surfaces;
- progressive `doc()` / surface discovery;
- bounded context blocks and canonical event-history selection;
- nested tracing and observable runtime events;
- scoped model routing;
- runtime snapshot/resume with compatibility checks and explicit resource/live-object rebinding.

### Cognition and memory

ExHarness separates semantic memory from correctness state.

The core package exposes semantic-memory storage, relations/graph, evolution, ranking/intelligence, spontaneous recall and a retrieval authority boundary. `createSemanticMemoryRetrievalPort()` re-reads canonical records, rejects archived records, enforces tags and context budgets, and treats provider ranking as non-authoritative.

A NOOA-style associative retrieval adapter is exposed separately through:

```js
import { createNooaMemoryRetriever } from "exharness/memory-retrieval";
```

The adapter provides hybrid dense/sparse candidate generation, ACT-R-like recency, importance weighting and bounded graph spread. It is a ranking adapter, not correctness authority and not automatically wired into every memory/context path.

### Trust and evidence

The kernel exposes evidence, decision and attestation primitives, including process-trust and verification-independence semantics. Trust artifacts remain distinct from model traces, semantic memory and evaluation state.

## Consumer entry point

Normal consumers should start with `createHarness()`:

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

await harness.start({
  sessionId: "work-1",
  work: { objective: "improve the candidate" },
  seedCandidate: { id: "candidate", version: "v0" }
});

await harness.vary("work-1");
```

Low-level `createAVOHarness()`, `createCoreHarness()` and `createAgentRuntime()` remain exported for custom composition.

## State and authority boundaries

Important invariants include:

```text
working candidate ancestry != committed lineage
Observation != SemanticMemory != Evaluation
AgentEvent != TurnEvent != TraceSpan != EffectJournal
retrieval/ranking != correctness authority
candidate state != proof of external side effect
search investment != promotion correctness
supervision != correctness verdict
```

Promotion requires a fresh evaluation over the exact current observation and verification artifact snapshots.

Context is a bounded projection of canonical history/state; selectors cannot fabricate canonical runtime events. Live resources and live objects carry explicit authority and are not silently resurrected by snapshot restore.

## Recovery semantics

ExHarness currently has three distinct recovery mechanisms:

1. **AVO interrupted-variation recovery** — a persisted `RUNNING` variation causes `resume()` / `vary()` to fail closed until the variation is explicitly recovered and closed as interrupted.
2. **AgentRuntime snapshot/resume** — restores compatible runtime configuration and `AgentEvent` state; active resources/live objects require explicit rebinding.
3. **Effect-operation reconciliation** — effectful capabilities can journal operation intent before dispatch and reconcile `PURE`, `IDEMPOTENT`, `OBSERVABLE` or `NON_RECONCILABLE` operations.

Effect semantics are exposed through:

```js
import {
  EffectReplayPolicy,
  createInMemoryEffectJournal,
  defineEffectCapability,
  reconcileEffectOperation
} from "exharness/effects";
```

These mechanisms are intentionally not presented as one completed recovery workflow yet. In the built-in AVO path, `avo.act` still delegates to `core.act()`, which calls `environment.act()` before resulting candidate/event state is persisted. Consumers with externally visible effects must not infer effect completion from candidate or trace state alone.

## Persistence and infrastructure

Production use should provide a revision-aware durable session store. The bundled in-memory implementations are references/test utilities, not production durability.

```js
import { verifySessionStoreContract } from "exharness/testing";

await verifySessionStoreContract(() => myStore());
```

Executors/sandboxes remain injected infrastructure. ExHarness can carry timeout/abort/constraint envelopes, but actual filesystem, process, network, credential and resource isolation must be enforced by the executor boundary.

## Living repository state

Current delivery truth for repository continuation lives under:

```text
docs/worktree/
├── state.md
└── engineering/
    ├── state.md
    ├── architecture.md
    ├── workflow.md
    ├── gaps.md
    └── decisions.md
```

`docs/worktree/state.md` is the repository delivery projection. Engineering children contain bounded current state only. Historical stage detail stays in Git and `docs/architecture/`.

Source/public exports remain implementation authority; worktree projections must be reconciled when those semantics change.

## Verification

Requires Node.js 20 or newer.

```bash
npm run verify
```

The repository verification gate includes the kernel suite, reference workloads/benchmarks, package dry-run and packed blank-consumer smoke tests. Fidelity/reference artifacts are checked in under `artifacts/`.

## Package

`packages/core-harness` publishes `exharness`.

Public package subpaths currently include:

```text
exharness
exharness/testing
exharness/effects
exharness/memory-retrieval
```

The workspace root remains private so adapters and repository tooling can evolve without expanding the kernel package surface.
