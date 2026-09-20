# Agentic Application current state

Source-synchronized application-layer projection. All unresolved application work lives in `../docs/blackboard/state.md`.

## Current roles

### Backend

- concrete `BackendObjective`, `BackendWorkOrder`, `BackendContext`, `BackendWorkResult` and `BackendWorker`;
- context resolved before execution through `resolveBackendContext(...)`;
- Worker executes through ExHarness Core;
- `APPLIED` requires real committed-lineage advancement;
- completion evidence is grounded from ExHarness/runtime artifacts, not trusted from Worker prose;
- default completion requires mutation + typecheck + tests + artifact presence;
- completion emits an acceptance-boundary ExHarness decision artifact;
- bounded `BackendAdvisor` is available only after required objective evidence passes and semantic gaps remain;
- Advisor `REQUEST_CONTEXT` / `ESCALATE` proposals become durable application coordination requirements; they are not direct execution or acceptance authority;
- Backend execution can use a concrete durable JSON Core SessionStore so Core session state and AVO action-effect journal survive process reconstruction;
- interrupted Backend recovery is exposed through `BackendWorker.recover(...)` / `recoverBackendObjective(...)` and never bypasses the ordinary Backend completion/evidence policy.

### QA

- concrete QA objective/order/context/result/completion shapes;
- consumes only accepted Backend revision/artifact refs;
- context resolved through `artifactReader` before execution;
- mutation and lineage advancement are forbidden;
- grounded evidence claims are `qa.behavior` and `qa.regression`;
- QA issues deterministically request remediation/continuation;
- interrupted QA can be explicitly redispatched against the same accepted Backend target after the abandoned application execution generation is fenced out.

## Current orchestration state

The package exposes `createApplicationOrchestrator(...)` for durable Blackboard lifecycle control and `createJsonBlackboardStore(...)` for JSON persistence.

Implemented Board semantics include:

- only `READY`/`REOPENED` work is normally claimable and dependencies must already be `DONE`;
- each execution claim increments a monotonic `claimGeneration` independently from owner identity;
- `checkpoint(...)`, `submit(...)` and `block(...)` require the exact current `{ owner, claimGeneration }`, so an abandoned executor cannot commit after takeover even if the same owner name is reused;
- `recoverClaim(...)` is an explicit recovery transition from `CLAIMED` that increments the generation before replacement work can mutate Board state;
- a claimed owner may persist a partial-work checkpoint before final submission;
- checkpoints can release work as `REOPENED` or preserve exact continuation state while `BLOCKED`;
- blocked work can be resumed to `REOPENED`; unfinished work can be superseded/canceled;
- unresolved Backend coordination is the narrow exception: `resolveBlockedCheckpoint(...)` atomically replaces one exact blocked checkpoint and reopens it, while generic resume is rejected for that state;
- a claimed Worker owner may submit an immutable result payload and Worker-sourced review requests;
- PM-sourced review requirements can be added separately from Worker requests;
- submitted work becomes `PENDING_REVIEW`, never directly `DONE`;
- each review dispatch increments a monotonic `reviewGeneration`; that generation is part of the exact review subject;
- `recoverReview(...)` explicitly replaces an interrupted `REVIEWING` attempt with a new generation/subject, making evidence from the abandoned generation stale even when the same reviewer is reused;
- all required reviews must be `ACCEPTED` and remaining work must be empty before `DONE` is derived;
- `REJECTED`/`INCONCLUSIVE` review reopens the same item and narrows remaining work;
- follow-up reconciliation distinguishes current obligation, existing work, genuine new work and non-actionable findings;
- checkpoints, submissions, generations, active review state and pending review state survive reconstruction through the JSON store.

Generation is lifecycle fencing only. Elapsed time, heartbeat loss or lease expiry is not implemented as correctness authority and does not prove an interrupted effect is safe to retry.

The package also exposes a concrete session-handoff surface:

