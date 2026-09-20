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

For manifest-protected Backend -> QA continuation, the application checkpoint may carry an exact `artifactManifestRef`. That ref is continuation provenance only: it does not become correctness or acceptance authority. Protected `QA_PENDING` is published only after producer manifest durability; recovery of a failed publication remains fenced by Backend/Core recovery semantics.

For an explicitly manifest-protected Backend -> QA workflow, the Application also owns publication ordering: an exact producer manifest ref must be durable before `QA_PENDING` is committed. The manifest publisher has no Board mutation or acceptance authority; a protected fresh QA session must resolve through a reader scoped to the exact persisted manifest ref. Publication failure after Backend effects sets the existing recovery-required fence so Core recovery remains effect replay authority.

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

## Blackboard persisted-value contract

The public Blackboard boundary accepts only values whose semantics survive JSON persistence without silent conversion. Raw snapshots are checked before structural normalization and normalized snapshots are checked again before acknowledgment.

Unsupported persisted values include `Map`, `Set`, `Date`, `undefined`, non-finite numbers, negative zero, `BigInt`, symbol-keyed values, non-enumerable own properties, accessor properties, sparse/extended arrays, cycles and shared object identity. Arrays may contain only their canonical indexed data elements plus the built-in `length` property. Rejection reports the field path and occurs before the fenced store publishes a successor, so failed checkpoint/submission/origin writes preserve the prior lifecycle state. Writable/configurable descriptor flags on ordinary enumerable data properties are outside the persisted JSON-value semantics; hidden values and getters/setters are rejected instead of being silently dropped or executed during validation.

The JSON-value contract wraps the dependency-graph store rather than replacing it. Graph diagnosis/repair remain available through the public store, and repaired snapshots are rechecked for persisted-value integrity before acknowledgment. Transaction results are clone-preflighted before commit so an uncloneable acknowledgment cannot turn a successful persistence write into a caller-visible post-commit failure.

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

A legacy pre-immutable-root `<path>` snapshot is used only to initialize the immutable root when no root authority exists yet. Concurrent initialization publishes exactly one root through hard-link no-overwrite semantics.

Legacy `.lock` files are not correctness authority and are neither trusted nor deleted by the public store. `lockStaleMs` remains accepted for compatibility but elapsed time does not grant takeover authority.

The committed successor record itself is authoritative if a process dies after publication. Projection refresh failure cannot turn a committed transaction into an unknown outcome; a later store reconstruction still resolves the immutable chain. Temporary pre-publication files are not completion evidence.

This is a concrete local durable store. It requires same-filesystem hard-link support and does not claim distributed coordination or automatic history-compaction semantics.

## Backend Core-session persistence contract

`createJsonBackendSessionStore(...)` is a concrete revision-aware local SessionStore for the Backend vertical. It persists Core session state and the AVO action-effect journal used by the same deterministic Backend session id.

Persistence authority is fenced by an immutable single-successor chain per session revision. A save is bound to the exact `expectedRevision`; publication uses same-filesystem hard-link no-overwrite semantics so only one successor may be committed for a given base revision. Concurrent or stale writers fail explicitly with `StoreConflictError` and cannot replace a newer durable Core/effect state. Legacy lock files are not recovery authority and elapsed time does not grant takeover rights.

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

## Bounded horizontal PM / SA coordination contract

The semantic authority split remains: PM coordinates project obligations; SA assesses architecture. The current implementation is only a concrete application-local slice of those horizontal semantics.

`createPmSaCoordinationController(...)` consumes the project-bound session handoff and a concrete PM/SA coordination artifact store. PM and SA receive separate bounded context projections rather than one universal role context.

SA assessment is evidence-bound judgment state:

- it binds one project, durable root intent, target item/work and one or more current target evidence refs;
- it may state whether architecture review is required and record the architecture finding;
- it cannot carry dependency, priority, timeline, lifecycle, completion or review-verdict authority;
- stale/missing evidence or project/root/target drift fails before the assessment becomes applicable coordination input.

