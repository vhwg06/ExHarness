# Workflow state

Stateful architecture projection. Reconcile this file with source in the same PR when the listed semantics change.

## CURRENT

- `PersistentWorkState` owns the current candidate and persisted observations, verifications, evaluations, knowledge, variations, lineage, trust artifacts, trajectory and supervision state.
- `createAVOHarness()` composes the long-horizon variation loop with `AgentRuntime`. Its built-in `avo.act` is currently a normal `defineCapability()` that calls `core.act()` directly.
- Runtime keeps separate `AgentEvent`, `TurnEvent`, and `TraceSpan` records. Model context is a bounded projection of canonical working history plus selected context/resources.
- Semantic-memory retrieval is `RELEVANCE_ONLY`: provider ranking selects candidates, then ExHarness re-reads canonical records, excludes archived/tag-mismatched records, and enforces item/serialized-size budgets.
- Evaluation freshness is bound to the current candidate's exact observation and verification ID snapshots before promotion.
- Effect reconciliation exists as a standalone capability primitive: `defineEffectCapability()` persists operation intent before execution and supports `PURE`, `IDEMPOTENT`, `OBSERVABLE`, and `NON_RECONCILABLE` recovery policies.

## INVARIANTS

```text
Observation != SemanticMemory != Evaluation
AgentEvent != TurnEvent != TraceSpan != EffectJournal
retrieval ranking != correctness authority
candidate state != proof of external effect
promotion requires current evaluation inputs
```

Effect recovery is machine-defined where capability semantics permit it: confirmed -> continue; pure/idempotent -> retry; observable -> observe then continue/retry; non-reconcilable -> escalate.

## GAP

The effect journal/reconciler is not yet wired into the built-in AVO `avo.act` path or into a repository-wide restore/resume orchestration loop. Therefore ExHarness does not currently provide one integrated `restore -> reconcile pending effects -> resume workflow` API.

There is also no consumer-facing workflow declaration API that composes runtime turns, observations, effect recovery, evaluation, promotion and search investment as one executable graph.

## TARGET

Wire effect semantics into the execution boundary without changing existing authority rules, then expose recovery as an explicit machine-first lifecycle. Model judgment should receive recovery context only for residual semantic ambiguity that deterministic replay/idempotency/observation cannot resolve.

## SOURCE MAP

- `packages/core-harness/src/state.js` — persistent work state
- `packages/core-harness/src/avo-harness.js` — current AVO composition and `avo.act`
- `packages/core-harness/src/agent-runtime.js` — runtime history/context/capability execution
- `packages/core-harness/src/effect-reconciliation.js` — effect intent and recovery semantics
- `packages/core-harness/src/semantic-memory-retrieval.js` — retrieval authority boundary
- `packages/core-harness/src/evaluation-freshness.js` — promotion freshness

If source and this projection disagree, source is current implementation truth and this file must be reconciled before the change is complete.
