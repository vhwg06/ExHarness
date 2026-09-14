# Agentic Application gaps

Only unresolved seams that matter to the current application layer. Implementation ordering is owned by `../pipeline.md`.

## FIRST BACKEND VERTICAL SLICE

Current:

- architecture/semantics are defined;
- no Agentic Application package exists yet;
- no concrete Backend application slice exists yet;
- earlier generic contract sketches are no longer implementation targets.

Desired Wave-A exit:

```text
BackendObjective
 -> concrete Backend order
 -> concrete Backend context resolution through Oracle
 -> BackendWorker through ExHarness
 -> BackendWorkResult
 -> concrete deterministic Backend completion/next-step decision
```

The entire S1-S4 path is one continuous implementation wave with one review after it works end-to-end.

## BACKEND OBJECTIVE / ORDER / CONTEXT / RESULT

Open until the concrete slice supplies evidence:

- exact Backend objective fields;
- exact Backend order fields;
- whether context need is role-level, order-level or represented another way;
- exact Backend context schema;
- exact Backend result statuses, artifacts, gaps/blockers and evidence references.

Constraint: do not introduce generic `<C,R>` contracts to answer these questions before the concrete slice runs.

## BACKEND COMPLETION

Open:

- exact evidence required to ACCEPT a Backend result;
- which verification comes from ExHarness versus application-specific policy;
- how mutation/build/typecheck/tests/artifacts are represented for the real Backend use case.

Constraint: Backend completion/evidence semantics are role-specific in S5 and must not become a universal application evidence standard before another role proves common structure.

## ADVISOR

Open:

- first real judgment gap that requires Advisor instead of deterministic code;
- exact plan/assess/replan proposal shape needed by that gap;
- trigger policy for Advisor invocation.

Constraint: Advisor never becomes implicit dispatch/control authority.

## SECOND ROLE / COMMON ABSTRACTIONS

Open until S7:

- which second role best pressure-tests the Backend slice (Frontend or QA are likely candidates);
- what role/dependency semantics actually repeat;
- whether a common Worker/WorkOrder/WorkResult abstraction is justified;
- whether generic orchestration is justified.

Constraint: the second slice is the extraction point. There is no generic Orchestrator before it.

## ARTIFACT HANDOFF / INTERNAL SOURCES

Open until S8:

- application artifact reference shape;
- storage/lookup boundary for application-produced artifacts;
- how prior WorkResult/artifact references become inputs to a later role's context need;
- provenance required when Oracle dereferences internal application-produced sources.

Constraint:

```text
Oracle performs IO/dereference/adaptation.
Serializer performs no IO; it only renders resolved context.
```

External source adapters and internal application-artifact adapters remain semantically distinguishable even though both live behind Oracle's resolution boundary.

## APPLICATION STATE / RESILIENCE

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