PM proposal is bounded coordination proposal state:

- it binds the exact current target lifecycle tuple `{itemId, status, claimGeneration, reviewGeneration}`;
- it may propose fresh prerequisite work, dependency edges for the current target/new work, blockers and PM-sourced review requirements;
- review requirements that claim architecture need must reference a durable current SA assessment that actually requires architecture review;
- it cannot rewrite user intent or carry architecture/completion/review-verdict authority;
- even an empty/no-op proposal must still match the current target state before returning non-mutating fallback.

Roles do not mutate Blackboard directly. The controller validates project/root/target/evidence authority and delegates canonical mutation to `ApplicationOrchestrator`.

`extendWorkGraph(...)` is the concrete Orchestrator-owned graph-extension primitive used by this slice. It adds only fresh READY work, permits dependency extension only for the current target or work created in the same call, rechecks the exact expected target inside the same Blackboard transaction, and atomically commits graph changes, artifact/evidence refs, blockers and PM review requirements. Conflicting duplicate definitions, non-coordinatable target states and invalid complete dependency graphs fail before persistence. A PM review requirement does not clear an existing blocker.

A proposal ref is not sufficient replay authority by itself. Replay requires that the ref is a direct target Board artifact ref and that the proposal's expected new-work provenance, dependency edges, blockers, PM review requirements and grounded SA refs/evidence are still established. A ref present only in a submission, or a direct ref injected by an unrelated checkpoint without the proposal effects, fails closed. `recoverCoordination()` similarly dereferences only direct Board artifact refs rather than submission-contained refs.

Durable PM proposal and SA assessment artifacts become continuation-relevant only after their refs are canonically linked with the corresponding Board effects. An orphan artifact written before a failed canonical mutation does not become project lifecycle truth.

This implementation is not a generic PM/SA agent runtime, role registry, horizontal-role framework, workflow DSL or vertical reviewer implementation.

## Advisor contract

`BackendAdvisor` remains a bounded judgment boundary. Advisor output is proposal state; it does not own Blackboard transitions, dispatch or correctness authority.

The durable Backend -> QA workflow interprets Advisor actions at the application boundary:

- `RETRY` remains an ordinary Backend retry and deterministic `CONTINUE` remains ordinary continuation;
- `REQUEST_CONTEXT` and `ESCALATE` persist `BACKEND_COORDINATION_PENDING` and move the Board item to `BLOCKED` instead of silently redispatching;
- the requirement persists gap ids, context needs, rationale, original Backend stage, attempt and Backend completion-decision provenance;
- `advance(...)` / `current(...)` expose unresolved coordination without redispatching Backend, and generic `resume(...)` fails closed;
- only application-owned `resolveBackendCoordination(...)` may clear the requirement;
- context resolution must declare additional repository files; escalation resolution must identify a resolver and rationale.

The workflow commits resolution through `resolveBlockedCheckpoint(...)`, which compares the exact expected blocked checkpoint and atomically replaces it plus `REOPENED` in one store transaction. Resolution does not accept Backend work, bypass QA, authorize `DONE`, or grant lifecycle authority to the Advisor.

## Organization work/claim authority contract

`ORGANIZATION_WORK_CONTRACT v1` freezes one accepted obligation's owning domain, workload type, exact input/output refs and acceptance refs. Its content-derived ref is stable across duplicate materialization attempts.

Materialization is permitted only while the exact authorization head is `ACTIVE`, still binds the accepted decision and includes the obligation key. The resulting Board item records exact materialization/work-contract provenance; a conflicting duplicate id/key/ref fails closed.

Execution authority is current-head based. A historical policy ref is insufficient after the durable policy head advances or becomes revoked. Principal-to-domain membership is read from the current policy head.

A claim-release receipt binds the exact:

```text
itemId
principal
claimGeneration
workContractRef
materialization authorization id/ref/generation
execution authority policy id/ref/generation
```

The release head is keyed by `{itemId, claimGeneration}`. Duplicate release for the same exact receipt converges; a conflicting receipt fails closed. Execution entry requires a matching current Board claim tuple, a RELEASED head and unchanged active authority heads.

