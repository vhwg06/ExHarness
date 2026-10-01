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

### Integration C semantic publication and obligation contract

`DOMAIN_WRITE_AUTHORITY_POLICY` is independently published by a trusted policy authority. Its per-domain CAS head authorizes named principals, semantic kinds, and exact obligation-kind/target-domain pairs. The production `createDomainPublicationGate` implements the existing controller gate interface. Publication requires the live write-guard capability, a persisted ACCEPT completion bound to the same contract/outcome/binding, exact content-addressed produced revisions, and explicit accepted upstream revision edges. Runtime proposals and caller-made guard observations cannot commit product truth.

`SEMANTIC_CLAIM` identity separates the stable project/root/domain/kind/subject key from immutable normalized content. `CROSS_DOMAIN_OBLIGATION` identity uses project/root, issuing semantic subject, target domain/workload, obligation kind and stable obligation key. Its revision pins the exact issuing claim, required outcome, inputs, expected artifact kind and acceptance refs. Unknown fields, including dispatch mechanics, are rejected. Identical normalized content shares a revision. Changed content supersedes the previous revision without rewriting it; historical superseded content cannot reactivate itself.

Immutable `PRODUCT_LINEAGE_EVENT` records bind accepted publication receipts, semantic currentness transitions and `PRODUCT_DERIVATION_EDGE` records. A CAS journal root atomically selects the authoritative event chain. The chain reconstructs heads and lineage in a fresh reader; reverse adjacency is derived. STALE and REVOKED heads cannot authorize mutation, and a head that points to a replacement makes its old revision SUPERSEDED. Historical transitions and artifact bytes remain resolvable. Only edges to the dependent's currently selected revision participate in reverse-transitive invalidation.

Publication captures exact consumed head observations before receipt persistence and validates them during and after commit. Drift leaves the dependent non-current; a later supersession sees its already committed edges and invalidates the same closure. The write guard is domain-local, allowing independent domain publications to interleave without making a global scheduler.

Cross-domain work contracts additionally pin `crossDomainObligationRef`, `crossDomainObligationSubjectKey` and `crossDomainPublicationReceiptRef`. Materialization authorization must name that exact revision as its implementation artifact. Materialization revalidates semantic currentness at the Board write boundary and afterward. Claim/release, execution entry and guarded publication require the obligation to remain ACTIVE. Durable reconciliation blocks exact affected READY/REOPENED work or invokes canonical claim invalidation and release fencing for CLAIMED work. It never traverses Board dependency edges as semantic lineage or resets unrelated work. Publication reconciliation runs after the lifecycle guard is released to avoid reentering the same Board fence.

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

## Domain activation and FE/BE execution contract

### Activation key and canonical source

An activation key is exactly `{projectId,workId,owningDomain}`; every other hint field is ignored. `scan({owningDomain})` returns keys for `listEligible({owningDomain})` results. `read(key)` rereads the canonical Board item and WorkContract and returns `null` when the work is not READY/REOPENED in that domain. Queue, cursor, timer and hint state are disposable latency state, never canonical work truth.

### Reconcile outcome

`reconcile(key)` returns an immutable `{state,reason?,key,...}` with `state` in `EXECUTED | NOOP | REJECTED` and `reason` in `DOMAIN_MISMATCH | NOT_ACTIONABLE | CONTRACT_MISMATCH | OBLIGATION_NOT_CURRENT | OBLIGATION_DRIFT_AFTER_RELEASE | CLAIM_CONTENDED | DUPLICATE_IN_FLIGHT`. `EXECUTED` carries `contractRef`, `claimGeneration`, `receiptRef` and the controller's execution identity (`executionAttemptId`, `bindingRef`, `completionDecisionRef`, `publicationReceiptRef`, `judgmentBundleRef`). Ordering is fixed: domain admission -> canonical reread -> pre-claim obligation currentness -> claim (host principal) -> release -> post-release currentness recheck -> `execute({itemId,claimGeneration,receiptRef})`.

### Obligation currentness reader

`createObligationCurrentnessReader({resolveObligation,currentHead})` exposes only `current(obligationRef) -> {obligationRef,subjectKey,revision,status}`. `obligationCurrentnessFromLineage({lineage})` binds it to the product lineage read surface (`resolve`, `snapshot`). Work is current only when `status == ACTIVE`, `revision == WorkContract.crossDomainObligationRef` and `subjectKey == WorkContract.crossDomainObligationSubjectKey`. The reader has no write, invalidation or fencing capability.

### Runtime adapter input

`DomainExecutionController` passes `{binding,contract,input,runtimeInvocationKey}` to `runtimeAdapter.dispatch/recover`, where `contract` is the exact released-claim WorkContract. Only the controller resolves policy/strategy, binds the attempt, revalidates the release and attests the runtime.

### DomainExecutionInput

