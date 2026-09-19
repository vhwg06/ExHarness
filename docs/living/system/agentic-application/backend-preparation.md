# Backend preparation and durable recovery boundary

This file describes the Backend preparation behavior implemented in the Agentic Application today.

## Concrete preparation boundary

Backend source resolution is an explicit read-only phase before the mutating Worker/Core boundary:

```text
BackendObjective
  -> prepareBackendObjective(...)
       -> validate objective
       -> make BackendWorkOrder
       -> Oracle resolveBackendContext(...)
  -> prepared { objective, order, context }
  -> runPreparedBackendObjective(...)
       or recoverPreparedBackendObjective(...)
  -> BackendWorker / ExHarness Core
  -> ordinary Backend completion policy
```

`runBackendObjective(...)` and `recoverBackendObjective(...)` remain compatibility wrappers over this same preparation path. The prepared boundary is Backend-specific; it does not introduce a generic Worker/Context registry, lifecycle facade, role runtime or workflow DSL.

Prepared input is revalidated before Worker execution. The prepared WorkOrder must exactly match the prepared objective, and the prepared context must satisfy `BackendContextSchema`.

## Durable workflow handling

`createDurableBackendQaWorkflow(...)` performs Backend preparation after claiming the current work generation but before entering the Worker.

If Oracle/repository resolution fails in that phase:

```text
CLAIMED
  -> Backend preparation fails
  -> Worker/Core not entered
  -> persist same Backend stage checkpoint
  -> BLOCKED with source-resolution blocker
```

The failure therefore survives process/session handoff instead of leaving an unexplained `CLAIMED` item.

After source recovery, `resume(...)` returns the item to `REOPENED` and the same durable stage is attempted again.

## Recovery-required mode

A source outage during an interrupted Backend takeover is different from an ordinary preflight outage. The old attempt may already have durable Core effect/session state even though the replacement process cannot currently resolve source context.

The Backend checkpoint therefore carries `backendRecoveryRequired`:

```text
ordinary Backend preflight failure
  -> backendRecoveryRequired = false
  -> resume later enters normal prepared execution

recoverClaim(...) / interrupted Backend recovery
  -> preparation fails
  -> backendRecoveryRequired = true
  -> resume later re-enters prepared Backend recovery
  -> Core effect/session reconciliation still decides retry authority
```

A recovered source cannot silently convert an interrupted mutating attempt into fresh execution.

If `BackendWorker.recover(...)` itself blocks because effect/session truth is insufficient, the checkpoint also retains `backendRecoveryRequired = true`. A later resume therefore continues recovery rather than bypassing it.

Once recovery returns a normal Backend result, the recovery-required marker is cleared before ordinary completion/checkpoint progression.

## Authority invariants

- Oracle owns repository IO/adaptation and still fails rather than fabricating context.
- Source-resolution failure before Worker entry is application lifecycle state, not Core effect truth.
- Worker/Core failures are not flattened into source blockers.
- `claimGeneration` continues to decide who may commit application state; it does not decide whether a mutating effect may be retried.
- Core persisted session/effect state continues to decide recovery/replay authority for mutating Backend execution.
- Backend role completion still requires the same grounded mutation/typecheck/test/artifact evidence and completion policy.
- Backend acceptance, QA acceptance and Blackboard `DONE` remain separate authorities.

## Regression coverage

`packages/agentic-system/test/bb032-composition-boundary-research.test.js` now acts as the post-BB-033 regression for the research finding:

- ordinary source failure becomes durable `BLOCKED` before Worker execution and resumes into normal execution after the source returns;
- source failure after interrupted takeover becomes durable `BLOCKED` with recovery-required mode, and resume re-enters `BackendWorker.recover(...)` rather than `execute(...)`.

Existing Backend recovery tests continue to cover confirmed, idempotent/ambiguous and non-reconcilable effect semantics. This boundary does not change those Core rules.
