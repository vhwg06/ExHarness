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

Wave D adds the first durable Agentic Application orchestration state:

```text
ApplicationOrchestrator
  -> claim READY/REOPENED Board work
  -> persist Worker submission
  -> collect Worker-requested / PM-required review obligations
  -> PENDING_REVIEW / REVIEWING
  -> record explicit assessment
     -> accepted obligations satisfied -> DONE
     -> rejected/inconclusive -> REOPENED
  -> reconcile follow-up findings as CURRENT / EXISTING / NEW / NON_ACTIONABLE
```

`createJsonBlackboardStore(...)` persists the Board snapshot so pending submissions/reviews survive a new Orchestrator instance. Worker submission cannot transition directly to `DONE`.

This slice does **not** yet bind the direct Backend -> QA execution path to durable Blackboard dispatch/recovery. It also does not fabricate concrete PM, SA or global Reviewer runtime roles. D003 promotes PM as horizontal project coordination, SA as horizontal architecture only, and other execution/review as vertical/context-bound; those concrete role contexts remain to be earned in source.

The role comparison still does **not** justify a generic Worker, WorkOrder, role registry, workflow graph, generic Advisor, Teacher registry or Reviewer registry. `ApplicationOrchestrator` is concrete Blackboard/workflow control, not a generic workflow DSL or second runtime.

Oracle keeps external and internal sources explicit. Backend context uses `repositoryReader.readFile(...)`; QA context uses `artifactReader.readArtifact(...)` with `APPLICATION_ARTIFACT` provenance. Application handoff carries refs and acceptance-decision provenance, not copied artifact payloads.