`DOMAIN_EXECUTION_INPUT` v1 is `{kind,version,projectId,owningDomain,workloadType,objective}` addressed as `domain-execution-input:sha256:<digest>` and stored through `putDomainExecutionInput` / `resolveDomainExecutionInput` on the organization artifact registry. Principal, policy, strategy, runtime, next-role/domain, priority, stage and obligation fields are rejected. Execution requires exactly one such ref in `requiredArtifactRefs`, matching the contract's project, owning domain and workload type.

### Frontend domain

`FrontendObjective -> FrontendWorkOrder (<id>:frontend) -> FrontendContext -> FrontendWorkResult (APPLIED | BLOCKED | FAILED)`. Frontend completion accepts only grounded `frontend.mutation`, `frontend.typecheck` and `frontend.tests` evidence plus artifact presence; a policy cannot drop those claims. `prepareFrontendObjective`, `runPreparedFrontendObjective` and `recoverPreparedFrontendObjective` depend on no Backend stage, session or completion state.

### Domain strategies

`createBackendExecutionStrategy(...)` / `createFrontendExecutionStrategy(...)` accept only their own domain's contracts, map WorkContract + input to the domain objective (id = Board item id), run prepare/run/recover, and map results to the controller: accepted `APPLIED -> SUCCEEDED` with output artifacts, derivation edges from the input ref and evidence ids as verification candidates; `BLOCKED -> BLOCKED`; `FAILED` or unaccepted work -> `FAILED` with completion reasons as counterevidence. The Backend strategy never calls the Backend -> QA composite flow.

## Deployment identity and Product QA acceptance contract

- **Provenance.** `publishDeployableArtifact(...)` resolves the source delivery with `resolveAcceptedSourceDelivery(...)` (receipt plus ACCEPT decision from the owning FE/BE domain) and writes `BuildProvenance` then `DeployableArtifactRef`. `resolveDeployableProvenance(...)` walks the chain back and rejects any mismatch between the component kind, source domain and digest.
- **DevOps domain.** `createDevOpsExecutionStrategy(...)` (`DEVOPS_DOMAIN`) parses the deployment objective, calls the deployment adapter and emits only `DEPLOYMENT_EXECUTION_EVIDENCE`. It never publishes a release.
- **Release currentness.** `createDeploymentReleaseController(...)` publishes a `DeploymentRelease` for an environment from an ACCEPTed DevOps judgment bundle. The head is keyed by `deploymentReleaseSubjectKey(environmentRef)` and moves by CAS from `previousReleaseRef`. `current(environmentRef)`, `resolveRelease(ref)` and `withCurrentReleaseGuard(...)` are the read paths. `DeploymentReleaseDriftError` (`DEPLOYMENT_RELEASE_DRIFT`) is raised when a guarded mutation sees a different current release.
- **Acceptance snapshot.** `defineAcceptancePolicy(...)` requires both components, criterion refs and trusted observer refs, and optionally permitted runtime digests. `createAcceptanceSnapshotBuilder(...).build({releaseRef, acceptancePolicyRef})` accepts only those two keys. `resolve(snapshotRef)` recomputes the snapshot and rejects a stored snapshot that differs.
- **Runtime observation.** `createRuntimeObserver(...)` accepts only a snapshot ref and a trusted observer. It rejects release objects and self-reported identities. `classifyRuntimeIdentity(...)` returns `RuntimeObservationStatus`.
- **Product QA.** `createProductQaExecutionStrategy(...)` (`PRODUCT_QA_DOMAIN`) returns BLOCKED with `RELEASE_DRIFT` counterevidence when the snapshot's release is no longer current at start. Otherwise it records runtime observation and criterion evidence bound to the snapshot. `createProductQaCompletionEvaluator(...)` returns ACCEPT only when the observation is acceptable and every criterion is PASS, and `REMEDIATION_REQUIRED` otherwise. `createQualityAcceptancePublisher(...).publish({judgmentBundleRef, snapshotRef})` writes `QualityAcceptance` inside `withCurrentReleaseGuard(...)` and advances the head keyed by `qualityAcceptanceSubjectKey(environmentRef)`. `resolve(ref)` and `currentFor(environmentRef)` are the read paths.

## Integration G — product history, projection and closure contract

