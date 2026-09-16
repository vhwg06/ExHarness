# BB-038 — Recorded-event workflow policy replay research

Status: **EVIDENCE / JUDGMENT CANDIDATE**

## Question

Can ExHarness use a bounded replay/fault-schedule helper to compare workflow-policy behavior before adoption, reproduce known lifecycle regressions and isolate the changed decision, without replay becoming execution authority or reissuing historical external effects?

## Current source-backed pressure

The Agentic Application already has a deterministic Backend -> QA evaluation gate covering happy, restart, remediation, blocked-recovery and cancellation flows. Separate Blackboard work has exposed lifecycle failures around stale writes, late reconciliation and interrupted execution/review.

Those tests prove individual contracts, but they do not provide one small comparison surface for:

```text
same recorded scenario
+ same event ordering
+ explicit baseline policy identity
+ explicit candidate policy identity
-> changed decision
-> downstream outcome refs
```

BB-038 evaluates that missing comparison surface. It does not own BB-023/024 fixes or BB-016/017 recovery semantics.

## Experiment budget and evidence class

This research intentionally uses a deterministic fixture budget:

```text
4 schedules
2 policy identities
2 repeated replay passes
0 model/provider calls
0 real external mutations
```

Evidence class:

```text
DETERMINISTIC_POLICY_REPLAY_FIXTURE
productionEvidence = false
```

The experiment may establish replay determinism and bounded regression-discrimination value for the fixed fixtures. It cannot establish production effectiveness, real timing fidelity, provider behavior or causal certainty when live inputs differ.

## Minimum replay input contract

The probe shows the smallest useful recorded input is:

```text
scenario id
scenario category
revision / immutable target identity
initial state needed by the policy comparison
ordered observable events
recorded adapter outcomes embedded in those events
explicit policy id + version
```

The replay input does **not** need a full runtime snapshot when the question is only policy comparison over already observed events.

The helper deliberately does not infer hidden process state, model state, filesystem interleavings or effect truth that is absent from the fixture.

## Fixed schedules

The checked fixture uses four categories required by the Blackboard research plan.

### Artifact outage

```text
QA_PENDING
-> artifact read unavailable
-> BLOCKED
-> source available
-> RESUME
-> QA verified
-> PENDING_REVIEW
```

This schedule is a control: the BB-024 candidate policy should not change it.

### Cancellation + late reconciliation

```text
PENDING_RECONCILIATION
-> SUPERSEDE
-> delayed CURRENT_WORK finding reconciliation
```

Baseline policy reproduces the BB-024 defect:

```text
SUPERSEDED
-> APPLY_LATE_FINDING_TO_CURRENT_WORK
-> REOPENED
```

Candidate policy modeled from PR #85 rejects the terminal mutation:

```text
SUPERSEDED
-> REJECT_TERMINAL_MUTATION
-> SUPERSEDED
```

The changed event is exactly `cancel:late-finding`, with separate baseline/candidate outcome refs.

### Retry with a recorded mutating effect

The fixture includes a historical confirmed mutating effect followed by a retry request.

Replay records the historical observation but never invokes an effect adapter. The result is intentionally:

```text
DO_NOT_REISSUE_HISTORICAL_MUTATION
REQUIRES_LIVE_AUTHORITY
```

This is a boundary check, not a replacement for Core effect reconciliation. Replay cannot decide whether a live retry is safe.

### Review delay

```text
PENDING_REVIEW
-> recorded review dispatch
-> delay observed
-> recorded trusted acceptance
-> DONE
```

This is another control schedule. The BB-024 cancellation policy must not change review-delay behavior.

## Policies compared

The pair differs by one declared policy bit:

```text
baseline
  id = bb024-baseline-late-reconciliation-v1
  terminalCancellationGuard = false

candidate
  id = bb024-terminal-cancellation-guard-v1
  terminalCancellationGuard = true
```

Keeping policy identity explicit prevents a trace from being compared without knowing which decision rule produced it.

## Measured result

The checked artifact `artifacts/bb038-workflow-replay-eval.json` records:

```text
scenarioCount                     = 4
behavioralDivergenceCount         = 1
cancellationRegressionReproduced  = true
unaffectedScheduleCount           = 3
deterministicRepeatPasses         = 2
historicalExternalEffectsObserved = 2
externalDispatchCount             = 0
inputFixtureBytes                 = 1914
replayTraceBytes                  = 5508
```

The only behavioral divergence is the intended BB-024 cancellation case:

