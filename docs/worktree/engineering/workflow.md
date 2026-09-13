# Workflow state

Current execution/recovery projection. Load for pipeline, resume, crash-recovery or effect work.

## RUNNING PATH

```text
createHarness.vary()
  -> reject unrecovered RUNNING variation
  -> gate next variation by search investment
  -> createAVOHarness.vary()
       -> project bounded AVO context
       -> begin persisted variation
       -> AgentRuntime.runWithReport()
            -> observe / act / verify / evaluate / memory / promote capabilities
       -> complete persisted variation
       -> assess search investment
       -> resume public AVO snapshot
  -> optional supervisor trajectory review
```

`avo.act` currently delegates to `core.act()`. `core.act()` calls `environment.act()` before the resulting candidate mutation/event is persisted, so external-effect completion is not proven by AVO state alone.

## RECOVERY PATHS

Three mechanisms exist and are intentionally distinct:

1. **AVO variation recovery** — detects a persisted `RUNNING` variation and explicitly closes it as `INTERRUPTED`; `resume()`/`vary()` fail closed until recovery.
2. **AgentRuntime snapshot/resume** — restores runtime event/configuration state; agent-scoped resources/live objects require explicit rebinding and are not silently resurrected.
3. **Effect reconciliation** — `defineEffectCapability()` journals `INTENDED -> DISPATCHED -> CONFIRMED/UNKNOWN`; `reconcileEffectOperation()` returns `CONTINUE`, `RETRY` or `ESCALATE` from replay policy and external observation.

These mechanisms are not yet one lifecycle.

## CORRECTNESS PATH

```text
current candidate
  -> observations + verification artifacts
  -> evaluation bound to exact artifact IDs
  -> freshness assertion
  -> promotion to committed lineage
```

Search investment and supervisor intervention may control continuation, but neither certifies correctness.

## TARGET

Machine-first recovery should compose the existing mechanisms as:

```text
restore persisted work/runtime state
  -> identify unresolved effect operations
  -> reconcile by replay/idempotency/external observation
  -> escalate only residual ambiguity
  -> project bounded current context
  -> resume or open the next variation
```

Do not use tracing or semantic memory as recovery authority.

## SOURCE

`harness.js`, `avo-harness.js`, `core-harness.js`, `recovery.js`, `resumable-agent-runtime.js`, `effect-reconciliation.js`, `evaluation-freshness.js`.
