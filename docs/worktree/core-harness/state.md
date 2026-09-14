# Core Harness current state

Source-synchronized ExHarness Core checkpoint. Open Core gaps/problems live only in `../../living/blackboard.md`.

## Current implemented capabilities

- `createHarness()` composes persistence, environment actions, observability, supervision, recovery gating, search investment and AVO.
- `createAVOHarness()` composes AVO variation control with `AgentRuntime`; built-in `avo.act` currently reaches `core.act()` as a normal capability.
- persistent AVO work state tracks candidates, observations, verifications, evaluations, knowledge, variations, search-investment decisions, trust artifacts, lineage, trajectory and supervision;
- `createResumableAgentRuntime()` snapshots runtime configuration, event history and agent-scoped resource/live-object activity with compatibility checks and explicit authority rebinding;
- `recoverInterruptedVariation()` closes an interrupted running variation as `INTERRUPTED`; it is separate from external-effect reconciliation;
- effect reconciliation has explicit operation identity, intent-before-dispatch journal state and `PURE | IDEMPOTENT | OBSERVABLE | NON_RECONCILABLE` replay policies;
- structured deliberation and ActionIntent are explicit bounded cognition/action artifacts;
- grounded durable `REFLECTION` / `INTENT` require persisted source snapshots and grounding verification; active reflection requires a fresh evaluation source;
- intent/reflection alignment is a grounded semantic-divergence signal, not evaluation or promotion authority;
- `createActionIntentEffectController()` links capability-target ActionIntent to exact effect operations and keeps ambiguous pending effects authorized until confirmation/reconciliation;
- semantic-memory retrieval is `RELEVANCE_ONLY`; associative ranking/spontaneous recall are opt-in;
- promotion requires a current evaluation over exact current observation/verification snapshots.

## Current authority boundary

```text
Agentic Application -> work semantics / orchestration / completion policy
Oracle              -> source resolution / dereference / adaptation
ExHarness Core       -> execution / runtime authority / cognition / evidence / recovery primitives
```

Source/public exports are authority for the exact behavior. Any unresolved Core issue belongs on the Blackboard, not in this subtree.

## Routing

- current Core structure -> `architecture.md`
- current execution/cognition/recovery behavior -> `workflow.md`
- current Core invariants -> `decisions.md`
- all open Core work -> `../../living/blackboard.md`
