# Workflow state

Current Core execution/cognition/recovery projection. This file does not define Agentic Application orchestration or Oracle source resolution.

## CURRENT AVO RUNNING PATH

```text
createHarness.vary()
  -> reject unrecovered RUNNING variation
  -> gate next variation by search investment
  -> createAVOHarness.vary()
       -> project bounded AVO context
       -> begin persisted variation
       -> AgentRuntime.runWithReport()
            -> strategy.run(...)
            -> observe / act / verify / evaluate / memory / promote
       -> complete persisted variation
       -> assess search investment
       -> resume public AVO snapshot
  -> optional supervisor trajectory review
```

`avo.act` still delegates to `core.act()`. `core.act()` calls `environment.act()` before the resulting candidate mutation/event is persisted, so externally visible effect completion is not proven by AVO state alone.

## DELIVERED COGNITION BOUNDARIES

Core now has an explicit structured cognition path:

```text
persisted evidence + bounded context
        -> DeliberationArtifact
        -> ActionIntent
        -> authorization policy
        -> action/effect boundary
        -> outcome refs
        -> observation / evaluation
        -> grounded REFLECTION / durable INTENT
        -> intent/reflection alignment
```

The deliberation artifact is bounded structured state, never raw chain-of-thought. `ActionIntent` is a per-step concrete operation intent; `SemanticMemory.INTENT` remains durable goal/continuation state.

Grounded cognition is separate from correctness authority:

```text
persisted source snapshots
  -> semantic derivation proposal
  -> grounding verifier
  -> ACTIVE REFLECTION / durable INTENT
```

Every activated reflection must retain a fresh persisted evaluation source. Intent/reflection alignment can produce semantic-divergence knowledge for later search policy, but it is not an evaluation or promotion verdict.

## ACTION INTENT + EFFECT COMPOSITION

`createActionIntentEffectController()` now composes capability-target ActionIntent with the existing effect journal:

```text
AUTHORIZED ActionIntent
        -> exact intended capability + input
        -> effect operationKey
        -> journal INTENDED
        -> dispatch
        -> CONFIRMED
             -> link EFFECT_OPERATION ref
             -> ActionIntent EXECUTED
```

Ambiguous effect state does not become false failure:

```text
dispatch boundary error
        -> journal UNKNOWN / pending
        -> link exact EFFECT_OPERATION ref
        -> ActionIntent remains AUTHORIZED
        -> reconcile
             PURE/IDEMPOTENT -> RETRY
             OBSERVABLE      -> observe -> CONTINUE or RETRY
             NON_RECONCILABLE-> ESCALATE
```

If observation confirms the effect, reconciliation completes the ActionIntent without replaying the side effect. A retryable effect remains authorized until the retry actually confirms.

## CORRECTNESS PATH

Existing correctness authority remains independent:

```text
current candidate
  -> observations + verification artifacts
  -> evaluation bound to exact artifact IDs
  -> freshness assertion
  -> promotion to committed lineage
```

Effect confirmation does not imply evaluation success, and grounded semantic memory does not imply effect completion.

## MEMORY VISIBILITY

Semantic retrieval and spontaneous recall are already composable, but visibility is deliberately explicit:

```text
semantic memory
  -> retrieval port (RELEVANCE_ONLY)
  -> optional NOOA ranking adapter
  -> explicitly selected __semantic_memory__ context block
  -> UNTRUSTED bounded context
```

There is no desired hidden global memory injection. Ranking selects context; it never becomes correctness authority.

## RECOVERY PATHS

Three mechanisms still exist and remain distinct:

1. **AVO variation recovery** — closes persisted interrupted work explicitly.
2. **AgentRuntime snapshot/resume** — restores compatible runtime state with explicit live-authority rebinding.
3. **Effect reconciliation** — reconciles journaled operations through replay policy/external observation.

The remaining recovery target is composition, not another recovery mechanism:

```text
restore persisted work/runtime state
  -> reconcile pending effect operations deterministically
  -> restore exact observation/evidence state
  -> project grounded memory + bounded context
  -> continue from an explicit cognition boundary
```

Tracing and semantic memory are context/evidence inputs, never recovery authority by themselves.

## NEXT CORE DELIVERY

Do not generalize a Core workflow surface yet. The next source-backed continuation is:

```text
1. harden built-in AVO external-effect semantics
2. prove restore -> reconcile effects -> resume with a concrete Core recovery consumer
3. only then extract a higher-level Core lifecycle composition surface
```

This work can proceed independently from Agentic Application Wave A only where it stays inside Core authority. Application WorkOrder/Worker/Advisor/completion abstractions remain governed by `../pipeline.md` and must preserve concrete-first sequencing.

## SOURCE

Current implementation authority includes `agent-runtime.js`, `avo-harness.js`, `core-harness.js`, `deliberation.js`, `deliberation-controller.js`, `action-effect.js`, `grounded-cognition.js`, `effect-reconciliation.js`, `semantic-memory*.js`, `spontaneous-recall.js`, `search-investment.js` and `evaluation-freshness.js`.
