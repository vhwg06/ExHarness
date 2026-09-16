# BB-030 — Application-level work prioritization and stopping research

Status: **EVIDENCE / JUDGMENT CANDIDATE**

## Question

Can ExHarness choose among simultaneously eligible Blackboard work using explicit user priorities, correctness obligations, dependency pressure and measured cost/outcomes, while preserving PM coordination and Orchestrator lifecycle authority and without reusing Core search-investment as a project scheduler?

## Scope

This research is bounded to project-level selection among already-eligible work and to per-item continuation/stop/escalation rules.

It does **not**:

- change Blackboard eligibility rules;
- let a score bypass dependencies, review obligations, user constraints or correctness gates;
- let a selector `claim`, complete, reopen or supersede work;
- replace PM coordination authority;
- replace Core search-investment inside one AVO/Core session;
- claim production effectiveness from fixture-only measurements.

## Current source boundary

### There is no project-level scheduler today

`sessionHandoffFromBlackboard(...)` derives `lifecycle.eligibleWork` by filtering `READY | REOPENED` items whose dependencies are done. The filter preserves Board/work-graph order; it does not rank by impact, severity, dependency unblocking, cost or user priority.

That is a useful handoff surface, not a scheduling policy. The session protocol says to choose eligible unresolved work but does not define a runtime project-selection algorithm.

For the deterministic probe, the baseline is therefore the smallest possible consumer policy: **take the first affordable eligible item in exported Board order**. This is a reference baseline, not a claim that all current human/agent sessions literally use FIFO.

### Core search-investment is a different authority plane

`packages/core-harness/src/search-investment.js` evaluates history inside one Core session and returns `CONTINUE | STOP | ESCALATE` for further variation search. It binds decisions to candidate/evaluation history and freshness.

Project work selection instead compares distinct Blackboard items with user/dependency/project semantics. Reusing Core search-investment as the project scheduler would conflate two scopes:

```text
Core search investment
  = should this current candidate/variation search continue?

Application work selection
  = which already-eligible project obligation should be claimed next?
```

BB-030 therefore keeps the two policies separate.

## Inputs and provenance

A bounded project selector may consume only explicit, attributable signals. Every numeric signal carries whether it is `OBSERVED` or `ESTIMATED`; missing values remain missing.

Candidate input classes:

| Signal | Meaning | Typical provenance |
| --- | --- | --- |
| user priority | explicit project/user sequencing importance | user intent / PM policy |
| correctness obligation | safety/integrity work that cannot be traded away | acceptance/review contract |
| defect severity | concrete failure impact | reproduced defect/evidence |
| dependency unblocks | work made eligible by completing the item | Blackboard graph |
| user impact | expected acceptance-goal contribution | explicit estimate until measured |
| evidence confidence | confidence in the impact/severity estimate | evidence-backed estimate |
| cost | observed or estimated execution/resource cost | run history/provider/runtime |
| deferral age | how many eligible selections skipped this item | scheduling history |

An estimate is allowed as an estimate; it must not be relabeled as an observation. A missing required ranking signal is not coerced to zero.

## Candidate policy

The replayable probe uses `bounded-project-selection@1` with a cost budget of `5`, maximum `3` deferrals, retry ceiling `2` and plateau window `2`.

Selection is ordered by authority before score:

```text
1. ordinary Blackboard eligibility/dependency gates
2. mandatory correctness/user constraints
3. starvation fence for non-mandatory work at max deferrals
4. bounded score among remaining measurable candidates
5. deterministic Board-order tie break
```

The fixture score combines explicit user impact, observed defect severity, dependency unblocking, evidence confidence, declared user priority, cost and bounded age. The exact weights are experiment configuration, not architecture truth.

Critical invariant:

```text
score cannot make ineligible work eligible
score cannot waive mandatory work
score cannot waive a required review
score cannot mutate lifecycle state
```

If mandatory work exceeds the remaining budget, the policy escalates the budget conflict rather than silently selecting a cheaper low-value task as a substitute.

## Stopping and escalation

Selection and continuation need explicit budgets or the system can spend indefinitely on locally attractive work.

Candidate rules:

- retry ceiling: `2` attempts per bounded item experiment;
- plateau window: `2` consecutive non-improving observed deltas;
- optional work at plateau/retry ceiling may `STOP` with evidence;
- mandatory work at plateau/retry ceiling must `ESCALATE`, not disappear;
- mandatory work that cannot fit the remaining budget must `ESCALATE`;
- stale or contradictory evidence cannot justify further scoring; optional work stops/defer-fails-closed, mandatory work escalates;
- a stopped item is not automatically `DONE` or `SUPERSEDED`; the Orchestrator/PM must reconcile the scheduling result into ordinary lifecycle semantics.

