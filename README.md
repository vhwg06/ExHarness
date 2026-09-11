# ExHarness

ExHarness is a reusable long-horizon harness kernel that combines two NVIDIA-inspired ideas at different layers:

- **AVO** is the control/search spine: candidate variation, committed lineage, persistent progress, objective feedback, accumulated knowledge, supervision, recovery, and adaptive search investment.
- **NOOA-style runtime primitives** are the agent substrate: explicit context, programmable strategy, typed capabilities, validation boundaries, and observable invocation.

ExHarness intentionally contains no backend, frontend, QA, Figma, repository, or product semantics. A consuming project imports the kernel and injects those concerns.

## Consumer API

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
    async evaluate({ candidate, observations, verifications }) {
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

const result = await harness.vary("work-1");
```

A real project normally adds domain capabilities, objective verifiers, a durable revision-aware store, model-backed strategy, executor/sandbox adapters, optional supervisor policies, and—when the workload has a meaningful quality/cost signal—an adaptive search-investment policy. None require editing ExHarness.

## Architecture

```text
consumer harness
  domain objective / environment / policies / adapters
                    |
                    v
+------------------------------------------------+
|                 ExHarness                      |
|                                                |
| AVO control plane                              |
| candidate + committed lineage                  |
| variation + objective verification             |
| grounded feedback + persistent K               |
| adaptive search investment                     |
| supervision + recovery                         |
|                                                |
| NOOA-style substrate                           |
| strategy + context + typed capabilities        |
| programmable invocation + runtime events       |
+--------------------------+---------------------+
                           |
                           v
              injected infrastructure
           model / tools / executor / store
```

The layering rule is:

```text
AVO  = what autonomous search does over time
NOOA = how the agent can programmatically act inside a variation
```

The agent owns local search judgment. Deterministic kernel code owns lifecycle invariants.

## Kernel invariants

ExHarness currently enforces the following base semantics:

- working candidate ancestry is distinct from committed AVO lineage;
- a candidate derived from a stale lineage head cannot be promoted;
- stale observations/verifications cannot certify a mutated candidate;
- evaluation snapshots become stale when their candidate evidence changes;
- verification conflicts/incompleteness are visible before objective PASS;
- persistent feedback is grounded in execution/evaluation state rather than agent prose;
- knowledge is append-only, scoped, provenance-aware, and can expose unresolved contradictions;
- variation outcomes come from persisted state changes, not model claims;
- variation capability budget is owned outside strategy exception handling;
- adaptive search-investment decisions are grounded in persisted artifacts, never model self-reported progress;
- search-investment decisions are freshness-bound to both the consumed artifact snapshot and policy revision/configuration;
- search investment controls whether another variation may start, never objective correctness or promotion;
- hard variation budgets remain authoritative even when search investment says CONTINUE;
- promotion closes variation capability activity;
- supervisor can redirect search but cannot mutate candidates or issue correctness verdicts;
- persistent work state has schema/revision identity;
- revision-aware stores reject stale writes;
- interrupted RUNNING variations require explicit recovery;
- execution adapters receive timeout/abort/constraint envelopes;
- observability is separate from correctness state.

## Adaptive search investment

A hard variation budget and an adaptive useful range answer different questions:

```text
maxCapabilityCalls
= how much work one variation is allowed to spend at most

SearchInvestmentDecision
= given grounded history, is another variation still worth opening?
```

Configure a policy only when the consumer has a meaningful grounded signal. The kernel does not invent a universal quality function.

```js
import {
  createHarness,
  createMarginalImprovementPolicy
} from "exharness";

const harness = createHarness({
  // ...strategy/environment/objective...
  variationPolicy: {
    maxCapabilityCalls: 64 // hard containment ceiling
  },
  searchInvestmentPolicy: createMarginalImprovementPolicy({
    revision: "quality-v1",
    minEvaluations: 3,
    window: 2,
    minimumImprovement: 0.01,
    anomalyImprovement: 0.5,
    selectQuality(evaluation) {
      return evaluation.metadata?.quality;
    }
  })
});
```

After each completed variation, the controller persists a `SearchInvestmentDecision`:

```text
WARMUP / IN_RANGE / DIMINISHING_RETURNS / ANOMALOUS / INSUFFICIENT_DATA
                           |
                           v
              CONTINUE / STOP / ESCALATE
```

`STOP` or `ESCALATE` gates the next variation before strategy execution. A fresh correctness PASS can still be promoted; the range gate is not a correctness oracle. New observations/verifications/evaluations/trajectory artifacts or a policy revision/configuration change make an older range decision stale and force recomputation. Recovery remains a separate, higher-priority lifecycle concern.

See `docs/architecture/adaptive-useful-range.md` for the control-plane contract.

## Infrastructure extension points

### Capabilities

```js
import { defineCapability } from "exharness";

const inspect = defineCapability({
  name: "domain.inspect",
  async execute(input) {
    return inspectDomain(input);
  }
});
```

Capabilities can define `parseInput` / `parseOutput` without binding the kernel to a schema library.

### Executor boundary

```js
import { createExecutorCapability } from "exharness";

const runSomething = createExecutorCapability({
  name: "domain.run",
  executor,
  executionPolicy: {
    timeoutMs: 30_000,
    constraints: {
      network: "deny",
      workspace: "/work"
    }
  }
});
```

The kernel carries the execution policy and bounds the caller. The injected executor/sandbox must enforce real filesystem, network, credential, process, and resource isolation.

### Persistent store

Production composition requires a revision-aware store. The bundled in-memory store is a reference implementation.

```js
import { verifySessionStoreContract } from "exharness/testing";

await verifySessionStoreContract(() => myStore());
```

### Recovery

A persisted `RUNNING` variation is never silently erased.

```js
await harness.resume(id);       // throws RECOVERY_REQUIRED when needed
await harness.recover(id);      // stale-only by policy
await harness.recover(id, { force: true });
```

Recovery marks the interrupted run explicitly and preserves already-persisted engineering state.

## Objective verification during development

ExHarness itself is developed with two tracks:

```text
implementation candidate
        |
        +--------------------+
        |                    |
        v                    v
 implementation       verification track
                      manual vigilance
                      codified artifacts
                      adversarial checks
                      automation where stable
        |                    |
        +---------+----------+
                  v
              PASS / GAP
```

Tests are regression guards, not the whole verification strategy.

## Verification commands

Requires Node.js 20 or newer.

```bash
npm run verify
```

The full gate runs:

```text
kernel test suite
reference harness
kernel benchmark
npm package dry-run
blank-consumer packed-package import smoke
```

Individual commands:

```bash
npm test
npm run example
npm run benchmark
npm run verify:package
npm run verify:consumer
```

See `docs/architecture/kernel-completion.md` for the completion contract and explicit non-goals.

## Package status

`packages/core-harness` is the publishable `exharness` package. The workspace root remains private so optional adapters can evolve without expanding the kernel surface.

Low-level `createAVOHarness()` and `createCoreHarness()` remain exported for kernel development and custom composition; normal consumers should start with `createHarness()`.
