# Bounded project work selection

This document describes the delivered opt-in BB-031 Agentic Application work-selection surface. It is current source-backed behavior, not the research roadmap and not a production-effectiveness claim.

## Position in the application

```text
SessionHandoffSurface.read()
  -> lifecycle.eligibleWork
  -> createBoundedProjectWorkSelector(...).propose(...)
  -> persisted WORK_SELECTION_DECISION v1
  -> caller validates freshness
  -> ordinary ApplicationOrchestrator.claim(...)
```

The selector runs above the existing Blackboard eligibility projection. It never makes blocked, dependency-ineligible, review-stage or otherwise non-eligible work claimable.

The selector does not call `claim`, `checkpoint`, `submit`, `requireReview`, `recordAssessment`, `reconcileFinding`, `DONE`, or any other Blackboard mutation. `ApplicationOrchestrator` remains the lifecycle-transition authority and performs its ordinary fresh eligibility/dependency check when a caller later claims the selected item.

## Opt-in policy

`defineBoundedWorkSelectionPolicy(...)` defines one explicit policy instance with:

- name and revision;
- configuration ref;
- selection budget;
- maximum deferrals before fairness fencing;
- retry ceiling;
- plateau window;
- explicit score weights.

There is no runtime-default scheduler. Disabling the caller-side use of this surface returns the application to explicit/manual selection over `lifecycle.eligibleWork`; no Blackboard schema migration is required.

## Authority-first selection order

The delivered policy evaluates only current `eligibleWork` and applies this order:

```text
1. current Blackboard eligibility
2. mandatory obligations
3. starvation fence
4. bounded score among complete affordable measurements
5. original eligible-work order as deterministic tie break
```

A measurement may carry:

```text
itemId
userPriority
mandatoryObligations[]
deferrals
signals {
  userImpact
  defectSeverity
  dependencyUnblocks
  evidenceConfidence
  cost
}
```

Every numeric signal must declare `source: OBSERVED | ESTIMATED`. A signal may also retain an `evidenceRef`. Missing values remain listed in `missingSignals`; they are never coerced to zero for ranking.

Existing review requirements are copied into the scheduling measurement record for provenance, but a score cannot satisfy or waive them.

## Mandatory work

Mandatory obligations are hard scheduling fences.

If mandatory eligible work lacks a required measurement, selection returns no item and emits `ESCALATE` with `MANDATORY_MISSING_MEASUREMENT` rather than choosing cheaper optional work.

If the highest mandatory eligible item exceeds the remaining budget, selection returns no item and emits `ESCALATE` with `MANDATORY_BUDGET_CONFLICT` rather than treating budget exhaustion as completion or substituting optional work.

## Fairness and scoring

When no mandatory item controls the decision, an affordable fully measured item at or beyond `maxDeferrals` is selected by `STARVATION_FENCE` before ordinary scoring.

Otherwise the configured score combines the declared measurements and preserves their original `OBSERVED` / `ESTIMATED` provenance in the decision artifact. The score is scheduling evidence only. It is not task correctness, review acceptance or lifecycle evidence.

## Stop and escalation

`decideProjectWorkContinuation(...)` returns only:

```text
CONTINUE | STOP | ESCALATE
```

Current rules include:

- stale or contradictory evidence -> optional `STOP`, mandatory `ESCALATE`;
- mandatory next cost above remaining budget -> `ESCALATE`;
- retry ceiling -> optional `STOP`, mandatory `ESCALATE`;
- plateau window of non-improving observed deltas -> optional `STOP`, mandatory `ESCALATE`;
- otherwise -> `CONTINUE`.

`STOP` and `ESCALATE` are scheduling outcomes. They do not mutate Blackboard status and do not imply `DONE` or `SUPERSEDED`.

## Decision artifact and persistence

`createJsonWorkSelectionDecisionStore(...)` persists immutable content-addressed `WORK_SELECTION_DECISION v1` artifacts outside Blackboard payload state.

A decision records:

- stable project id;
- policy name/revision/configuration ref and concrete configuration;
- explicit/manual baseline policy revision and candidate policy revision;
- exact input snapshot digest and eligible item ids;
- excluded/non-eligible items with reasons;
- per-item measurements, missing fields, signal provenance and review requirements;
- selected item id or null;
- reason and score components when applicable;
- budget state;
- stop/escalation outcome when applicable;
- `productionEvidence: false`;
- explicit authority flags stating that selection does not mutate Blackboard or establish correctness.

A fresh store instance can reload a decision by `{ id, digest }`.

## Freshness

The decision input digest covers the project identity, user intent, full handoff work graph and current eligible item ids.

`selector.assertFresh(decisionRef)` reloads the decision and compares it with a newly read handoff. Any Board/input change makes the old decision stale and it fails closed instead of being applied as current scheduling evidence.

Even a fresh decision does not claim work. The caller still invokes ordinary `ApplicationOrchestrator.claim(...)`, which re-checks current status and dependencies inside canonical Board mutation authority.

## Verification boundary

`packages/agentic-system/test/bb031-work-selection.test.js` covers:

- non-eligible high-score work cannot enter selection;
- mandatory obligations remain hard gates;
- missing values are never invented;
- starvation fencing precedes ordinary scoring;
- optional stop versus mandatory escalation;
- stale decisions fail after Board changes;
- ordinary claim still rejects work that became ineligible/claimed;
- decision artifacts survive fresh-store reconstruction;
- the actual selector replays the accepted BB-030 deterministic comparison at equal budget: fixture outcome `11 -> 13` and blocked-work reduction `2 -> 3`.

That comparison remains deterministic fixture evidence only. It does not establish representative project benefit, production cost/latency improvement, universal score weights or a reason to make the selector the default scheduler.

## Boundaries

This delivery does not introduce:

- a Core scheduler;
- a workflow DSL;
- a generic PM runtime;
- selector-owned claim/completion authority;
- score-derived correctness evidence;
- automatic review waiver;
- production/default scheduler promotion.

Core search-investment remains scoped to variation investment inside one Core session. BB-031 project work selection remains an application-level choice among distinct already-eligible Blackboard obligations.
