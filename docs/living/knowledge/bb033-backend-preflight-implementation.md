# BB-033 implementation evidence — Backend preparation boundary

Status: IMPLEMENTED CANDIDATE

Source lineage: accepted BB-032 result (`NARROW`) from PR #101.

Integration baseline: latest implementation is rebased over BB-019 project acceptance and the delivered BB-016/017 interrupted-recovery track. Project-acceptance hooks, same-item remediation obligations, trusted review and Core effect recovery remain in the composed path.

## Implemented slice

The concrete Backend application now separates read-only preparation from Worker/Core execution:

```text
prepareBackendObjective
  -> validated BackendObjective
  -> exact BackendWorkOrder
  -> Oracle-resolved BackendContext

runPreparedBackendObjective / recoverPreparedBackendObjective
  -> BackendWorker
  -> existing Core effect/evidence semantics
  -> existing Backend completion policy
```

The old `runBackendObjective(...)` and `recoverBackendObjective(...)` APIs remain wrappers over the same path.

`createDurableBackendQaWorkflow(...)` uses the preparation phase to distinguish source-resolution failure from effectful Worker failure. A repository/context outage before Worker entry persists the exact Backend checkpoint as `BLOCKED` and records a source blocker instead of leaving unexplained `CLAIMED` state.

## Recovery fence

Interrupted Backend takeover persists `backendRecoveryRequired=true` when source context is unavailable. After source recovery, normal `advance(...)` sees that durable marker and re-enters `recoverPreparedBackendObjective(...)`; it cannot silently downgrade the interrupted mutating attempt into fresh execution.

The same marker remains true when `BackendWorker.recover(...)` itself blocks on unresolved Core effect/session truth. It is cleared only after recovery yields a normal Backend result and ordinary application completion proceeds.

## Compatibility

- no generic Worker/Context abstraction added;
- no Core public API widened;
- Oracle remains source IO owner;
- QA path remains unchanged;
- Backend completion/evidence policy remains unchanged;
- BB-019 project-acceptance persistence/review/remediation hooks remain composed around the same role-completion path;
- project review/Blackboard DONE authority remains unchanged.

## Regression/value gate

`packages/agentic-system/test/bb032-composition-boundary-research.test.js` is converted from the BB-032 baseline/prototype probe into post-fix regression coverage:

1. ordinary repository outage -> durable `BLOCKED`, Worker calls remain zero, resume returns to normal Backend execute after source recovery;
2. repository outage during interrupted recovery -> durable `BLOCKED` with `backendRecoveryRequired=true`, Worker calls remain zero, resume re-enters Backend recover rather than execute.

The full repository matrix additionally guards existing Backend recovery and BB-019 project-acceptance behavior, including confirmed/idempotent/non-reconcilable effect semantics, same-item remediation and trusted project review.

## Evidence limits

This is repository-level deterministic evidence. It establishes the concrete composition fix and authority preservation. It does not establish production failure frequency or production effectiveness, and it does not reopen D005 or justify a shared lifecycle facade.
