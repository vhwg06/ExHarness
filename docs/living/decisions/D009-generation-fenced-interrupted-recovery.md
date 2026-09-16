# D009 — Interrupted recovery requires generation fencing plus effect reconciliation

Status: **PROMOTED**

Accepted: 2026-09-16

Promoted: 2026-09-16

Acceptance boundary: BB-016 application-recovery/Core-effect review accepted the source-backed failure matrix and recovery split on PR #82.

Promotion boundary: BB-017 implements execution/review generation fencing, explicit takeover, concrete Backend Core session/effect recovery and non-mutating QA recovery on PR #83. PR #83 was accepted after application/code and crash-recovery reviews were re-affirmed on exact head `ac86472a2f5e1362cc0c743833ed7e18d6fa0d99`, exact-head CI #1473 passed, and merge commit `d755605fe8b917c22d79b42073b18f0265ce8474` landed on `main`.

## Question

How should ExHarness recover a Blackboard item stranded in `CLAIMED` or `REVIEWING` after a process/session interruption without accepting stale results or blindly replaying external effects?

## Decision

Interrupted Application work is recovered through **explicit recovery**, not automatic time-based reclaim.

Two independent authorities are required:

```text
lifecycle generation
  -> who may commit this execution/review attempt?

effect reconciliation
  -> is a mutating interrupted stage safe to continue or redispatch?
```

Neither replaces the other.

## Execution fencing

Each execution claim/takeover receives a monotonically increasing generation independent from owner identity.

Any state-changing result from the attempt must match the currently active `{owner, generation}`. A takeover changes generation before replacement work can commit, so the abandoned executor is stale even if the same logical owner name is reused.

Generation is lifecycle fencing only. It is not correctness evidence, an effect result or a Core variation identity.

## Recovery trigger

Elapsed time, heartbeats or lease metadata may be used as liveness signals in a future implementation, but they do not authorize retry by themselves.

A recovery transition must be explicit and source-backed. In particular:

```text
lease expired
!= executor stopped
!= external effect did not happen
!= safe to retry
```

## Backend recovery

Backend is mutating. Before an interrupted Backend stage can be retried or continued, the concrete application recovery path restores/reconciles its durable Core execution/effect authority.

The implemented BB-017 composition persists the Backend Core session plus AVO action-effect journal through the concrete `createJsonBackendSessionStore(...)` and then recovers the exact Backend WorkOrder/Context.

An **absence** of persisted Core state is usable as recovery evidence only when the configured SessionStore explicitly declares durable recovery authority. `createJsonBackendSessionStore(...)` declares `supportsDurableRecovery: true`; the default in-memory store does not. Therefore an empty volatile store fails closed instead of being interpreted as proof that no interrupted external effect occurred.

The concrete durable Backend SessionStore also fences stale writers by exact expected revision and immutable single-successor publication; elapsed-time lock takeover is not persistence authority.

Outcomes:

```text
no persisted Core session + durable-recovery store authority
  -> normal fresh execution may start

no persisted Core session + no durable-recovery authority
  -> block; empty volatile state does not prove effect absence

confirmed effect on the original candidate
  -> close interrupted variation
  -> replay same strategy/session
  -> consume confirmed effect result without external redispatch

safe idempotent retry
  -> retry only under Core replay policy/action-key semantics

unknown / non-reconcilable
  -> block or escalate; do not redispatch

multiple mutation effects / candidate divergence /
already-advanced candidate without durable Worker semantic result
  -> block / require reassessment; do not invent a result
```

A recovered normal Backend result still passes the ordinary lineage, evidence and completion policy. Recovery does not self-authorize Backend acceptance.

## QA recovery

QA is non-mutating at the application environment boundary. An interrupted QA attempt may be retried against the exact persisted accepted Backend revision/artifact handoff **after** the old execution generation is invalidated.

This does not make stale QA results valid; generation fencing prevents an abandoned attempt from committing after takeover.

## Review fencing

Each active review dispatch receives a monotonically increasing review generation. The generation is part of the exact review subject alongside item id, requirement key and submission.

