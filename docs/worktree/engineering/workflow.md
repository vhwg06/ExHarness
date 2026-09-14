# Workflow state

Current execution/recovery projection plus desired cognition loop for the next implementation stage.

## CURRENT RUNNING PATH

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

`strategy.run(...)` currently owns arbitrary inner-loop control. Turn/events/traces make execution inspectable, but there is no kernel-owned semantic boundary between observation/context and the action chosen from it.

`avo.act` currently delegates to `core.act()`. `core.act()` calls `environment.act()` before the resulting candidate mutation/event is persisted, so external-effect completion is not proven by AVO state alone.

## DESIRED COGNITION LOOP

```text
persisted evidence + bounded context
        -> DELIBERATION
             structured, inspectable, no raw CoT
        -> ACTION INTENT
             exact deliberation/source refs
        -> pre-action policy / verification
        -> EFFECT / ACTION
        -> persisted OBSERVATION
        -> grounded REFLECTION / durable INTENT derivation
        -> grounding check against exact persisted sources
        -> next bounded context
        -> DELIBERATION
```

Kernel owns step identity, causal links, lifecycle and authority boundaries. Strategy/model owns how a deliberation proposal is produced inside those bounds.

Desired causal chain:

```text
source evidence snapshot
   -> DeliberationArtifact
   -> ActionIntent
   -> EffectOperation / action
   -> Observation
   -> GroundingArtifact
   -> REFLECTION / SemanticMemory.INTENT
```

A `SemanticMemory.INTENT` is durable goal/continuation state. It is not the same object as the concrete `ActionIntent` used for one step/effect.

## CORRECTNESS / GROUNDING

Existing correctness path remains:

```text
current candidate
  -> observations + verification artifacts
  -> evaluation bound to exact artifact IDs
  -> freshness assertion
  -> promotion to committed lineage
```

Grounded cognition adds a parallel semantic-authority path:

```text
persisted source artifacts / memories
  -> semantic derivation proposal
  -> exact source snapshot + provenance
  -> independent grounding validation
  -> ACTIVE REFLECTION / durable INTENT
```

Source linkage alone is not sufficient grounding. Model-authored semantic output must be rejectable before activation.

## RECOVERY PATHS

Three mechanisms exist and remain distinct:

1. **AVO variation recovery** — closes persisted interrupted work explicitly.
2. **AgentRuntime snapshot/resume** — restores compatible runtime state with explicit live-authority rebinding.
3. **Effect reconciliation** — reconciles journaled operations through replay policy/external observation.

Desired composition after the cognition boundaries exist:

```text
restore persisted work/runtime state
  -> reconcile pending effect operations deterministically
  -> restore exact observation/evidence state
  -> project grounded reflection/intent + bounded context
  -> continue from an explicit deliberation boundary
```

Tracing and semantic memory are context/evidence inputs, never recovery authority by themselves.

## IMPLEMENTATION ORDER

```text
1. deliberation + action-intent step contract
2. grounded reflection / durable intent producer + grounding boundary
3. compose action intent with effect reconciliation
4. expose higher-level workflow/pipeline composition only after these boundaries are stable
```

## SOURCE

Current implementation authority: `agent-runtime.js`, `turn-events.js`, `codeact-strategy.js`, `avo-harness.js`, `core-harness.js`, `semantic-memory.js`, `semantic-memory-evolution.js`, `effect-reconciliation.js`, `evaluation-freshness.js`.
