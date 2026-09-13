# Engineering gaps

Only unresolved, source-backed seams that matter to current continuation.

## EFFECT / RECOVERY COMPOSITION

- Built-in `avo.act` is a normal capability calling `core.act()`; it does not use `defineEffectCapability()`.
- `core.act()` can cross an external-effect/persistence crash window because `environment.act()` completes before candidate/event persistence.
- The bundled effect journal is in-memory reference state; production durability/fencing is not supplied here.
- AVO interrupted-variation recovery, AgentRuntime snapshot/resume and effect reconciliation are separate APIs; there is no integrated restore -> reconcile effects -> resume workflow lifecycle.

## MEMORY COMPOSITION

- `createSemanticMemoryRetrievalPort()` still exposes `RELEVANCE_ONLY` authority semantics and treats provider ranking as non-authoritative.
- `createNooaMemoryRetriever()` supplies NOOA-style ranking separately; it is not default-wired into the semantic-memory port or spontaneous recall by the kernel.

## WORKFLOW SURFACE

- There is no consumer-facing workflow/pipeline declaration surface composing turns, effects, observations/verifications, evaluation, promotion, recovery and search investment as one executable lifecycle.

Resolved gaps must be removed from this file when implementation lands; Git keeps the history.
