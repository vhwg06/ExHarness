# Agentic System current state

Source-synchronized system checkpoint. Open work is intentionally excluded; see `docs/blackboard/state.md`.

Outer repository-development tooling is separate from the Agentic Application runtime. Its current contract routes OBJECTIVE through RESEARCH_SA to READY_IMPLEMENT_PLAN, then through WORKER to DELIVERED_FEATURE. The scripts validate exact semantic bindings, collect candidate evidence, integrate typed Jev evaluation and verify candidate presence/tree identity on main. The pull-request `test` workflow is the single automatic semantic-gate surface: kernel verification and Living-doc impact run first, then an internal `blackboard-gate` selects exact judgment work or readiness publication. Exact semantic judgment invokes the trusted reusable `blackboard-jev.yml@main` inside the same PR run with pinned work id, PR-base authority SHA and subject SHA; there is no standalone Blackboard router or workflow-dispatch chain. Canonical `RESEARCH_SA/SATISFIED` readiness publication is checked by a sibling `readiness-verify` job rather than rerolling the provider. Push commits use only the separate `push-test` kernel workflow. WORKER is selected only by exact bound candidate SHA. RESEARCH_SA is selected when the tested PR head changes the current plan draft or its exact research baseline even if execution dependencies are still non-DONE; dependency readiness gates WORKER execution, not research planning or Jev readiness. Research objective judgment is now evidence-routed per objective: each objective question receives its exact objectiveCoverage binding (criterionIds, planElements, verificationIds), mapped acceptance criteria, and mapped implementation slices instead of relying on the undifferentiated full-plan bundle. Other routing mutations remain rejected. Large baseline files are sent as deterministic excerpt bodies bounded below 2 Ki characters per file while full-file hashes remain in the semantic state, preventing omitted source changes from reusing a stale Jev result. Live provider judgment and actual delivery require their own evidence; offline tooling tests do not establish either. Operational details are in `docs/blackboard/jev.md`.

## Repository-development outer Blackboard

The repository-development Blackboard has exactly two lanes and keeps their semantic boundary explicit:

```text
OBJECTIVE
  -> RESEARCH_SA
  -> READY_IMPLEMENT_PLAN
  -> Jev readiness judgment
  -> WORKER (exact plan binding)
  -> implementation + verification evidence
  -> Jev candidate judgment
  -> merge/tree verification
  -> DELIVERED_FEATURE
```

`RESEARCH_SA` consumes an `OBJECTIVE` and can converge only when the plan makes scope, constraints, invariants, acceptance criteria, architecture decisions, source seams and verification (including negative cases) explicit enough that a worker need not infer them. `WORKER` consumes the exact current `READY_IMPLEMENT_PLAN`; it cannot redefine the objective or plan, and it can converge only when the candidate, evidence, Jev result and delivery identity all bind to that plan. Implementation defects return to worker repair. A plan/input contradiction returns upstream to research.

Jev uses one bounded `{model,state,questions}` request. The state contains the objective, semantic plan and bounded source/evidence contents rather than a conversation transcript or bare references. Each acceptance criterion is an independent typed Choice question, and every choice must be `SATISFIED` for the gate to pass. The cache key covers semantic state, question/spec, model, policy and lane; unchanged semantic input reuses the result, while changed objective, plan, evidence or candidate content invalidates it. Evaluations retain attempts, latency, payload size, usage, cache and pricing metadata, and the separate stability benchmark never publishes acceptance.

The TypeSafe adapter pins the Jev model, validates the typed response and bounds transport retries. Local and CI verification execute without the provider key; a separate CI evaluation job calls the API with `TYPESAFE_API_KEY`, validates the result and publishes the typed evaluation artifact. Live evaluation and stability runs remain outside the normal test matrix.

The current artifact layout stores lane inputs under `docs/blackboard/artifacts/objective/` and `docs/blackboard/artifacts/ready-implement-plan/`. Retained implementation results, Jev evaluations and the delivery receipt stay beside the plan, while detailed verification logs live under `docs/blackboard/evidence/`. Delivery is publishable only after the evaluated candidate is committed, its ancestry and tree match the merge on `main`, and the evaluated source remains present there. Legacy artifact locations are rejected after idempotent migration.