Recovery and invalidation preserve the accepted v7 ordering: generation takeover makes prior release subjects stale; canonical Board invalidation commits before release-head fencing. If release-head fencing later fails, the stale release cannot pass the Board tuple check.

### A.1 repair: durable resolution and trusted publication

Organization work and authority references are now backed by a durable immutable artifact registry. A fresh process resolves the exact work contract from the Board's `workContractRef`; claim/release/recovery no longer accept a caller-supplied raw contract as authority.

Materialization-authorization and execution-authority current heads are advanced through a trusted publisher boundary. The boundary invokes `organizationAuthority.verifyMaterializationAuthorizationIssuer(...)` or `verifyExecutionAuthorityPolicyPublisher(...)` before publishing an immutable authority artifact and CAS-advancing its current head. Raw CAS storage is persistence infrastructure, not publication authority.

Claim freshness is checked both before and after the canonical Board claim. A post-claim authority failure invalidates the provisional claim. Release freshness is checked after durable release publication; a stale result fences that release subject and invalidates the canonical claim.

Organization invalidation is replayable. If the Board transition commits but release fencing fails, the same `invalidationRef` against the same claim generation recognizes the already-applied REOPENED/BLOCKED Board consequence and resumes release-head fencing. A fresh process can therefore reconcile the Board-first crash window.

### A.1 authority-currentness repair

Authority current heads are now pointers, not authority payloads: `{ generation, status, artifactRef }`. Authorization resolves the exact immutable artifact behind `artifactRef` and validates subject, generation and status before reading work scope or principal/domain grants. Raw authority CAS constructors are no longer exported from the package application surface.

Claim and release capture exact authority observations (CAS revision + generation + artifact ref) before their durable mutation and require the same observations afterward. ACTIVE-to-ACTIVE head advancement is therefore a freshness failure even when the new policy would grant the same domain.

Freshness failures preserve lifecycle cause. Materialization/work-authorization failure commits `WORK_AUTHORIZATION_INVALIDATED -> BLOCKED`; execution-policy/principal failure commits `EXECUTION_AUTHORITY_INVALIDATED -> REOPENED`. Post-release failure commits that canonical Board consequence before fencing the release head, so the existing replay path can reconcile a fence crash without leaving canonical lifecycle stale.



### A.1 trust-completion repair

Organization authority consumers are project/root-bound. `ORGANIZATION_WORK_CONTRACT v1` records the durable `projectId`, root item and root intent in addition to obligation/domain/workload refs. Materialization authorization artifacts must bind the same project, and the exact authorization observation is revalidated inside the Board publication transaction and again immediately after publication. Drift after publication moves the newly materialized work to `BLOCKED` rather than leaving stale work eligible.

Execution identity comes from an injected trusted `executionPrincipalProvider`. Caller context is only input to that provider and cannot directly choose the Board owner or policy principal. The released capability records both the derived Board owner and immutable trusted `principalRef`.

`CLAIM_RELEASE_RECEIPT` is an immutable content-addressed organizational artifact. `ClaimReleaseHead` is currentness only and stores `{ status, receiptRef }` under a project-scoped subject derived from `{ projectId, itemId, claimGeneration }`. Execution entry resolves the immutable receipt and checks its exact project/root/work-contract/authority bindings before accepting the release.

Organization-claim invalidation also uses an immutable `CLAIM_AUTHORITY_INVALIDATION` artifact. It binds project/root, exact item/owner/generation, typed cause, observed materialization/execution authority heads, reason provenance, and an optional released receipt ref. The Orchestrator accepts only a content-addressed ref whose payload matches the exact current claim tuple; replay reuses the same artifact and then completes release-head fencing.

These changes remain A.1 application-local trust/currentness semantics. They do not introduce a generic IAM system or enter domain execution/HOW resolution.


### A.1 final-completion repair

Organization-managed work now separates logical obligation identity from exact materialization identity:

