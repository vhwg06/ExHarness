# Adaptive useful range for long-horizon search

ExHarness uses hard budgets to bound autonomous work, but a fixed budget such as `N` capability calls or `N` iterations answers only a containment question:

```text
What is the most work this run is allowed to spend?
```

It does not answer the economic/search question:

```text
Given the grounded artifacts produced so far,
is another unit of search still worth paying for?
```

Those are different concerns.

## Core distinction

```text
hard safety budget
= absolute outer ceiling
= cannot be exceeded by the strategy

adaptive useful range
= dynamic search-investment decision inside that ceiling
= decides whether continued search is still worth the cost
```

The adaptive range does not replace containment. It decides when to stop earlier, continue, or escalate while the hard safety boundary still owns the absolute maximum.

## Placement

The gate belongs in the AVO control plane, outside `strategy.run()` and after grounded evaluation state exists.

```text
candidate
   |
   v
objective.evaluate()
   |
   v
append grounded evaluation / verification / cost artifacts
   |
   v
adaptive range gate
   |
   +---- CONTINUE
   |
   +---- STOP
   |
   `---- ESCALATE
```

The gate is not a correctness oracle.

```text
EvaluationDecision
→ does the candidate satisfy the objective?

SearchInvestmentDecision
→ is it worth spending more compute on this search trajectory?
```

A range decision must never rewrite, synthesize, or override an objective verdict.

## Grounded inputs only

The range gate must derive its state from append-only, inspectable runtime artifacts such as:

- objective evaluations;
- verification assessments;
- candidate / committed-lineage transitions;
- model / execution / capability usage or cost measurements where available;
- supervisor interventions and failed-direction history when represented as grounded runtime state.

It must not use a strategy or model's prose claim that it is "making progress" as authoritative progress input.

```text
agent says: "almost there"
        ↓
not a range signal by itself

objective/evidence/cost history changes
        ↓
may become a range signal
```

This preserves the existing invariant that progress and feedback come from persisted state changes and grounded evaluation rather than self-assessment.

## Range decision artifact

A range decision should be inspectable and freshness-bound to the exact history it consumed.

Conceptually:

```text
SearchInvestmentDecision
  id
  at
  lineageHead
  candidate
  inputSnapshot
    evaluationIds[]
    verificationIds[]
    costArtifactIds[]
    variationIds[]
  policy
  state
    WARMUP
    IN_RANGE
    DIMINISHING_RETURNS
    ANOMALOUS
    INSUFFICIENT_DATA
  action
    CONTINUE
    STOP
    ESCALATE
  rationale
  metrics
```

The names are not yet a frozen public API. The important contract is that the decision records what grounded history it consumed.

If a new relevant evaluation, verification, cost, or trajectory artifact appears, the previous search-investment decision is stale and must be recomputed before it is relied on again.

## Warm-up and minimum evidence

The gate must not infer a trend from too little data.

A policy therefore needs a warm-up condition such as `minSamples` or an equivalent evidence sufficiency rule.

```text
1-2 observations
→ insufficient trend evidence
→ WARMUP / CONTINUE under hard bounds

sufficient history
→ range policy may decide CONTINUE / STOP / ESCALATE
```

`minSamples` is itself policy, not a universal magic constant.

## Possible range policies

The kernel should support policy composition rather than hard-code one universal formula.

### Marginal improvement band

Track quality improvement between successive grounded evaluations.

```text
Δquality stays meaningfully positive
→ CONTINUE

Δquality remains near zero for a configured window
→ DIMINISHING_RETURNS
→ STOP or ESCALATE
```

### Cost per unit quality

Useful when search cost matters directly.

```text
marginal_value = Δquality / Δcost
```

When marginal value stays below the workload's minimum acceptable threshold, the range gate can stop continued investment even though the hard iteration budget has not been exhausted.

### Control-band / anomaly policy

A rolling distribution can identify unusually poor or unusually good movement.

```text
unexpectedly bad trajectory
→ recovery / redirect / stop candidate search

unexpectedly large positive jump
→ ESCALATE for stronger verification
```

An anomalously good score is not automatically trusted; it can justify additional independent verification rather than immediate promotion.

## Relation to supervisor

The range gate is a narrow automatic control-plane mechanism. It can emit a grounded trajectory signal or a `SearchInvestmentDecision` that a supervisor consumes.

It does not gain supervisor-forbidden authority:

- it cannot mutate the candidate;
- it cannot promote a candidate;
- it cannot issue a correctness PASS/FAIL;
- it cannot silently discard persisted work;
- it cannot bypass recovery.

A supervisor may use the result to redirect or escalate the search, but objective correctness remains owned by the evaluation/verification path.

## Recovery remains separate

A persisted `RUNNING` variation cannot be abandoned merely because a range policy now says the trajectory is not worth continuing.

```text
RUNNING variation
     ↓
explicit resume / recover path
     ↓
resolved lifecycle state
     ↓
range decision may influence what happens next
```

This preserves crash/recovery invariants.

## Hard cap remains authoritative

The adaptive range can choose to stop early or request continued investment, but it cannot override absolute safety limits.

```text
adaptive range says CONTINUE
        +
hard budget exhausted
        ↓
STOP / BUDGET_EXHAUSTED
```

A future policy may support bounded budget extension, but only up to an independently configured hard ceiling owned outside the strategy.

## Verification requirements

The implementation stage must challenge at least these failure modes:

- strategy/model self-reported progress cannot move the range;
- insufficient sample history cannot fabricate a trend;
- a new relevant artifact makes the previous range decision stale;
- diminishing returns can stop search without changing the objective verdict;
- an anomalous positive jump can request stronger verification without self-promoting;
- range STOP cannot skip explicit recovery for interrupted work;
- range CONTINUE cannot exceed hard safety budgets;
- missing cost/quality inputs yield explicit insufficient-data behavior rather than invented metrics;
- the policy can be replaced without changing AVO correctness semantics.

## Why this exists

The goal is not to replace fixed safety bounds with model intuition. The goal is to separate two questions that were previously collapsed:

```text
How much autonomy is allowed at most?
        ≠
How much additional search is still worth buying now?
```

Long-horizon search needs both.
