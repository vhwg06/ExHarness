# BB-034 — Evidence-gated bounded self-upgrade research

Status: **EVIDENCE / JUDGMENT CANDIDATE**

## Question

Can ExHarness turn one observed project failure into a bounded candidate experiment using existing Core cognition, replay and trust primitives while preventing the candidate, reflection or experiment from changing its own evaluator, acceptance gate, user intent or rollout authority?

## Concrete consumer and pilot

The concrete consumer is the future BB-035 application-level self-upgrade experiment pipeline. BB-034 deliberately does **not** implement BB-035 because that delivery lane also depends on BB-027 durable research continuation and BB-019 independent application review.

The pilot uses a real historical project failure:

```text
BB-024
  delayed CURRENT_WORK finding reconciliation
  could revive SUPERSEDED work
```

The tested policy is the terminal-cancellation guard represented by merged BB-038 and now delivered on current main through PR #85. The old defective policy remains a historical baseline only.

This research does not claim to have discovered the BB-024 fix. The candidate is intentionally known so the experiment isolates whether the **self-upgrade control loop** itself preserves evidence, evaluation, stopping and adoption boundaries.

## Predeclared experiment protocol

Before candidate outcome evaluation, the executable probe fixes all of the following:

```text
baseline policy        = bb024-baseline-late-reconciliation-v1
candidate policy       = bb024-terminal-cancellation-guard-v1
scenarios              = 4
policy identities      = 2
repeat passes          = 2
external mutations     = 0

target                 = cancellation-late-reconciliation
development controls   = artifact-outage, retry-recorded-effect
held-out               = review-delay
```

The held-out id is declared before the candidate experiment executes. Candidate acceptance is evaluated in two stages:

```text
DEVELOPMENT GATE
  target fixed
  + development controls stable
  + zero external dispatch
  + budget respected

HELD-OUT GATE
  review-delay remains behaviorally unchanged
```

Final experiment PASS requires **both** gates. Failure or inconclusive evidence produces `KEEP_BASELINE`; PASS produces only `PROPOSE_FOR_REVIEW`.

Evidence class is explicitly:

```text
DETERMINISTIC_SELF_UPGRADE_RESEARCH_FIXTURE
productionEvidence = false
```

## 1. Fresh failure -> grounded reflection

Core grounded cognition already requires a persisted evaluation source before a `REFLECTION` may become active. The probe derives one reflection from the baseline failure evaluation and confirms it becomes active.

It then changes the current candidate revision and tries to reuse the old baseline evaluation. Core rejects that stale evaluation.

Measured result:

```text
reflectionActivatedFromFreshEvaluation = true
staleEvaluationRejected                 = true
```

Therefore reflection is bounded proposal context, not self-generated correctness authority.

## 2. Reflection -> experiment-only ActionIntent

The probe composes existing Core cognition:

```text
DeliberationArtifact
  -> ActionIntent
  -> authorization policy
```

The ActionIntent authorizes only:

```text
evaluation.compare-recorded-policy
```

Its exact input carries baseline/candidate policy identities, target scenario, development-control ids, held-out ids and budget. Its authorization evidence references the grounded reflection and persisted failure evaluation.

Measured result:

```text
boundedDeliberationCreated = true
experimentActionExecuted   = true
authorizedScope            = EXPERIMENT_ONLY
adoptionAuthorityGranted   = false
```

Invariant:

```text
proposal to experiment != authority to adopt
```

## 3. Development and held-out evaluation

The experiment consumes merged BB-038's checked deterministic replay artifact; it does not reissue historical actions.

Target behavior:

```text
cancellation-late-reconciliation
baseline  -> REOPENED
candidate -> SUPERSEDED
```

Development controls:

```text
artifact-outage       -> unchanged
retry-recorded-effect -> unchanged
```

Held-out schedule:

```text
review-delay -> unchanged
```

Measured positive result:

```text
developmentAccepted       = true
targetFixed               = true
developmentControlsStable = true
heldOutAccepted           = true
heldOutStable             = true
noExternalDispatch        = true
budgetRespected           = true
stopReason                = PROPOSE_FOR_REVIEW
```

Inherited replay measurements:

```text
scenarioCount         = 4
externalDispatchCount = 0
inputFixtureBytes     = 1914
replayTraceBytes      = 5508
```

These byte counts are fixture observations, not production cost measurements.

## 4. Negative held-out stop rule

The initial probe incorrectly treated all controls as if they were held out. Evaluation-method review rejected that interpretation.

The corrected probe predeclares `review-delay` as held-out before executing the candidate experiment and constructs a deterministic negative held-out fixture before positive evaluation. Only the held-out schedule is changed in that negative fixture.

Result:

```text
developmentAccepted            = true
heldOutAccepted                = false
negativeHeldOutControlRejected = true
negativeHeldOutStopReason      = KEEP_BASELINE
```

This demonstrates a stronger stop invariant:

```text
a candidate that passes its development gate still cannot become an adoption proposal when the predeclared held-out gate fails
```

The candidate cannot alter held-out membership, evaluator identity, thresholds or resource budget after seeing outcomes.

## 5. Independent experiment trust -> proposal only

A passing experiment becomes existing Core trust artifacts over one exact `self-upgrade-experiment` subject:

```text
EvidenceArtifact
  producer = bb034-experiment-verifier

DecisionArtifact @ ACCEPTANCE
  evaluator = bb034-experiment-evaluator

Attestation
  issuer = bb034-experiment-attestor
```

Required experiment claims are:

```text
target-regression-fixed
development-controls-stable
held-out-stable
no-external-dispatch
budget-respected
```

The proposer, evidence producer, evaluator and attestor are separate identities under the configured trust policy.

