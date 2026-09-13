# Workflow engineering state

Load only for workflow, pipeline, effect-recovery or resume work.

## CURRENT

`createAVOHarness()` composes AVO with `AgentRuntime`; built-in `avo.act` is a normal capability calling `core.act()` directly. Effect recovery is separate: `defineEffectCapability()` journals intent before dispatch and `reconcileEffectOperation()` resolves `PURE`, `IDEMPOTENT`, `OBSERVABLE` or `NON_RECONCILABLE` outcomes.

Runtime history (`AgentEvent`), turn lifecycle (`TurnEvent`), tracing (`TraceSpan`) and effect operations are distinct records. Semantic memory is cognition; evaluation freshness is the promotion gate.

## INVARIANTS

```text
AgentEvent != TurnEvent != TraceSpan != EffectJournal
Observation != SemanticMemory != Evaluation
candidate state != external-effect proof
retrieval ranking != correctness authority
```

## GAP

There is no integrated machine lifecycle for:

```text
restore -> reconcile pending effects -> project current state -> resume work
```

There is also no declarative pipeline API composing runtime turns, observations, effects, evaluation, promotion and search investment.

## NEXT

Wire effect semantics at the execution boundary first. Recovery should resolve replay/idempotency/observable state deterministically; only unresolved semantic ambiguity may be projected to model/operator judgment.

## SOURCE

`avo-harness.js`, `agent-runtime.js`, `effect-reconciliation.js`, `state.js`, `semantic-memory-retrieval.js`, `evaluation-freshness.js`.
