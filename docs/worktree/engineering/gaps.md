# Engineering gaps

Only unresolved, source-backed seams that matter to current continuation. For active work, each gap also states the desired exit condition.

## DELIBERATION BOUNDARY

Current:

- `AgentRuntime` records model turns, `AgentEvent`, `TurnEvent`, traces and capability calls.
- `strategy.run({...})` still owns arbitrary inner-loop control; the kernel does not materialize a semantic step between context/observation and action.
- CodeAct has a model -> action -> observation loop, but model output is normalized directly into an action protocol rather than a separately inspectable deliberation artifact.

Desired:

```text
context + persisted observations
        -> DELIBERATION
        -> structured action intent
        -> policy / verification boundary
        -> ACT
        -> persisted observation
        -> next DELIBERATION
```

Exit conditions:

- deliberation is a first-class bounded artifact/step, not raw chain-of-thought;
- it carries explicit source/context refs, intended action, expected outcome and success condition;
- strategy owns reasoning policy, while the kernel owns inspectable step lifecycle and causal identity;
- an action can be linked to the exact deliberation that selected it and the observation that resulted.

## GROUNDED REFLECTION / INTENT

Current:

- semantic memory already represents `REFLECTION` (`DERIVED`) and `INTENT` (`GOAL`).
- semantic-memory evolution `ABSTRACT` can create a `REFLECTION` with source-memory lineage.
- structural source lineage does not prove the derived semantic claim is supported by those sources; a caller/model can still author the output content.
- there is no equivalent kernel-owned grounded producer for durable `INTENT`.

Desired:

```text
persisted observation / verification / evaluation / grounded memory
        -> bounded semantic derivation
        -> independent grounding check
        -> grounded REFLECTION or durable INTENT
```

Exit conditions:

- `REFLECTION` / `INTENT` activation requires exact persisted source refs/snapshots and provenance;
- semantic derivation cannot become authoritative merely because a model authored it;
- grounding can reject unsupported or stale derivations before they enter active memory;
- durable `SemanticMemory.INTENT` remains distinct from a per-step action/effect intent;
- grounded cognition may feed later deliberation, but semantic memory remains distinct from correctness/effect-recovery authority.

## EFFECT / RECOVERY COMPOSITION

- Built-in `avo.act` is a normal capability calling `core.act()`; it does not use `defineEffectCapability()`.
- `core.act()` can cross an external-effect/persistence crash window because `environment.act()` completes before candidate/event persistence.
- The bundled effect journal is in-memory reference state; production durability/fencing is not supplied here.
- AVO interrupted-variation recovery, AgentRuntime snapshot/resume and effect reconciliation are separate APIs; there is no integrated restore -> reconcile effects -> resume workflow lifecycle.

## MEMORY COMPOSITION

- `createSemanticMemoryRetrievalPort()` still exposes `RELEVANCE_ONLY` authority semantics and treats provider ranking as non-authoritative.
- `createNooaMemoryRetriever()` supplies NOOA-style ranking separately; it is not default-wired into the semantic-memory port or spontaneous recall by the kernel.

## WORKFLOW SURFACE

- There is no consumer-facing workflow/pipeline declaration surface composing deliberation, action/effects, observations/verifications, grounded reflection/intent, evaluation, promotion, recovery and search investment as one executable lifecycle.

Resolved gaps must be removed or collapsed into delivered state when implementation lands; Git keeps the history.
