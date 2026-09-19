# Agentic System current state

Source-synchronized system checkpoint. Open work is intentionally excluded; see `../living/blackboard.md`.

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
- all gaps/problems/next work -> `../living/blackboard.md`


## Repository coordination context plane

Repository development coordination now has a bounded context-plane implementation for migrated Blackboard items. A migrated active item binds one immutable `WORK_CONTEXT_SPEC` generation through its exact Board `current-context` pointer. The repository verifier fails closed when an active migrated item has no pointer, and validates unique Board binding, generation lineage, required refs, read-only review scope and exact accepted-decision subject binding before an implementation context is usable. A Board with no active item may have no current context.

The resolver loads declared required current-system/input refs while keeping audit/history refs lazy. Context generation does not make a candidate current, schedule work, decide acceptance or replace source/tests as current-system truth. This capability is repository coordination only; the runtime JSON Blackboard has not adopted it.

## Organizational A.1 bridge

The Agentic Application now contains the bounded Integration A.1 organization boundary. Accepted obligations can be deterministically materialized into immutable `ORGANIZATION_WORK_CONTRACT`-bound Blackboard work. Materialization, execution-authority policy and claim-release currentness use durable CAS heads.

Organizational claim authorization is derived from a trusted principal plus the current execution-authority policy, not from caller-supplied domain text. Blackboard `CLAIMED` remains provisional; executable capability requires a current durable `CLAIM_RELEASE_RECEIPT`/head matching the exact Board owner + claim generation and still-current materialization/execution authority heads.

Organization claim invalidation commits the canonical Blackboard consequence first and only then fences the release head. A release-fence cleanup failure therefore cannot preserve executable capability after the Board claim tuple is no longer current. The slice stops before `DOMAIN_EXECUTION_CONTROL`, ExecutionPolicy/ExecutionStrategy resolution, BA execution and ProductStateProjection.

## A.1 durability/authority repair

The organizational A.1 bridge now persists immutable work/authority artifacts behind exact content refs and resolves them in fresh processes. Current-head stores remain mutable CAS pointers, but advancing materialization/execution authority is mediated by trusted publisher boundaries rather than treating raw store mutation as authorization.

Claim/release freshness is a handshake rather than a single pre-check: claim revalidates authority after the canonical Board claim and invalidates stale provisional claims; release revalidates after publishing the release head and fences a stale release. Organization invalidation replay recognizes the already-committed canonical Board consequence and can finish release fencing after a crash/restart.
