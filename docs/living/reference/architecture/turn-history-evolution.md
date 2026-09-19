# Turn-aware history evolution

G3 extends the G1/G2 runtime seam without adding a second history store.

The authoritative journal remains `AgentEvent`. Turn history is always a bounded projection of that journal.

## Runtime flow

```text
turn N completes
  ↓
MODEL_OUTPUT / ACTION_* / VALIDATION_ERROR
are recorded canonically
  ↓
AFTER_TURN
  ↓
BEFORE_TURN (N+1)
  ↓
current canonical AgentEvent snapshot
  ↓
exclude current-call TASK
  ↓
selectHistory
  ↓
maxHistoryEvents + serialized bounds
  ↓
reduceHistory (optional)
  ↓
model-facing history for turn N+1
```

## Authority boundary

`AgentEvent` is authoritative runtime working history.

`promptContext.history` is not authoritative. It is a selected or reduced model-facing projection.

A reducer may lose information by design, but it cannot replace, reorder or mutate canonical events.

## Current TASK exclusion

The runtime records the invocation `TASK` before entering the strategy. For turn-aware history, that current-call TASK is excluded before projection.

Reason: input/call context already has a dedicated model-facing surface. Including the same TASK in selected history would duplicate the current request and make turn history semantics depend on prompt formatting rather than completed-turn state.

TASK records from prior invocations remain canonical and may be selected normally.

## Selection and provenance

The existing `selectHistory` contract remains unchanged:

- selections must reference canonical event IDs;
- selectors cannot fabricate IDs;
- selectors cannot duplicate events;
- output is restored to canonical chronology even if the selector requests another order.

When `reduceHistory` is used, the summary carries the exact canonical `sourceEventIds` used to produce it.

## Bounds

Every `prepareTurn()` runs the existing history/context policy again.

Therefore a previous turn can make the next projection exceed `maxHistoryEvents` or `maxSerializedChars`. The runtime then truncates or fails closed according to the declared context policy before another model generation occurs.

## Separation from lifecycle telemetry

`BEFORE_TURN` and `AFTER_TURN` remain runtime lifecycle journal entries, not AgentEvents. They do not become selectable prompt history.

This avoids self-referential prompt growth and preserves the distinction:

```text
AgentEvent  = canonical model working history
TurnEvent   = runtime lifecycle
TraceSpan   = causal execution tree
```

## Reference artifact change

G3 intentionally changes selected prompt-history bytes in the packed blank-consumer reference workload because a later turn now sees completed events from the previous turn.

The stable reference artifact is updated only for that measured projection-size change. Task success, model/capability/resource behavior, false-success count, unsafe-accept count, tracing, snapshot fidelity and adversarial pass counts remain unchanged.

## Non-goals

G3 does not add semantic memory, embeddings, vector search, graph recall or a second summary database. Those belong to G4+.