```text
obligationSubjectKey = H(projectId, rootIntentId, implementationArtifactRef, obligationKey)
materializationKey   = H(obligationSubjectKey, acceptedDecisionRef, authorizationRef)
```

The canonical materialization transaction derives/validates the Board item id from `materializationKey`, records the exact `authorizationId/ref/generation/revision` plus implementation artifact provenance, and permits at most one live Board item for one `obligationSubjectKey`. A later grant cannot silently create duplicate live work for the same logical obligation.

Claim/release/recovery do not accept a caller-selected materialization authorization subject. They derive the exact `authorizationId` from Board materialization provenance and require the current head revision, generation and artifact ref to match the observation that created the work. The execution-authority policy subject is controller configuration rather than caller authority.

The trusted principal boundary supports both request-context resolution and durable owner recovery. `reconcileOrganizationClaimAuthority({ itemId })` reconstructs the canonical principal from Board owner state and, without incrementing claim generation, either completes a missing release, reconstructs an existing immutable release receipt, or commits typed Board invalidation then fences the release capability.

Verified authority publication persists canonical publisher provenance. The trusted organization-authority adapter returns a canonical `authorityRef`; caller-supplied issuer/publisher provenance is stripped and cannot become authority. Immutable materialization grants carry `issuedByAuthorityRef`; immutable execution policies carry `publishedByAuthorityRef`.

Materialization grants explicitly bind `implementationArtifactRef`, `authorizedSliceIds` and `authorizedObligationKeys`. There is no wildcard grant interpretation.


### A.1 final acceptance repair

`ORGANIZATION_WORK_CONTRACT v1` is now the complete immutable WHAT/provenance artifact for one materialized obligation. It binds project/root, accepted decision, exact materialization authorization id/ref/generation/revision, pinned authority-policy revision, implementation artifact, slice/key, logical `obligationSubjectKey`, grant-bound `materializationKey`, canonical Board item id, domain/workload, bounded summary, declared dependencies, required artifact refs, expected artifact kind/output refs and acceptance refs. Consumers validate the content-derived contract ref rather than reconstructing these semantics from caller input.

Runtime materialization grants are explicit immutable grant/revocation artifacts. Active grants bind project + root intent + accepted decision + implementation artifact + authorized slice/key + pinned authority-policy revision + verified issuer provenance. Wildcard slice/key grants are rejected by the materializer. Execution-authority policy artifacts bind canonical `principalRef` values to authorized domains and carry the same pinned authority-policy revision plus verified publisher provenance; Board-owner display identity is not policy authority.

Claim-release receipts record exact materialization and execution authority refs/generations plus their pinned policy revisions. At execution entry, stale work authorization maps to `WORK_AUTHORIZATION_INVALIDATED -> BLOCKED`; stale execution policy/principal authority maps to `EXECUTION_AUTHORITY_INVALIDATED -> REOPENED`. The canonical Board invalidation commits before historical release-head fencing.

Materialization is exactly-once at two levels: `obligationSubjectKey` permits at most one live logical Board item, while identical `materializationKey` attempts converge on that exact item. Concurrent immutable-artifact writes wait/recheck content identity, concurrent Board publication conflicts reload the deterministic result, and all successful identical callers receive the same content-addressed materialization receipt ref.

`createOrganizationWorkDiscovery(...)` is read-only. It reads current Board eligibility, requires dependencies DONE, resolves and validates each exact immutable work contract/project/root/item binding, and filters by `owningDomain`. It does not authenticate a caller, claim work, choose a next domain, or mutate lifecycle.


### A.1 final authority/recovery race repair

Authority invalidation provenance can be constructed from the exact raw current-head observations even when the immutable authority artifact behind a head is missing or inconsistent. That fallback records the subject, CAS revision, generation, status and artifact ref without treating the broken artifact as trusted authority. This lets fresh reconciliation and execution entry still commit the typed canonical Board consequence before release fencing.

