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

For compatibility, the existing `context` argument remains available to strategies and model adapters. It is invocation data, not an automatically trusted instruction channel. ExHarness keeps the channels separate; a downstream consumer that deliberately merges them back together owns that security decision.

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

Dynamic resolvers are evaluated for every invocation. The resolver contract intentionally does not receive invocation `input` or `context`; call data therefore cannot be promoted into a trusted block implicitly. A resolver can still use trusted external state through its closure or adapters, so the consumer remains responsible for the authority of those dependencies.

Prompt-visible block values and reduced history summaries are restricted to stable JSON-style data: null, strings, booleans, finite numbers, arrays and plain objects. Structured-cloneable values such as `Map`, `BigInt`, class instances or cyclic objects are rejected because they make rendering and size accounting ambiguous.

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

Context selection is an internal runtime contract. Adding NOOA-04 does not widen the public NOOA-01 `judgments()` metadata shape or expose selector/reducer functions through introspection.

## Canonical history vs prompt history

`AgentEvent` remains the authoritative chronological working journal.

```text
AgentEvent store
      |
      +--> runtime.agentEvents()  canonical history
      |
      `--> selector/reducer       prompt projection only
```

For an invocation, the runtime snapshots prior canonical events before recording the new call's model activity. The current call's TASK therefore cannot leak into its own selected prior history.

A judgment may then:

1. select a subset of prior canonical events;
2. restore that subset to canonical chronological order;
3. bound the selected event count;
4. optionally reduce/summarize the selected events;
5. send only that projection to the strategy/model.

A selector is a subset selector, not a history-authoring API. It may only return existing canonical event IDs, cannot duplicate or fabricate IDs, cannot replace canonical event bodies, and cannot reorder the canonical chronology. The runtime resolves selected IDs back to canonical bodies before rendering.

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

`maxHistoryEvents: 0` means exactly zero prior events. It is an explicit zero-history projection, not a request for the complete journal.

`TRUNCATE_OLDEST` only removes oldest selected history events. The runtime does not silently truncate trusted context blocks or a reduced summary to make a prompt fit. If those alone exceed the serialized bound, composition fails closed with `CONTEXT_LIMIT_EXCEEDED`.

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

It also preserves provenance boundaries:

```text
selector output
      !=
new authoritative history

summary
      !=
canonical source events
```

It does not prove the truth or safety of a trusted block. Instruction/policy provenance remains part of the process-trust / trusted-computing-base model.

## Manual vigilance findings

NOOA-04 changed materially during verification:

1. normalized dynamic blocks initially became ambiguous on a second normalization pass because the normalized object exposed both an undefined `value` property and `resolve()`; normalization is now idempotent;
2. shallow freezing allowed nested trusted values to be mutated by strategy code; rendered prompt context is now deep-frozen;
3. exposing context metadata through `judgments()` broke the earlier typed-judgment API contract; context selection remains internal and the public view is unchanged;
4. `maxHistoryEvents: 0` initially hit JavaScript's `slice(-0)` behavior and retained the full history; zero now means zero events;
5. selectors initially could fabricate or alter event objects while retaining apparently valid provenance; they now select canonical IDs only and the runtime restores canonical bodies;
6. structured-cloneable values were too broad for stable prompt rendering and size accounting; prompt-visible data is now restricted to JSON-style values;
7. a selector could reorder the journal; selected output now preserves canonical chronology;
8. model-visible block descriptions are normalized to text/null instead of accepting arbitrary values.

## Residual limits

- `TRUSTED` is a classification supplied by the consumer, not independent proof of instruction integrity;
- the runtime cannot prevent a custom downstream strategy/model adapter from deliberately merging `callContext` with trusted blocks again;
- reducers are consumer-defined and may produce a semantically bad summary even though they cannot mutate canonical history;
- context bounds are containment defaults and require workload-specific evaluation before claiming optimality;
- dynamic resolver closures can read whatever authority the consumer grants them;
- runtime snapshot/resume of context/history remains NOOA-09.

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
