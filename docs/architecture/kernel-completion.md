# ExHarness Kernel Completion

## Identity

ExHarness is a reusable harness kernel composed from two NVIDIA-inspired layers:

```text
AVO control plane
  candidate / lineage
  autonomous variation
  objective feedback
  persistent K
  supervision
  commit / recovery
        |
        v
NOOA-style agent substrate
  strategy
  explicit context
  typed capabilities
  programmable invocation
  runtime events
        |
        v
injected infrastructure
  model adapter
  executor / sandbox
  tools
  persistent store
  event sinks
```

AVO owns what the system does over long horizons. The NOOA-style substrate owns how an autonomous agent can programmatically inspect and act inside one variation. Consumer projects own domain semantics and infrastructure adapters.

## Public composition boundary

Normal consumers start at one facade:

```js
import { createHarness } from "exharness";

const harness = createHarness({
  strategy,
  environment,
  objective,
  capabilities,
  verifiers,
  sessionStore,
  supervisor,
  policies
});
```

`createAVOHarness()` and `createCoreHarness()` remain exported for low-level composition and kernel development. They are not the recommended production entrypoint.

## Persistent state and consistency

Persistent work state has an explicit `schemaVersion` and monotonic `revision`.

Production `createHarness()` requires a revision-aware store. A store must reject a stale write instead of silently applying last-writer-wins. The bundled in-memory store is the reference semantics, not the production persistence recommendation.

The testing SDK exports `verifySessionStoreContract()` so a project-specific Postgres, SQLite, Redis, object-store, or remote implementation can prove the same behavior. A revision-aware store must return the revision it actually persisted; merely advertising revision support is insufficient.

Future schema versions must be rejected before they enter kernel state. Older compatible state is normalized at the persistence boundary; future-state guessing is forbidden.

Schema evolution is explicit and sequential:

```text
v1 -- migration 1->2 --> v2 -- migration 2->3 --> v3
```

`defineStateMigration()` and `createStateMigrator()` require every intermediate transition. Missing migration steps fail rather than silently coercing persistent engineering memory.

## External mutation consistency

No generic kernel can atomically commit arbitrary external side effects and its own state store. A process can crash after an external mutation succeeds but before the new candidate is persisted.

ExHarness therefore does not claim distributed rollback. The production facade gives every `environment.act()` call a deterministic `actionKey` derived from:

```text
session + current candidate + semantic action
```

A retry of the same semantic action from the same candidate receives the same key. Environment/executor adapters use that key to deduplicate or reconcile an uncertain prior attempt.

```text
external mutation succeeds
        |
process crashes before state save
        |
explicit recovery / retry
        |
identical actionKey
        |
consumer adapter deduplicates or reconciles
```

This is an idempotency/reconciliation protocol, not a fake transaction guarantee. Consumers whose external systems cannot provide idempotent or reconcilable mutation semantics must surface that limitation in their workload harness.

## Interrupted work and recovery

A `RUNNING` variation is durable state. Resume never silently erases it and never automatically assumes the worker is dead.

```text
RUNNING variation found
        |
        +--> resume/vary => RECOVERY_REQUIRED
        |
        +--> recover(force=false)
        |      only if stale by policy
        |
        +--> recover(force=true)
               explicit operator decision
```

Recovery completes the old variation with `termination=INTERRUPTED`. Any candidate/evidence changes already persisted remain visible; recovery does not roll them back or pretend the run never happened.

## Supervision semantics

Supervisor remains a search-control role, never a correctness oracle.

Deterministic trajectory signals may surface:

- no-change streak;
- repeated budget exhaustion;
- failed/interrupted variation frequency;
- exact repeated failed-direction records;
- unresolved active knowledge conflicts.

Signals request attention; they do not declare failure or success.

After a completed variation, a configured supervisor can be asked to redirect when the trajectory crosses a signal threshold. The same supervisor contract still forbids verdicts and candidate mutation. A valid redirect is persisted in `supervision.interventions`, enters trajectory, and is available to the next variation context.

## Execution boundary

Core capabilities do not need to execute processes directly. `Executor` is the infrastructure boundary:

```text
semantic capability
       |
       v
execution envelope
  capability
  request
  timeout
  AbortSignal
  constraints
       |
       v
consumer executor
  local / sandbox / container / remote / Codex / MCP / future
```

The kernel bounds the caller with timeout/abort behavior and transports explicit constraints. It does **not** claim that an in-process Promise timeout kills an OS process. Filesystem, network, credential, process, and resource containment must be enforced by the injected executor/sandbox adapter.

This is intentional: security authority belongs at the actual runtime boundary, not in prompts.

## Observability

Kernel observability has two distinct forms:

- persistent engineering trajectory inside work state;
- process/runtime event sinks for runs, capabilities, recovery, and facade lifecycle.

Observability is not correctness. By default a failing telemetry sink is recorded without changing the engineering outcome. Consumers can opt into strict observability when losing telemetry itself should fail a run.

## Testing and compatibility

The kernel ships deterministic utilities for clocks, IDs, fake environments/executors, and adapter contracts.

Repository verification has four independent surfaces:

```text
kernel invariant + adversarial tests
        +
reference harness
        +
blank-consumer packed-package smoke
        +
deterministic control-plane benchmark
```

The blank-consumer smoke installs the actual packed tarball and imports both `exharness` and `exharness/testing`; it is deliberately separate from source-relative tests.

The benchmark measures kernel plumbing/invariants only. It deliberately does not claim model or domain quality. Backend/frontend/QA/research harnesses must add their own workload benchmarks and objective verification artifacts.

The CI compatibility gate runs the complete verification command on Node 20, 22, and 24.

## Completion gate

The base kernel is considered complete when all of the following hold:

1. another project can import `createHarness` from the packed `exharness` package;
2. the project can inject its own environment, objective, strategy/model runtime, capabilities, verifier, store, executor, supervisor, and policies without editing kernel code;
3. candidate lineage, verification freshness, persistent K, bounded variation, promotion, and feedback remain enforced by deterministic core semantics;
4. interrupted work is detectable and explicitly recoverable;
5. stale persistence writes conflict instead of silently overwriting progress;
6. schema evolution has an explicit sequential migration contract;
7. external mutation retries have a stable idempotency/reconciliation key;
8. supervisor redirects can survive context/process boundaries without gaining correctness or mutation authority;
9. execution is routed through an explicit adapter boundary with timeout/abort/constraints;
10. run/capability lifecycle is observable without making telemetry the source of truth;
11. custom store/executor adapters have reusable contract verification;
12. tests, reference example, package smoke, benchmark, npm pack, and supported-runtime matrix are green.

## Explicit non-goals of the kernel

The completed kernel does not contain:

- backend/frontend/QA/research workflows;
- repository/Figma/SRS/Task Provider semantics;
- a concrete model provider;
- a concrete shell/container/browser sandbox;
- automatic semantic truth resolution for conflicting knowledge;
- distributed transactions over consumer side effects;
- benchmark-derived optimal context/supervision doses;
- parallel AVO branches.

Those are adapters, workload harnesses, or future evidence-driven extensions. Keeping them outside the kernel is part of the completion contract, not missing implementation.
