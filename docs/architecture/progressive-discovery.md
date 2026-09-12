# Progressive discovery

NOOA-F3 adds a bounded discovery plane above the F1 object-agent surface and F2 live-object graph. Its goal is NOOA-style progressive API disclosure: the model starts with a small description of `self` and asks for richer surface information only when needed.

## Core distinction

```text
discovery
!=
authority
```

A discovery document may describe a method/property that policy later denies. Invocation authority still lives in AgentRuntime capability/resource/live-object policy.

## Initial `self` disclosure

Every object-agent agentic judgment receives one runtime-generated trusted context block:

```text
__exharness_self_doc__
```

The block contains a `CONCISE` object-agent document. Hidden/private members are absent. Because the block is selected automatically by object-agent judgments, existing Predict/CodeAct strategies receive it through the ordinary `promptContext`; F3 does not introduce a parallel prompt channel.

`TRUSTED` here means the runtime owns the channel/provenance. Developer-authored descriptions remain control inputs and are not correctness/evidence claims.

## `doc(self)`

`docObjectAgent(agent, { mode })` renders the current public object-agent surface.

Modes:

- `CONCISE` — member names + kinds only;
- `FULL` — descriptions, mutation signal, typed-input/output metadata.

The renderer applies explicit limits:

```text
maxMembers
maxChars
maxDescriptionChars
```

Overflow is deterministic and reported in the document/metrics rather than silently dumping more context.

## `doc(handle)`

`docLiveObject(runtime, ref, { mode })` first resolves the handle through `runtime.describeLiveObject(ref)` and then renders a bounded discovery document. Therefore F2 still owns:

- registry identity;
- lifetime/revocation;
- DESCRIBE authorization;
- cross-runtime rejection.

Discovering a member does not grant invoke/read permission for that member.

## Progressive disclosure measurement

The packed blank-consumer proof on the F3 candidate measured:

```text
concise self document: 236 chars
full self document:    725 chars
initial/full ratio:    32.6%
packed consumer:       PASS
```

The same packed consumer also resolves one live-object member through `doc(handle)`.

The broad-surface adversarial test independently requires concise disclosure to remain below 60% of full disclosure while exposing the same public member names.

## Security / integrity boundaries

- hidden/private object-agent members are never rendered by the default discovery path;
- `doc(handle)` cannot bypass live-object authorization;
- descriptions are clipped before rendering;
- member counts and serialized size are bounded;
- discovery does not recurse through the transitive live-object graph;
- discovery never exposes function bodies, raw live values, registry IDs, or handle internals beyond the explicit ref already possessed by the caller;
- the concise `self` block uses the existing trusted context plane rather than invocation-controlled data.

## Verification findings

F3 verification established the following implementation choices:

1. **No new prompt channel.** The concise `self` document is injected as an N4 trusted context block, so Predict/CodeAct inherit the existing context-selection and size-policy semantics.
2. **Discovery is not capability authority.** A test deliberately discovers a live method and then proves `INVOKE_LIVE` policy may still deny it.
3. **Measured, not asserted, progressiveness.** The packed package reports concise/full serialized sizes and CI requires a meaningful reduction.
4. **Hidden surfaces stay hidden.** Private convention members never appear in either concise or full default docs.
5. **Bounds are first-class.** Full docs clip descriptions/member counts and preserve explicit truncation metadata.

## Claim boundary

F3 proves progressive documentation and bounded surface discovery. It does not yet provide language-native generated JavaScript, persistent cell locals, sandbox proxies, or in-session `doc(obj)` syntax. Those belong to F4, which reuses this discovery plane through the sandbox host bridge.
