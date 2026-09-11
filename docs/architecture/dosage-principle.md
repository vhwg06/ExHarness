# Dosage and marginal-value principle

ExHarness does not treat an engineering practice as intrinsically good or bad. The useful question is whether a mechanism is being applied in the right context and at the right dose.

```text
practice × context × dosage
        ↓
useful range or harmful range
```

This is the working form of the Paracelsus maxim for the harness architecture: the same mechanism can move from missing, to useful, to counterproductive as dosage changes.

## Example: global data

```text
0 global data
→ can be unnecessarily extreme

a small amount of immutable global state
→ simple and convenient

too much global state
→ coupling + hidden dependencies + chaos
```

The conclusion is not `global data = bad`. The conclusion is that global data has a useful range that depends on its mutability, ownership, lifetime, consumers and change pressure.

## Cross-cutting engineering rule

The same reasoning applies to mechanisms such as:

- abstraction;
- tests and TDD;
- microservices;
- DDD boundaries;
- caching;
- context supplied to agents;
- guardrails;
- supervision;
- code review;
- documentation;
- verification depth;
- tracing and observability.

Examples:

```text
TDD / tests

none
→ regression risk

reasonable discipline
→ feedback + confidence

mandatory red-green-refactor around every agent micro-step
→ process/token cost can exceed marginal benefit
```

```text
guardrails

none
→ unsafe autonomy

enough to bound important failure modes
→ useful bounded autonomy

too many overlapping constraints
→ governance tax + loss of useful autonomy
```

```text
review

none
→ risky changes can self-certify

independent review for high-risk boundaries
→ high leverage

human review of every generated micro-diff
→ reviewer bottleneck
```

## Architectural consequence

A default is not justified merely because the underlying practice is a "best practice".

For every meaningful mechanism ExHarness adds, design and verification should ask:

```text
1. What failure appears at zero / under-dose?
2. What useful range are we targeting?
3. What failure appears at over-dose?
4. Which context variables move that range?
5. What observable signals tell us the marginal benefit is flattening or turning negative?
```

The goal is not to discover one universal numeric optimum. The goal is to avoid encoding `more X = better` into the kernel without evidence.

## Kernel posture

Where the optimum is workload-dependent, the kernel should prefer:

- bounded and inspectable defaults rather than maximal defaults;
- explicit policy knobs rather than hidden escalation;
- measurable usage/cost signals where practical;
- consumer-specific tuning above the reusable kernel;
- ablation/benchmarking before claiming an optimum;
- the smallest mechanism that satisfies the current risk model.

A default may still be necessary for safety or usability, but it must be described as a starting dose, not as a proven optimum.

## Verification consequence

Objective verification should challenge both sides of the useful range.

```text
UNDER-DOSE
    ↓
missing context / weak checks / unsafe freedom

TARGET RANGE
    ↓
enough information/control to achieve the objective

OVER-DOSE
    ↓
context pressure / duplicated checks / governance tax / bottlenecks
```

Therefore a stage is not fully understood merely because the mechanism works when enabled. Where dosage materially affects behavior, verification should include at least one low-dose and one high-dose/adversarial case, or explicitly record why such an ablation is not yet practical.

## Immediate NOOA implications

### Context and history

NOOA-04 must not encode `more context = better`.

The design should support selective context/history and bounded rendering. Verification should compare at least:

```text
insufficient context
reasonable selected context
excessive / irrelevant context
```

Relevant observables include task success, invalid-output/correction rate, context size and model-call cost where available.

### Resource and tool exposure

NOOA-05 should prefer progressive disclosure over dumping every operation into every model turn. Too little exposure blocks useful action; too much exposure increases search surface, ambiguity and security risk.

### CodeAct autonomy

NOOA-06 budgets and guardrails are safety/control doses. `maxIterations`, time limits and capability budgets are bounded defaults, not claims about optimal autonomy.

### Tracing

NOOA-07 should make tracing sufficiently rich to reconstruct important behavior without assuming maximal event/span volume is always beneficial.

### Final evaluation

NOOA-10 should include dosage-oriented ablations for context/history, resource disclosure and autonomy budgets when those variables materially affect the reference workload.

## Practitioner rule

The novice question is often:

```text
Is X good or bad?
```

The practitioner questions are:

```text
In which context?
How much is enough?
What failure am I preventing?
What new cost am I introducing?
When does marginal benefit turn negative?
```

Engineering judgment is not only knowing which mechanism to use. It is knowing how much of it the current system can justify.