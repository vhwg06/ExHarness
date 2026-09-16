# BB-032 — Concrete composition boundary across Application, Oracle and Core

Status: **EVIDENCE / JUDGMENT CANDIDATE**

Inspected source revision: `8eb55bf3eb31b599e85a47d03b28893f69066281`.

## Question

Does the delivered Backend -> QA system now show enough repeated pressure to extract a shared Application/Core/Oracle lifecycle facade, or is there a smaller concrete composition improvement with measurable value?

BB-032 is not permission to create a generic role framework, workflow DSL or Core lifecycle facade. D005 remains the default boundary unless repeated consumers prove otherwise.

## Current ownership map

| Concern | Current owner | Source-backed observation |
| --- | --- | --- |
| Project/stage dispatch | Agentic Application durable workflow + ApplicationOrchestrator | `durable-backend-qa.js` claims work, persists checkpoints, selects Backend/QA/remediation stages and submits final QA output. |
| Required context declaration | Concrete Application WorkOrder | Backend `requiredFiles` and QA `requiredArtifacts` are declared before Oracle resolution. |
| Context source IO/adaptation | Oracle | `resolveBackendContext(...)` reads repository files; `resolveQaContext(...)` reads application artifacts and preserves source/provenance refs. Oracle does not own Board lifecycle. |
| Core execution/session state | Concrete Worker + ExHarness Core | `BackendWorker` creates the Core harness, deterministic session id, candidate lineage, verification memory and recovery session state. |
| External effect truth/reconciliation | ExHarness Core effect journal through BackendWorker | Backend recovery inspects persisted effects, consumes confirmed truth, retries only under replay policy and blocks ambiguous/non-reconcilable state. Blackboard generation fencing is separate. |
| Role evidence | Concrete Worker/Core verification composition | Backend Worker rebuilds mutation + verifier evidence from promoted/current Core state rather than trusting Worker-returned evidence. |
| Role completion | Concrete Application completion policy | `backend-application.js` evaluates grounded Backend result/evidence and optionally invokes bounded Advisor judgment. |
| Project completion | ApplicationOrchestrator trusted review lifecycle | Backend/QA role completion still does not authorize Blackboard `DONE`. |

This ownership split is coherent. No single missing authority currently requires a generic cross-layer facade.

## Repeated sequencing that exists today

`runBackendObjective(...)` and `recoverBackendObjective(...)` both perform the same concrete pre-Worker sequence:

```text
parse BackendObjective
  -> make BackendWorkOrder
  -> resolve BackendContext through Oracle
  -> execute or recover BackendWorker
  -> apply Backend completion policy
```

The repeated part is real, but it is still one concrete Backend consumer. By itself it does not justify a generic `Worker<C,R>`, provider registry, lifecycle facade or workflow DSL.

## Concrete missing link: pre-Worker source failure is outside the durable Backend stage boundary

The durable Backend/QA workflow claims the Board item before calling `runBackendObjective(...)`. `runBackendObjective(...)` resolves Oracle context before invoking `backendWorker.execute(...)`.

Therefore a repository read failure has this current path:

```text
REOPENED
  -> claim
  -> CLAIMED
  -> Oracle repository read fails
  -> exception escapes runBackendStage
  -> no durable blocker is persisted
  -> Worker/Core was never entered
```

`recoverInterrupted(...)` explicitly fences the old generation, but it calls `recoverBackendObjective(...)`, which again resolves Oracle context before `backendWorker.recover(...)`. If the source is still unavailable, recovery throws again and the item remains `CLAIMED` under the new generation without a durable source blocker.

This is not an Oracle correctness bug: Oracle correctly fails instead of fabricating context. It is a composition/lifecycle gap between a read-only pre-Worker phase and the durable stage boundary.

## Existing QA contrast

The same durable workflow already wraps `runQaObjective(...)` in a stage-level `try/catch`. The existing BB-004 regression contract demonstrates that an unavailable artifact source becomes durable `BLOCKED`, preserves the `QA_PENDING` checkpoint, survives reconstruction and resumes after source recovery.

The Backend path has no equivalent safe pre-Worker failure boundary today.

This asymmetry matters because a broad `catch (error) -> BLOCKED` around all Backend execution would be unsafe: a Worker error may happen after an external mutation or after Core has persisted effect intent/truth. Such a failure belongs to Core effect recovery, not source-availability handling.

