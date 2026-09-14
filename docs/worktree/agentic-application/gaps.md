# Agentic Application gaps

Only unresolved seams that matter to the current application layer. Implementation ordering is owned by `../pipeline.md`.

## WAVE-A CHECKPOINT — CLOSED

The first concrete Backend slice now exists in `packages/agentic-system/` and runs:

```text
BackendObjective
 -> BackendWorkOrder
 -> concrete Backend context resolution through Oracle
 -> BackendWorker through ExHarness
 -> BackendWorkResult
 -> deterministic Backend run decision
```

Wave A resolved the initial contract uncertainty without introducing generic `<C,R>` application contracts. Current concrete choices are evidence from one Backend slice, not yet reusable system abstractions.

Observed concrete shape:

- objective identifies the Backend task, repository revision, required files and constraints;
- order makes the repository source and required files explicit before dispatch;
- context contains the exact resolved files plus source references;
- result exposes Backend status, summary, revision, artifact references and blockers;
- `APPLIED` requires actual ExHarness lineage advancement to the reported revision;
- orchestration remains a direct Backend-specific composition.

## BACKEND COMPLETION — S5

Open:

- exact evidence required to ACCEPT a Backend result;
- which verification comes from ExHarness versus application-specific policy;
- how mutation/build/typecheck/tests/artifacts are represented for the real Backend use case;
- when a structurally valid and lineage-promoted result must still CONTINUE, BLOCK or FAIL.

Constraint: Wave-A lineage promotion proves execution-state transition, not sufficient Backend correctness. Backend completion/evidence semantics remain role-specific in S5 and must not become a universal application evidence standard before another role proves common structure.

## ADVISOR — S6

Open:

- first real judgment gap that requires Advisor instead of deterministic code;
- exact plan/assess/replan proposal shape needed by that gap;
- trigger policy for Advisor invocation.

Constraint: Advisor never becomes implicit dispatch/control or correctness authority.

## SECOND ROLE / COMMON ABSTRACTIONS — S7

Open until S7:

- which second role best pressure-tests the Backend slice (Frontend or QA are likely candidates);
- what role/dependency semantics actually repeat;
- whether a common Worker/WorkOrder/WorkResult abstraction is justified;
- whether generic orchestration is justified.

Constraint: the second slice is the extraction point. There is no generic Orchestrator before it.

## ARTIFACT HANDOFF / INTERNAL SOURCES — S8

Open until S8:

- application artifact reference shape beyond the concrete Backend refs;
- storage/lookup boundary for application-produced artifacts;
- how prior WorkResult/artifact references become inputs to a later role's context need;
- provenance required when Oracle dereferences internal application-produced sources.

Constraint:

```text
Oracle performs IO/dereference/adaptation.
Serializer performs no IO; it only renders resolved context.
```

External source adapters and internal application-artifact adapters remain semantically distinguishable even though both live behind Oracle's resolution boundary.

## APPLICATION STATE / RESILIENCE — S9

Open until multiple work items exist:

- minimum durable application workflow state;
- retry/cancel/block/resume semantics;
- dependency/join state that actually needs persistence;
- mapping into ExHarness recovery/effect boundaries.

Constraint: application workflow state remains distinct from ExHarness persistent/runtime state and artifact storage.

## NON-GOALS UNTIL PROVEN

- group-chat architecture;
- shared global conversation state;
- model-selected Worker handoff;
- generic Crew/Team framework;
- dynamic role registry;
- workflow graph DSL;
- generic Worker/WorkOrder contracts before the second slice;
- application-owned model/session/runtime loop.