Rescheduling an interrupted review changes the generation. Evidence/decision/attestation produced for the abandoned generation therefore cannot satisfy the new active review target, including when the same reviewer is selected again.

## Recovery visibility

Fresh-session state exposes the current `claimGeneration`, `reviewGeneration`, `activeReview` and ordinary Blackboard lifecycle state.

The implemented semantics preserve:

```text
interrupted != safe to retry
recovery requested != recovery reconciled
recovery reconciled != accepted
```

`CLAIMED` with the current generation identifies the active execution attempt; later `REOPENED`, `BLOCKED`, `PENDING_REVIEW` or other ordinary lifecycle state records the result of the recovered stage. No separate lease/recovery state machine is introduced.

## Core boundary

This decision does not add a generic Core lifecycle/recovery facade and does not reopen D005.

BB-017 composes the existing Core session/effect/recovery primitives in the concrete Backend vertical. Further abstraction requires additional repeated consumer evidence.

## Non-goals

This decision does not introduce:

- timeout-based automatic ownership transfer;
- distributed consensus or a lease service;
- exactly-once external effects;
- a generic recovery DSL/registry;
- reviewer prose as recovery authority;
- Blackboard checkpoint state as proof of effect completion;
- empty non-durable memory as proof of effect absence;
- a generic Core recovery facade.

## Promotion targets

- `docs/worktree/agentic-application/state.md`
- `docs/worktree/agentic-application/contracts.md`
- `docs/worktree/agentic-application/workflow.md`
- `docs/worktree/agentic-application/decisions.md`

## Evidence

Research/acceptance evidence:

- `packages/agentic-system/src/blackboard-orchestrator.js`: pre-BB-017 stranded `CLAIMED`/`REVIEWING` pressure;
- `packages/agentic-system/src/durable-backend-qa.js`: claim-before-execute and durable stage checkpoints;
- `packages/core-harness/test/recovery-composition.test.js`: confirmed-effect consumption, fail-closed ambiguity and idempotent retry/reference recovery composition;
- BB-016 research artifact `../knowledge/bb016-interrupted-work-recovery.md`;
- PR #82 application-recovery/Core-effect review on exact head `b3072f5a175631ea1063c38043f1fffbd64a7843`;
- exact-head CI #1251;
- merge commit `ad61a2b037b99384e16fdd5245ee04f43dc36083`.

Implementation/promotion evidence:

- `packages/agentic-system/src/blackboard-orchestrator.js`: claim/review generations plus explicit recovery transitions;
- `packages/agentic-system/src/session-handoff.js`: attempt generation and active-review continuation projection;
- `packages/agentic-system/src/backend-session-store.js`: concrete durable Backend Core/effect session store, explicit durable-recovery authority and stale-writer fencing;
- `packages/agentic-system/src/backend-worker.js`: effect-aware Backend recovery with fail-closed empty non-durable state;
- `packages/agentic-system/src/backend-application.js`: recovered result composition through ordinary completion policy;
- `packages/agentic-system/src/durable-backend-qa.js`: concrete Backend/QA interrupted-stage recovery;
- `packages/agentic-system/test/backend-session-store.test.js`: concurrent/stale writer exclusion contracts;
- `packages/agentic-system/test/wave-d.test.js`: stale execution/review generation fencing;
- `packages/agentic-system/test/interrupted-recovery.test.js`: empty non-durable fail-closed, confirmed no-redispatch, same-key idempotent retry and non-reconcilable block contracts;
- PR #83 application/code and crash-recovery reviews re-affirmed on exact head `ac86472a2f5e1362cc0c743833ed7e18d6fa0d99`;
- exact-head CI #1473;
- merge commit `d755605fe8b917c22d79b42073b18f0265ce8474`.

## What would change this decision

Revisit lease/heartbeat automation only when a concrete deployment has a liveness source whose semantics are explicit; it still must not replace generation fencing or effect reconciliation. Revisit a Core recovery facade only after repeated concrete consumers justify it.
