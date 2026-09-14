# @exharness/agentic-system

Concrete agentic application slices built above ExHarness Core.

Wave A intentionally contains one Backend vertical slice only:

```text
BackendObjective
  -> BackendWorkOrder
  -> resolveBackendContext(...)
  -> BackendWorker
  -> ExHarness Core
  -> BackendWorkResult
  -> deterministic Backend run decision
```

The package does not expose a generic Worker, WorkOrder, role registry, workflow graph, or generic Orchestrator. Common abstractions are deferred until a second real role demonstrates repeated semantics.
