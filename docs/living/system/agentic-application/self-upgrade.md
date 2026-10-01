# Bounded self-upgrade pilot

The Agentic Application exposes one opt-in self-upgrade experiment pilot over the existing research-continuation and Blackboard lifecycle surfaces. It is not a generic SelfImprover runtime.

## Authority boundary

The pilot accepts one fixed `SELF_UPGRADE_EXPERIMENT_PROTOCOL v1` containing:

- the exact durable user-intent root reference;
- one pinned accepted baseline and one pinned candidate, each with identity, revision, artifact ref and digest;
- candidate-producer identity;
- independent evaluator identity/revision plus exact evaluator-policy ref, revision and digest;
- fixed target, development-control and recorded-holdout scenario membership;
- fixed resource/attempt budget;
- the exact independent review requirement key;
- an exact rollback target equal to the accepted baseline;
- `adoptionAuthority: false`.

The protocol is rejected when the user-intent root does not match the project handoff, evaluator identity equals the candidate producer, the candidate/baseline identity collapses, scenario membership exceeds the fixed budget, rollback differs from the baseline, or the protocol grants adoption authority.

## Durable experiment state

`createSelfUpgradePilotController(...)` composes the delivered research-continuation boundary:

```text
Blackboard lifecycle + RESEARCH_CONTINUATION cursor
  -> content-addressed question/protocol/experiment/ledger refs
  -> fixed baseline/candidate pins
  -> bounded evaluation attempt
  -> completed result + evidence ledger
```

The Board remains lifecycle + refs. Experiment work products are immutable external artifacts.

The local JSON artifact store validates JSON-safe persisted values before cloning/writing, writes through a temporary file, and publishes an immutable content-addressed envelope. Unsupported values fail before persistence rather than being silently converted.

## Evaluation and recovery

Before evaluator execution the item is durably blocked with an exact namespaced attempt marker:

```text
SELF_UPGRADE_EVALUATION_ATTEMPT:<attempt>:<protocol-digest>
```

A crash therefore does not make the same experiment silently eligible for redispatch. Recovery is application-owned and requires the exact blocker plus exact research-continuation checkpoint. Recovery increments the Blackboard claim generation before the next bounded attempt.

The v1 pilot permits one candidate and at most two evaluation attempts. It forbids reported external mutation and does not expose repository/deployment mutation authority.

## Result semantics

The evaluator must return the exact evaluator identity, revision, policy ref, policy revision and policy digest from the fixed protocol. Scenario membership and repeat/policy-identity budgets must also match.

```text
PASS + every fixed scenario PASS
  -> PROPOSE_FOR_REVIEW

FAIL
INCONCLUSIVE
any scenario not PASS
  -> KEEP_BASELINE
```

Both outcomes persist evidence. `selectedUntilIndependentAcceptance` and `rollback` remain the accepted baseline.

Only `PROPOSE_FOR_REVIEW` can call `submitForReview(...)`. The review key must be the single key fixed in the protocol. Submission uses the atomic proposal + PM-required-review boundary and remains `PENDING_REVIEW`; there is no `adopt`, merge, deploy or rollout method.

## Evidence limits

The delivered pilot proves a bounded deterministic application contract over recorded scenarios. It does not establish:

- production effectiveness;
- candidate-generation quality;
- statistical generalization;
- independent organizational execution;
- safe live self-modification;
- automatic adoption or rollout.

Any future production adoption requires separate representative evidence and independent project acceptance.

## HOW evolution (organization loop)

The bounded pilot above is unchanged. The organization-level HOW-evolution loop in `packages/agentic-system/src/how-evolution.js` reuses its pinning, independence and budget patterns, not its pilot-specific contract:

- `HOW_EVOLUTION_FINDING` binds one causal observation projection (subject, projection, domain/workload, baseline policy/strategy, one bounded HOW axis) into immutable evidence-only state. It grants no candidate, evaluation, promotion, rollback or product-acceptance authority.
- `HOW_EVOLUTION_EVALUATION_PROTOCOL/v1` pins one pinned accepted baseline and one pinned candidate against one fixed semantic/acceptance subject, plus evaluator/policy, trigger/regression/holdout cases, metric thresholds, replay/budget, evidence snapshot and the expected policy head.
- `evaluateHowEvolution(...)` compares paired per-case runs plus the evaluate-only Jev receipt and returns `PROPOSE_FOR_PROMOTION` only for satisfied hard gates and the held-out `minEffect`; every other outcome is `KEEP_BASELINE` and leaves the baseline current.
- `createHowEvolutionJevEvaluator(...)` (`how-evolution-jev-adapter.js`) is the only Jev seam. It posts the real SystemOne `{model, state, questions}` schema (one narrow typed Choice judgment per pinned semantic question, with `questions` as an object keyed by question ID exactly like the owner controller contract) and parses typed answers under the trusted probability contract. `state` carries the exact bounded hash-bound evidence bodies (subject pins, scenario set, metric policy, per-record body/digest/producer/environment), never opaque references alone. Evidence records must carry explicit digests, producer identities and environment digests; anything missing or integrity-mismatched fails closed, and the pinned evidence snapshot must be fully covered. The receipt is accepted only for the exact pinned question set, model snapshot and evidence identity. Authority is verified through `evaluateTrustBoundary()` under a policy that requires the pinned evaluator identity and every evidence producer identity (evidence producers independent from the candidate producer); missing verifiers, missing authority evidence or a negative verification fails closed to `INCONCLUSIVE`. `TYPESAFE_API_KEY` comes from the process/CI environment only and is never persisted or returned. The adapter has no repository, product, policy-publisher, promotion or rollback capability.
- Promotion is a separate independently authorized action: `createHowEvolutionPromotionProposal(...)` is proposal-only, then `publishHowEvolutionPromotion(...)` revalidates protocol/evaluation digests, independent promotion authority (candidate producer, evaluator and promoter are three distinct roles), the current `ExecutionPolicyHead` against the expected tuple, and semantic-subject, evaluator-policy, scenario-set and evidence-snapshot currentness through four required freshness readers (promotion with only a head check is refused) before calling the existing `createDomainExecutionPolicyPublisher`, whose authority check, generation+1 and CAS remain the only policy-currentness mutation. Any drift fails closed and requires a fresh evaluation; a stale proposal is never silently rebased.
- Promotion affects new attempts only. `ACTIVE`/`RECOVERY_REQUIRED` attempts retain their original `ExecutionAttemptBinding`; the in-flight/recovered old attempt continues on the old head while new attempts may resolve the promoted head.
- Rollback publishes another immutable `ExecutionPolicy` generation through the same currentness, authority and CAS path with `reasonKind: ROLLBACK`. The rollback publisher must be the protocol promotion authority, independent from candidate producer and evaluator; the reversed promotion must bind the reversed evaluation, the exact protocol and its own resulting head, and the live current head must still equal that promotion head. The target is an exact prior accepted strategy whose rollback target equal to the accepted baseline strategy, with reason evidence refs. No artifact or head history is rewritten; the rollback successor stays auditable beside the reverted promotion.
- Findings, protocol, paired runs, Jev receipt, evaluation, proposal and promotion/rollback decisions are immutable content-addressed artifacts (injected store port; local JSON adapter is test/dev only). The only mutable head is `ExecutionPolicyHead`, which stores a compact current pointer so a fresh process can reconstruct the full finding to policy-head provenance chain by exact refs and digests without conversation history.
<!-- Delivery rebuild 2026-10-01: re-validated on current main. -->
