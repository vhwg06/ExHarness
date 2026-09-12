# Spontaneous semantic recall

NOOA-G6 connects G5 associative retrieval to the G1-G3 turn/context lifecycle without creating a second prompt system or globally injecting memory into every judgment.

## Visibility boundary

```text
semantic memory available
        !=
semantic memory visible
```

A consumer creates the standard dynamic context block:

```text
__semantic_memory__
```

and a judgment explicitly selects that block through the existing context-selection contract.

Once selected, G2 causes the block resolver to run at every `BEFORE_TURN`. G6 owns only recall cadence inside that resolver.

```text
BEFORE_TURN
    ↓
selected dynamic memory block
    ↓
cadence decision
    ↓
G5 recall (or reuse)
    ↓
UNTRUSTED context block
    ↓
existing maxBlocks/maxSerializedChars
    ↓
model
```

No hidden global prompt concatenation exists.

## Trust boundary

The block is always:

```text
trust = UNTRUSTED
```

and its description explicitly identifies recalled memory as relevance-ranked data, not instruction or correctness evidence.

Consumers cannot configure a trusted spontaneous-memory block. `__semantic_memory__` is the reserved name for this kernel helper.

G5 result semantics remain:

```text
RELEVANCE_ONLY
```

Therefore:

```text
recalled memory
!= truth
!= trusted instruction
!= verification evidence
!= evaluation verdict
```

## Cadences

### SELF_GATED

```text
deriveQuery(turn N)
       ↓
query changed since last recall?
   ├─ no  → reuse previous RecallResult
   └─ yes → G5 recall again
```

This gate is deterministic. It does not spend a model call asking whether memory is needed.

The kernel does not define what semantic state should become the query. Consumers provide `deriveQuery()` and may derive it from their live object/application state or Oracle resolution state. The context resolver itself still receives only the normal safe metadata (`callId`, `judgment`, `turn`); G6 does not weaken the existing trusted-context resolver boundary by injecting invocation input.

### PER_TASK

Recall once on the first selected model turn for a call and reuse that result for later turns in the same call.

### EVERY_TURN

Derive the query and call G5 retrieval before every selected model turn.

## Context block API

```js
createSpontaneousRecallContextBlock({
  retrieval,
  deriveQuery,
  policy: {
    cadence,
    limit?,
    tags?
  }
})
```

The returned object is an ordinary `defineContextBlock()` result and therefore participates in all existing context selection, trust, cloning and serialized-size contracts.

For lower-level composition, G6 also exposes `createSpontaneousRecallController()` and policy/definition helpers.

## Per-call state

Cadence state is isolated by runtime `callId`. The context-block helper creates one controller per observed call so PER_TASK and SELF_GATED never reuse another invocation's recall result.

Because the existing context resolver has no after-call mutation hook, the helper bounds retained call controllers with a small deterministic LRU (`maxCachedCalls`, default 128). This cache is only cadence state; semantic records and retrieval indexes remain owned by G4/G5 providers.

A later workload may justify an explicit call-close hook, but G6 does not add one without evidence.

## Failure semantics

Recall occurs during context resolution, before the model call.

Therefore:

- retrieval/provider contract failures fail the prepared turn before model generation;
- recalled memory is still subject to the existing context serialized-character ceiling;
- an oversized memory projection fails with the existing `CONTEXT_LIMIT_EXCEEDED` path;
- no recall failure can be hidden as a model output or validation retry.

## G6 invariants

- memory visibility remains explicit per judgment;
- recall cadence executes at existing `BEFORE_TURN` context resolution;
- spontaneous recall cannot become TRUSTED context;
- SELF_GATED reuses only when the derived query is unchanged;
- PER_TASK state is isolated by call ID;
- EVERY_TURN performs retrieval every selected turn;
- G5 retrieval remains the only associative-ranking authority;
- existing context bounds remain the final model-facing budget;
- no new prompt channel or correctness authority is introduced.
