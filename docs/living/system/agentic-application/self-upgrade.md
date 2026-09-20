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
