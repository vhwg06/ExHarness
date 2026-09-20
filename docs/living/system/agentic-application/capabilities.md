# Agentic Application capabilities

Current source-backed capability semantics of the Agentic Application. APIs are implementation entry points, not the capability definition.

## A1 — Project-bound fresh-session handoff
Outcome: reconstruct one durable project's current lifecycle/continuation state.
Requires: durable Board, one user-intent root, matching project id, traceable provenance.
Guarantees: project identity + lifecycle buckets + generations + active review + checkpoints + refs; fail-closed identity/provenance.
Durable state: `USER_INTENT_ROOT` + Board.
Limits: handoff does not select work, resolve source bytes, execute Workers or authorize completion.
Details: `contracts.md`, `state.md`.

## A2 — Durable Blackboard lifecycle
Outcome: claim/checkpoint/block/submit/review/recover/reopen/reconcile/complete work across reconstruction.
Requires: transactional Board store + exact current lifecycle generation.
Guarantees: dependency/eligibility checks; stale execution/review generations cannot mutate; Worker submission cannot self-authorize `DONE`; reviews/remaining obligations gate completion.
Durable state: work graph, generations, checkpoints, submission, review/finding state.
Limits: Board is not Core effect truth, Oracle payload authority or trust-artifact payload storage.
Details: `contracts.md`.

## A3 — Grounded mutating Backend execution
Outcome: execute Backend work and accept only after committed-lineage/evidence policy succeeds.
Requires: concrete Backend objective/order/context + Core execution/evidence.
Guarantees: `APPLIED` requires lineage advancement; default completion grounds mutation + typecheck + tests + artifacts; Advisor proposals cannot self-authorize acceptance.
Failure: interrupted mutating work must recover against durable Core session/effect truth.
Limits: no generic Worker/Advisor abstraction is claimed.
Details: `state.md`, `backend-preparation.md`.

## A4 — Non-mutating QA verification
Outcome: verify one accepted Backend target and accept it or return bounded remediation.
Requires: exact accepted Backend handoff + Oracle-resolved artifacts.
Guarantees: QA cannot mutate/advance lineage; completion grounds behavior/regression evidence; abandoned generation is fenced before redispatch.
Failure: source unavailability blocks exact stage; QA issues return to remediation.
Limits: QA acceptance is role-local, not project `DONE`.
Details: `state.md`, `workflow.md`.

## A5 — Durable Backend -> QA continuation
Outcome: carry accepted Backend work across fresh sessions into QA and remediation.
Guarantees: exact stage checkpoint; ref-only `BackendQaHandoff`; Backend acceptance precedes QA; QA acceptance submits to `PENDING_REVIEW`.
Durable state: `BACKEND_PENDING | QA_PENDING | BACKEND_REMEDIATION_PENDING | BLOCKED` + decision/artifact refs.
Failure: QA source failure blocks/resumes; Backend interruption goes through Backend/Core recovery.
Limits: no automatic project acceptance.
Details: `workflow.md`, `contracts.md`.

## A6 — Manifest-protected publication ordering
Outcome: exact producer manifest is durable before protected `QA_PENDING`.
Requires: explicit publisher + revision-bound producer source.
Guarantees: persist exact `artifactManifestRef`; publication failure after Backend effects enters recovery-required path; receipt reuse requires semantically equivalent recovered acceptance.
Failure: conflicting semantics fail closed; protected flow cannot downgrade to direct-reader mode.
Limits: manifest integrity is not semantic correctness or acceptance.
Details: `../oracle/artifact-manifest.md`.

## A7 — Trusted Backend/QA project acceptance
Outcome: fresh-session grounded review can complete, reconcile or reopen the same item for remediation.
Requires: PM-sourced requirement + exact decision/application refs + trust artifacts + verifier/evaluator/attestation dependencies.
Guarantees: exact-input preparation; review subject/generation fencing; trust-policy validation before mutation; rejection/inconclusive reopens same item.
Failure: missing/corrupt/mismatched inputs fail closed; interrupted review gets a new generation.
Limits: PM configuration does not cryptographically prove PM identity; reviewer prose is not evidence.
Details: `project-acceptance.md`.

