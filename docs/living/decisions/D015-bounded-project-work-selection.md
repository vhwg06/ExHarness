# D015 — Bounded project work selection

Status: **ACCEPTED**

Accepted: 2026-09-16

Acceptance boundary: BB-030 architecture-boundary and evaluation-method reviews passed exact head `d103d4547181a3d166a0c2f1f0a1c29d4af3289c`; Actions run #1614 was green and PR #94 merged as `a4dead599ccbaac72995bb01e5bb4bc874f48dda`.

## Context

The Agentic Application exposes durable Blackboard lifecycle state and `eligibleWork`, but it does not currently define a project-level scheduling policy. Core search-investment controls whether search inside one Core session should continue; it is not a project scheduler.

BB-030 asks whether application-level work selection can use explicit user priorities, correctness obligations, dependency pressure, evidence confidence and cost without weakening lifecycle authority or inventing measurements.

A deterministic reference probe shows one bounded policy can improve fixture outcome/dependency unblocking at equal cost while preserving hard correctness gates, starvation protection and explicit stop/escalation semantics. This remains fixture evidence, not production effectiveness.

## Decision

The first BB-031 pilot should use an **opt-in Agentic Application/PM work-selection policy above the existing Blackboard eligibility surface**.

The policy may rank only already-eligible work. It may produce a referenced `WORK_SELECTION_DECISION` artifact, but it does not own Blackboard transitions.

Selection order is authority-first:

1. existing Blackboard eligibility and dependency gates;
2. mandatory correctness/user constraints;
3. bounded starvation fence;
4. configured score among measurable candidates;
5. deterministic tie break.

Every scoring signal must retain provenance as `OBSERVED` or `ESTIMATED`. Missing values remain missing and cannot be silently replaced by zero/default values for ranking.

## Authority

The policy may answer:

```text
which currently eligible item should the application propose to claim next?
should optional investment stop, continue or defer?
when must mandatory unresolved work escalate because the configured budget/attempt limit is exhausted?
```

It may not:

- make blocked/ineligible work eligible;
- waive dependencies or user constraints;
- waive required review/acceptance;
- claim or complete work directly;
- convert a scheduling score into correctness evidence;
- change Core promotion/evaluation authority;
- treat a mandatory obligation as completed merely because its budget was exhausted.

The Orchestrator must re-check current Board eligibility before the ordinary claim transition. Stale selection artifacts must be recomputed against a fresh Board/input revision.

## Stopping/fairness boundary

The first pilot should expose explicit configuration for:

- total/selection budget;
- per-item retry ceiling;
- plateau window based on observed outcome deltas;
- maximum eligible deferrals before fairness fencing;
- escalation behavior for mandatory work that hits retry/plateau/budget limits.

Optional work may stop/defer under an accepted stopping rule. Mandatory work escalates instead of disappearing from the project lifecycle.

## Separation from Core search-investment

```text
Core search-investment
  -> one session/candidate's further variation investment

Application work selection
  -> choice among distinct eligible Blackboard obligations
```

They may reuse general vocabulary such as budget or plateau, but they must not share authority/state merely because the concepts look similar.

## Adoption boundary

BB-031 remains an opt-in bounded pilot with the existing explicit/manual selection path as fallback. Fixture improvements do not justify a production/default scheduler. A default recommendation requires representative measured project evidence with hard correctness gates still passing.

## Rollback

Disable the opt-in policy and return to ordinary eligible-work selection. The first pilot should not require Blackboard schema migration or reinterpret historical lifecycle state.

## Evidence

- `docs/living/knowledge/bb030-work-prioritization.md`
- `docs/living/knowledge/bb030-work-prioritization-probe.mjs`
- `artifacts/bb030-work-prioritization-probe.json`
- PR #94 architecture-boundary review PASS on exact head `d103d4547181a3d166a0c2f1f0a1c29d4af3289c`;
- PR #94 evaluation-method review PASS on the same exact head;
- exact-head Actions run #1614 green;
- merge commit `a4dead599ccbaac72995bb01e5bb4bc874f48dda`.

## Promotion boundary

`ACCEPTED` approves the bounded BB-031 pilot contract only. It does **not** make project work selection a runtime default or production-proven scheduler. Runtime promotion requires implementation plus representative evidence beyond the deterministic fixture.
