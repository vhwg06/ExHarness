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

## Context rules

- repository and application-artifact context are resolved explicitly before execution;
- source payload is not hidden in a provider/session lifecycle;
- Oracle does not widen semantic scope;
- source refs/provenance survive into validated context;
- serializer/dereference responsibilities remain separate.

## Completion rules

Worker prose is not completion authority. Completion is derived from structured results plus grounded role-specific evidence and application policy.
