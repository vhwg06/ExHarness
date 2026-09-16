# Durable Backend Advisor coordination

This document describes the current source-backed application contract for Backend Advisor continuation inside `createDurableBackendQaWorkflow(...)`.

## Authority boundary

`BackendAdvisor` remains a bounded judgment boundary. It may propose:

```text
RETRY_IMPLEMENTATION
REQUEST_CONTEXT
ESCALATE
```

Advisor output does not mutate Blackboard lifecycle, accept Backend work, bypass QA, or authorize `DONE`. The durable application workflow interprets a validated proposal and owns the resulting lifecycle transition.

## Durable continuation mapping

```text
Backend completion = CONTINUE
  |
  +-- no Advisor / deterministic CONTINUE --> same Backend stage, REOPENED
  |
  +-- Advisor RETRY_IMPLEMENTATION --------> same Backend stage, REOPENED
  |
  +-- Advisor REQUEST_CONTEXT / ESCALATE
       -> persist BACKEND_COORDINATION_PENDING
       -> Blackboard BLOCKED
       -> no Backend redispatch until explicit application resolution
```

The coordination checkpoint stores the bounded Advisor action, gap ids, context needs, rationale, original Backend stage, attempt and Backend completion-decision provenance. A fresh session can therefore distinguish an eligible retry from unresolved application coordination without prior conversation context.

## Context request resolution

`REQUEST_CONTEXT` is not permission for Oracle or the Advisor to widen source scope. `resolveBackendCoordination(...)` requires the application to map the request to one or more declared repository files. Only after those files are added to the persisted Backend objective does the original Backend stage become `REOPENED` and eligible for another claim.

## Escalation resolution

`ESCALATE` persists the unresolved requirement until `resolveBackendCoordination(...)` receives an explicit resolver identity and rationale. Resolution records provenance and makes only the original Backend stage eligible again. It does not record acceptance of the previous Backend result.

## Atomic blocked-checkpoint transition

The public Application Orchestrator exposes `resolveBlockedCheckpoint(...)` for this application-owned transition.

It requires:

- current item status is still `BLOCKED`;
- the item has no active owner;
- the caller's exact expected checkpoint still matches current durable state;
- the replacement checkpoint is supplied explicitly.

Checkpoint replacement, blocker clearing and `REOPENED` transition occur in one guarded store transaction. A stale expected checkpoint or competing committed successor fails closed without an intermediate `resume -> claim -> checkpoint` state.

The transition runs through the same terminal-cancellation guard and public Blackboard store stack as ordinary orchestration. A `SUPERSEDED` item therefore cannot be revived through coordination resolution. Persisted-value, dependency-graph and immutable single-successor store invariants remain in force.

## Interaction with interrupted recovery

Backend coordination and interrupted execution are separate states:

- `BACKEND_COORDINATION_PENDING` is intentionally `BLOCKED`, ownerless application coordination;
- `recoverInterrupted(...)` applies only to an interrupted `CLAIMED` execution attempt;
- generation fencing still determines which execution attempt may commit;
- mutating Backend recovery still requires durable Core effect truth before redispatch.

A blocked coordination requirement cannot be converted into execution authority through generic `resume(...)` or interrupted-recovery APIs.

## Completion invariant

Advisor proposal, coordination persistence and coordination resolution are continuation semantics only.

```text
Advisor proposal
  != Backend acceptance
  != QA acceptance
  != Blackboard review acceptance
  != Blackboard DONE
```

A later Backend attempt still passes the ordinary lineage, evidence and completion policy, and accepted Backend work still must flow through QA and project review requirements.
