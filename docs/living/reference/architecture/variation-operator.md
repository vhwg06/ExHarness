# AVO Variation Operator Semantics

## Objective

ExHarness treats one AVO variation as a self-directed agent run around deterministic lifecycle boundaries. The kernel does not prescribe a fixed sequence such as plan -> implement -> test. The agent decides what to inspect, change, verify, repair, and commit.

The kernel owns the facts around that search:

```text
committed lineage P_t
        |
        v
VARIATION_STARTED
        |
        v
self-directed agent run
  inspect / act / verify / evaluate / repair
        |
        +---- promote ----> P_t+1
        |
        v
VARIATION_COMPLETED
```

## Persisted lifecycle

Each variation records:

- the base candidate and committed lineage head it started from;
- the problem/request and variation policy;
- start/end state snapshots;
- grounded activity deltas;
- capability-call count;
- state-based outcome;
- run termination;
- serialized failure metadata when applicable.

A variation is persisted as `RUNNING` before the agent executes. This makes interruption visible instead of pretending the run never happened.

## Outcome is not termination

These are intentionally separate.

Outcome describes what durable engineering state changed:

```text
COMMITTED
CANDIDATE_CHANGED
SEARCH_STATE_CHANGED
NO_CHANGE
```

Termination describes how the agent run ended:

```text
RETURNED
BUDGET_EXHAUSTED
FAILED
```

A variation may therefore be `COMMITTED + FAILED` if it successfully committed a candidate and then violated the post-commit protocol. Likewise it may be `CANDIDATE_CHANGED + BUDGET_EXHAUSTED` if useful state was created before the run hit its action budget.

The kernel deliberately does not label a variation `productive`. Productivity remains a higher-level judgment for evaluation/supervision. Agent-returned text such as `progress: 100%` has no effect on the grounded outcome.

## Bounded autonomy

`variationPolicy.maxCapabilityCalls` bounds harness-mediated capability invocation inside one variation. The default is currently 64 calls and is explicitly configurable.

This is a control-plane budget, not a complete runtime sandbox. It prevents an agent from indefinitely invoking harness capabilities, including when the strategy catches the budget exception: the runtime records that the budget was exhausted independently of exception propagation.

It does **not** stop arbitrary CPU/model reasoning that never invokes a capability. Wall-clock timeout, process containment, resource limits, and cancellation belong to the later execution-runtime boundary.

## Commit is terminal

A successful `avo.promote` advances committed lineage and closes variation capability activity. Any subsequent capability invocation is a protocol violation.

This keeps the AVO transition unambiguous:

```text
P_t
 |
 variation search
 |
 promote candidate
 v
P_t+1   <-- terminal boundary for that variation
```

The protocol violation is recorded even if strategy code catches the thrown error. Exception handling by model/strategy code cannot erase the outer harness fact.

## Grounded activity

Variation activity is computed from persistent state deltas, not model claims. It includes candidate/lineage changes and counts of observations, verifications, evaluations, knowledge records, failed-direction records, supervisor interventions, and trajectory events.

`SEARCH_STATE_CHANGED` is intentionally neutral. A new knowledge record or supervisor intervention is not automatically called evidence or progress. Verification/evaluation layers decide evidentiary meaning; supervision decides whether the search trajectory is productive.

## Failed directions

Failed directions remain explicit persistent knowledge and are counted in variation activity. The kernel does not yet infer that two natural-language failed-direction statements are semantically the same direction. Detecting repeated or cyclic search behavior belongs to supervision once sufficient trajectory artifacts are available.

## Current concurrency rule

This slice permits only one `RUNNING` variation per session. Starting a second variation while one is running is rejected.

This is a safety invariant for the current store model, which does not yet provide optimistic revision/CAS semantics. Interrupted runs remain visible as `RUNNING`; automatic interrupted-run recovery is intentionally deferred to the recovery/concurrency phases rather than guessed here.

## Development verification for this slice

Manual vigilance should challenge at least:

1. an agent returning a fake success/progress object without changing state;
2. repeated capability calls beyond the configured budget;
3. a strategy catching the budget error and trying to hide exhaustion;
4. a successful commit followed by another capability call;
5. a strategy catching the post-commit violation;
6. candidate mutation without committed-lineage advancement;
7. repeated failed-direction records being mislabeled as progress;
8. a persisted `RUNNING` variation blocking overlapping work.

Automated tests guard these behaviors, but the architectural claim is supported by the persisted lifecycle model, state-derived outcomes, runtime-side budget accounting, commit boundary, and explicit residual gaps—not by green tests alone.

## Residual gaps

- the default capability budget of 64 is a safe bounded default, not a benchmark-derived optimum;
- pure model/CPU loops without capability invocation are not time-bounded here;
- interrupted `RUNNING` variations require explicit recovery semantics in a later phase;
- concurrent/parallel variations are not supported until store revision/CAS semantics exist;
- semantic repeated-direction/stagnation detection belongs to the supervisor phase;
- capability-call traces are not yet persisted as first-class observability records; only grounded state/event deltas and call counts are persisted.
