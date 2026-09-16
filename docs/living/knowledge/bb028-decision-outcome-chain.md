# BB-028 — Decision-to-outcome chain research

Status: **EVIDENCE / JUDGMENT CANDIDATE — REVIEW FINDING REMEDIATED**

## Question

Can ExHarness make one Backend/QA remediation decision inspectable across sessions by composing existing Core deliberation, ActionIntent, effect, evaluation and grounded-reflection artifacts, without introducing a new correctness authority or a generic reasoning engine?

## Scope

This research is intentionally bounded to one concrete remediation shape:

```text
QA reports a defect
  -> Backend chooses one remediation action among explicit alternatives
  -> action is authorized
  -> action/effect executes
  -> fresh verification/evaluation observes the result
  -> grounded reflection records what actually happened
  -> intent/reflection alignment records divergence or alignment
  -> a later reviewer reconstructs the decision and outcome
```

It does not attempt to persist private chain-of-thought, replace review/acceptance, define project scheduling, or create a generic workflow DSL.

## Source observations

Core already contains the lower-level semantic pieces: bounded deliberation, ActionIntent authorization/outcome refs, effect truth, fresh evaluation-backed reflection, grounding and intent/reflection alignment. The durable Backend/QA remediation path still does not expose one bounded application correlation artifact linking those pieces for a fresh reviewer.

The concrete pressure remains application-side discoverability. A fresh reviewer either uses the current bounded handoff and cannot reconstruct the decision chain, or loads a larger raw artifact set and manually correlates independent refs. That does not justify a global artifact graph or new Core lifecycle surface.

## Review blocker reproduced

The original BB-028 fixture demonstrated only a consistent happy projection. A plausible summary was manually built from the same raw fixture and then scored against the same canonical answers. That did **not** prove the critical authority invariant:

```text
copied summary prose/fields
!=
correctness evidence
```

A stale, tampered, incomplete or contradictory summary could therefore have appeared useful without executable proof that correctness-relevant answers still required exact underlying artifacts.

The post-merge review finding on PR #88 correctly kept BB-028 unresolved and D013 `PROPOSED`.

## Remediated deterministic probe

`bb028-decision-outcome-probe.mjs` now separates two summary uses:

```text
summary orientation
  -> bounded discoverability only
  -> correctness answers remain UNKNOWN

summary verification
  -> resolve exact underlying refs/revisions
  -> derive correctness-relevant answers from underlying artifacts
```

The fixture still asks five bounded questions:

1. Which action was selected?
2. How many alternatives were explicitly considered?
3. Was the action authorized?
4. What observed outcome followed?
5. Did grounded reflection align with the intended fix?

Measured result:

| Mode | Context chars | Exact underlying reads for correctness | Correct | Incorrect | Unknown |
| --- | ---: | ---: | ---: | ---: | ---: |
| Current bounded handoff | 623 | 0 | 0 | 0 | 5 |
| Raw full graph | 3,967 | 8 orientation artifact reads | 5 | 0 | 0 |
| Proposed summary — orientation only | 1,527 | 0 | 0 | 0 | 5 |
| Proposed summary — verified | 1,527 | 8 | 5 | 0 | 0 |

The summary remains useful as a compact correlation surface, but its copied fields no longer score themselves correct. Correctness-relevant answers are derived only after exact underlying artifact resolution.

Evidence class remains `DETERMINISTIC_SYNTHETIC_REPOSITORY_SHAPE`; `productionEvidence=false`.

## Executable anti-laundering controls

The probe now executes seven adversarial controls against the same verification boundary:

| Control | Expected result |
| --- | --- |
| copied authorization conflicts with ActionIntent | fail closed |
| copied success conflicts with failing evaluation | fail closed |
| authorization evidence refs conflict with ActionIntent | fail closed |
| outcome refs conflict with ActionIntent | fail closed |
| underlying evaluation ref is unavailable | fail closed |
| ActionIntent revision is wrong | fail closed |
| current failing evaluation is omitted from counterevidence | fail closed |

Measured result:

```text
controlCount = 7
escapedControls = 0
```

Each rejected control records the exact violated invariant. No copied summary statement is accepted merely because it is internally plausible.

## Proposed bounded surface

Candidate artifact kind remains:

```text
DECISION_OUTCOME_SUMMARY v1
```

The summary is an immutable application-level projection/index over existing persisted artifacts. It may carry concise structured orientation data:

```text
objective
hypothesis
alternatives[]
selected action
concise rationale
uncertainty[]
exact refs/revisions for deliberation, ActionIntent, effects,
evaluation, reflection, grounding, alignment and counterevidence
```

It is not a source of truth.

## Authority rules

The executable probe now supports these invariants:

- explicit alternatives/rationale are bounded structured metadata, never private chain-of-thought;
- rationale cannot prove that an action worked;
- `EXECUTED` or confirmed effect cannot be rewritten as verification success;
- summary orientation is not correctness evidence;
- correctness-relevant answers require exact underlying reads;
- observed outcome must agree with the referenced evaluation;
- ActionIntent identity/revision and authorization must agree with the referenced artifact;
- authorization evidence refs and outcome refs must agree with the referenced ActionIntent;
- grounding/alignment must retain the current evaluation lineage;
- contradictory/current failing evidence cannot be omitted from counterevidence;
- missing underlying evidence fails closed;
- the summary never authorizes an action, changes Blackboard lifecycle state, or satisfies acceptance by itself.

## Why application-level, not Core

The pressure is still one Backend/QA review/continuation projection. Core already owns lower-level semantics and effect/evidence truth. A generic `DecisionOutcomeGraph`, registry, lifecycle facade or reasoning engine would generalize before a second real consumer exists.

## BB-029 handoff gate

BB-029 remains blocked until the BB-028 architecture-boundary and evaluation-method reviews accept this remediated exact-head evidence.

If accepted, the implementation handoff remains one concrete Backend/QA remediation pilot only:

1. produce bounded structured deliberation metadata through existing Core primitives;
2. retain exact ActionIntent/effect/evaluation/grounding/alignment refs;
3. materialize one immutable summary after fresh post-action evaluation and grounded reflection exist;
4. use the summary for bounded orientation/correlation only;
5. resolve exact underlying refs before correctness-relevant answers or acceptance;
6. keep stale/missing/contradictory negative controls as contract tests;
7. keep fixture metrics separate from production claims.

No Core schema change is justified by BB-028 alone.

## Artifacts

- `docs/living/knowledge/bb028-decision-outcome-probe.mjs`
- `artifacts/bb028-decision-outcome-probe.json`
- `docs/living/decisions/D013-bounded-decision-outcome-summary.md`

## Conclusion

The narrow application projection remains technically plausible, but its value is bounded discoverability/correlation only. The remediated evidence closes the specific anti-laundering proof gap by making correctness answers depend on exact underlying artifacts and by failing closed on seven stale/tampered/incomplete controls.

D013 remains `PROPOSED` until the required system reviews accept this exact remediation head.