- `defineUserIntent(...)` validates the durable user-owned objective, bullets and constraints;
- `createSessionHandoffSurface({ orchestrator, projectId })` can bind a handoff-safe surface to an explicit stable project identity;
- project identity is stored on the durable `USER_INTENT_ROOT`, is separate from store path/session/work/user-intent ids and is exposed as `handoff.projectId`;
- a fresh project-bound surface must supply the same expected project id; a mismatched id fails closed;
- an unbound legacy surface cannot silently open a project-bound Board, and a project-bound surface cannot silently upgrade a legacy Board that has no project identity;
- legacy unbound Boards remain available for low-level compatibility but are not project-identity handoff-safe;
- `initialize(...)` seeds one durable intent root plus initial work traceable to that root;
- `read()` projects the current Board into fresh-session lifecycle buckets;
- the projection includes `claimGeneration`, `reviewGeneration`, `activeReview`, current work checkpoints, lifecycle buckets and artifact/evidence refs with item provenance;
- a Board without exactly one durable user-intent root fails closed as not handoff-safe;
- work that cannot trace directly or transitively to the durable user intent is rejected by the handoff projection.

Project identity belongs to the Board/root boundary rather than being copied into every work-item origin. Work provenance continues to express intent/parent/finding lineage independently.

## Durable Backend -> QA application path

`createDurableBackendQaWorkflow(...)` binds the concrete Backend/QA verticals to Blackboard checkpoints.

Current state transitions are:

- initialization persists validated Backend + QA objectives before Worker execution;
- `BACKEND_PENDING` executes Backend from the persisted spec;
- Advisor `RETRY` and deterministic `CONTINUE` remain ordinary eligible Backend continuation;
- Advisor `REQUEST_CONTEXT` / `ESCALATE` persist `BACKEND_COORDINATION_PENDING` as `BLOCKED`, including gap/context/rationale/completion-decision provenance, and a fresh session does not redispatch Backend while it remains unresolved;
- `resolveBackendCoordination(...)` is application-owned: context requests require declared additional repository files; escalations require an explicit resolver and rationale; resolution only reopens the original Backend stage;
- accepted Backend completion persists a ref-only `BackendQaHandoff` plus acceptance-decision provenance as `QA_PENDING`;
- a fresh process/session can reconstruct the same Board and continue QA without prior conversation state;
- QA issues persist as `BACKEND_REMEDIATION_PENDING`; remediation uses the last accepted Backend revision as its new repository base;
- ordinary artifact/context lookup failure blocks while preserving the exact stage checkpoint; resume retries from that checkpoint; unresolved `BACKEND_COORDINATION_PENDING` cannot be cleared by generic resume;
- QA acceptance clears the partial checkpoint and creates a final Blackboard submission with Backend/QA decision refs and artifact refs;
- final submission becomes `PENDING_REVIEW` but does not fabricate a Worker-sourced application review request; project/PM review requirements remain a separate authority path;
- if a process dies while a stage is `CLAIMED`, `recoverInterrupted(...)` first increments the application claim generation to fence the abandoned attempt;
- interrupted `QA_PENDING` recovery reruns the non-mutating QA stage against the exact persisted accepted Backend handoff;
- interrupted Backend recovery restores the persisted Core session/effect journal through the concrete Backend session store before deciding whether strategy execution can continue.

Concrete Backend recovery handles persisted effect truth as follows:

- no persisted Core session in a store that declares `supportsDurableRecovery: true` -> the Backend stage may start normally because the durable recovery authority establishes absence of Core execution/effect state;
- no persisted Core session in a non-durable/default in-memory store -> recovery blocks; empty volatile state is not proof that an interrupted external effect did not occur;
- confirmed effect on the original candidate -> close the interrupted variation and replay the same strategy on the same session; the Core effect journal returns the confirmed action result without external redispatch;
- idempotent ambiguous effect -> Core reconciliation prepares a retry using the same operation/action-key semantics before ordinary Backend completion runs;
- non-reconcilable ambiguity -> recovery blocks rather than redispatching;
- multiple persisted mutation effects, candidate divergence, or an already-advanced Core candidate without a durable Worker semantic result -> recovery blocks/requires reassessment instead of inventing a Backend result.

A recovered Backend result still passes the ordinary lineage, evidence, completion and Advisor boundaries. Recovery state is not acceptance authority.

The older `runBackendThenQaObjective(...)` direct composition remains available as an in-session path. It is not the durable cross-session workflow surface.

