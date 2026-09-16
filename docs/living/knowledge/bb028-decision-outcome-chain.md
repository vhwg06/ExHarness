# BB-028 — Decision-to-outcome chain research

Status: **EVIDENCE / JUDGMENT CANDIDATE**

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

### Core already contains the semantic pieces

`createDeliberationStore(...).createStep(...)` persists a bounded `DeliberationArtifact` containing `judgment`, source/context refs, intent, expected outcome, success condition, constraints and the exact `ActionIntent` ref. The `judgment` field is intentionally opaque application-provided structured data; no raw chain-of-thought field exists.

`ActionIntent` separately persists the concrete action, expected outcome, success condition, authorization decision/policy/evidence refs, status and outcome refs. `createDeliberationController(...)` authorizes before execution and records outcome artifact refs only after authorization.

`createActionIntentEffectController(...)` can link the exact effect-operation ref to the authorized `ActionIntent`; confirmed effect state is still distinct from verification/evaluation success.

Grounded cognition separately requires persisted sources. A `REFLECTION` cannot activate without a fresh persisted evaluation source, and intent/reflection alignment records the exact intent/reflection/grounding/evaluation refs plus `ALIGNED | DIVERGED | INDETERMINATE` state. None of these artifacts is acceptance authority.

### The Backend/QA application does not currently correlate those pieces

The durable Backend/QA remediation checkpoint persists the accepted Backend handoff, completion-decision ref, QA issues and Board artifact/evidence refs. On QA `CONTINUE`, the workflow records the QA decision and a remediation obligation, then redispatches Backend remediation.

That checkpoint does not carry `DELIBERATION`, `ACTION_INTENT`, effect-operation, semantic-memory, grounding or alignment refs. Conversely, current Core cognition artifacts do not carry a Blackboard work-item correlation contract.

Therefore a fresh reviewer has two bad choices today:

1. use the bounded application handoff and fail closed because the decision chain is not discoverable; or
2. load/search a larger raw artifact set and manually correlate independent stores/refs.

There is no current source-backed reason to add a global artifact graph or a new Core lifecycle facade merely to solve this projection problem.

## Deterministic probe

`bb028-decision-outcome-probe.mjs` models the current repository shapes for one failed remediation attempt and asks five orientation questions:

1. Which action was selected?
2. How many alternatives were explicitly considered?
3. Was the action authorized?
4. What observed outcome followed?
5. Did grounded reflection align with the intended fix?

The fixture intentionally represents a partial remediation failure: the selected invalidation patch executes, but fresh evaluation finds a second stale-write path and the grounded alignment is `DIVERGED`.

The checked-in output is `artifacts/bb028-decision-outcome-probe.json`.

| Mode | Context chars | Artifact reads for orientation | Correlation joins | Correct | Incorrect | Unknown |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Current bounded handoff | 623 | 1 | 0 | 0 | 0 | 5 |
| Raw full graph | 3,967 | 9 | 7 | 5 | 0 | 0 |
| Proposed bounded summary | 1,527 | 1 | 0 | 5 | 0 | 0 |

The summary is about 61.5% smaller than the synthetic raw graph while keeping the five orientation answers explicit. This is **deterministic fixture evidence only**; `productionEvidence=false`. It does not establish model-quality improvement, production token savings or lower human review time.

The zero incorrect count is also important: the current bounded handoff is scored fail-closed as `UNKNOWN`, not optimistically guessed. The proposed summary improves bounded answerability and correlation effort; it is not evidence that a reviewer becomes intrinsically more correct.

## Accepted research direction candidate

Use one **application-level immutable decision/outcome summary per completed remediation attempt**. Do not add a new Core primitive yet.

Candidate artifact kind:

```text
DECISION_OUTCOME_SUMMARY v1
```

Minimum bounded shape:

```text
workItemId
objective
hypothesis
alternatives[]
decision:
  selected
  concise rationale
  uncertainty[]
  deliberationRef
action:
  actionIntentRef + revision
  authorization decision + policy revision + evidenceRefs
  outcomeRefs[]
observedOutcome:
  status
  concise statement
  evaluation/verification refs
reflection:
  reflectionRef
  groundingRef
  alignmentRef
  alignment status/divergence
counterEvidenceRefs[]
authority:
  rationaleIsCorrectnessEvidence=false
  summaryIsAcceptanceAuthority=false
  acceptanceMustResolveEvidenceRefs=true
```

The summary is a bounded projection/index over existing artifacts. It may copy concise human-readable fields for orientation, but every correctness-relevant claim retains exact refs to the underlying persisted evidence/decision artifacts.

## Authority rules

The following invariants are required for BB-029 if this direction is accepted:

- explicit alternatives/rationale are bounded structured decision metadata, never raw/private chain-of-thought;
- rationale explains a choice but cannot prove the action worked;
- `EXECUTED`/confirmed effect cannot be rewritten as verification success;
- observed outcome must cite persisted verification/evaluation refs;
- grounded reflection must retain its grounding/evaluation lineage;
- contradictory or stale evidence is listed, not summarized away;
- a missing required ref leaves the summary incomplete/fail-closed rather than fabricating a conclusion;
- the summary never authorizes an action, changes Blackboard lifecycle state, or satisfies independent acceptance by itself;
- independent acceptance still resolves and verifies the exact evidence/decision/attestation refs required by the applicable policy.

## Why application-level, not Core

The concrete pressure is a Backend/QA review/continuation projection. Core already provides the lower-level artifacts and authority boundaries. A generic `DecisionOutcomeGraph`, registry or lifecycle engine would generalize before a second real consumer exists and would risk conflating explanation/correlation with evidence or acceptance.

The pilot should therefore live at the Agentic Application artifact-composition boundary and consume Core refs without changing their semantics.

## BB-029 implementation handoff

If architecture/evaluation review accepts this research result, BB-029 should implement exactly one Backend/QA remediation pilot:

1. pass a bounded structured `judgment` containing hypothesis/options/selection/rationale/uncertainty into existing Core deliberation;
2. retain exact `ActionIntent` authorization and outcome refs;
3. after fresh post-action evaluation + grounded reflection/alignment, materialize one immutable `DECISION_OUTCOME_SUMMARY` artifact;
4. attach only the summary ref to the relevant application/Board continuation or review artifact path;
5. let fresh reviewers orient from the summary and resolve exact underlying refs only when needed;
6. test missing/stale/contradictory evidence and ensure the summary cannot satisfy action authorization or acceptance authority;
7. rerun the deterministic comparison and report costs/limitations without promoting fixture numbers to production evidence.

No Core schema change is justified by BB-028 alone.

## Conclusion

The repository already has enough semantic primitives to represent a decision-to-outcome chain, but not a bounded application correlation surface. The evidence supports a **small application projection artifact**, not another engine. The value demonstrated by the fixture is bounded discoverability and lower reconstruction/context cost; correctness continues to come from the underlying authorization, effect, evaluation, grounding and acceptance boundaries.
