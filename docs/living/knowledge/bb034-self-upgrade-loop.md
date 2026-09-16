# BB-034 — Evidence-gated bounded self-upgrade research

Status: **EVIDENCE / JUDGMENT CANDIDATE**

## Question

Can ExHarness turn one observed project failure into a bounded candidate experiment using existing Core cognition, replay and trust primitives while preventing the candidate, reflection or experiment from changing its own evaluator, acceptance gate, user intent or rollout authority?

## Review correction

The first BB-034 probe merged in PR #95 before its required architecture/evaluation review was satisfied. Exact-head review found two semantic blockers:

1. the custom ActionIntent used `input` even though Core normalizes `CUSTOM` actions through `payload`, and its authorization policy returned `ALLOW` without validating scope;
2. the GroundingVerifier treated the presence of any `EVALUATION` ref as sufficient support for the failure reflection even though the persisted evaluation did not bind the BB-038 failure outcome.

Merge is not acceptance. D016 stayed `PROPOSED`, BB-034 stayed unresolved, and this research artifact records the corrected experiment contract.

## Existing source boundaries

The correction uses existing semantics rather than adding a self-improvement runtime:

- `grounded-cognition.js` resolves exact persisted source snapshots and separately enforces evaluation freshness;
- `deliberation-controller.js` gives the ActionIntent policy the full normalized `actionIntent` before operation execution;
- `deliberation.js` stores custom action data in `action.payload`;
- BB-038 supplies a deterministic recorded policy-replay artifact;
- trust artifacts separate evidence producer, evaluator and attestation identities;
- application/project acceptance remains outside the experiment.

## Corrected pilot

The historical target remains BB-024 late finding reconciliation after cancellation.

```text
recorded BB-038 failure
  -> persisted observation + evaluation bound to replay digest
  -> grounded REFLECTION
  -> stale-evaluation negative control
  -> DeliberationArtifact + CUSTOM ActionIntent
  -> exact payload authorization
  -> payload-tamper negative control
  -> mutation-action negative control
  -> target/development/recorded-holdout evaluation
  -> full budget check
  -> identity-separated trust contract
  -> PROPOSE_FOR_REVIEW | KEEP_BASELINE
```

No operation in the fixture mutates a live repository, runtime policy, Blackboard state or external system.

## Semantic failure grounding

The corrected persisted observation/evaluation include the exact:

```text
replay artifact ref
SHA-256 replay artifact digest
scenario id = cancellation-late-reconciliation
baseline final status = REOPENED
candidate final status = SUPERSEDED
failure code = TERMINAL_CANCELLATION_VIOLATED
```

The GroundingVerifier checks those values from resolved persisted sources. It no longer equates “has an evaluation ref” with “the evaluation supports this claim”.

The active candidate is then changed. Reusing the baseline evaluation is rejected by the existing Core freshness boundary before a new reflection can activate.

Value of this check:

```text
freshness prevents stale reuse
semantic verification prevents unsupported interpretation
```

Both are required.

## Exact experiment-only ActionIntent

The corrected ActionIntent is:

```text
target  = CUSTOM
name    = evaluation.compare-recorded-policy
payload = exact recorded experiment protocol
```

The payload contains:

- replay artifact ref + digest;
- baseline/candidate policy identities;
- target scenario;
- development controls;
- recorded holdout control;
- complete budget;
- `adoptionAuthority: false`.

The authorization policy compares the normalized ActionIntent against that exact payload before returning `ALLOW`.

Two negative controls demonstrate fail-closed scope:

- same action with widened/tampered budget payload -> rejected before operation runs;
- `repository.mutate` action -> rejected before operation runs.

This closes the gap where `authorizedScope: EXPERIMENT_ONLY` had previously been a report label rather than an enforced boundary.

## Experiment split

Fixed target:

```text
cancellation-late-reconciliation
```

Development controls:

```text
artifact-outage
retry-recorded-effect
```

Recorded holdout control:

```text
review-delay
```

The holdout is intentionally described as a **recorded control**, not genuinely unseen data. The replay artifact and candidate were already known in this research slice. It can test the stop-rule shape but cannot establish candidate generalization.

A negative fixture modifies only `review-delay`. Development remains passing while the holdout control fails. Required result:

```text
KEEP_BASELINE
```

## Budget

Predeclared budget:

```text
scenarios         = 4
policy identities = 2
repeat passes     = 2
external mutation = 0
```

The corrected probe verifies all four dimensions. The first probe did not check the policy-identity dimension explicitly.

## Trust evidence

The fixture creates different identities for evidence producer, evaluator and attestor and passes them through the existing trust policy.

This establishes an **identity-separated trust contract inside one deterministic process**. It does not establish independent teams/processes or production governance.

Trusted experiment result means only:

```text
the exact experiment claims were accepted under the exact fixture subject/policy
```

It does not authorize adoption.

## Measured corrected result

Expected checked artifact: `artifacts/bb034-self-upgrade-loop-probe.json`, schema version 3.

Expected properties:

```text
failureGroundingBoundToReplayDigest = true
staleEvaluationRejected             = true
actionPayloadPreserved              = true
tamperedPayloadRejected             = true
tamperedPayloadOperationRan         = false
mutationActionRejected              = true
mutationOperationRan                = false
targetFixed                         = true
developmentControlsStable           = true
heldOutStable                       = true
policyIdentityCount                 = 2
policyIdentityBudgetRespected       = true
budgetRespected                     = true
negativeHeldOutControlRejected      = true
negativeHeldOutStopReason           = KEEP_BASELINE
trusted                             = true
adoptionAuthorized                  = false
generalizationEvidence              = false
productionEvidence                  = false
```

## Interpretation

The corrected experiment supports a narrow architecture judgment only:

> Existing cognition, deliberation, replay and trust primitives can represent a bounded self-upgrade proposal loop when the observed failure is semantically grounded, the ActionIntent scope is actually enforced, evaluation membership/budget are fixed, and adoption remains outside experiment authority.

It does **not** show that ExHarness can autonomously generate good upgrades, generalize from held-out production tasks, safely mutate live systems, or choose rollout policy.

## BB-035 handoff

Even if BB-034 is accepted after fresh review, BB-035 remains conditional on BB-027 and BB-019.

A future implementation pilot must:

- use a currently accepted baseline, not the historical defective BB-024 policy, as rollback target;
- persist exact candidate/baseline/protocol revisions;
- resume experiments through durable research continuation;
- use independent application/project acceptance before adoption;
- keep failed/inconclusive evidence;
- obey fixed search/resource budgets;
- preserve user objective, review and rollout authority.

No generic SelfImprover framework is justified by this fixture.

## Review requirements

BB-034 remains unresolved until fresh exact-head reviews pass:

- architecture-boundary review;
- evaluation-method review.

CI success is necessary but not sufficient for either review.
