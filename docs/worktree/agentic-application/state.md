# Agentic Application convergence state

Durable convergence material for the application layer above ExHarness Core and beside Oracle infrastructure.

This subtree is **not automatic desired-state authority**. Read `../README.md` and `../../living/contracts.md` before treating future component shapes as accepted architecture.

## ACCEPTED PURPOSE / OWNERSHIP

The Agentic Application Layer owns what work exists, how work is decomposed, which specialist role executes it, what semantic context that role requires, what structured result is expected and when application work is complete.

Current accepted ownership direction:

- Application owns Objective, role/work semantics, required semantic context, result/completion semantics and deterministic workflow control.
- Orchestrator owns dispatch/application workflow state and remains deterministic where next actions are known.
- Advisor supplies bounded judgment only where planning/assessment/replanning is genuinely needed.
- Worker owns one specialist execution responsibility and returns machine-inspectable role-specific result state.
- Oracle resolves/dereferences application-defined context; it does not decide what context a role should need.
- ExHarness owns agent/runtime execution mechanics, cognition, evidence/trust and recovery/lifecycle primitives.

Names above describe accepted responsibilities. They do not imply that every future interface/service shape already exists or is promoted.

## OBSERVED CHECKPOINT — WAVES A + B

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

No generic `Worker<C,R>`, generic `WorkOrder<C,R>`, generic Advisor, dynamic role registry or workflow graph has been introduced. Source/public exports remain authority for exact implementation.

## ACTIVE CANDIDATE CONVERGENCE — WAVE C

Implementation ordering follows `../pipeline.md`.

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

The delivery need/order is accepted; the exact second-role contracts, extracted common APIs and S8 handoff types remain candidates until implementation/evidence earns promotion.

## ROUTING

- semantic meaning of roles/control -> `semantics.md`
- candidate layer/component boundaries -> `architecture.md`
- authority/dependency bounds -> `boundaries.md`
- candidate execution topology -> `workflow.md`
- concrete-first extraction policy -> `contracts.md`
- prior accepted/working constraints -> `decisions.md`
- unresolved application seams -> `gaps.md`
- implementation order -> `../pipeline.md`
- promotion rules -> `../../living/README.md`
