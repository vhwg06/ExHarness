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

Role-local completion remains distinct from Blackboard problem completion. Interrupted recovery is also not completion authority: a recovered Backend result must pass the same ordinary lineage/evidence/completion policy as a non-recovered result.

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

## Execution-generation contract

Every execution claim increments a monotonic `claimGeneration` independent from owner identity.

```text
claim
  -> { owner, claimGeneration }

checkpoint / submit / block
  require exact current { owner, claimGeneration }
```

`recoverClaim(...)` is the explicit interrupted-work takeover transition. It is valid only from `CLAIMED`, increments the generation before replacement work can mutate canonical state and therefore fences the abandoned attempt even when the replacement reuses the same owner name.

A stale generation cannot checkpoint, submit or block. Owner equality alone is insufficient authority. Elapsed time, heartbeat loss or lease expiry is not execution correctness authority and does not prove an external effect is safe to retry.

## Review target and trust contract

`beginReview(...)` freezes an exact review target subject over:

```text
Blackboard item id
+ review requirement key
+ exact submitted payload
+ submission producer identity
+ review generation
```

Every review dispatch increments `reviewGeneration`.

`recoverReview(...)` explicitly replaces an interrupted active review with a new generation and exact subject. Evidence/decision/attestation from the abandoned generation therefore fails exact-target binding even when the same reviewer is selected again.

`recordAssessment(...)` does not accept a naked caller-provided verdict. It accepts a Core trust bundle:

```text
EvidenceArtifact[]
DecisionArtifact
Attestation
```

The Orchestrator validates that:

- the bundle is structurally/integrity valid;
- evidence is bound to the active review target, including the current review generation;
- the decision evaluator is the scheduled reviewer and differs from the submission producer;
- the decision/attestation is at `TrustBoundary.ACCEPTANCE`;
- signature, evaluator authority and evidence authority pass application-provided trust verification;
- issuer/evidence authority is independent from the submission producer;
- the review policy digest is accepted by the concrete application trust policy;
- `ACCEPTED` carries no unresolved findings/claims.

Only the trusted DecisionArtifact verdict is applied to Board state.

Trust verification runs before the Board mutation transaction; the transaction re-checks that the active review target/generation has not changed before committing the assessment.

## Terminal cancellation contract

Once a Blackboard item is `SUPERSEDED`, later transactions cannot remove or mutate that item. Cancellation preserves the exact stored submission, review, evidence, finding and blocker history for inspection while preventing delayed reconciliation from reviving the item or creating follow-up work from it.

This invariant is enforced at the public Application Orchestrator transaction boundary, so `NON_ACTIONABLE`, `CURRENT_WORK`, `EXISTING_WORK`, `NEW_WORK` and any equivalent stale mutation path fail before persistence when they would change an already-superseded item. `SUPERSEDED` is therefore terminal unless a separate future contract explicitly introduces a new transition.

## Blackboard dependency graph contract

The public complete-snapshot boundary rejects dependency graphs containing dangling edges, self dependencies or cycles. Validation is order-independent: a valid DAG remains accepted when a dependency appears later in the snapshot, and the durable intent root is an ordinary valid dependency when it exists in the same Board.

Normal public store reads and transactions validate the complete graph. Transactions validate the current graph before mutation and the resulting graph before fenced persistence, so an invalid mutation cannot replace the prior committed snapshot. `NEW_WORK` reconciliation is covered by the same resulting-snapshot validation rather than validating only the child item.

Previously accepted structurally valid but graph-invalid legacy state is not silently rewritten. `diagnoseDependencyGraph()` exposes offending item/edge information without admitting the Board for ordinary use. `repairDependencyGraph({ replacements })` requires explicit complete dependency replacements, executes through the fenced store transaction boundary, and must produce a valid complete graph before commit. Failed or incomplete repair leaves the prior committed state unchanged and never invents completed dependencies or silently drops edges.

## Durable Blackboard store contract

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

`<path>.root` plus immutable successor records are persistence authority. The caller-selected `<path>` JSON file remains a compatibility/inspection projection of the latest committed snapshot; it is refreshed only after commit publication and is never read as authority once the immutable root exists. Tampering with or losing that projection cannot roll back the committed chain.

A legacy pre-D011 `<path>` snapshot is used only to initialize the immutable root when no root authority exists yet. Concurrent initialization publishes exactly one root through hard-link no-overwrite semantics.

Legacy `.lock` files are not correctness authority and are neither trusted nor deleted by the public store. `lockStaleMs` remains accepted for compatibility but elapsed time does not grant takeover authority.

The committed successor record itself is authoritative if a process dies after publication. Projection refresh failure cannot turn a committed transaction into an unknown outcome; a later store reconstruction still resolves the immutable chain. Temporary pre-publication files are not completion evidence.

This is a concrete local durable store. It requires same-filesystem hard-link support and does not claim distributed coordination or automatic history-compaction semantics.

## Backend Core-session persistence contract

`createJsonBackendSessionStore(...)` is a concrete revision-aware local SessionStore for the Backend vertical. It persists Core session state and the AVO action-effect journal used by the same deterministic Backend session id, using local filesystem locking and revision conflict checks.

It explicitly declares `supportsDurableRecovery: true`. Absence of persisted Core state is usable as recovery evidence only when the configured store declares that durable-recovery authority. The default in-memory store does not, so an empty volatile store fails closed rather than being interpreted as proof that no interrupted external effect occurred.

This store is not a generic Core recovery facade, project store, distributed lock/lease service or exactly-once effect mechanism.

## Interrupted Backend recovery contract

Backend is mutating, so Blackboard generation takeover alone cannot authorize redispatch.

`BackendWorker.recover(...)` / `recoverBackendObjective(...)` recover the exact persisted Backend WorkOrder/Context and Core session/effect state before deciding whether execution can continue.

```text
no persisted Core session + durable-recovery store authority
  -> normal fresh execution may start

no persisted Core session + no durable-recovery authority
  -> BLOCK; empty volatile state does not prove effect absence

confirmed effect on original candidate
  -> close interrupted Core variation
  -> replay same strategy/session
  -> effect journal returns confirmed result without external redispatch

idempotent ambiguous effect
  -> Core reconciliation prepares retry under existing replay policy/action key
  -> ordinary Backend execution/completion continues

non-reconcilable ambiguity
  -> BLOCK; do not redispatch

candidate divergence / multiple mutation effects /
already-advanced candidate without durable Worker semantic result
  -> BLOCK / require reassessment
```

A caller assertion, Blackboard checkpoint, owner identity or elapsed time cannot replace Core effect truth. A recovered result still must satisfy ordinary Backend lineage advancement, mutation/typecheck/test evidence, artifact and completion policy requirements.

## Interrupted QA recovery contract

QA is non-mutating at the application environment boundary. After `recoverClaim(...)` invalidates the abandoned execution generation, the durable workflow may rerun QA against the exact persisted accepted Backend revision/artifact handoff. The new generation still fences a late result from the abandoned attempt.

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

The handoff work projection includes current `claimGeneration`, `reviewGeneration` and `activeReview` state so a fresh session can identify the durable execution/review attempt rather than relying on prior conversation context.

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
