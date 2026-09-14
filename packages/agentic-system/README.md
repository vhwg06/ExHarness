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

Wave B makes Backend completion trustworthy and introduces bounded judgment:

```text
BackendWorkResult
  -> grounded ExHarness evidence
     mutation + typecheck + tests
  -> BackendCompletionPolicy
  -> ACCEPT | CONTINUE | BLOCK | FAIL

all objective checks pass + unresolved semantic gaps
  -> BackendAdvisor
  -> RETRY_IMPLEMENTATION | REQUEST_CONTEXT | ESCALATE
```

Wave C adds a second real role and cross-work context chaining:

```text
accepted BackendWorkResult
  -> ref-only BackendQaHandoff
  -> QaWorkOrder selects required artifact refs
  -> resolveQaContext(...)
     -> artifactReader.readArtifact(...)
  -> QaWorker
     -> non-mutating ExHarness verification
  -> qa.behavior + qa.regression evidence
  -> QaCompletionPolicy
```

`QaWorker` cannot mutate or advance lineage. Worker-returned evidence and inspected-artifact claims are replaced with grounded ExHarness/runtime state.

The two-role comparison did **not** justify a generic Worker, WorkOrder, role registry, workflow graph, generic Advisor, or generic Orchestrator. Backend is mutating/promoting work; QA is inspection of a fixed accepted revision. The repeated shapes extracted so far are deliberately narrow: application artifact references and evidence-integrity/claim-state plumbing.

Oracle keeps external and internal sources explicit. Backend context uses `repositoryReader.readFile(...)`; QA context uses `artifactReader.readArtifact(...)` with `APPLICATION_ARTIFACT` provenance. Application handoff carries refs and acceptance-decision provenance, not copied artifact payloads.