## Concrete Backend session persistence

`createJsonBackendSessionStore(...)` is the current local durable SessionStore used when a Backend deployment needs process-crash recovery.

It stores the Core session/effect journal in an immutable single-successor revision chain per encoded Backend session id. A save may publish exactly one successor for its expected base revision through same-filesystem hard-link no-overwrite semantics; concurrent or stale writers from that base fail explicitly with `StoreConflictError` rather than replacing newer recovery authority. Temporary pre-publication files are not completion evidence, and elapsed lock age is not takeover authority. `lockStaleMs` remains only a compatibility input.

The store explicitly declares `supportsDurableRecovery: true`. That declaration is the concrete authority that permits recovery to interpret an absent persisted session as absent durable Core execution/effect state. A generic/default SessionStore without that declaration cannot make the same inference.

It is application infrastructure for the concrete Backend vertical, not a new generic Core lifecycle facade, distributed lease service or exactly-once effect guarantee.

## Current evaluation gate

The repository runs a deterministic application reference evaluation through `npm run eval:agentic` and includes it in root `npm run verify`.

The gate executes the concrete durable Backend -> QA workflow across happy-path, restart, QA-remediation, artifact-source block/resume and cancellation scenarios, then deep-compares measured output with `artifacts/agentic-backend-qa-reference-eval.json`.

The checked result is explicitly classified as `DETERMINISTIC_REFERENCE` with `productionEvidence: false`. It measures false completion, handoff/ref integrity, source reads/context size, remediation/recovery and review-gate behavior, but does not claim real-repository effectiveness, external-provider quality, production latency/cost, Advisor value-add or justification for generic abstractions.

The interrupted-effect crash scenarios are enforced by application contract tests; they are not currently part of the deterministic `eval:agentic` reference corpus.

See `evaluation.md` for the current executable evaluation surface and limitations.

## Current composition

Shared shapes proven in source remain deliberately narrow:

- `ApplicationArtifactRef`;
- evidence integrity / required-claim state plumbing;
- Blackboard item/review/follow-up/checkpoint/generation state required for durable orchestration;
- durable `UserIntent` plus optional project-bound read-only session-handoff projection over Blackboard state;
- concrete Backend -> QA workflow checkpoint semantics earned by the existing Backend and QA slices;
- concrete Backend durable session/effect recovery composition, without a generic recovery registry/facade;
- bounded project-bound PM/SA coordination with separate context projections, durable proposal/assessment refs and Orchestrator-owned canonical mutation.

There is still no generic Worker/WorkOrder/Advisor/role registry/workflow graph/Teacher registry/Reviewer registry, project-state registry, lease service or recovery DSL.

## Bounded PM / SA coordination

The current authority split is:

- PM = horizontal project coordination/sequencing/dependency/timeline/progress;
- SA = horizontal architecture judgment only;
- remaining execution/review = vertical and context-bound.

Current source implements a bounded application-local PM/SA coordination slice through `createPmSaCoordinationController(...)`, not generic PM/SA Worker roles.

The implemented slice provides:

- separate bounded PM and SA context projections rather than one universal role context;
- durable evidence-bound SA architecture assessments that may require architecture review but cannot own dependency, priority, timeline, lifecycle, completion or review-verdict authority;
- durable PM coordination proposals bound to the exact target `{itemId, status, claimGeneration, reviewGeneration}`;
- PM proposals may add fresh prerequisite work, bounded dependency edges, blockers and PM-sourced review requirements, but cannot rewrite user intent or carry architecture/completion/review-verdict authority;
- project/root/target/evidence freshness checks before coordination can affect canonical state;
- Orchestrator-owned `extendWorkGraph(...)` as the canonical mutation boundary, with exact-target recheck and atomic graph/ref/blocker/review updates;
- replay/recovery that requires direct canonical Board refs plus the corresponding established proposal effects; orphan/spoofed coordination artifacts are not lifecycle truth.

What is still not implemented is a generic PM/SA agent runtime, PM/SA Worker abstraction, horizontal-role framework, role registry, workflow DSL or concrete vertical Reviewer Worker. `requireReview(... source: PM ...)` remains only one PM authority surface inside the broader bounded coordination capability.

