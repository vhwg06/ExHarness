# Engineering state

Current engineering continuation state. Route from here to the smallest relevant child projection.

## CURRENT

- `createHarness()` composes validated persistence, idempotent environment actions, observability, supervision, recovery gating, search investment and `createAVOHarness()`.
- `createAVOHarness()` composes AVO variation control with `AgentRuntime`; built-in `avo.act` still calls `core.act()` directly through a normal capability.
- Persistent AVO work state tracks candidate history, observations, verifications, evaluations, knowledge, variations, search-investment decisions, trust artifacts, lineage, trajectory and supervision.
- `createResumableAgentRuntime()` snapshots runtime configuration, `AgentEvent` history and agent-scoped resource/live-object activity; restore requires compatibility checks and explicit rebinding of live authority.
- Interrupted AVO variations have explicit stale/forced recovery through `recoverInterruptedVariation()`; this closes a running variation as `INTERRUPTED`, it does not reconcile external side effects.
- Effect reconciliation is a separate primitive with operation identity, intent-before-dispatch journal state and replay policies.
- Semantic-memory authority and ranking are separate: `createSemanticMemoryRetrievalPort()` re-reads canonical records and enforces ACTIVE/tag/budget boundaries; `createNooaMemoryRetriever()` is a ranking adapter, not correctness authority.
- `REFLECTION` / `INTENT` exist as semantic-memory kinds, but there is no kernel-owned grounded producer that proves semantic output against persisted evidence.
- `AgentRuntime` owns model turns, events, traces and capability execution, but not an inspectable deliberation/intention step between observation/context and action.
- Promotion requires a current evaluation over the exact current observation and verification ID snapshots.

## ACTIVE

Desired continuation state:

1. first-class inspectable `deliberate -> act -> observe` step lifecycle;
2. grounded `REFLECTION` / durable `INTENT` derivation from persisted evidence;
3. then compose those semantics with effect/recovery workflow boundaries.

## CONTEXT

- implemented structure -> `architecture.md`
- desired execution/cognition loop -> `workflow.md`
- unresolved seams / exit conditions -> `gaps.md`
- active constraints -> `decisions.md`

## AUTHORITY

```text
source/public API -> worktree desired state -> implementation -> reconciled source
```

Worktree is the desired delivery projection for active engineering. Implementation is complete only when source converges to these semantics and the projection can be reconciled to current state.
