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

The public `createJsonBlackboardStore(...)` exposes read + transactional mutation over a concrete local filesystem store.

Mutation correctness is fenced by an immutable single-successor revision chain rather than by elapsed-time lock ownership:

```text
immutable root snapshot
  -> one successor for root
  -> one successor for revision r1
  -> one successor for revision r2
```

Each committed revision has an opaque identity token. A transaction resolves the exact current revision, executes its mutator against that snapshot and atomically publishes one complete successor record for that base revision with same-filesystem hard-link no-overwrite semantics.

If another transaction already published a successor for the same base revision, the stale/concurrent writer fails explicitly with a transaction conflict before it can publish a replacement snapshot.

Commit records also carry the digest of the exact base snapshot for mismatch/corruption detection. Snapshot value identity is not revision identity, so a later revision may legitimately contain the same logical snapshot value as an earlier one.

`<path>.root` plus the immutable successor records are persistence authority. The caller-selected `<path>` JSON file remains a compatibility/inspection projection of the latest committed snapshot; it is refreshed only after commit publication and is never read as authority once the immutable root exists. Tampering with or losing that projection cannot roll back the committed chain.

A legacy pre-BB-023 `<path>` snapshot is used only to initialize the immutable root when no root authority exists yet. Concurrent initialization publishes exactly one root through hard-link no-overwrite semantics.

Legacy `.lock` files are not correctness authority and are neither trusted nor deleted by the public store. `lockStaleMs` remains accepted for compatibility but elapsed time does not grant takeover authority.

The committed successor record itself is authoritative if a process dies after publication. Projection refresh failure cannot turn a committed transaction into an unknown outcome; a later store reconstruction still resolves the immutable chain. Temporary pre-publication files are not completion evidence.

This is a concrete local durable store. It requires same-filesystem hard-link support and does not claim distributed coordination or automatic history-compaction semantics.

## Project-bound session-handoff contract

`createSessionHandoffSurface({ orchestrator, projectId })` can bind a runtime handoff surface to one explicit project identity.

The identity is persisted on the durable `USER_INTENT_ROOT` and is intentionally distinct from:

```text
store path
session / owner identity
WorkOrder or Blackboard item id
user-intent id
```

For a project-bound Board:

- the handoff projection exposes the stored `projectId`;
- a fresh session must provide the same expected project id;
- another project id is rejected rather than treated as a valid continuation;
- an unbound legacy reader is rejected rather than silently dropping the project boundary.

For a legacy Board with no project identity:

- unbound low-level compatibility reads remain possible;
- a project-bound reader rejects it instead of inferring identity from path, task text or user intent.

Project identity is Board/root authority. It is not copied into every work-item origin; work provenance remains responsible for root-intent/parent/finding lineage.

This contract does not introduce a project registry, distributed store identity, Markdown/JSON synchronization or self-hosting migration.

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
