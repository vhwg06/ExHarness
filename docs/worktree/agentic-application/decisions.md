# Agentic Application decisions

Current constraints that must shape implementation. This is not an ADR archive.

## LAYERING

- Agentic Application owns domain/task/workflow semantics above ExHarness Core.
- ExHarness owns agent/runtime execution mechanics and must not be reimplemented in the application layer.
- Oracle is infrastructure implementing application-defined context requirements; Oracle does not own application semantics.
- Workspace/executor/source transports remain infrastructure concerns behind application ports.

## ORCHESTRATION

- Orchestrator is deterministic application code by default, not an agent persona.
- Deterministic control decisions must stay in code when their semantics are already known.
- Advisor judgment is separate from Orchestrator control authority.
- Advisor may propose plan/assessment/replan; Orchestrator decides whether/how to apply the proposal.
- Specialist coordination uses manager-style delegation by default, not handoff-style shared conversation takeover.
- Group chat, model-selected speaker routing and shared-conversation coordination are not default abstractions.

## WORKERS

- Worker is a typed specialist application role, not a generic chat participant.
- Worker receives a bounded WorkOrder plus explicitly resolved context and returns a bounded WorkResult.
- Worker does not implicitly choose the next Worker or mutate global application workflow state.
- Backend/Frontend/QA/Designer are expected specializations, not architecture-level primitives.

## CONTEXT

- Context requirements and result shape are application-owned contracts.
- Oracle resolves context once per WorkOrder before execution.
- No automatic provider lifecycle, hidden refresh or implicit widening of context scope.
- Missing required context must remain explicit; infrastructure cannot manufacture semantic substitutes.

## CONTRACTS

- Boundary data should be typed and runtime-validatable where model/external-source output crosses into application authority.
- Prefer established schema tooling such as Zod-compatible schemas over inventing a new validation system.
- Free-form prose may accompany artifacts/results but must not be the only machine-readable workflow state.

## STATE AND AUTHORITY

- Application workflow state is distinct from ExHarness runtime state, semantic memory, traces, evidence and effect-recovery state.
- Advisor confidence/self-report is not correctness authority.
- Worker completion prose is not application completion authority.
- Application completion is derived from accepted typed WorkResults plus application policy/evidence requirements.

## IMPLEMENTATION STYLE

- Prefer ordinary TypeScript composition over a generic Crew/Team/WorkflowGraph abstraction until a concrete need proves otherwise.
- Reuse external frameworks for specific capabilities only when they solve the exact required problem; do not import their session/run-loop/group-chat semantics into this layer.
- Start with one vertical slice before generalizing role registries, dynamic routing or graph DSLs.