Measured result:

```text
trusted                = true
proposalReadyForReview = true
adoptionAuthorized     = false
```

The `ACCEPTANCE` boundary is scoped to the exact **experiment subject**. It does not imply project/application adoption.

Invariant:

```text
trusted experiment ACCEPT != project adoption
```

## Bounded self-upgrade loop established by BB-034

```text
OBSERVED FAILURE
  -> fresh persisted evaluation

GROUNDED REFLECTION
  -> proposes bounded experiment only

DELIBERATION / ACTION INTENT
  -> exact baseline/candidate
  -> target/dev-control/held-out split
  -> immutable evaluator + thresholds + budget
  -> EXPERIMENT_ONLY authorization

CONTROLLED EXPERIMENT
  -> development gate
  -> predeclared held-out gate

INDEPENDENT EXPERIMENT TRUST
  -> EvidenceArtifact[]
  -> DecisionArtifact
  -> Attestation

FAIL / INCONCLUSIVE / HELD-OUT FAIL
  -> KEEP_BASELINE
  -> preserve evidence

PASS
  -> ADOPTION_PROPOSAL
  -> baseline still selected
  -> exact rollback target

APPLICATION/PROJECT ACCEPTANCE
  -> separate later authority
```

## Hard authority boundaries

The reflection, candidate and experiment must not change by implication:

- user objective or constraints;
- Blackboard lifecycle authority;
- mandatory project review obligations;
- experiment evaluator/policy after experiment creation;
- success thresholds after outcomes are observed;
- development or held-out membership;
- fixed resource/iteration budget;
- evidence freshness rules;
- adoption/rollout authority;
- rollback target.

The object under test may produce evidence. It cannot become the authority that defines what counts as evidence.

## Continuation

BB-034 introduces no second durable research store. BB-027 remains responsible for accepted cross-session research continuation semantics.

A BB-035 delivery must persist exact refs for failure evaluation, reflection/grounding, baseline/candidate revisions, immutable experiment configuration, development/held-out membership, budget, outputs, trust bundle, adoption proposal and rollback target.

Stale evidence or a changed experiment subject invalidates prior experiment authority rather than silently inheriting it.

## Adoption and rollback

Default state throughout the loop is:

```text
selected = baseline
```

PASS changes only proposal state:

```text
baseline selected
candidate proposed for independent application review
```

FAIL, INCONCLUSIVE or held-out failure leaves the baseline selected.

The fixture records the old BB-024 policy as rollback solely to demonstrate the control field. That historical baseline is known defective and is **not** a rollout recommendation. A real BB-035 pilot must start from a currently accepted application baseline and name that exact accepted revision/configuration as rollback target.

## Value gate result

BB-034 passes its research value gate **narrowly for the control-loop contract**:

```text
fresh failure grounding enforced
+ stale evidence rejected
+ experiment authorization bounded
+ fixed development gate
+ predeclared held-out gate
+ held-out failure keeps baseline
+ independent trust validates exact experiment claims
+ PASS remains proposal-only
+ zero external mutation
```

What this establishes:

- existing Core primitives can compose a non-self-authorizing improvement experiment;
- BB-038 is a useful deterministic comparison substrate;
- evaluation and stopping policy can be fixed before outcome observation;
- independent experiment trust can sit before application adoption;
- negative and held-out results can mechanically stop the loop.

What this does **not** establish:

- production self-improvement effectiveness;
- autonomous candidate-generation quality;
- model/provider generalization;
- production rollout safety;
- benefit across multiple task families;
- durable cross-session experiment continuation;
- justification for a generic self-improvement framework.

The held-out schedule is one deterministic recorded fixture, not statistical evidence of generalization.

## BB-035 implementation handoff

BB-035 remains blocked until BB-027 and BB-019 are delivered in addition to BB-034 acceptance.

When all prerequisites are satisfied, implement only one bounded application pilot with:

1. a current accepted baseline revision/configuration;
2. one exact isolated candidate revision/configuration;
3. persisted research refs through BB-027 continuation semantics;
4. immutable predeclared evaluator, thresholds, development/held-out split and resource budget;
5. no candidate authority to mutate evaluator, user/project policy or acceptance requirements;
6. independent application acceptance through BB-019 semantics;
7. explicit adoption proposal and rollback target;
8. fail/inconclusive/held-out-fail behavior that preserves baseline and evidence;
9. exact audit refs from observed failure through final adoption/rejection.

Do not add from this single fixture:

```text
generic SelfImprover<T>
autonomous rollout agent
self-modifying evaluator
adaptive self-authored thresholds
global experiment registry
generic workflow DSL
new correctness authority
```

## Judgment

```text
ACCEPT bounded evidence-gated experiment contract
NARROW adoption to proposal-only
REQUIRE predeclared held-out gate
DEFER runtime delivery to BB-035 prerequisites
REJECT autonomous self-authorization
```

The demonstrated value is not "ExHarness can improve itself." The demonstrated value is that ExHarness can represent an improvement attempt as a bounded, reproducible, held-out-checked and independently trusted experiment while keeping adoption authority outside the thing being improved.

## Evidence

- `docs/living/knowledge/bb034-self-upgrade-loop-probe.mjs`;
- `artifacts/bb034-self-upgrade-loop-probe.json`;
- merged BB-038 replay helper/artifact and D012;
- merged PR #85 current terminal-cancellation behavior;
- `packages/core-harness/test/grounded-cognition.test.js`;
- `packages/core-harness/test/deliberation-lifecycle.test.js`;
- Core trust primitives exercised by the probe;
- PR #95 Node 20/22/24 executable verification evidence.
