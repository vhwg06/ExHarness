# Agentic Application contract policy

This file describes the application contract rules implemented today. It intentionally does **not** freeze generic Worker/WorkOrder/Reviewer APIs before concrete slices prove them.

## Principle

Application boundaries become explicit, typed and runtime-validatable where external/model-produced data crosses a semantic or authority boundary.

Abstraction still follows evidence:

> No generic abstraction before concrete repeated semantics justify it.

## Concrete role contracts

Backend and QA remain materially different concrete slices.

```text
BackendObjective / BackendWorkOrder / BackendContext / BackendWorkResult
QaObjective / QaWorkOrder / QaContext / QaWorkResult
```

Application decides required semantic context; Oracle resolves/dereferences it before Worker execution.

```text
Application semantic contract
    -> Oracle resolves context
    -> Worker binds execution to ExHarness
```

There is no generic `Worker<C,R>`, generic WorkOrder/WorkResult, role registry, Teacher registry, Reviewer registry or workflow graph/DSL.

## Role completion contract

Worker prose is not completion authority.

Backend completion requires grounded Backend evidence; QA completion requires grounded QA evidence. Both use ExHarness trust/decision primitives at the application acceptance boundary.

Role-local completion remains distinct from Blackboard problem completion.

## Blackboard orchestration contract

The concrete `ApplicationOrchestrator` owns Board lifecycle transitions over a transactional store.

```text
READY/REOPENED -> CLAIMED -> PENDING_REVIEW -> REVIEWING
                                     |              |
                                     |              +-> REOPENED
                                     |              +-> DONE
                                     +-> deferred review survives restart
```

A Worker submission cannot transition directly to `DONE`.

Worker and PM have separate review-initiation authority:

```text
Worker -> REQUEST review at submit
PM     -> REQUIRE review from project obligations
```

`REQUEST != REQUIRE != DISPATCH != ASSESS != ACCEPT`.

## Review target and trust contract

`beginReview(...)` freezes an exact review target subject over:

```text
Blackboard item id
+ review requirement key
+ exact submitted payload
+ submission producer identity
```

`recordAssessment(...)` does not accept a naked caller-provided verdict. It accepts a Core trust bundle:

```text
EvidenceArtifact[]
DecisionArtifact
Attestation
```

The Orchestrator validates that:

- the bundle is structurally/integrity valid;
- evidence is bound to the active review target;
- the decision evaluator is the scheduled reviewer and differs from the submission producer;
- the decision/attestation is at `TrustBoundary.ACCEPTANCE`;
- signature, evaluator authority and evidence authority pass application-provided trust verification;
- issuer/evidence authority is independent from the submission producer;
- the review policy digest is accepted by the concrete application trust policy;
- `ACCEPTED` carries no unresolved findings/claims.

Only the trusted DecisionArtifact verdict is applied to Board state.

Trust verification runs before the Board mutation transaction; the transaction re-checks that the active review target has not changed before committing the assessment.

## Durable store contract

`createJsonBlackboardStore(...)` exposes read + transactional mutation only.

Mutations are serialized with a filesystem lock and snapshots are persisted by temporary-file write + rename. Concurrent claims therefore cannot both acquire the same Board item through the JSON store.

This is a concrete local durable store, not a claim of distributed coordination semantics.

## Follow-up contract

A finding requires a provenance `sourceRef` before it can mutate canonical Board work.

The Orchestrator classifies it as:

```text
CURRENT_WORK
EXISTING_WORK
NEW_WORK
NON_ACTIONABLE
```

A finding that proves the current acceptance obligation remains unmet reopens/narrows that same item instead of manufacturing replacement work.

## Horizontal role decision vs current implementation

D003 promotes PM as horizontal project coordination and SA as horizontal architecture only. Concrete PM context/role execution, SA context/role execution and vertical reviewer Workers are not implemented yet and are not current-source contracts here.

## Advisor contract

`BackendAdvisor` remains a bounded judgment boundary. Advisor output is proposal state; it does not own Blackboard transitions, dispatch or correctness authority.