## Runnable probe

`packages/agentic-system/test/bb032-composition-boundary-research.test.js` compares two bounded cases using the public Orchestrator/Oracle composition.

### Baseline

1. initialize `BACKEND_PENDING`;
2. claim via current durable workflow;
3. repository resolution fails;
4. assert Backend Worker `execute` was never called;
5. assert Board remains `CLAIMED`, checkpoint remains `BACKEND_PENDING`, blockers remain empty;
6. explicit interrupted takeover increments generation;
7. source resolution fails again before `backendWorker.recover`, leaving the new attempt `CLAIMED` with no durable blocker.

### Phase-separated candidate prototype

1. initialize the same durable Backend checkpoint;
2. claim normally;
3. perform the existing concrete `makeBackendWorkOrder -> resolveBackendContext` preflight;
4. on preflight failure, persist `BLOCKED` with the same checkpoint and a source-resolution blocker;
5. assert Backend Worker execute/recover call count remains zero;
6. resume returns the exact `BACKEND_PENDING` checkpoint to `REOPENED`.

The candidate does not claim effect completion, does not reconcile Core effects and does not change Orchestrator authority. It only proves that the read-only pre-Worker phase can be made explicit enough for durable lifecycle handling.

## Judgment

**NARROW — do not extract a shared Application/Core/Oracle lifecycle facade.**

The current ownership boundaries are already materially different and useful:

```text
Application workflow = project/stage lifecycle
Oracle               = declared source resolution
Worker + Core         = execution/session/effect/evidence truth
Application policy   = role completion
Orchestrator review  = project acceptance
```

The measured pressure supports one concrete Backend composition improvement instead:

```text
Backend objective preparation
  = parse objective
  + build Backend WorkOrder
  + resolve BackendContext

then, only after preparation succeeds:
  execute/recover BackendWorker
  -> completion policy
```

This phase separation gives the durable workflow a safe pre-Worker failure boundary without catching effectful Worker failures as ordinary source outages.

## BB-033 implementation handoff

If architecture/evaluation review accepts this result, BB-033 should implement the smallest concrete Backend-only boundary that preserves these invariants:

- one reusable preparation path for normal and recovery execution;
- Oracle remains the source IO owner; serializer/workflow code does not read repository files directly;
- durable workflow may persist a context-resolution blocker because Worker/Core has not started yet;
- Worker/runtime/effect failures remain under existing Backend/Core recovery semantics and are not flattened into source errors;
- existing Backend WorkOrder/Context schemas and completion policy remain authoritative;
- no generic Worker/Context registry, role runtime, lifecycle facade or workflow DSL;
- QA behavior stays unchanged unless a later second consumer proves the same phase semantics.

A likely concrete shape is a Backend-specific preparation function returning `{ objective, order, context }`, consumed by distinct normal/recovery execution functions. Exact API naming is intentionally left to implementation pressure; this research does not freeze a generic abstraction.

## Value gate for BB-033

A candidate implementation is useful only if it demonstrates all of the following against the current baseline:

- repository unavailability before Worker execution becomes durable `BLOCKED` rather than stranded `CLAIMED`;
- a fresh session can resume the same Backend checkpoint after source recovery;
- Backend Worker execute/recover is not called when preflight fails;
- confirmed/idempotent/non-reconcilable effect recovery behavior is unchanged;
- successful Backend -> QA/remediation behavior is unchanged;
- no new authority is granted to Oracle, Worker, Advisor or Blackboard.

## What this does not establish

This probe is deterministic repository-level evidence. It does not establish production failure frequency, production effectiveness or a general abstraction need. It does not reopen D005. It does not establish that all Application roles need a preparation phase.

## Evidence

- `packages/agentic-system/src/durable-backend-qa.js`
- `packages/agentic-system/src/backend-application.js`
- `packages/agentic-system/src/backend-worker.js`
- `packages/agentic-system/src/oracle.js`
- `packages/agentic-system/test/durable-backend-qa.test.js`
- `packages/core-harness/test/recovery-composition.test.js`
- `packages/agentic-system/test/bb032-composition-boundary-research.test.js`
- `docs/living/decisions/D005-no-core-lifecycle-facade-yet.md`