Worker exit also has a documentation gate: each ready worker plan declares the Living Docs refs that describe its implementation. The candidate must update those docs within the authorized scope, Jev receives their full contents and judges a dedicated implementation-description claim, and delivery requires that claim to be `SATISFIED` plus the refs to be consolidated and preserved on `main`.

## Current composition

Concrete execution path:

```text
BackendObjective
 -> BackendWorkOrder
 -> repositoryReader / BackendContext
 -> BackendWorker / ExHarness Core
 -> grounded Backend completion
 -> ref-only BackendQaHandoff
 -> QaWorkOrder
 -> artifactReader / QaContext
 -> non-mutating QaWorker / ExHarness Core
 -> grounded QA completion
```

Durable application coordination path:

```text
ApplicationOrchestrator
 -> JSON-backed Blackboard state
 -> claim / submit
 -> Worker-requested or PM-required review obligation
 -> pending/reviewing assessment state
 -> DONE or REOPENED
 -> grounded follow-up reconciliation
```

The concrete `createDurableBackendQaWorkflow(...)` path binds Backend -> QA execution to the durable Blackboard lifecycle. It persists validated workflow objectives and stage checkpoints, carries accepted Backend handoffs by reference, supports QA remediation and blocked-source resume, and submits accepted QA to the separate review/acceptance path. The older `runBackendThenQaObjective(...)` path remains a direct one-session composition.

## Current ownership boundaries

- Agentic Application owns concrete objective/work/result/completion semantics, deterministic composition and Blackboard lifecycle control.
- Oracle owns explicit source pull/dereference/adaptation into application-shaped context.
- ExHarness Core owns agent execution mechanics, cognition, evidence/trust, lifecycle and recovery primitives.
- Concrete infrastructure owns repository/artifact access, executors, storage, filesystem/network/process authority and credentials.

## Delivered facts

- `packages/core-harness/` is the reusable Core.
- `packages/agentic-system/` contains concrete Backend and QA slices plus a durable `ApplicationOrchestrator` Blackboard state slice.
- Backend is mutating/promoting work; QA is non-mutating verification of an accepted Backend revision.
- Backend completion grounds mutation/typecheck/tests evidence rather than trusting Worker-returned claims.
- QA grounds behavior/regression evidence and cannot advance lineage.
- `ApplicationArtifactRef` is shared across Backend-produced and QA-consumed artifacts.
- Backend -> QA state carries refs plus Backend acceptance-decision provenance, not copied artifact payloads.
- optional manifest-protected Backend -> QA continuation captures producer-side artifact identity/provenance without changing the default direct-reader path.
- protected `QA_PENDING` is committed only after the exact producer manifest ref is durable, and fresh QA resolution is scoped to that persisted manifest.
- manifest publication failure after Backend effects returns through the existing Backend/Core recovery fence rather than authorizing a fresh Backend execute.
- durable publication receipts may be reused without producer-byte reads only when recovered Backend acceptance is semantically equivalent; conflicting acceptance or payload semantics fail closed.
- durable Backend -> QA execution persists `BACKEND_PENDING`, `QA_PENDING`, `BACKEND_REMEDIATION_PENDING` and blocked checkpoints through the JSON store.
- a fresh Orchestrator can resume the same QA checkpoint after artifact lookup failure, and QA acceptance produces a final `PENDING_REVIEW` submission.
- Oracle keeps external repository reads and internal application-artifact reads distinct.
- Worker submission cannot directly authorize Board `DONE`.
- Review request and PM review requirement are separate paths; explicit reviewer assessment is required before review-gated completion.
- rejected/inconclusive review reopens current work; an accepted review also reopens when unrelated current obligations remain.
- resubmission can explicitly identify addressed current obligations, which are still subject to required review before `DONE`.
- follow-up findings require a provenance ref before current/existing/new-work reconciliation.
- JSON-backed Board state survives a new Orchestrator instance.
- No generic Worker, WorkOrder, Advisor, role registry, workflow graph, Teacher registry, Reviewer registry or generic workflow Orchestrator/DSL is implemented.

The concrete `ApplicationOrchestrator` is application workflow/Board control, not a generic workflow engine.

## Routing

- **current system capability semantics -> `capabilities.md`**
- current delivered pipeline/composition -> `pipeline.md`
- current application details -> `agentic-application/state.md`
- current Oracle details -> `oracle/state.md`
- current Core details -> `core-harness/state.md`
- all gaps/problems/next work -> `docs/blackboard/state.md`


## Repository coordination context plane

