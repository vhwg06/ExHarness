# D016 — Self-upgrade experiments may propose adoption but never self-authorize rollout

Status: **ACCEPTED**

Proposed: 2026-09-16

Accepted: 2026-09-16

Acceptance boundary: BB-034 architecture-boundary and evaluation-method review both passed on exact remediation head `ca5157f8ecfa14a6deb95e4e7d8ecf63ba11295a` in PR #105. Exact-head CI #1695 was green, and the corrected research evidence merged on `main` as `854432d6af1aaac3fd27e49823ef2984923d1357`.

## Context

ExHarness already has separate primitives for grounded cognition, bounded deliberation and ActionIntent authorization, deterministic policy replay, and trust artifacts. BB-034 asks whether those primitives can compose one bounded improvement experiment without creating a second correctness or rollout authority.

The pilot uses the historical BB-024 late-reconciliation cancellation failure represented by the deterministic BB-038 replay artifact. The current terminal-cancellation behavior is already delivered; this experiment is research about the control loop, not a new implementation of BB-024.

## Decision

A self-upgrade attempt may produce an **adoption proposal** only after a fixed experiment passes its declared evaluation gates.

It may not accept, merge, deploy, select, or roll itself out.

```text
persisted observed failure
  -> semantically grounded REFLECTION
  -> bounded hypothesis
  -> DeliberationArtifact + ActionIntent
  -> exact EXPERIMENT_ONLY authorization
  -> fixed recorded experiment
  -> development controls
  -> predeclared recorded holdout-control schedule
  -> identity-separated evidence / evaluation / attestation
  -> PROPOSE_FOR_REVIEW | KEEP_BASELINE
  -> separate application/project acceptance
```

## Grounding contract

The reflection must be grounded against persisted source content that establishes the concrete failure, not merely against the existence of an `EVALUATION` ref.

For the BB-034 fixture, the persisted observation and evaluation bind to:

- the exact BB-038 replay artifact ref;
- its SHA-256 content digest;
- the `cancellation-late-reconciliation` scenario;
- baseline final status `REOPENED`;
- candidate final status `SUPERSEDED`;
- the failure code representing violation of terminal cancellation.

The GroundingVerifier validates those fields. Changing the active candidate makes the baseline evaluation stale and the reflection cannot be reactivated from it.

```text
fresh evaluation ref != semantically grounded claim
```

Both freshness and claim support are required.

## Exact experiment authorization

The experiment ActionIntent is authority-bearing only for one exact custom action:

```text
CUSTOM evaluation.compare-recorded-policy
```

For `CUSTOM` ActionIntent, the protocol is carried in `action.payload`. The policy must validate the exact payload before returning `ALLOW`.

The payload binds:

- replay artifact ref and digest;
- baseline and candidate policy identities;
- target scenario;
- development-control scenario ids;
- recorded holdout-control scenario ids;
- full experiment budget;
- `adoptionAuthority: false`.

A changed action name, changed payload, widened budget, repository mutation request, or adoption-shaped action is denied before the operation executes.

```text
reported EXPERIMENT_ONLY != enforced EXPERIMENT_ONLY
```

The authorization policy itself must enforce the scope.

## Fixed experiment protocol

Before evaluating the candidate, the application fixes:

```text
baseline policy
candidate policy
replay artifact identity
scenario membership
success predicates
budget
rollback/baseline-selection rule
```

The BB-034 budget is:

```text
4 scenarios
2 distinct policy identities
2 deterministic repeat passes
0 external mutations/dispatches
```

`budgetRespected` is true only when all declared dimensions are checked.

## Development and recorded holdout control

The first fixture uses:

```text
target:
  cancellation-late-reconciliation

development controls:
  artifact-outage
  retry-recorded-effect

recorded holdout control:
  review-delay
```

The `review-delay` schedule is **not unseen statistical held-out evidence**. The replay artifact and candidate are already known within this research slice. It is a predeclared recorded control used to prove that the decision rule does not ignore a non-development regression.