## A8 — Distinct review obligation sources
Outcome: Worker review requests and PM project review requirements coexist without conflating authority.
Guarantees: `REQUEST != REQUIRE != DISPATCH != ASSESS != ACCEPT`; Orchestrator owns lifecycle state.
Durable state: requirement source/key/reason + active review.
Limits: the implemented PM/SA slice is bounded coordination/proposal/assessment semantics, not concrete PM/SA Worker roles or a generic horizontal-role runtime. PM-sourced review requirements remain distinct from review assessment and acceptance authority.
Details: `contracts.md`, `boundaries.md`, `state.md`.

## A9 — Bounded PM/SA project coordination
Outcome: apply evidence-grounded horizontal coordination to one exact current project target without giving PM or SA direct Blackboard mutation authority.
Requires: project-bound handoff + exact target lifecycle tuple + current target evidence refs + PM/SA coordination artifact store + ApplicationOrchestrator.
Guarantees: separate PM and SA context projections; SA may assess architecture evidence/review need only; PM may propose fresh prerequisite work, bounded dependency edges, blockers and grounded PM review requirements; controller revalidates project/root/target/evidence; Orchestrator `extendWorkGraph(...)` rechecks the target and atomically commits graph/refs/blocker/review effects.
Durable state: direct Board-linked PM proposal and SA assessment refs plus their canonical Board effects.
Failure: stale target/evidence, invalid graph mutation, conflicting work definitions, orphan artifacts or replay without both canonical ref and established effects fail closed.
Limits: not a generic PM/SA agent runtime, role registry or workflow framework; PM has no architecture/completion/review-verdict authority and SA has no project sequencing/timeline/lifecycle authority.
Details: `contracts.md`, `workflow.md`, `architecture.md`.

## A10 — Bounded project work selection
Outcome: propose one eligible item without taking claim authority.
Requires: current eligible work + explicit policy + current measurements/evidence + budget.
Guarantees: eligibility hard gate; mandatory/starvation gates before scoring; full freshness before decision reuse; ordinary claim rechecks Board.
Limits: not a default scheduler.
Details: `work-selection.md`.

## A11 — Durable research continuation
Outcome: resume exact incomplete research, skip completed experiments, reassess stale evidence, submit only a reviewable proposal.
Requires: `RESEARCH_CONTINUATION v1` + declared external refs.
Guarantees: Board stores cursor/refs; only declared refs resolve; scope-aware freshness; proposal + PM-required review commit together.
Failure: inconsistent experiment state or unresolved freshness blocks submission.
Limits: no generic research engine or automatic decision promotion.
Details: `research-continuation.md`.

## A12 — Bounded self-upgrade proposal
Outcome: evaluate one pinned candidate vs accepted baseline and either keep baseline or propose for review.
Requires: fixed protocol, independent evaluator, fixed scenarios/budget/rollback, `adoptionAuthority: false`.
Guarantees: durable attempt blocker; bounded retry/recovery; only `PROPOSE_FOR_REVIEW` submits; baseline remains selected pending acceptance.
Limits: no merge/deploy/rollout/self-modification/adoption authority.
Details: `self-upgrade.md`.

## A13 — Decision/outcome reconstruction
Outcome: materialize an immutable orientation summary over existing Core chain and re-verify exact source artifacts in a fresh review.
Requires: exact chain refs + resolver + immutable summary store.
Guarantees: relation validation, digest pins, summary ref in submission, fresh re-resolution/re-derivation.
Failure: missing/changed/stale source blocks materialization/reconstruction.
Limits: summary is not correctness evidence, action authorization or project acceptance.
Details: `decision-outcome.md`.

## A14 — Organization work materialization, trusted claim and released capability
Outcome: turn one accepted bounded obligation into durable organization work and, after exact authority checks, expose one released executable claim that a later domain-execution boundary may consume.

Requires: project/root-bound Board; accepted decision; explicit non-wildcard materialization grant; immutable organization artifact store; current materialization/execution-authority heads; trusted principal provider; project-scoped release store.

