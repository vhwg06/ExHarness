# Active Agentic Application decisions

Current constraints that must shape Agentic Application implementation. This is not an ADR archive.

## OWNERSHIP

- Application owns objectives, role/work semantics, deterministic workflow control, required semantic context and application completion policy.
- Oracle owns source resolution/dereference/adaptation; it does not decide what a role should need.
- ExHarness Core owns agent/runtime execution mechanics, cognition, evidence/trust and lifecycle/recovery primitives.
- Infrastructure owns concrete storage, executors/sandboxes, source access and enforcement.

## CONCRETE-FIRST DELIVERY

- Wave A is Backend-specific end-to-end implementation, not a generic framework milestone.
- `runBackendObjective(...)` may call `BackendWorker` directly; a generic Worker interface is not required.
- No generic `Worker<C,R>`, `WorkOrder<C,R>`, `ContextRequirement<C>`, Worker registry or generic Orchestrator before a second real role demonstrates common semantics.
- S7 is the first legitimate extraction point for common Worker/WorkOrder/result/orchestration abstractions.
- Duplicate concrete code is preferable to a guessed abstraction before repeated structure exists.

## ORCHESTRATION

- Orchestrator is deterministic application control code by default.
- Manager-style bounded delegation is preferred over handoff/shared-group-chat takeover.
- Workers do not select the next Worker or mutate global application workflow state.
- Parallelism requires application-established independence; it is not emergent conversation behavior.

## ADVISOR

- Advisor is invoked only for a demonstrated judgment gap.
- Advisor output is a bounded structured proposal/assessment, never direct dispatch or workflow mutation.
- Deterministic next steps must not be routed through an LLM merely to preserve an “agentic” appearance.

## CONTEXT

- Application owns the required semantic context and its shape.
- Oracle resolves context explicitly before Worker execution.
- The application does not need to decide in advance whether context requirement metadata belongs to a Worker role or individual order; concrete slices determine that shape.
- Context feeding is explicit, not hidden behind provider lifecycle/session hooks.

## RESULT / COMPLETION

- A Worker saying “done” in prose is not application completion authority.
- Completion is derived from structured role-specific result state plus application policy and accepted evidence.
- Backend tests/typecheck/mutation/artifact semantics remain Backend-specific until another role proves common evidence semantics.

## ARTIFACT CHAINING

- Large produced artifacts flow between work items by reference rather than by copying payloads through orchestration state.
- Oracle dereferences both external sources and internal application-produced artifacts/state when a later context need requires them.
- External-source adapters and internal application-artifact adapters remain distinguishable even when exposed through the same Oracle resolution boundary.
- Serializer performs no IO or dereference; it only renders already-resolved semantic context.

## STATE

- Application workflow state is distinct from ExHarness runtime/persistent state and from artifact storage.
- Do not add application persistence until multi-work/resilience requirements demonstrate what must actually survive.

Remove or replace a decision when concrete slices invalidate it; do not preserve obsolete abstractions for compatibility with design-only code.
