# D009 — Interrupted recovery requires generation fencing plus effect reconciliation

Status: **ACCEPTED**

Accepted: 2026-09-16

Acceptance boundary: BB-016 application-recovery/Core-effect review accepted the source-backed failure matrix and recovery split on PR #82. This decision is not promoted into `docs/worktree/*` because BB-017 has not implemented it yet.

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

Backend is mutating. Before an interrupted Backend stage can be retried or continued, the concrete application recovery path must restore/reconcile its durable Core execution/effect authority.

Outcomes:

```text
confirmed effect
  -> consume/apply confirmed effect truth without blind external redispatch

safe idempotent retry
  -> retry only under Core replay policy/action-key semantics

unknown / non-reconcilable
  -> block or escalate; do not redispatch
```

Current Backend Worker does not yet persist the Core session/effect authority required across process death; BB-017 must close that concrete integration gap rather than treating Blackboard checkpoint state as effect truth.

## QA recovery

QA is non-mutating at the application environment boundary. An interrupted QA attempt may be retried against the exact persisted accepted Backend revision/artifact handoff **after** the old execution generation is invalidated.

This does not make stale QA results valid; generation fencing still prevents an abandoned attempt from committing after takeover.

## Review fencing

Each active review dispatch receives a monotonically increasing review generation. The generation is part of the exact review subject alongside item id, requirement key and submission.

Rescheduling an interrupted review changes the generation. Evidence/decision/attestation produced for the abandoned generation therefore cannot satisfy the new active review target, including when the same reviewer is selected again.

## Recovery visibility

Fresh-session state must distinguish interrupted work that requires recovery from ordinary runnable work.

The concrete BB-017 storage/state shape may be chosen from implementation pressure, but it must preserve:

```text
interrupted != safe to retry
recovery requested != recovery reconciled
recovery reconciled != accepted
```

## Core boundary

This decision does not add a generic Core lifecycle/recovery facade and does not reopen D005 by itself.

BB-017 should first compose the existing Core effect/recovery primitives into the concrete Backend recovery path. Further abstraction requires additional repeated consumer evidence.

## Non-goals

This decision does not introduce:

- timeout-based automatic ownership transfer;
- distributed consensus or a lease service;
- exactly-once external effects;
- a generic recovery DSL/registry;
- reviewer prose as recovery authority;
- Blackboard checkpoint state as proof of effect completion.

## Evidence

- `packages/agentic-system/src/blackboard-orchestrator.js`: current owner-only claim fencing and stranded `CLAIMED`/`REVIEWING` behavior;
- `packages/agentic-system/src/durable-backend-qa.js`: claim-before-execute plus durable completed-stage checkpoints;
- `packages/agentic-system/src/backend-worker.js`: current per-execution Core harness with default in-memory session state;
- `packages/agentic-system/src/qa-worker.js`: non-mutating QA environment boundary;
- `packages/core-harness/test/recovery-composition.test.js`: confirmed-effect consumption, fail-closed ambiguity and idempotent retry/reference recovery composition;
- BB-016 research artifact `../knowledge/bb016-interrupted-work-recovery.md`;
- PR #82 application-recovery/Core-effect review and CI.

## What would change this decision

Revisit lease/heartbeat automation only when a concrete deployment has a liveness source whose semantics are explicit; it still must not replace generation fencing or effect reconciliation. Revisit a Core recovery facade only after repeated concrete consumers justify it.