- **Completeness cursor.** `productHistorySubjectKey(productId)` derives one CAS head per product. `createProductHistoryController({artifactStore, headStore, mutationGuard, authorityReaders})` exposes `appendTransition({productId, transitionKind, transitionRefs, authorityHeads})`, `current({productId})`, `withCurrentHistoryGuard({productId, expectedGeneration, expectedDigest}, action)` and `reconcile({productId, transitionKind, transitionRefs, authorityHeads})`. Each `PRODUCT_HISTORY_COMMIT` binds `previousCommitRef`, `generation`, `previousDigest`, `historyDigest`, `transitionRefs[]` and the observed closure-relevant authority heads; fresh reads validate full chain continuity. Only closure-relevant kinds (`SEMANTIC_PUBLICATION`, `OBLIGATION_TRANSITION`, `RELEASE_PUBLICATION`, `QUALITY_ACCEPTANCE`, `ACCEPTED_PRODUCT_REVISION`, `ACCEPTANCE_POLICY_REVISION`, `WAIVER_REVISION`) advance the head; execution policy/strategy/attempt kinds are rejected. The shared `createProductMutationGuard()` serializes history, acceptance, lineage, release and closure paths per project/environment key and also implements `withEnvironment`, so it can serve as the delivered deployment release `mutationGuard`.
- **Acceptance authority.** `createProductAcceptanceAuthority({artifactStore, headStore, mutationGuard})` exposes `publishPolicy({productId, policy})`, `publishWaiver({productId, waiver})`, `resolveCurrent({productId})` and `withCurrentPolicyGuard(...)`. Policy/waiver artifacts are immutable; one CAS head pins `policyRef`/`policyRevision`, the sorted/deduplicated applicable `waiverRefs` and `waiverSetDigest`. The resolver derives the full applicable set from canonical authority; no public API accepts caller `waiverRefs`.
- **Deterministic projection.** `createProductStateProjectionBuilder({productHistory, acceptanceAuthority, artifactStore, artifactResolvers, mutationGuard})` exposes `build({productId, rootIntentRef})`, `rebuild({subject})` and `resolve(projectionRef)`. Any caller-selected `claimRefs`/`obligationRefs`/`qualityRefs`/`waiverRefs` input is rejected, and any enumerating `list*`/`current*` resolver is rejected at construction: resolvers may only resolve one given ref to its immutable content. The builder holds the shared guard in fixed order (history, then acceptance) across head read, validated chain fold from genesis to the pinned head, per-ref immutable resolution and the acceptance read, so one projection can never mix `Hn` with later state. Later commits supersede earlier ones per identity key (claim subject, obligation key, release/quality environment slot); uncommitted store artifacts have no effect. The builder stores the content-addressed `PRODUCT_PROJECTION_SUBJECT` plus `PRODUCT_STATE_PROJECTION` (`readiness`, `activeSetDigest`, `blockers`). `rebuild({subject})` re-derives the same subject's projection byte-identically (same readiness, active-set digest, blockers). The projection is disposable and can never mutate canonical authority.
- **Closure fence.** `createProductClosureController({projectionBuilder, productHistory, acceptanceAuthority, artifactStore, outcomeHeadStore, mutationGuard})` exposes `close({projectionRef})` and `currentOutcome({productId})`. `close` resolves the stored projection, requires `ELIGIBLE_FOR_CLOSURE`, then holds the history guard and the acceptance guard (fixed order history -> acceptance) across the whole sequence: freshness re-read of exact generation/digest/policy revision/waiverSetDigest, the immutable `PRODUCT_OUTCOME_CLAIM` write and the outcome-head CAS. A stale `Hn` or drifted policy basis rejects with `STALE_PROJECTION`; a current head pinning a newer history generation also rejects instead of retrying; a lost CAS inside the guard surfaces a conflict error. `currentOutcome` returns `CURRENT` only when the pinned subject matches current history/policy state and a pinned rebuild stays eligible; otherwise `HISTORICAL` (old claims stay resolvable) or `NOT_READY`/`RECOVERY_REQUIRED` on history drift. Only drift errors map to `NOT_READY`; other errors propagate.

## Integration H — adversarial recovery contract

There is no recovery manager. Each crash window is owned by the boundary that owns the affected authority/currentness subject, and every restart reconstructs from durable canonical refs and CAS heads only. Process memory, queues, hints and conversation state are never authority.

