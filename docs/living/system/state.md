# Agentic System current state

Source-synchronized system checkpoint. Open work is intentionally excluded; see `docs/blackboard/state.md`.

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

Repository development coordination now has a bounded context-plane implementation for migrated Blackboard items. A migrated active item binds one immutable `WORK_CONTEXT_SPEC` generation through its exact Board `current-context` pointer. The repository verifier fails closed when an active migrated item has no pointer, and validates unique Board binding, generation lineage, required refs, read-only review scope and exact accepted-decision subject binding before an implementation context is usable. A Board with no active item may have no current context.

The resolver loads declared required current-system/input refs while keeping audit/history refs lazy. Context generation does not make a candidate current, schedule work, decide acceptance or replace source/tests as current-system truth. This capability is repository coordination only; the runtime JSON Blackboard has not adopted it.

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
