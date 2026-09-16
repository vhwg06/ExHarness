# Agentic Application current workflow

## Backend

```text
parse objective
 -> make BackendWorkOrder
 -> resolve declared repository files once
 -> execute BackendWorker through ExHarness
 -> ground result/evidence from committed lineage + verification artifacts
 -> BackendCompletionPolicy
```

Deterministic evidence failure/missing/inconclusive paths stay in application code. `BackendAdvisor` is invoked only for the source-implemented semantic-gap condition after required objective checks pass.

## Accepted Backend -> QA

```text
Backend ACCEPT
 -> create ref-only BackendQaHandoff
 -> create QaWorkOrder selecting required artifact paths
 -> resolve declared application artifacts once
 -> execute non-mutating QaWorker through ExHarness
 -> ground behavior/regression evidence
 -> QaCompletionPolicy
```

If Backend is not accepted, QA is not dispatched.

`runBackendThenQaObjective(...)` still provides this as a direct one-session composition. Cross-session execution uses the durable workflow below.

## Durable Backend -> QA workflow

Canonical durable composition is:

```text
createDurableBackendQaWorkflow(...)
 -> initialize(itemId, owner, backendObjective, qaObjective)
      -> validate objectives
      -> persist BACKEND_PENDING checkpoint
      -> release claim as REOPENED

fresh/current session
 -> advance(itemId, owner)
      -> claim exact item
      -> execute exactly one durable stage
```

State transitions:

```text
BACKEND_PENDING
  |
  | Backend ACCEPT
  v
QA_PENDING
  |
  +-- QA artifact/context failure --> BLOCKED
  |                                   |
  |                                 resume
  |                                   |
  +<----------------------------------+
  |
  | QA issues
  v
BACKEND_REMEDIATION_PENDING
  |
  | remediation objective derives from
  | last accepted revision + grounded QA issues
  v
QA_PENDING
  |
  | QA ACCEPT
  v
final Blackboard submission
  |
  v
PENDING_REVIEW
  |
  +-> PM/project coordination may require concrete review
```

The persisted checkpoint carries the validated workflow spec plus only the continuation state required by the current stage. Accepted Backend -> QA continuation carries the existing ref-only handoff and Backend acceptance-decision provenance rather than artifact payloads.

QA issues do not silently invalidate or rewrite the accepted revision. They create explicit remediation work; the remediation Backend objective uses the accepted revision as its repository base. A new accepted Backend result replaces the QA handoff with the new revision before QA runs again.

Artifact/context lookup failure does not discard progress. The item becomes `BLOCKED` with its `QA_PENDING` checkpoint intact. `resume(...)` returns it to `REOPENED`, and a later session retries the same durable stage.

`cancel(...)` supersedes unfinished work. Superseded work is not claimable.

QA role acceptance is not Blackboard acceptance. Successful QA clears the partial checkpoint and creates a final submission with Backend/QA decision refs and artifact refs. It does **not** fabricate `source: WORKER` for application review. If project completion requires review, PM/project coordination must use the distinct PM review-requirement path.

## Durable Blackboard lifecycle

```text
READY / REOPENED
 -> Orchestrator.claim(...)
 -> CLAIMED
 -> either checkpoint partial work
      -> REOPENED | BLOCKED
    or submit final work
      -> PENDING_REVIEW
 -> project/PM may add required review
 -> Orchestrator.beginReview(...)
      -> freeze exact review target subject
 -> REVIEWING
 -> reviewer produces grounded Core trust bundle
      EvidenceArtifact[] + DecisionArtifact + Attestation
 -> Orchestrator verifies bundle outside Board transaction
 -> transaction re-checks same active review target
 -> apply trusted decision verdict
      |
      +-> all required ACCEPTED + no remaining work -> DONE
      +-> REJECTED / INCONCLUSIVE -> REOPENED
      +-> ACCEPTED but remaining current work -> REOPENED
      +-> other required review remains -> PENDING_REVIEW
```

The Orchestrator does not accept a naked caller-provided review verdict. Review decision/evidence/signature/authority must pass the application-provided trust policy over the exact active review target.

Review requirements may be Worker-requested when a real Worker raises that need or PM-required separately. `createDurableBackendQaWorkflow(...)` does not impersonate either source after QA completion. Current source still does not implement concrete PM/SA role execution or vertical reviewer Workers.

## Fresh-session handoff

Canonical handoff-safe bootstrap is:

```text
user-defined idea / objective / bullets / constraints
 -> defineUserIntent(...)
 -> createSessionHandoffSurface(...).initialize(...)
 -> durable intent root + initial Blackboard work
```

A later session does not need prior conversation state:

```text
fresh session
 -> reconstruct ApplicationOrchestrator from the durable Board store
 -> createSessionHandoffSurface(...).read()
 -> recover user intent
 -> recover work graph, current checkpoints and lifecycle buckets
 -> recover artifact/evidence refs with item provenance
 -> resolve only the refs needed for the next work context
 -> continue
```

The handoff projection exposes:

```text
intent
workGraph[*].checkpoint
workGraph[*].checkpointedBy
lifecycle.eligibleWork
lifecycle.claimedWork
lifecycle.pendingReview
lifecycle.reviewing
lifecycle.pendingReconciliation
lifecycle.blocked
lifecycle.done
lifecycle.superseded
references.artifacts
references.evidence
```

The intent root is excluded from ordinary work buckets. A Board with no durable intent root, multiple intent roots or untraceable work fails closed as not handoff-safe.

Legacy `orchestrator.seed(...)` remains available for existing tests/low-level Board construction; it does not by itself establish session-handoff safety.

## Follow-up reconciliation

```text
grounded finding(summary + sourceRef)
 -> CURRENT_WORK   -> reopen/narrow current item
 -> EXISTING_WORK  -> link existing Board item
 -> NEW_WORK       -> create child with parent/finding/source provenance
 -> NON_ACTIONABLE -> no Board work
```

Review failure that proves the current obligation is still unresolved does not create a replacement item.

## Persistence and concurrency

`createJsonBlackboardStore(...)` exposes read + transaction, serializes mutations through a filesystem lock and persists snapshots through temp-file write + rename.

A new `ApplicationOrchestrator` instance can restore checkpoints, submissions, pending reviews and requirements from that file. Concurrent local claims cannot both acquire the same Board item.

Async review trust verification happens outside the mutation lock; the later commit fails closed if the active review target changed meanwhile.

Application checkpoint persistence is not external-effect reconciliation. A crash between an external effect and durable Core proof remains a Core recovery concern and must not be inferred from application stage alone.

## Context rules

- repository and application-artifact context are resolved explicitly before execution;
- source payload is not hidden in a provider/session lifecycle;
- Oracle does not widen semantic scope;
- source refs/provenance survive into validated context;
- serializer/dereference responsibilities remain separate;
- conversation history is not project lifecycle state;
- Blackboard tracks lifecycle and refs, while actual work products remain external artifacts.

## Completion rules

Worker prose is not completion authority. Role completion is derived from structured results plus grounded role-specific evidence and application policy.

Backend acceptance authorizes creation of the QA handoff; QA acceptance authorizes a final application submission. Neither role-local decision directly authorizes Blackboard `DONE` or a fabricated review requirement.

Blackboard problem completion remains a separate boundary: required review/acceptance obligations and unresolved current-work findings must be reconciled first.
