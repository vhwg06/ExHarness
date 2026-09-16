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

Public built-in `avo.act` now crosses a durable effect boundary before `core.act()` derives/persists candidate state:

```text
semantic action + current candidate
        -> deterministic actionKey
        -> effect journal INTENDED
        -> effect journal DISPATCHED
        -> environment.act(...)
        -> effect journal CONFIRMED(result)
        -> core.act applies result to candidate/event state
        -> persist Core session state
```

If Core state persistence fails after `CONFIRMED`, a later identical action over the still-current candidate reuses the confirmed result and does not dispatch the external action again.

If execution becomes ambiguous before confirmation:

```text
DISPATCHED / UNKNOWN
        -> fail closed
        -> reconcile by declared adapter replay policy
             PURE / IDEMPOTENT -> RETRY
             OBSERVABLE        -> observe -> CONTINUE or RETRY
             NON_RECONCILABLE  -> ESCALATE
```

The default is `NON_RECONCILABLE`. Deterministic `actionKey` establishes identity; it does not by itself prove idempotency or effect completion.

Built-in action-effect journal state remains separate from candidate lineage, trajectory, evaluation, semantic memory and application completion.

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

`createActionIntentEffectController()` composes capability-target ActionIntent with the existing effect journal:

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

Built-in AVO actions use the same replay-policy vocabulary but do not synthesize a model `ActionIntent`; ActionIntent and built-in AVO effect-operation state remain distinct artifacts.

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

Three mechanisms exist and remain distinct:

1. **AVO variation recovery** — closes persisted interrupted work explicitly.
2. **AgentRuntime snapshot/resume** — restores compatible runtime state with explicit live-authority rebinding.
3. **Effect reconciliation** — reconciles journaled operations through replay policy/external observation, including built-in AVO action effects.

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
1. prove restore -> reconcile effects -> resume with a concrete recovery consumer
2. only then assess whether a higher-level Core lifecycle composition surface is justified
```

Application WorkOrder/Worker/Advisor/completion abstractions remain owned by Agentic Application and must preserve concrete-first sequencing.

## SOURCE

Current implementation authority includes `agent-runtime.js`, `avo-harness.js`, `effect-aware-harness.js`, `avo-action-effect.js`, `core-harness.js`, `deliberation.js`, `deliberation-controller.js`, `action-effect.js`, `grounded-cognition.js`, `effect-reconciliation.js`, `semantic-memory*.js`, `spontaneous-recall.js`, `search-investment.js` and `evaluation-freshness.js`.
