# NOOA context blocks and working-history selection

NOOA-04 separates three things that were previously easy to conflate:

```text
invocation input / call context
        !=
runtime-owned prompt context
        !=
canonical AgentEvent working history
```

The goal is not to invent one universal prompt format. The goal is to make authority, selection and history reduction explicit before a strategy or model sees them.

## Context channels

The runtime keeps invocation data separate from selected prompt context.

```text
input
  caller/model task data

context / callContext
  invocation-scoped compatibility/data channel

promptContext
  runtime-composed named blocks + selected history projection
```

Callers cannot shadow a named runtime context block by placing the same key inside `input` or `context`.

For compatibility, the existing `context` argument remains available to strategies. It should be treated as invocation data, not as an automatically trusted instruction channel.

## Named context blocks

A context block is defined when the runtime is configured, not by model output.

```js
const instructions = defineContextBlock({
  name: "review-policy",
  trust: ContextBlockTrust.TRUSTED,
  value: "Reject authentication bypasses."
});
```

A block is either fixed or dynamic.

```js
const runtimeState = defineContextBlock({
  name: "runtime-state",
  async resolve({ callId, judgment }) {
    return readCurrentRuntimeState();
  }
});
```

Dynamic resolvers are evaluated for every invocation. The resolver contract intentionally does not receive invocation `input` or `context`; call data therefore cannot be promoted into a trusted block implicitly. A resolver can still use trusted external state through its closure or adapters.

`ContextBlockTrust.TRUSTED` is an authority classification, not a prompt-injection sanitizer or cryptographic proof. A consumer that intentionally places untrusted material into a model prompt still owns that threat model.

## Per-judgment selection

Judgments select blocks explicitly.

```js
defineJudgment({
  name: "review",
  context: {
    blocks: ["review-policy", "architecture"],
    history: true
  }
});
```

A registered block that is not selected is not rendered for that judgment.

The default selection is intentionally empty:

```text
no selected block
+ history=false
=> no automatic prompt-context dump
```

This keeps persistent engineering memory and accumulated working history out of the prompt unless a consumer explicitly projects them.

## Canonical history vs prompt history

`AgentEvent` remains the authoritative chronological working journal.

```text
AgentEvent store
      |
      +--> runtime.agentEvents()  canonical history
      |
      `--> selector/reducer       prompt projection only
```

For an invocation, the runtime snapshots prior canonical events before recording the new call's working activity. A judgment may then:

1. select/filter those prior events;
2. bound the selected event count;
3. optionally reduce/summarize the selected events;
4. send only that projection to the strategy/model.

Selectors and reducers receive clones. Mutating their arguments cannot rewrite canonical AgentEvent history.

A reduced history has provenance without duplicating the source events into prompt context:

```text
history.mode = REDUCED
history.sourceEventIds = [...]
history.events = []
history.summary = ...
```

The kernel does not claim that a summary is semantically equivalent to the source events. It is a lossy context projection whose authoritative source remains the canonical journal.

## Bounded rendering

Context composition has deterministic bounds:

```text
maxBlocks
maxHistoryEvents
maxSerializedChars
```

History overflow can be configured as:

```text
ERROR
TRUNCATE_OLDEST
```

`TRUNCATE_OLDEST` only removes oldest selected history events. The runtime does not silently truncate trusted context blocks to make a prompt fit. If selected blocks or a reduced summary alone exceed the serialized bound, composition fails closed with `CONTEXT_LIMIT_EXCEEDED`.

These defaults are containment defaults, not benchmark-derived optimal prompt sizes.

## Predict integration

Predict receives the channels separately:

```text
input
callContext
promptContext
agentEvents   // selected raw history only
history       // selected/reduced history metadata
```

When history is reduced, `agentEvents` is empty and the reduction is available through `history.summary` / `promptContext.history.summary`.

## Security invariant

This stage protects against implicit authority collapse:

```text
malicious call data
      x
same key as trusted block
      !=
trusted block override
```

and against accidental common-context leakage:

```text
registered context/history
      !=
automatically model-visible context/history
```

It does not prove the truth or safety of a trusted block. Instruction/policy provenance remains part of the process-trust / trusted-computing-base model.

## Non-goals

NOOA-04 intentionally does not implement:

- live resource handles;
- CodeAct or execution sessions;
- model routing;
- nested traces;
- runtime snapshot/resume;
- automatic semantic summarization;
- automatic projection of AVO persistent memory into agent context.

Those remain later stages in the canonical completion pipeline.