The negative control modifies only that recorded holdout schedule. Development remains passing while the holdout control fails, and the required result is:

```text
KEEP_BASELINE
```

This establishes a stop-rule contract. It does not establish production generalization.

## Trust boundary

The fixture uses distinct identities for:

- proposal producer;
- experiment evidence producer;
- evaluator;
- attestation issuer.

The trust pipeline validates those identities, policy digest, required claims, evidence producer authority, evaluator authority, and attestation signature.

Because all identities are exercised inside one deterministic process, this is **identity-separated trust-contract evidence**, not evidence of organizational/process independence.

A trusted experiment decision still means only:

```text
this exact recorded experiment satisfied its exact policy
```

It does not mean project adoption is authorized.

## Adoption boundary

PASS changes conceptual state only from:

```text
BASELINE_SELECTED
```

to:

```text
BASELINE_SELECTED
+ CANDIDATE_PROPOSED_FOR_REVIEW
```

BB-019 remains the dependency for independent application/project acceptance. BB-034 acceptance satisfies the self-upgrade design dependency, but BB-035 remains blocked until BB-027 supplies durable research continuation.

## Stop and rollback semantics

For this research fixture:

```text
PASS                  -> PROPOSE_FOR_REVIEW
FAIL                   -> KEEP_BASELINE
INCONCLUSIVE           -> KEEP_BASELINE
recorded holdout fail  -> KEEP_BASELINE
```

The historical defective policy appears as the experiment baseline only. It is not a production rollback recommendation. A real adopted pilot must name the currently accepted production baseline as its rollback target before rollout.

## Authority invariants

No self-upgrade iteration may alter by implication:

- user objective or constraints;
- project identity;
- Blackboard lifecycle/dependency rules;
- mandatory reviews;
- evaluator or acceptance policy;
- evidence freshness rules;
- experiment membership or budget after outcomes are observed;
- rollout authority.

Reflection, candidate generation, experiment execution, experiment evaluation, project acceptance, and rollout are distinct authority boundaries.

## Evidence

Corrected BB-034 evidence:

- `docs/living/knowledge/bb034-self-upgrade-loop-probe.mjs`;
- `artifacts/bb034-self-upgrade-loop-probe.json` schema v3;
- `artifacts/bb038-workflow-replay-eval.json` and its bound digest;
- current Core `grounded-cognition.js` source-snapshot semantics;
- current Core `deliberation-controller.js` ActionIntent policy hook;
- current Core `deliberation.js` `CUSTOM.payload` normalization;
- trust artifacts exercised by the probe;
- PR #105 architecture-boundary review PASS on exact remediation head `ca5157f8ecfa14a6deb95e4e7d8ecf63ba11295a`;
- PR #105 evaluation-method review PASS on the same exact head;
- exact-head CI #1695;
- merge commit `854432d6af1aaac3fd27e49823ef2984923d1357`.

The checked artifact remains:

```text
evidenceClass = DETERMINISTIC_SELF_UPGRADE_RESEARCH_FIXTURE
productionEvidence = false
generalizationEvidence = false
```

## Non-goals

This decision does not create:

- a generic autonomous SelfImprover runtime;
- live sandbox mutation authority;
- automatic merge/deploy/rollout;
- adaptive evaluator or threshold rewriting;
- production effectiveness evidence;
- production rollback policy.

## Promotion rule

D016 is accepted as the bounded design constraint for a future BB-035 application pilot.

Acceptance of D016 still does not mean a self-upgrade runtime exists. `docs/worktree/*` may claim only the executable research verification surface until a separately reviewed implementation is delivered.

## What would reopen this decision

Reopen if a concrete pilot needs live mutation, multiple competing candidates, adaptive budgets, nondeterministic provider evaluation, statistical held-out datasets, automatic rollout, or a materially different authority model.
