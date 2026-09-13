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
- Promotion requires a current evaluation over the exact current observation and verification ID snapshots.

## ACTIVE

Workflow/recovery composition is the current engineering continuation seam.

## CONTEXT

- implemented structure -> `architecture.md`
- execution/recovery loop -> `workflow.md`
- unresolved seams -> `gaps.md`
- active constraints -> `decisions.md`

## AUTHORITY

```text
source/public API -> worktree projection -> task context
```

Children carry current semantic state only; historical completion detail remains in Git and `docs/architecture/`.