Repository development coordination uses an explicit-current context model.

```text
docs/blackboard/state.md
  -> active work item
  -> current-context.ref
  -> docs/blackboard/context/<WORK_ID>/current.json
       -> exact action/lane
       -> semantic input ref
       -> authority/result refs when required
       -> required current-system/input refs
       -> bounded source scope
       -> verification
```

The helper context is updated in place as the lane changes. It has no generation chain, parent traversal, stale marker or audit-history dependency. Git preserves prior revisions.

Helper context is routing/loading convenience only. Readiness decisions, implementation results and judgments bind the semantic work/candidate subjects directly; context identity is not authority. A Board with no active work has no required `current.json`.

The resolver loads only the refs declared by the current context. It does not scan repository history to infer currentness, choose work, decide acceptance or replace source/tests as current-system truth. This capability is repository development coordination only; runtime product/Blackboard generations used for domain fencing remain separate application semantics.

## Organizational A.1 bridge

The Agentic Application now contains the bounded Integration A.1 organization boundary. Accepted obligations can be deterministically materialized into immutable `ORGANIZATION_WORK_CONTRACT`-bound Blackboard work. Materialization, execution-authority policy and claim-release currentness use durable CAS heads.

Organizational claim authorization is derived from a trusted principal plus the current execution-authority policy, not from caller-supplied domain text. Blackboard `CLAIMED` remains provisional; executable capability requires a current durable `CLAIM_RELEASE_RECEIPT`/head matching the exact Board owner + claim generation and still-current materialization/execution authority heads.

Organization claim invalidation commits the canonical Blackboard consequence first and only then fences the release head. A release-fence cleanup failure therefore cannot preserve executable capability after the Board claim tuple is no longer current. The slice stops before `DOMAIN_EXECUTION_CONTROL`, ExecutionPolicy/ExecutionStrategy resolution, BA execution and ProductStateProjection.

## Bounded domain execution control

The Agentic Application now contains the first bounded Integration B execution slice below A.1. One exact current released organizational claim can enter a domain-local execution controller. The controller reads the durable ExecutionAttemptHead before policy resolution, pins an immutable ExecutionPolicy / ExecutionStrategyDescriptor / ExecutionAttemptBinding before runtime dispatch, and revalidates the exact released-claim authority immediately before dispatch.

ACTIVE or RECOVERY_REQUIRED attempts recover the same semantic attempt and immutable binding rather than resolving a newer policy. Policy promotion after binding affects only later attempts. Runtime identity comes from the configured trusted runtime-adapter boundary, not strategy self-report.

Execution facts remain split from judgment and publication: RuntimeExecutionAttestation -> ExecutionAttemptOutcome -> DomainCompletionDecision -> DomainPublicationReceipt. A derived ExecutionJudgmentBundle indexes exact content-addressed refs and re-resolves the source chain for fresh-session reconstruction. Runtime SUCCEEDED is not domain ACCEPT, and domain ACCEPT is not authoritative publication.

This slice proves one BUSINESS_ANALYSIS-owned domain execution path. It does not select Blackboard work, dispatch another organizational domain, change ApplicationOrchestrator lifecycle semantics, widen Oracle/Core authority, or implement Integration C-J.

## Integration B post-merge authority repair

The bounded domain-execution slice now fences authoritative publication across two current mutation gates held through canonical publication commit: the exact organization claim lifecycle and the current domain write-authority subject. The lifecycle fence is shared by every organization-claim lifecycle mutation that can invalidate the released capability, so recovery/invalidation/checkpoint/submit/block/supersede cannot commit while canonical publication is inside the guarded action. Unrelated Blackboard transactions retain the normal optimistic single-successor CAS protocol. A completion decision alone is not enough to publish.

Canonical publication is keyed idempotently by the semantic execution attempt/binding. Concurrent recovery may observe/recover the same runtime attempt, but duplicate workers converge on one authoritative publication rather than duplicating domain write side effects.

Recovery-relevant `EXECUTION_ATTEMPT_TRANSITION` artifacts record the exact observed `ExecutionAttemptHead` revision they attempt to advance. Fresh judgment reconstruction verifies those revisions against the reconstructed CAS-head sequence, not only status continuity.

The earlier g0015 candidate acceptance is historical/stale evidence after the merged tree changed outside that review envelope. Current acceptance must come from the post-merge repair and a fresh exact candidate judgment.
