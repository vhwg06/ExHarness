# Agentic Application self-improvement

Current source-backed self-improvement contracts. Everything here is evidence or proposal machinery: nothing in this file can mutate a response, an acceptance, a promotion or a policy head.

## S1 — Cross-episode improvement pattern projection

Outcome: project a deterministic, read-only pattern summary over a set of feedback resolution refs.
Requires: `FEEDBACK_RESOLUTION_V1` refs resolved by exact ref+digest; the referenced episode, response and outcome artifacts.
Guarantees:
- `patternKey = sha256(canonical({cohortKey, findingKind, howAxis}))`; `howAxis` comes from `PATTERN_POLICY_V1.findingKindToHowAxis`; an unmapped finding kind is excluded with reason `UNMAPPED_AXIS`, never guessed.
- A support unit is the sorted set of observation refs behind an episode's grounded finding inputs; retried or duplicated episodes with the same unit count once.
- `outcomeCounts` (`IMPROVED`, `NO_CHANGE`, `REGRESSED`, `REJECTED_ACKNOWLEDGED`) and `contraryEvidenceRefs` (episode contrary refs plus `NO_CHANGE`/`REGRESSED` episodes) are always retained.
- Classification is `INSTANCE` | `RECURRING` | `SYSTEMIC`: `RECURRING` when distinct support units reach `policy.minSupport` (>= 2); `SYSTEMIC` only when `RECURRING` and mechanism evidence covers every supporting episode. Frequency alone never yields `SYSTEMIC`.
- Reinforcement is recomputation: `projectionId = sha256(canonical(policy digest + sorted input resolution refs))`. New positive evidence changes only support metadata in a new projection.
- A digest mismatch rejects that resolution; a superseded resolution contributes only through its successor.
Limits: the projection exposes no write port; it cannot change response, acceptance, promotion or policy state. It carries no accepted or promoted authority.
Details: `packages/agentic-system/src/improvement-pattern.js`.

## S2 — HOW improvement proposal envelope

Outcome: bind one eligible pattern to a single-axis HOW change candidate with a pinned optimizer identity.
Requires: a `RECURRING` or `SYSTEMIC` pattern projection entry; baseline HOW refs+digests; the pinned optimizer identity.
Guarantees:
- `HOW_IMPROVEMENT_PROPOSAL_V1` carries pattern projection ref+digest, pattern key, cohort episode refs, baseline HOW (`policyHeadRef`, `strategyRef`+digest), exactly one `allowedHowAxis`, optimizer identity (`gepa` 0.1.4 at the locked commit), candidate (`strategyRef`, digest, diff), development evidence refs and benchmark attempt refs.
- Proposals from `INSTANCE` patterns are ineligible. Any `accepted`, `promoted`, `approved`, `verdict` or policy-head mutation field — at any depth — is rejected.
Limits: the proposal is a candidate description only. Only the delivered independent HOW-evolution evaluation authority can promote; this envelope cannot self-promote.
Details: `packages/agentic-system/src/improvement-proposal.js`.

## S3 — Offline GEPA optimizer bridge

Outcome: run a pinned, offline optimizer search with Node-owned benchmark accounting.
Requires: `python3 >= 3.10`; the requirements lock; a benchmark `AttemptLedger`.
Guarantees:
- One Node-owned child process per run; bounded bidirectional JSON-lines with explicit request ids and schema kinds; Python evaluation callbacks cannot mutate repository, benchmark ledger, product state or policy head.
- Every attempt is reserved through the delivered `AttemptLedger` before dispatch; over-budget work returns terminal `BUDGET_DENIED` with no side effect.
- Crash after a benchmark side effect reconciles the exact attempt before any retry (retry = new attempt id with `retryOfAttemptId`); cancellation keeps the reservation consumed; unknown usage/cost stays null, never zero.
- Only trusted same-run local checkpoints load; pickle state is never evidence; foreign checkpoints are rejected.
- Optimizer identity is pinned: `gepa` 0.1.4 at commit `d771eb21b5dd3228bc3f567293d2ccfc423fc900`, Python `>=3.10,<3.15`, no extras. Any change is a new optimizer identity.
Limits: the bridge dispatches development and search-validation cases only; the final holdout never enters bridge input. Aggregate optimizer gain cannot bypass independent evaluation.
Details: `scripts/self-improve/gepa-bridge.mjs`, `scripts/self-improve/gepa_adapter.py`, `scripts/self-improve/requirements.lock`.

## S4 — Independent evaluation handoff

Outcome: freeze the evaluation contract before search and map a proposal to the independent HOW-evolution evaluation inputs.
Requires: a validated proposal; sealed partitions; an evaluator-owned final holdout; a frozen metric policy with `minEffect`.
Guarantees:
- `IMPROVEMENT_EVALUATION_HANDOFF_V1` freezes WHAT/acceptance refs+digests, baseline HOW head, optimizer identity/config, allowed axis, development and search-validation partition refs+digests, final holdout ref+digest, metric policy ref+digest with `minEffect`, and model/provider/tool/budget/evaluator identities — before search starts. Post-freeze changes invalidate the handoff.
- `buildHowEvolutionHandoff` maps the proposal to the delivered HOW-evolution finding and evaluation-protocol inputs; final baseline/candidate runs register as benchmark units/attempts; stochastic model-backed cases need at least 3 paired repeats.
- A critical per-case regression blocks promotion even with aggregate gain; missing evidence is `INCONCLUSIVE`. The handoff never calls a policy publisher.
Limits: promotion requires independent evaluation over sealed, pre-frozen partitions. Per-case critical regression or missing evidence is never success.
Details: `packages/agentic-system/src/improvement-proposal.js`.

## Authority and non-claims

- Pattern, reinforcement, optimizer and proposal outputs are evidence or proposals only. They cannot mutate response, acceptance, promotion or policy state.
- Support is counted once per distinct observation set; `SYSTEMIC` requires mechanism evidence covering every supporting episode, never frequency alone.
- No benchmark attempt is dispatched without a prior Node-owned reservation; crash, cancellation or unknown usage never duplicates dispatch, refunds budget or becomes success.
- No live model-effectiveness claim is made here: optimizer acceptance or aggregate gain is not effectiveness evidence, and no paid experiments or universal improvement threshold are asserted.
