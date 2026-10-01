# Feedback: episode, response, outcome, pattern and improvement handoff

This file documents the delivered application-owned feedback
capability as implemented in `packages/agentic-system/src/feedback-contracts.js`,
`packages/agentic-system/src/feedback-controller.js`,
`packages/agentic-system/src/feedback-projection.js` and
`packages/agentic-system/src/feedback-improvement.js`, with the optional
offline GEPA bridge under `scripts/feedback/`. It covers only delivered
behavior plus explicit limitations. The earlier response-lifecycle
contracts in `feedback-lifecycle-contracts.js` remain unchanged and are
described in `feedback-lifecycle.md`.

## Contracts

`FEEDBACK_OBSERVATION_V1` is delivered observation or event evidence. It
binds an exact source ref+digest, a subject, JSON-safe evidence, provenance
(observer id and observed time) and an explicit uncertainty statement.
Uncertainty is required; its absence is not certainty. The observation
never infers causal truth from provider prose.

`FEEDBACK_CONTEXT_BINDING_V1` binds an observation to an exact Oracle
ContextResolution identity (ref+digest). A binding is `BOUND` only when the
resolution digest matches, the source observation ref matches and
currentness is `CURRENT`. Anything else is `UNRESOLVED` with an explicit
reason (`MISSING_CONTEXT`, `STALE_CONTEXT`, `AMBIGUOUS_CONTEXT`,
`RESOLUTION_DIGEST_MISMATCH`, `SOURCE_OBSERVATION_MISMATCH`). Derived data
can never self-certify `CURRENT`; mismatches fail closed.

`FEEDBACK_EPISODE_V1` is a finding/impact record over one bound
observation. It requires a `BOUND` context binding; unresolved context can
never ground a finding. The finding binds an exact source ref; the episode
id is the sha256 over canonical content, which makes cross-episode
deduplication deterministic. An optional explicit `cohortKey` enables
grouping; episodes without one are never grouped.

`FEEDBACK_RESPONSE_V1` is application-owned. Only a principal with role
`application` may create or revise it; observer, evaluator, provider, GEPA
and model roles are rejected. Disposition is exactly `ACTED`, `REJECTED`,
`DEFERRED` or `SUPERSEDED`. Revisions use expected-current compare-and-swap
starting at 1; stale revisions fail rather than silently rebasing. Recovery
is idempotent and appends no new lifecycle mutation.

`FEEDBACK_OUTCOME_V1` binds fresh outcome evidence to a response. The
outcome is exactly `IMPROVED`, `NO_CHANGE`, `REGRESSED` or `UNKNOWN`.
Non-`UNKNOWN` outcomes require an evidence ref; missing fresh evidence is
`UNKNOWN`, never `IMPROVED`.

`HOW_IMPROVEMENT_PROPOSAL_V1` is the improvement handoff envelope. It
carries the frozen HOW subject ref+digest, optimizer identity, frozen
partitions (development, search-validation, sealed final holdout),
metric-policy ref+digest with an explicit numeric minEffect, the candidate
evidence ref and status `PROPOSED`. It never carries accepted, promoted,
verdict or any acceptance/promotion flag, and it never sees final-holdout
membership or evidence.

## Controller

`createFeedbackController` owns the response lifecycle in memory:
`createResponse`, `reviseResponse` (compare-and-swap), idempotent
`recoverResponse`, and `recordOutcome`. Every mutation is journaled in an
append-only journal; recovery and rejected revises append no mutation.

## Projection

`createFeedbackProjector({ resolveContext })` normalizes delivered
observations, binds exact Oracle resolution/currentness/provenance through
the injected `resolveContext` seam, and returns either a grounded episode
or an explicit unresolved binding. It never invents causal truth.

`createCrossEpisodeProjector` deterministically deduplicates episodes by
id, groups only on explicit cohort keys, retains contrary evidence on each
pattern, and requires explicit mechanism evidence plus support of at least
two before a `SYSTEMIC` proposal candidate can be produced. Reinforcement
records evidence only; it never auto-escalates and never mutates
acceptance, promotion, policy or response state.

## Improvement handoff

`createImprovementHandoff({ benchmark })` freezes the experiment scope
(HOW subject, optimizer identity, partitions, metric-policy ref+digest and
minEffect) before candidate search. `submitCandidate` normalizes untrusted
optimizer output to the proposal envelope only, reserving a benchmark
attempt first when a benchmark seam is provided; without a successful
reservation nothing is dispatched. `evaluateFinal` compares paired repeats
against the frozen minEffect: model-backed comparisons need at least three
paired repeats per case unless the frozen policy requires more, missing
measurements are `INCONCLUSIVE`, and any critical regression yields
`REGRESSED` even when the aggregate improves. Unknown is never success.

The selected candidate crosses to the independent HOW
evaluation/promotion/currentness authority. GEPA acceptance, aggregate
score gain or checkpoint state never sets accepted/promoted flags.

## Offline GEPA bridge (optional)

`scripts/feedback/gepa-bridge.mjs` (Node) orchestrates a pinned Python
worker (`scripts/feedback/gepa_adapter.py`) over a bidirectional JSON-lines
protocol. Node owns the benchmark `AttemptLedger` reservation, side
effects, reconciliation, cancellation accounting and evidence refs; Python
owns only GEPA optimizer computation. The bridge enforces a hard budget
before dispatch, reopens/reconciles exact settled/uncertain attempts across
crash without duplicate dispatch, preserves cancellation reservations, and
keeps unknown provider usage/cost null rather than coercing to zero.

Pinned dependency: `gepa==0.1.4` (base package only, Python >=3.10,<3.15;
see `scripts/feedback/requirements.lock`). No `gepa[full]`, DSPy,
LangChain or LangMem. Product feedback capture and resolution do not
depend on Python or GEPA availability; the adapter degrades to
`UNAVAILABLE` when GEPA is not installed.

## Authority boundaries

- Observation, interpretation, disposition and promotion authority remain
  separate. Observers and evaluators cannot mutate lifecycle or promote.
- Feedback cannot grant acceptance, lifecycle mutation or promotion
  authority.
- Measured improvement requires fresh comparable evidence; unknown outcome
  is not success.

## Explicit limitations (unevaluated / unsupported in v1)

- LangMem is absent from v1; deterministic native episode/cohort projection
  is the only pattern memory.
- GEPA checkpoint pickle state is recovery-only and never canonical
  ExHarness evidence; untrusted/external checkpoints are rejected.
- Effectiveness of GEPA-discovered candidates is not measured by the
  bridge; only the independent HOW authority can evaluate and promote.
- The controller and projectors are in-memory; durable stores are not
  provided by this feedback capability.