Released capability boundaries also final-revalidate the canonical Board claim tuple. After release publication, during fresh-process reconciliation, and immediately before execution entry returns usable authority, the controller re-reads exact `{ itemId, status: CLAIMED, owner, claimGeneration }`. If that tuple has advanced or been invalidated concurrently, the old release subject is fenced and no stale capability is returned; the newer canonical Board lifecycle is never overwritten by the stale path.

## Domain execution control contract

`ExecutionPolicyHead(domain, workloadType)` is a CAS-fenced current pointer to an immutable `EXECUTION_POLICY`. Trusted publication verifies publisher authority externally before advancing the head. Policy compatibility is explicit by WorkContract version and exact immutable strategy ref.

`ExecutionAttemptHead(project, item, workContractRef)` is the durable current pointer for one semantic attempt. ABSENT may create the first attempt; ACTIVE or RECOVERY_REQUIRED must reuse the exact immutable `EXECUTION_ATTEMPT_BINDING`; TERMINAL is replayable and does not silently mint a new attempt. The binding pins the exact WorkContract, ClaimReleaseReceipt, observed claim/policy heads, policy, strategy, trusted runtime adapter/code identity and stable invocation key before dispatch.

First-attempt publication rechecks the observed policy head before CAS and revalidates the exact released claim. Execution entry revalidates the released claim again immediately before runtime dispatch. Recovery does not consult the current policy/strategy; later policy promotion therefore cannot rewrite an in-flight semantic attempt.

The post-execution chain is explicit and content-addressed:

```text
RUNTIME_EXECUTION_ATTESTATION
 -> EXECUTION_ATTEMPT_OUTCOME
 -> DOMAIN_COMPLETION_DECISION
 -> DOMAIN_PUBLICATION_RECEIPT
 -> EXECUTION_JUDGMENT_BUNDLE
```

Runtime attestation is emitted from the trusted adapter boundary. Outcome is factual strategy result only. Domain completion is a separate authority; `SUCCEEDED != ACCEPT`. Publication is another authority and is attempted only after ACCEPT plus a fresh claim-currentness check. Publication may promote only exact produced outputs and derivation edges already proposed by the outcome.

`EXECUTION_JUDGMENT_BUNDLE` is a derived index. Fresh resolution dereferences the exact WorkContract, release receipt, policy, strategy, binding, runtime attestations, outcome, completion decision, optional publication receipt and transition history, then validates cross-artifact identity relations. It is not correctness or mutation authority.

### Integration B publication/currentness repair

After `DOMAIN_COMPLETION_DECISION.verdict == ACCEPT`, publication is a separate mutation-current transaction. The controller enters an exact organization-claim lifecycle guard backed by the public Blackboard store's shared mutation fence, then an exact current domain writer-authority guard, and performs the canonical write while both remain held. ApplicationOrchestrator wraps organization-claim lifecycle mutations that can invalidate an executable claim—recovery, checkpoint, submit, block, supersede and typed organization invalidation—in that same fence before their normal Board transaction. Guarded publication acquires the fence before reading the lifecycle subject and retains it through the external canonical write. Unrelated Blackboard transactions remain optimistic and are still governed by the immutable single-successor revision chain. Elapsed time never grants a second fence owner; fence contention waits/fails closed rather than stealing ownership.

The publication operation is idempotent under a stable key derived from the semantic execution attempt and immutable binding. Repeated/concurrent recovery for that attempt must return the same canonical publication result rather than duplicate external domain writes.

`DOMAIN_PUBLICATION_RECEIPT` additionally records:

```text
publicationKey
writeAuthorityRef
writeAuthorityRevision
lifecycleObservation
publicationStoreRevision
```

Those fields are historical proof of the exact mutation gate used for the commit. They do not become new authority for future writes.

`EXECUTION_ATTEMPT_TRANSITION` records `observedHeadRevision` for every transition that advances an existing attempt head; the first ABSENT -> ACTIVE transition records no predecessor revision. Fresh reconstruction walks the immutable transition sequence, reconstructs the exact nonterminal head value after each transition, derives its CAS revision and requires the next transition's `observedHeadRevision` to match. Status continuity alone is insufficient.
