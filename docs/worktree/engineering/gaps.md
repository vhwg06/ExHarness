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
- every activated `REFLECTION` includes a source ref to a persisted evaluation whose input snapshot is still fresh;
- semantic derivation cannot become authoritative merely because a model authored it;
- grounding can reject unsupported or stale derivations before they enter active memory;
- durable `SemanticMemory.INTENT` remains distinct from a per-step action/effect intent;
- grounded cognition may feed later deliberation, but semantic memory remains distinct from correctness/effect-recovery authority;
- `verifyReflectionGroundingContract` codifies the fresh-evaluation requirement as a package contract test used by repository verification.

## INTENT / REFLECTION CALIBRATION

Current:

- the kernel does not compare a pre-action durable `INTENT` with a post-evaluation grounded `REFLECTION`;
- adaptive search investment therefore cannot consume the semantic prediction error between what a variation intended to achieve and what persisted evidence says actually happened.

Desired:

```text
grounded INTENT before action
        -> execution / evaluation
        -> grounded REFLECTION after evaluation
        -> exact intent/reflection alignment
        -> semantic divergence signal
        -> grounded search knowledge
        -> adaptive search-investment input
```

Exit conditions:

- alignment is bound to exact intent/reflection memory IDs and revisions plus the grounding/evaluation evidence that made the reflection active;
- high divergence is an anti-hallucination/search-quality signal, not a correctness verdict;
- the signal can be persisted as grounded knowledge so search-investment freshness changes when a new alignment signal appears;
- custom/adaptive policies may reduce investment in similar directions when divergence remains high without allowing model self-report to manufacture the signal.

## EFFECT / RECOVERY COMPOSITION

- Built-in `avo.act` is a normal capability calling `core.act()`; it does not use `defineEffectCapability()`.
- `core.act()` can cross an external-effect/persistence crash window because `environment.act()` completes before candidate/event persistence.
- The bundled effect journal is in-memory reference state; production durability/fencing is not supplied here.
- AVO interrupted-variation recovery, AgentRuntime snapshot/resume and effect reconciliation are separate APIs; there is no integrated restore -> reconcile effects -> resume workflow lifecycle.

## MEMORY COMPOSITION

- `createSemanticMemoryRetrievalPort()` still exposes `RELEVANCE_ONLY` authority semantics and treats provider ranking as non-authoritative.
- `createNooaMemoryRetriever()` supplies NOOA-style ranking separately; it is not default-wired into the semantic-memory port or spontaneous recall by the kernel.

## WORKFLOW SURFACE

- There is no consumer-facing workflow/pipeline declaration surface composing deliberation, action/effects, observations/verifications, grounded reflection/intent, semantic calibration, evaluation, promotion, recovery and search investment as one executable lifecycle.

Resolved gaps must be removed or collapsed into delivered state when implementation lands; Git keeps the history.
