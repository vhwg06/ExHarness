# Agentic Application gaps

Only unresolved seams that matter to the current application layer. Implementation ordering is owned by `../pipeline.md`.

## WAVES A + B CHECKPOINT — CLOSED

The concrete Backend slice now proves execution plus trustworthy application completion:

```text
BackendObjective
 -> BackendWorkOrder
 -> Oracle-resolved BackendContext
 -> BackendWorker through ExHarness
 -> grounded mutation/verification evidence
 -> BackendCompletionPolicy
 -> ACCEPT | CONTINUE | BLOCK | FAIL
```

Closed S5 decisions:

- `APPLIED`/lineage promotion is necessary but not sufficient for Backend acceptance;
- grounded Backend evidence comes from actual ExHarness lineage + verification artifacts, not Worker-returned evidence claims;
- default required claims are `backend.mutation`, `backend.typecheck`, and `backend.tests`;
- artifact presence is part of Backend completion;
- invalid/failed evidence -> FAIL;
- missing/inconclusive evidence or missing artifacts -> CONTINUE;
- blocked/failed work remains deterministic BLOCK/FAIL;
- successful acceptance is materialized as an ExHarness acceptance-boundary decision artifact.

Closed S6 decisions:

- missing/failed evidence is not an Advisor problem because the next state is deterministic;
- the first observed judgment gap is unresolved semantic gaps remaining after required Backend evidence passes;
- BackendAdvisor is bounded to `RETRY_IMPLEMENTATION | REQUEST_CONTEXT | ESCALATE`;
- proposals must reference existing gaps;
- Advisor cannot ACCEPT work, dispatch Workers or become correctness authority.

These are Backend-specific facts from one role. They are not yet universal application contracts.

## SECOND ROLE / COMMON ABSTRACTIONS — S7

Open until S7:

- which second role best pressure-tests the Backend slice (Frontend or QA are likely candidates);
- which objective/order/context/result fields genuinely repeat;
- whether evidence/completion semantics repeat or remain role-specific;
- whether a common Worker/WorkOrder/WorkResult abstraction is justified;
- whether Advisor proposal structure repeats;
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
- generic Worker/WorkOrder/Advisor contracts before the second slice;
- application-owned model/session/runtime loop.
