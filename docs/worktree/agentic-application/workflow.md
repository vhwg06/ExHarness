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

This path is still composed directly by `runBackendThenQaObjective(...)`; durable Blackboard orchestration has not yet been wired around Backend/QA dispatch.

## Durable Blackboard lifecycle

```text
READY / REOPENED
 -> Orchestrator.claim(...)
 -> CLAIMED
 -> Worker produces bounded submission
 -> Orchestrator.submit(...)
 -> PENDING_REVIEW
 -> Orchestrator.beginReview(...)
 -> REVIEWING
 -> Orchestrator.recordAssessment(...)
      |
      +-> all required ACCEPTED + no remaining work -> DONE
      |
      +-> REJECTED / INCONCLUSIVE -> REOPENED
      |
      +-> other required review remains -> PENDING_REVIEW
```

Review requirements may be Worker-requested at submit time or PM-required separately. The Orchestrator owns scheduling/transition semantics; the current source does not yet implement concrete PM/SA role execution or vertical reviewer workers.

## Follow-up reconciliation

```text
unresolved finding
 -> CURRENT_WORK   -> reopen/narrow current item
 -> EXISTING_WORK  -> link existing Board item
 -> NEW_WORK       -> create child with parent/finding provenance
 -> NON_ACTIONABLE -> no Board mutation beyond returned disposition
```

Review failure that proves the current obligation is still unresolved does not create a replacement item.

## Persistence

`createJsonBlackboardStore(...)` persists the full Board snapshot through temp-file write + rename. A new `ApplicationOrchestrator` instance can restore submissions, pending reviews and requirements from that file.

## Context rules

- repository and application-artifact context are resolved explicitly before execution;
- source payload is not hidden in a provider/session lifecycle;
- Oracle does not widen semantic scope;
- source refs/provenance survive into validated context;
- serializer/dereference responsibilities remain separate.

## Completion rules

Worker prose is not completion authority. Role completion is derived from structured results plus grounded role-specific evidence and application policy.

Blackboard problem completion is a separate boundary: Worker submission cannot self-authorize `DONE`; required review/acceptance obligations and unresolved current-work findings must be reconciled first.
