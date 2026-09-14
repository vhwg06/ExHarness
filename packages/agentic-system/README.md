# @exharness/agentic-system

Concrete agentic application slices built above ExHarness Core.

## Delivered checkpoint

Wave A proves one real Backend vertical slice:

```text
BackendObjective
  -> BackendWorkOrder
  -> resolveBackendContext(...)
  -> BackendWorker
  -> ExHarness Core
  -> BackendWorkResult
```

Wave B makes completion trustworthy and introduces bounded judgment:

```text
BackendWorkResult
  -> grounded ExHarness evidence
     mutation + typecheck + tests
  -> BackendCompletionPolicy
  -> ACCEPT | CONTINUE | BLOCK | FAIL

all objective checks pass + unresolved semantic gaps
  -> BackendAdvisor
  -> RETRY_IMPLEMENTATION | REQUEST_CONTEXT | ESCALATE
  -> application validates and maps the proposal
```

Worker-returned prose is not completion authority. `BackendWorker` discards claimed evidence and rebuilds evidence from actual ExHarness lineage/verification state. `ACCEPT` is an application-owned decision represented with an ExHarness acceptance-boundary `DecisionArtifact`.

Advisor is not correctness authority: it is never invoked for deterministic missing/failed evidence, cannot ACCEPT work, cannot dispatch another Worker, and must reference an existing unresolved gap.

The package still does not expose a generic Worker, WorkOrder, role registry, workflow graph, generic Advisor, or generic Orchestrator. Common abstractions remain deferred until a second real role demonstrates repeated semantics in Wave C.
