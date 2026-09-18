# Bounded self-upgrade pilot

This file describes the concrete BB-035 application pilot implemented today. It is a current-source projection, not a generic self-improvement architecture.

## Scope

`createSelfUpgradePilotController(...)` runs one evidence-gated experiment over one accepted baseline and one isolated candidate.

The protocol fixes, before evaluation:

- user-intent and required-review references;
- source and policy revisions plus their scoped freshness boundaries;
- exact baseline and candidate identity, revision, artifact ref and digest;
- candidate-producer identity;
- independent evaluator identity, evaluator revision and evaluator-policy revision;
- target, development-control and recorded-holdout scenario membership;
- scenario, policy-identity, repeat-pass, candidate-count and evaluation-attempt budgets;
- the exact accepted baseline as rollback target.

The current pilot permits one candidate, exactly two policy identities, no external mutation and at most two evaluation attempts. It does not expose merge, deploy, rollout or adoption operations.

## Durable artifacts and continuation

The pilot uses a local content-addressed JSON store for question, protocol, attempt, experiment, evidence-ledger and result artifacts. Publication writes a complete temporary file and hard-links the immutable digest path before removing the temporary file.

Board lifecycle and refs remain owned by the existing Agentic Application. The pilot composes `createResearchContinuationController(...)` from BB-027, so a fresh session reconstructs the exact protocol, experiment cursor, evidence ledger and result from persisted refs rather than previous conversation state.

Baseline and candidate payloads are independently resolved and must match the protocol-pinned digest before evaluation is accepted.

## Evaluation-attempt fence

Starting an evaluation is a durable lifecycle transition, not an in-memory call.

```text
CLAIMED generation N
  -> persist immutable attempt artifact
  -> checkpoint same research continuation as BLOCKED
     blocker = SELF_UPGRADE_EVALUATION_ATTEMPT:<attempt>:<protocol-digest>
  -> run isolated evaluator
  -> recover the exact blocker atomically
     claimGeneration increases
  -> checkpoint completed experiment/result
```

A concurrent caller using the old claim generation fails before dispatching another evaluator. If the process dies after the attempt marker is published, the Board stays `BLOCKED` and a fresh session must explicitly call `recoverEvaluationAndCheckpoint(...)` with a reason. Recovery creates the next fenced attempt and is rejected after the protocol's fixed attempt budget.

This bounds repeated evaluation work. It does not claim exactly-once execution of an evaluator that crashed after starting; the accepted fixture permits one explicit recovery attempt and performs no external mutations.

## Evaluation outcome

The configured evaluator must match the protocol's exact identity, revision and policy revision. It must report exactly the fixed scenario set, repeat budget and policy-identity count, with evidence refs for each scenario. Production/generalization claims and external mutation are rejected.

The result has only two dispositions:

```text
all fixed scenarios PASS
  -> PROPOSE_FOR_REVIEW

FAIL or INCONCLUSIVE
  -> KEEP_BASELINE
```

In both cases the accepted baseline remains `selectedUntilIndependentAcceptance` and remains the rollback target. A passing experiment is therefore not adoption authority.

## Independent acceptance boundary

`submitForReview(...)` uses the existing research-continuation submission path and creates a PM-sourced independent review requirement. The Blackboard item remains `PENDING_REVIEW`.

The pilot has no `adopt`, merge, deploy or rollout method. Independent project/application acceptance remains a separate authority boundary. The candidate cannot rewrite user intent, review requirements, evaluator identity, evaluation policy, fixed scenario membership or resource limits through its result.

## Failure behavior

The pilot fails closed when:

- baseline/candidate content no longer matches its pinned digest;
- evaluator identity/revision/policy does not match the protocol;
- scenario membership or resource accounting differs from the fixed protocol;
- source/policy revision freshness needs reassessment;
- an evaluation attempt is stale, replaced or exceeds the recovery budget;
- a result claims external mutation, production evidence, generalization evidence or adoption authority.

Failed or inconclusive evaluation evidence remains durably inspectable and the baseline stays selected.

## Public surface

The bounded pilot is exported through:

```text
@exharness/agentic-system/self-upgrade-pilot
```

It remains an application-local pilot. Its existence does not supersede D005, create a generic Core lifecycle facade, or establish a reusable autonomous self-improvement framework.