## Starvation rule

Pure score ranking can repeatedly choose new cheap/high-scoring tasks. The candidate therefore adds a bounded fairness fence:

```text
non-mandatory item eligible but skipped >= 3 selections
  -> choose it before ordinary scored work
  -> unless mandatory correctness/user-constrained work exists
```

This is intentionally a fence, not an unbounded age bonus that could eventually outrank hard correctness obligations.

## Deterministic replay

Runnable artifact:

```text
node docs/living/knowledge/bb030-work-prioritization-probe.mjs
```

Checked result:

`artifacts/bb030-work-prioritization-probe.json`

The controlled workload contains two cheap low-value items before a mandatory correctness fence and a review-pipeline task. Both policies receive the same cost budget.

| Measure | Board-order baseline | Bounded candidate | Delta |
| --- | ---: | ---: | ---: |
| cost spent | 5 | 5 | 0 |
| observed fixture outcome | 11 | 13 | +2 |
| blocked-work reduction | 2 | 3 | +1 |

The candidate selects the correctness fence first, then the dependency-unblocking review task. The baseline spends two units on cheap low-value work before reaching the correctness item.

Additional controlled checks:

- an eligible P2 item deferred three times is selected through `STARVATION_FENCE` ahead of a new high-score non-mandatory item;
- a task with missing cost is returned as `MISSING_MEASUREMENT`; the probe records `inventedValue=false`;
- optional plateau -> `STOP`;
- mandatory plateau -> `ESCALATE`;
- mandatory budget exhaustion -> `ESCALATE`;
- stale optional evidence -> `STOP`/defer rather than fabricate a fresh score.

## What the probe establishes

Evidence class: `DETERMINISTIC_REFERENCE`.

It demonstrates that a bounded application policy can be replayed with explicit inputs, hard gates, fairness and stop/escalation semantics, and that on this fixture it improves observed fixture outcome and dependency unblocking at equal cost.

It does **not** establish:

- production task-success improvement;
- correct universal weights;
- real cost/latency savings;
- that Board-order selection is harmful on representative projects;
- that ranking estimates are correctness evidence;
- that BB-031 should become a default scheduler.

Representative project runs remain necessary before any production/default effectiveness conclusion. BB-005 remains the owner of broader production-effectiveness claims.

## Minimal application boundary

If accepted for BB-031, implement one opt-in project-selection pilot above the session-handoff/Blackboard eligibility surface.

Suggested decision artifact:

```text
WORK_SELECTION_DECISION v1

projectId
policy { name, revision, configurationRef }
boardRevision / inputSnapshot
eligibleItemRefs[]
excluded[] { itemId, reason }
measurements[] {
  itemId
  userPriority
  mandatoryObligations[]
  signals { value, source: OBSERVED | ESTIMATED }
  missingSignals[]
  deferrals
}
selectedItemId | null
reason
scoreComponents | null
budget { limit, observedSpent, remaining }
stopOrEscalation | null
```

The artifact is scheduling evidence/provenance only. It is not acceptance evidence for the selected implementation and not a lifecycle transition.

The execution path remains:

```text
SessionHandoff eligibleWork
  -> PM/application selection policy proposes selectedItemId
  -> Orchestrator re-checks eligibility and performs ordinary claim
  -> Worker/review lifecycle proceeds unchanged
```

Fresh selection must use a fresh Board/input revision. A stale decision is recomputed rather than applied to changed project state.

## BB-031 handoff

If architecture/evaluation review accepts the boundary, BB-031 should remain concrete:

1. implement one opt-in selection service over the existing handoff projection; default remains current explicit/manual selection;
2. persist `WORK_SELECTION_DECISION` outside the Blackboard payload and reference it as scheduling evidence when useful;
3. keep eligibility/claim/review/DONE authority in the Orchestrator;
4. preserve mandatory constraints before scoring and add max-deferral fairness;
5. persist signal provenance and distinguish observed vs estimated values;
6. add budget/retry/plateau/escalation tests, including stale-input and missing-metric cases;
7. replay the fixed baseline/candidate scenarios and add representative project runs before recommending any default;
8. rollback by disabling the opt-in policy; no Board migration should be required.

No shared Core scheduler, workflow DSL or global scoring framework is justified by BB-030 alone.

## Conclusion

A project-level prioritization pilot is technically justified as a narrow **Agentic Application/PM scheduling policy**, not as Core search-investment and not as a new lifecycle authority. The fixture supports explicit hard-gated prioritization plus bounded stopping/fairness semantics as an implementable experiment. Production adoption remains evidence-gated.