## Routing

- **current application capability semantics -> `capabilities.md`**
- current application architecture -> `architecture.md`
- current ownership boundaries -> `boundaries.md`
- current workflow -> `workflow.md`
- current contracts -> `contracts.md`
- current decisions/invariants -> `decisions.md`
- current application evaluation -> `evaluation.md`
- all open application gaps/problems -> `../docs/blackboard/state.md`

## Organization claim/release boundary

Integration A.1 adds a concrete organizational bridge without turning the Application Orchestrator into a scheduler:

- `createOrganizationWorkMaterializer(...)` validates an exact accepted obligation against the current materialization-authorization head, derives a deterministic materialization identity, and converges duplicate retries on one Board item + immutable work-contract ref;
- `createOrganizationWorkClaimController(...)` derives domain claim authority from the current execution-authority policy and authenticated principal identity;
- successful Board claim is provisional only;
- `release(...)` publishes an immutable `CLAIM_RELEASE_RECEIPT` behind a durable claim-generation-specific release head;
- execution entry must revalidate the exact Board claim tuple plus current materialization/execution authority heads;
- `recoverClaim(...)` increments the Blackboard claim generation and fences the prior release subject;
- `invalidateOrganizationClaim(...)` transitions canonical Board state before release-head fencing. Execution-authority invalidation reopens still-valid work; work-authorization invalidation blocks it without incrementing the invalidated generation.

The authority-head stores are concrete durable JSON CAS stores. This slice does not implement post-claim execution ownership, strategy resolution, BA requirement analysis or cross-domain dispatch.

## Domain execution control

The application now owns one bounded post-claim HOW boundary. `createDomainExecutionController(...)` accepts an exact released claim subject, resolves the existing `ExecutionAttemptHead` before any current-policy lookup, creates an immutable first-attempt binding only under a rechecked current policy head, and revalidates the released claim immediately before runtime dispatch.

Recovery reuses the exact existing `ExecutionAttemptBinding`; it does not re-resolve the current policy or strategy. Runtime attestation uses the trusted adapter/deployment identity configured at the boundary. Completion evaluation and authoritative publication are separate injected authorities.

The durable artifact chain is:

```text
ORGANIZATION_WORK_CONTRACT + CLAIM_RELEASE_RECEIPT
 -> EXECUTION_POLICY + EXECUTION_STRATEGY_DESCRIPTOR
 -> EXECUTION_ATTEMPT_BINDING + transition history
 -> RUNTIME_EXECUTION_ATTESTATION
 -> EXECUTION_ATTEMPT_OUTCOME
 -> DOMAIN_COMPLETION_DECISION
 -> DOMAIN_PUBLICATION_RECEIPT (only after ACCEPT + current claim revalidation)
 -> EXECUTION_JUDGMENT_BUNDLE
```

The current concrete proof surface is BUSINESS_ANALYSIS-owned work only. No global execution scheduler, cross-domain dispatcher or ProductStateProjection is introduced.

## Domain execution post-merge repair

Authoritative domain publication now runs inside the current organization claim guard and the current domain write-authority guard. The organization guard is backed by the public Blackboard store's production mutation fence. ApplicationOrchestrator uses that same fence around every organization-claim lifecycle mutation that can invalidate publication and holds it across the asynchronous canonical publication action; unrelated Board transactions remain optimistic successor-CAS operations. Both currentness subjects remain held through the idempotent canonical publication operation. The resulting `DOMAIN_PUBLICATION_RECEIPT` records the stable publication key plus the lifecycle and writer-authority observations used by that mutation.

Concurrent recovery still reuses the same immutable `ExecutionAttemptBinding`, but canonical publication is attempt-scoped and idempotent. If another worker has already terminalized the attempt, the loser reloads and replays that terminal result rather than inventing a new terminal outcome.

Every recovery-relevant `EXECUTION_ATTEMPT_TRANSITION` now carries `observedHeadRevision`. Fresh `ExecutionJudgmentBundle` reconstruction derives the expected CAS revision after each nonterminal transition and fails closed when the next transition does not bind that exact revision.