- **Same-attempt reuse.** `EXECUTION_ATTEMPT_BINDING` is immutable and attempt creation is converged (one ordinal per work subject). Recovering an in-flight attempt reuses its binding; repair cannot silently re-resolve HOW or mint a second semantic attempt. Only new authorized work or input may create a new attempt.
- **Stale-capability fencing.** After claim-generation takeover, the old generation fails the Board tuple and release-head checks before dispatch and before publication. The same fencing applies to stale release receipts, superseded semantic inputs, drifted release heads and non-current QA/projection subjects: none can authorize new effects or current acceptance.
- **Committed-publication reuse.** The publication gate exposes a read-only `resolveCommittedPublication({publicationKey})` over its lineage journal. When recovery finds a committed publication for the attempt's stable key, it resolves the exact receipt chain (receipt, ACCEPT decision, outcome, attestations), verifies the contract/binding relations, skips the runtime rerun, derives downstream effects idempotently through `reconcileWork()`, and commits the terminal head against the committed refs. A publish conflict followed by an existing commit converges the same way; a publish failure with no commit rethrows. The terminal commit itself is idempotent: a duplicate worker that arrives after `TERMINAL` reuses the committed head instead of appending a second terminal transition, so duplicate recovery converges through existing CAS heads and stable keys.
- **Bounded invalidation.** Semantic drift invalidates exactly the reverse-transitive dependent closure of the drifted subject; unrelated siblings stay `ACTIVE` and current. Superseded historical bytes cannot authorize a new mutation.
- **QA/closure/product-history recovery.** Deployment drift during QA rejects current `QualityAcceptance` from the old snapshot (`DEPLOYMENT_RELEASE_DRIFT`) while criterion and observation artifacts stay immutable history. Closure racing upstream supersession either commits first and becomes `HISTORICAL`, or aborts as stale (`STALE_PROJECTION`); a stale outcome is never current. Authority ahead of `ProductHistoryHead` reads `RECOVERY_REQUIRED`/`NOT_READY` until `reconcile(...)` appends the exact live-head transition; reconciliation with wrong observations is rejected and with current observations converges.
- **Locality.** Recovery never resets the organization, reruns all roles, rebuilds all artifacts, or follows a manual global order. Unaffected actionable work continues while affected subjects recover. Failure injection in tests may pause test-owned seams at durable boundaries but cannot add stronger serialization than production.

## Causal reconstruction contract

- **Observational provenance.** `defineCausalLifecycleEvidence(...)` validates one immutable `CAUSAL_LIFECYCLE_EVIDENCE` record (`MATERIALIZED`, `CLAIMED`, `RELEASED`, `RUNTIME_STARTED`, `RUNTIME_FINISHED`, `PUBLISHED`, `ACCEPTED`) with an ISO `observedAt` boundary timestamp. `createCausalLifecycleEvidenceSink({artifactStore, evidenceHeadStore, now})` exposes only `record(...)`: there is no read, list, delete or rewrite path on the writer. Owning boundaries (work materialization, claim, release, domain execution, deployment release, quality acceptance, product closure) accept an optional `causalSink` plus an injectable `causalNow` clock (defaulting to the current time) and invoke the sink best-effort after their durable commit; a sink failure never gates authority. Runtime timing truth stays in `RuntimeExecutionAttestation.startedAt/finishedAt`; missing earlier boundaries are never backfilled.
- **Pinned subject.** `defineCausalObservationSubject(...)` pins `productId`/`rootIntentRef`, history generation/digest/commit, policy ref/revision/waiver set digest and projection ref, plus a `CURRENT`/`HISTORICAL` mode. `createCausalReconstruction({...readers}).resolveCurrentSubject({productId, rootIntentRef})` resolves the canonical history/acceptance/projection heads and pins them; `reconstructPinned({subject})` re-derives the pinned projection and rejects any drift, so newer heads require a new subject. `listRemainingWork`, `traceObligation` and `chainEvidence` with a `CURRENT` subject first verify the pin still equals the canonical heads and reject stale subjects (`a newer head requires a new subject`); with a `HISTORICAL` subject, remaining work returns `{ status: NOT_RECONSTRUCTABLE_FROM_PINNED_SUBJECT, reason, items: [] }`, obligation tracing rejects (it needs live heads), and evidence is scoped to the pin. Every reconstruction method allowlists its argument keys: any caller-selected completeness subset (`blockerRefs`, `claimRefs`, `workIds`, `owningDomain`, `strategyRef`, ...) is rejected.
- **Read-only observer.** `createOrganizationObserver(deps)` exposes exactly `queryCurrent`, `queryHistorical`, `explainWhyNotDone`, `listRemainingWork`, `traceObligation`, `describeExecution`, `measureTiming` and `chainEvidence`. It receives canonical readers only and no write-capable acceptance, claim, dispatch, recovery or policy-publisher port. `queryCurrent` pins then explains; `queryHistorical` replays the pinned subject verbatim (blockers and pinned evidence only). Observation never mutates heads, boards or artifacts, never selects strategies or owners, and never emits findings or remediation commands.
- **Timing.** `measureTiming({workId, ...attemptKey})` reports `waiting` (materialized boundary of the same work generation to first runtime start) and `executing` (sum of persisted runtime invocation intervals) with per-invocation intervals and `evidenceRefs`. Only an absent attempt head degrades to `MISSING_PROVENANCE`; binding/attestation integrity failures throw. A materialized boundary later than first runtime start reports `INCONSISTENT_PROVENANCE` with a null duration, never a negative one. Process clocks are never evidence.
- **Execution identity.** `describeExecution(...)` returns the pinned policy/strategy/config/runtime binding plus `runtimeInvocations[]` (every attestation's invocation id, attestation ref and timestamps for the pinned attempt); the singular `runtimeInvocationId`/`runtimeAttestationRef` fields name the first invocation.