Guarantees:
- materialization validates project/root, accepted decision, implementation artifact, authorized slice/obligation and pinned authority-policy revision before publishing READY work;
- the immutable `ORGANIZATION_WORK_CONTRACT` is the complete governed WHAT/provenance source; Board origin is lifecycle/index provenance, not a second work-semantics authority;
- `obligationSubjectKey` identifies logical work and permits at most one live item; `materializationKey` identifies the exact decision+grant materialization and identical concurrent attempts converge;
- `createOrganizationWorkDiscovery(...)` is read-only and returns only currently eligible, dependency-satisfied, contract-valid work for the requested owning domain;
- `createOrganizationWorkClaimController(...)` obtains canonical `principalRef`/Board owner from the trusted principal boundary and derives the exact materialization authorization subject from Board provenance; caller context cannot choose identity, grant or execution-authority policy subject;
- successful claim is provisional. `release(...)` persists an immutable `CLAIM_RELEASE_RECEIPT` and advances a project-scoped ref-only release head;
- release, fresh-process reconciliation and execution-entry checks require the exact current Board `{ itemId, status: CLAIMED, owner, claimGeneration }`, exact materialization grant observation and exact execution-authority policy revision/currentness;
- `reconcileOrganizationClaimAuthority({ itemId })` keeps the same claim generation while completing/reconstructing release or converging invalidation after restart;
- typed authority loss is canonical lifecycle: work authority -> BLOCKED, execution authority -> REOPENED; Board transition precedes release fencing and replay is idempotent;
- corrupt/missing authority artifacts cannot strand executable authority: raw current-head observations are sufficient to persist exact invalidation provenance and fence stale release capability.

Durable state: `ORGANIZATION_WORK_CONTRACT`, materialization receipt, verified materialization/execution-authority artifacts, `CLAIM_RELEASE_RECEIPT`, `CLAIM_AUTHORITY_INVALIDATION`, Board `claimGeneration`, pointer-only authority heads and project-scoped `ClaimReleaseHead`.

Failure: stale grant/policy revision, ACTIVE→ACTIVE current-head drift, principal/domain mismatch, duplicate logical live work, claim-generation drift, missing/corrupt authority artifact or stale release/Board tuple fails closed and cannot silently preserve executable capability.

Limits: A.1 ends at the released executable claim boundary. It does not resolve execution HOW, choose `ExecutionPolicy`/`ExecutionStrategy`, create semantic execution attempts, execute a domain workload, judge domain completion, publish authoritative domain products or issue cross-domain obligations.

Details: `contracts.md`, `boundaries.md`, `state.md`.

## A15 — Bounded domain execution control

**Outcome:** exact released organization work can enter one domain-local semantic execution attempt with immutable policy/strategy/runtime binding and fresh-session reconstructable evidence.

**Guarantees:** policy publisher authority is verified outside payload self-assertion; current policy is CAS-headed separately from immutable policy artifacts; attempt currentness is CAS-headed separately from immutable binding/history; recovery reuses the same binding; runtime identity comes from trusted attestation; outcome, domain completion and publication authority remain distinct; judgment bundles re-resolve source artifacts rather than laundering copied claims.

**Failure semantics:** stale claim or release blocks execution entry; policy race before first binding forces re-resolution; runtime crash preserves RECOVERY_REQUIRED on the same attempt; a non-ACCEPT domain decision cannot publish authoritative products.

**Does not imply:** work selection, cross-domain continuation, automatic acceptance, or a generic workflow engine.

## Cross-layer rule

```text
Application declares WHAT semantic context/work is required
  -> Application calls Oracle for only those declared sources
  <- Oracle returns application-shaped resolved context
  -> Application binds WorkOrder + resolved context to a concrete Worker
  -> Worker executes through Core
  <- Core returns runtime/evidence/effect/recovery state
  -> Application applies completion and project-lifecycle semantics
```

Application must not turn Oracle into workflow authority or Core into project lifecycle authority.

## A16 — Mutation-current authoritative publication

**Outcome:** an accepted domain completion can publish authoritative outputs only inside exact lifecycle and writer-authority currentness fences.

**Guarantees:** the organization claim guard holds the exact CLAIMED owner/generation through publication by acquiring the same production Blackboard mutation fence used by organization-claim lifecycle mutation paths that can invalidate that claim; the domain writer gate holds its exact current authority through publication; one semantic attempt uses one stable canonical publication key; duplicate recovery converges; publication receipts preserve the mutation-current observations; attempt-transition history preserves exact CAS-head revisions.

**Failure semantics:** lifecycle change, writer revoke, duplicate recovery publication, or transition-revision mismatch fails closed or converges to the already-committed canonical result.

**Does not imply:** new organizational authority, cross-domain continuation, or a generic transactional workflow engine.
