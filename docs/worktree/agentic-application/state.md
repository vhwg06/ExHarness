# Agentic Application state

Desired-state projection for the application layer above ExHarness Core and beside Oracle infrastructure.

## PURPOSE

The Agentic Application Layer owns what work exists, how work is decomposed, which specialist role executes it, what semantic context that role requires, what structured result is expected and when application work is complete.

## OWNERSHIP

- Application owns Objective, role/work semantics, required semantic context, result/completion semantics and deterministic workflow control.
- Orchestrator owns dispatch/application workflow state and remains deterministic where next actions are known.
- Advisor supplies bounded judgment only where planning/assessment/replanning is genuinely needed.
- Worker owns one specialist execution responsibility and returns machine-inspectable role-specific result state.
- Oracle resolves/dereferences application-defined context; it does not decide what context a role should need.
- ExHarness owns agent/runtime execution mechanics, cognition, evidence/trust and recovery/lifecycle primitives.

## IMPLEMENTED CHECKPOINT — WAVES A + B

The concrete Backend application in `packages/agentic-system/` now runs:

```text
BackendObjective
 -> BackendWorkOrder
 -> resolveBackendContext(...)
 -> BackendWorker
 -> ExHarness
 -> grounded BackendWorkResult
 -> BackendCompletionPolicy
 -> deterministic completion
 -> bounded BackendAdvisor only for unresolved semantic gaps
```

Wave A established:

- explicit Backend objective/order/context/result contracts;
- resolve-once Oracle context loading;
- ExHarness-backed Backend execution;
- actual lineage promotion required for `APPLIED`;
- direct concrete orchestration with no generic Worker/Orchestrator framework.

Wave B established:

- mutation evidence is grounded in ExHarness lineage state;
- typecheck/tests evidence is grounded in actual ExHarness verification artifacts;
- evidence merely returned by Worker prose is discarded;
- default Backend acceptance requires mutation + typecheck + tests + artifact presence;
- application completion emits an ExHarness `DecisionArtifact` at `ACCEPTANCE` boundary;
- missing/inconclusive/failed verification is handled deterministically;
- the observed Advisor boundary is only `all required evidence passes + unresolved semantic gaps remain`;
- BackendAdvisor can propose only `RETRY_IMPLEMENTATION`, `REQUEST_CONTEXT`, or `ESCALATE` and must reference existing gaps;
- Advisor cannot ACCEPT, dispatch Workers, mutate workflow state directly, or become correctness authority.

No generic `Worker<C,R>`, generic `WorkOrder<C,R>`, generic Advisor, dynamic role registry or workflow graph has been introduced.

## CURRENT ACTIVE TARGET — WAVE C

Implementation follows `../pipeline.md`.

```text
S7 add a second real role
   -> compare concrete semantics
   -> extract only repeated shapes if actually proven

S8 prior WorkResult/artifact refs
   -> Oracle dereference
   -> resolved downstream context
   -> no payload-copy orchestration state
```

S7 is the first allowed extraction point for common Worker/WorkOrder/orchestration semantics. If the second role does not demonstrate a strong common shape, keep concrete duplicated code.

## ROUTING

- semantic meaning of roles/control -> `semantics.md`
- layer/component boundaries -> `architecture.md`
- authority/dependency bounds -> `boundaries.md`
- semantic execution topology -> `workflow.md`
- concrete-first contract/extraction policy -> `contracts.md`
- active constraints -> `decisions.md`
- unresolved application seams -> `gaps.md`
- implementation order -> `../pipeline.md`
