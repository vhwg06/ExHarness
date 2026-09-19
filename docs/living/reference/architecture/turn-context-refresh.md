# Turn-aware context refresh

NOOA-G2 moves built-in model-facing context from one eager invocation snapshot to one bounded projection per model turn.

## Ordering

G1 established the turn lifecycle. G2 makes context rendering part of that lifecycle:

```text
previous turn action / validation completes
        ↓
AFTER_TURN N
        ↓
BEFORE_TURN N+1
        ↓
renderAgentContext(turn=N+1)
        ↓
model generation
```

The important ordering is `BEFORE_TURN → context render → model`. If context rendering fails, the prepared turn closes as terminal `ERROR` before any model request is issued.

## One runtime seam

Built-in Predict, action-protocol CodeAct and JavaScript CodeAct declare `turnAwareContext: true` and call the runtime-owned `prepareTurn()` immediately before each model request.

`AgentRuntime` owns:

- closing the previous active turn as `CONTINUE`;
- creating the next runtime turn identity;
- rendering the selected context under the existing context policy;
- returning `{ promptContext, agentEvents, history }` for that model request;
- retaining the latest rendered projection in the invocation report.

The MODEL trace wrapper still has a fallback lifecycle path for custom/legacy strategies that do not use `prepareTurn()`. Their previous one-render-per-invocation context behavior remains compatible.

## Dynamic context

Dynamic block resolvers now receive:

```text
callId
judgment
turn
```

They still do **not** receive invocation `input` or `callContext`. G2 therefore increases temporal freshness without collapsing the existing trusted-context boundary.

The same `turn` metadata is available to existing history selectors/reducers, but G2 deliberately does not evolve the history source yet.

## G2 / G3 boundary

G2 freezes `canonicalEvents` to the pre-invocation snapshot for every turn in the current invocation.

Therefore:

```text
dynamic block value
turn 1 != turn 2          allowed / expected

prompt history source
turn 1 == turn 2          deliberate in G2
```

This keeps the implementation boundary explicit. G3 owns changing selected/reduced history based on canonical events created by earlier turns of the same invocation.

## JavaScript CodeAct

The persistent JavaScript session remains one session per invocation. Only the model-facing projection changes per generation turn.

`doc(self)` resolves against the latest turn prompt projection, so the generated-code helper does not retain an older concise self document after the runtime has refreshed context.

## Bounds and failure semantics

Every turn reruns the existing context checks:

```text
maxBlocks
maxHistoryEvents
maxSerializedChars
```

No new soft-truncation path is added. A dynamic block that fits on turn 1 but exceeds the bound on turn 2 fails closed with `CONTEXT_LIMIT_EXCEEDED` before turn-2 model generation.

A single-turn built-in strategy resolves a dynamic block exactly once; G2 does not retain the old eager render and then rerender it again.

## Verification

The G2 gate proves:

- Predict validation retry sees dynamic resolver turns `[1, 2]` and distinct projections;
- CodeAct turn 2 observes trusted external state mutated by the previous turn action;
- JavaScript CodeAct receives a fresh projection for each generated JavaScript turn;
- turn-two context overflow prevents the second model request and closes the prepared turn as terminal `ERROR`;
- one-turn Predict performs exactly one dynamic resolution;
- the existing full Node 20/22/24 verification matrix remains green.

## Non-goals

G2 does not implement:

- current-invocation event-history evolution;
- automatic summarization;
- semantic memory or retrieval;
- automatic plugin/resource relevance;
- model-controlled trusted context mutation.
