# Core Harness state

Current ExHarness Core continuation state. Route from here only when the task is about kernel/runtime behavior rather than Agentic Application or Oracle semantics.

## CURRENT

- `createHarness()` composes validated persistence, idempotent environment actions, observability, supervision, recovery gating, search investment and `createAVOHarness()`.
- `createAVOHarness()` composes AVO variation control with `AgentRuntime`; built-in `avo.act` still calls `core.act()` directly through a normal capability.
- Persistent AVO work state tracks candidate history, observations, verifications, evaluations, knowledge, variations, search-investment decisions, trust artifacts, lineage, trajectory and supervision.
- `createResumableAgentRuntime()` snapshots runtime configuration, `AgentEvent` history and agent-scoped resource/live-object activity; restore requires compatibility checks and explicit rebinding of live authority.
- Interrupted AVO variations have explicit recovery through `recoverInterruptedVariation()`; this closes a running variation as `INTERRUPTED`, it does not reconcile external side effects.
- Effect reconciliation is a separate primitive with operation identity, intent-before-dispatch journal state and replay policies.
- Semantic-memory authority and ranking are separate: `createSemanticMemoryRetrievalPort()` re-reads canonical records and enforces ACTIVE/tag/budget boundaries; `createNooaMemoryRetriever()` is a ranking adapter, not correctness authority.
- `REFLECTION` / `INTENT` exist as semantic-memory kinds, but there is no kernel-owned grounded producer that proves semantic output against persisted evidence.
- `AgentRuntime` owns model turns, events, traces and capability execution, but not an inspectable deliberation/intention step between observation/context and action.
- Promotion requires a current evaluation over the exact current observation and verification ID snapshots.

## ACTIVE CORE CONTINUATION

Desired Core continuation remains:

1. first-class inspectable `deliberate -> act -> observe` step lifecycle;
2. grounded `REFLECTION` / durable `INTENT` derivation from persisted evidence;
3. intent/reflection semantic calibration;
4. composition with effect/recovery workflow boundaries.

These are Core concerns. They must not absorb Agentic Application orchestration or Oracle context-resolution semantics.

## ROUTING

- implemented Core structure -> `architecture.md`
- execution/cognition/recovery loop -> `workflow.md`
- unresolved Core seams / exit conditions -> `gaps.md`
- active Core constraints -> `decisions.md`
- system-level delivery order -> `../pipeline.md`

## BOUNDARY

```text
Agentic Application
    -> owns work semantics / orchestration / completion policy

Oracle
    -> owns source resolution / dereference / adaptation

ExHarness Core
    -> owns agent execution mechanics / runtime authority / cognition / evidence / recovery primitives
```

## AUTHORITY

Source/public exports are implementation authority. This subtree is the desired continuation projection for ExHarness Core only. Implementation is complete when source converges and this projection can be reconciled to delivered truth.
