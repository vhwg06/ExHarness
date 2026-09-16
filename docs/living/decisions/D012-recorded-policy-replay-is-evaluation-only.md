# D012 — Recorded workflow replay is evaluation evidence, not runtime authority

Status: **ACCEPTED**

Accepted: 2026-09-16

Acceptance boundary: BB-038 research-method review plus application/architecture-boundary review. Both reviews passed on PR #93 after checking the deterministic fixture methodology, evidence classification and live-authority separation.

## Context

BB-038 adds a deterministic workflow-policy replay helper that consumes fixed recorded observable events under explicit baseline/candidate policy identities.

The first fixture reproduces the BB-024 late-reconciliation cancellation defect, distinguishes the terminal-cancellation fix under the same schedule, verifies three unrelated schedules remain behaviorally unchanged and records zero external dispatches even when a historical mutating effect appears in the trace.

The helper is integrated into the repository verification pipeline as `npm run eval:workflow-replay` and deep-compares its result with a checked deterministic artifact.

## Decision

Recorded policy replay is an **evaluation/regression surface only**.

It may establish:

```text
same recorded fixture
+ explicit policy A
+ explicit policy B
-> deterministic decision/outcome divergence
```

It may not establish or authorize:

```text
live ownership
live effect truth
safe retry
current source availability
current trust authority
production causal certainty
```

A trace is evidence of what was recorded. It is not executable authority merely because it contains an action/effect event.

## Required replay contract

Every comparable fixture carries at least:

```text
scenario id
scenario category
immutable revision/target identity
initial policy-relevant state
ordered observable events / recorded adapter outcomes
explicit policy id + version
```

Baseline and candidate causal language is valid only when the compared policy runs receive the same recorded inputs. When model/provider/environment/timing inputs differ, the result must not be described as proving the policy caused the live outcome.

## External-effect boundary

Historical mutation/effect observations are data:

```text
OBSERVED_EFFECT_RESULT
```

They never dispatch an external action during replay.

A replayed retry request that would require current runtime/effect authority must stop at an explicit boundary such as:

```text
REQUIRES_LIVE_AUTHORITY
```

Core/application recovery remains responsible for effect reconciliation and retry authorization.

## Runtime boundary

Do not use replay output to mutate Blackboard lifecycle, recover claims/reviews, authorize actions or satisfy acceptance evidence by itself.

The checked replay artifact may be CI/regression evidence about the fixture helper and declared policy behavior. Domain/project acceptance still depends on the ordinary current evidence/trust/review boundaries.

## Scope

Adopt only the bounded fixture helper and checked artifact pattern demonstrated by BB-038.

Do not infer a need for:

- a runtime event-sourcing architecture;
- replay database/service;
- universal workflow simulator;
- automatic trace-to-action execution;
- full production-history retention;
- generic policy registry.

Those abstractions require separate repeated-consumer and measured-value evidence.

## Consequences

- known lifecycle defects can be represented as deterministic comparison fixtures;
- candidate policy changes can be checked for intended divergence and bounded collateral changes;
- historical effects remain inert during replay;
- replay artifacts can live beside existing deterministic evaluation baselines;
- live integration/contract tests remain necessary for actual runtime correctness;
- fixture replay results remain explicitly non-production evidence unless a separate production protocol establishes otherwise.

## Evidence

- `docs/living/knowledge/bb038-workflow-policy-replay.md`;
- `scripts/workflow-policy-replay-eval.mjs`;
- `artifacts/bb038-workflow-replay-eval.json`;
- BB-024 baseline/candidate cancellation evidence from `blackboard-orchestrator.js` and PR #85;
- existing deterministic Agentic Application evaluation in `scripts/agentic-backend-qa-eval.mjs`;
- BB-016/017 separation between lifecycle fencing and live effect reconciliation;
- PR #93 research-method review PASS;
- PR #93 application/architecture-boundary review PASS.

## Promotion targets

The implemented evaluation command is projected in `docs/worktree/pipeline.md`. No runtime architecture document should describe replay as orchestration/recovery authority.

## What would reopen this decision

Reopen if a concrete consumer requires replay of nondeterministic providers, real concurrent interleavings, durable large-scale trace retention or trace-driven live execution. Each requires a new evidence and authority analysis rather than silently extending this fixture boundary.