```text
changedEventId       = cancel:late-finding
baselineFinalStatus  = REOPENED
candidateFinalStatus = SUPERSEDED
baselineOutcomeRef   = outcome:bb024-baseline-reopened
candidateOutcomeRef  = outcome:bb024-candidate-superseded
```

Artifact outage, retry-recorded-effect and review-delay schedules have the same behavioral outcome under both policy identities.

This is useful because the helper does not merely show that the candidate differs; it also shows the bounded fixture does **not** detect collateral policy changes in the three control schedules.

## External-effect isolation

The replay engine has no external effect dispatcher. A historical mutating effect is represented only as an observable event:

```text
OBSERVED_EFFECT_RESULT
```

The trace records it and a later retry request becomes `REQUIRES_LIVE_AUTHORITY`.

Measured external dispatch count across both policy replays is zero.

Invariant:

```text
historical effect appears in trace
!= authorization to execute it again
```

Live recovery remains owned by the existing runtime/effect-reconciliation boundaries.

## Integration

The research helper is implemented as:

```text
scripts/workflow-policy-replay-eval.mjs
artifacts/bb038-workflow-replay-eval.json
npm run eval:workflow-replay
```

The command deep-compares the measured deterministic result with the checked artifact and is wired into root `npm run verify` beside the existing application evaluation.

This makes the research output directly usable as a regression gate rather than leaving it as prose or a one-off notebook.

## Replay fidelity boundary

Supported by this first helper:

- fixed ordered fixture events;
- explicit policy ids/versions;
- recorded adapter outcomes;
- deterministic state/decision projection;
- changed-event and downstream outcome-ref comparison;
- historical-effect observation without dispatch;
- exact artifact drift detection.

Not supported and deliberately not inferred:

- real concurrent timing/interleaving;
- live filesystem atomicity;
- live external-effect truth or retry authority;
- provider/model nondeterminism;
- reconstruction of runtime ownership/lease authority;
- causal proof when baseline and candidate use different event/model/environment inputs.

A replay result must therefore be described as:

```text
policy divergence under the same recorded fixture
```

not:

```text
proof this policy will cause the same production outcome
```

## Storage / cost observation

The four-scenario fixture is 1,914 serialized bytes and the two replay trace sets are 5,508 serialized bytes.

This is small enough for checked regression fixtures, but the result is not a retention benchmark. Long production histories could grow substantially and would require separate retention/indexing evidence before replaying full histories.

The first implementation should stay scenario-bounded rather than introduce a replay database/event-sourcing subsystem.

## Alternatives considered

### Re-run the live workflow for every comparison

Rejected as the default comparison mechanism. It couples policy comparison to providers, timing and external effects, and makes exact reproduction harder. Live tests remain necessary for runtime contracts; they answer a different question.

### Reconstruct complete runtime authority from traces

Rejected. Recorded observations do not recreate ownership, effect truth, current source availability or current trust authority.

### General event-sourcing/replay platform

Rejected. Four bounded fixture schedules do not justify a runtime event bus, replay database or universal workflow simulator.

### Pure prose failure matrix

Insufficient. It cannot mechanically demonstrate the changed decision, preserve outcome refs or detect fixture drift in CI.

## Judgment

The value gate passes for a bounded evaluation addon:

```text
known BB-024 failure reproduced under baseline
+ same schedule distinguishes candidate fix
+ changed event/outcome refs are inspectable
+ three unrelated schedules remain behaviorally stable
+ external dispatch count stays zero
+ deterministic artifact is runnable in verify
```

The justified adoption is therefore a **fixture-level policy replay evaluation**, not a new runtime authority or recovery engine.

## Implementation boundary

Keep the current helper narrow:

- add scenario fixtures only when they correspond to a concrete regression/policy question;
- keep policy identity/version explicit;
- record rather than execute external effects;
- require the same event inputs for causal language about policy differences;
- preserve evidence class and `productionEvidence=false`;
- use live contract/integration tests for runtime correctness;
- do not generalize to a replay service/store until repeated real consumers demonstrate that pressure.

## Evidence

- `scripts/workflow-policy-replay-eval.mjs`;
- `artifacts/bb038-workflow-replay-eval.json`;
- `scripts/agentic-backend-qa-eval.mjs`;
- `packages/agentic-system/src/blackboard-orchestrator.js` baseline reconciliation semantics;
- PR #85 `bb024-cancellation-reconciliation.test.js` and terminal-cancellation guard candidate;
- BB-016/017 recovery boundary for the distinction between recorded replay and live effect authority.
