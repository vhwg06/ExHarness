# D016 — Self-upgrade experiments may propose adoption but never self-authorize rollout

Status: **PROPOSED**

Proposed: 2026-09-16

Acceptance boundary: BB-034 architecture-boundary review plus evaluation-method review. This decision must not be treated as accepted until both reviews pass.

## Context

ExHarness already has separate primitives for fresh grounded reflection, bounded deliberation and ActionIntent authorization, deterministic workflow-policy replay, and independently trusted evidence/decision/attestation bundles.

BB-034 composes those primitives against one concrete historical project failure: the BB-024 late-reconciliation cancellation regression represented by merged BB-038. The terminal-cancellation policy is now current source behavior after PR #85; the old defective policy is retained only as an experiment baseline.

The research question is not whether a model can recursively modify the system. The concrete question is whether an observed failure can produce a bounded candidate experiment without letting the candidate redefine its own evidence, evaluation gate or rollout authority.

## Decision

A self-upgrade attempt is a **bounded evidence-gated experiment that may produce an adoption proposal**.

It is not an authority that may select, merge, deploy or accept itself.

The accepted control shape, if BB-034 reviews pass, is:

```text
fresh persisted failure evaluation
 -> grounded REFLECTION
 -> bounded experiment hypothesis
 -> DeliberationArtifact + ActionIntent
 -> EXPERIMENT_ONLY authorization
 -> immutable experiment protocol
 -> development evaluation
 -> predeclared held-out evaluation
 -> independent EvidenceArtifact[]
 -> DecisionArtifact
 -> Attestation
 -> ADOPTION_PROPOSAL | KEEP_BASELINE
 -> separate application/project acceptance
```

## Immutable experiment protocol

Before candidate outcomes are observed, the application must fix and persist at least:

```text
baseline revision/config
candidate revision/config
experiment subject
target scenario/task set
development-control set
held-out set
evaluator/policy identity
success thresholds
resource/iteration budget
evidence freshness rules
rollback target
```

The candidate, reflection, experiment executor and generated rationale may not mutate those gates during the active experiment.

Development/held-out membership is part of the experiment subject, not a post-hoc reporting choice. If the evaluator, thresholds, membership or subject changes, previous evidence does not authorize the changed experiment.

## Grounding boundary

A reflection may propose an experiment only from fresh persisted evidence accepted by the existing grounding boundary. Stale evidence is not reusable merely because it supported an earlier candidate revision.

```text
REFLECTION != EVALUATION
REFLECTION != ACCEPTANCE
REFLECTION != ROLLOUT AUTHORITY
```

## Action boundary

The experiment ActionIntent authorizes only the declared isolated experiment.

For the BB-034 pilot this means evaluating a recorded baseline/candidate policy fixture. It does not authorize repository mutation, production configuration replacement, Blackboard lifecycle mutation, project-review changes, evaluator changes, merge, deploy or rollout.

A future candidate that requires live mutation needs a separately authorized sandbox/execution boundary; no such authority is inferred from this fixture research.

## Evaluation and held-out rule

A candidate becomes eligible for an adoption proposal only when:

```text
DEVELOPMENT GATE passes
AND PREDECLARED HELD-OUT GATE passes
AND fixed budget is respected
```

For the first research fixture:

```text
target = cancellation-late-reconciliation

development controls =
  artifact-outage
  retry-recorded-effect

held-out =
  review-delay
```

The corrected probe includes a negative fixture where the development gate still passes but the predeclared held-out schedule regresses. The required outcome is `KEEP_BASELINE`.

This establishes the stop invariant:

```text
development PASS + held-out FAIL != adoption proposal
```

Failed or inconclusive candidates and held-out failures must be retained as negative evidence. The system must not weaken the gate or retry indefinitely until a favorable result appears.

## Independent experiment trust

A successful experiment used as proposal input must be independently grounded through the existing trust pipeline.

Minimum authorities remain distinct:

```text
candidate/proposal producer
experiment evidence producer
experiment evaluator
attestation issuer
application/project adoption authority
```

A trusted experiment decision establishes only that the declared experiment claims passed under its exact subject/policy. In the BB-034 fixture, the trusted claims include target repair, development-control stability, held-out stability, zero external dispatch and budget compliance.

Invariant:

```text
trusted experiment ACCEPT != project adoption
```

## Adoption boundary

A PASS changes conceptual state only from:

```text
BASELINE_SELECTED
```

to:

```text
BASELINE_SELECTED
+ CANDIDATE_PROPOSED_FOR_REVIEW
```

Only the enclosing Agentic Application/project acceptance authority may later select the candidate.

BB-019 remains the dependency for independent application/project acceptance. BB-027 remains the dependency for durable research continuation. Therefore BB-034 acceptance alone does not unblock or authorize BB-035 delivery.

## Rollback

Every future adoption proposal must name the exact rollback target before rollout. Failure, inconclusive evaluation or held-out regression leaves the current baseline selected.

The BB-034 fixture uses the historical defective BB-024 policy only to exercise this control field; it is not a production rollback recommendation. A real pilot must use a currently accepted baseline as rollback target.

## User/project authority

No self-upgrade iteration may alter by implication:

- user objective or explicit constraints;
- project identity;
- Blackboard dependency/eligibility rules;
- mandatory review obligations;
- acceptance/trust policy;
- rollout authority.

Changing any of those requires the ordinary authority that owns that boundary. A model-generated suggestion does not gain additional authority because it came from a self-improvement loop.

## Rejected alternatives

### Reflection directly edits the system

Rejected. Grounded reflection is proposal context, not execution or rollout authority.

### Candidate defines its own success test or held-out set

Rejected. That makes evaluation circular and enables the object under test to weaken its own gate.

### Experiment PASS automatically adopts candidate

Rejected. Experiment correctness and project adoption are separate decisions with different authority and risk.

### Development tests only, with no held-out gate

Rejected for the self-upgrade pilot. A candidate known to fit the development fixture needs a predeclared unseen/control gate before it can become an adoption proposal.

### Retry candidates until something passes without a fixed budget

Rejected. This obscures negative results, permits unbounded search cost and increases selection bias.

### Generic autonomous SelfImprover framework now

Rejected. One deterministic pilot does not establish repeated runtime semantics or production value for a generic self-modifying subsystem.

## Consequences

- existing cognition, replay and trust primitives can compose a bounded improvement experiment without creating a second correctness system;
- experiment configuration, development/held-out separation and stop behavior are explicit and auditable;
- stale and negative evidence remain first-class;
- candidate PASS remains proposal state, never hidden auto-rollout;
- BB-035 receives a concrete implementation handoff only after BB-027 and BB-019 are also delivered;
- fixture success remains non-production evidence.

## Evidence

- `docs/living/knowledge/bb034-self-upgrade-loop.md`;
- `docs/living/knowledge/bb034-self-upgrade-loop-probe.mjs`;
- `artifacts/bb034-self-upgrade-loop-probe.json`;
- merged D012 / BB-038 replay boundary;
- merged PR #85 current cancellation behavior;
- Core grounded-cognition, deliberation and trust primitives exercised by the probe.

## Promotion targets

If accepted, D016 remains a living design constraint until BB-035 implements a real application pilot. No runtime `docs/worktree/*` document should claim a self-upgrade runtime exists from BB-034 alone.

The only current-system projection in BB-034 is the executable research verification command documented in `docs/worktree/pipeline.md`.

## What would reopen this decision

Reopen if a concrete pilot needs live sandbox mutation, multiple competing candidates, adaptive experiment budgets, nondeterministic provider evaluation, automatic rollout, statistical held-out evaluation, or another authority model. Each adds materially different failure/trust semantics and requires separate evidence rather than silent generalization.
