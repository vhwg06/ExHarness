# NOOA-07 — Nested tracing

## Objective

Provide a causal runtime execution tree for NOOA agent calls without collapsing three different information planes:

```text
AgentEvent = model working history
EventBus   = flat lifecycle telemetry
TraceSpan  = causal runtime tree
```

Tracing is observability. It is not verification evidence, correctness authority, persistent semantic memory, or process containment.

## Trace model

Each completed span records:

- `traceId`
- `spanId`
- `parentSpanId`
- `callId`
- `kind`
- `name`
- `startedAt`
- `endedAt`
- `durationMs`
- `status`
- `error`
- bounded cloned attributes

Async execution context propagates the parent span through nested `await`s and concurrent runtime calls.

The intended semantic tree is:

```text
JUDGMENT / AGENT_RUN
└─ STRATEGY
   ├─ PREDICT_ATTEMPT
   │  └─ MODEL
   └─ CODEACT_TURN
      ├─ MODEL
      └─ ACTION
         ├─ EXECUTION
         ├─ CAPABILITY
         └─ RESOURCE / RESOURCE_DESCRIBE
```

A recovered child failure remains an `ERROR` child span even when the parent CodeAct invocation later succeeds. Parent success does not rewrite child history.

## Correlation

Agent invocation `callId` is created by the runtime before execution and is shared by:

- AgentEvent records for that invocation;
- trace root and descendants for that invocation.

Trace identity remains separate from AgentEvent identity. Neither plane becomes the source of truth for the other.

## Sink policy

Trace sinks are non-strict by default.

```text
non-strict sink failure
→ record trace failure
→ preserve engineering result

strict sink failure
→ TRACE_SINK_FAILED
→ explicit operational failure
```

If engineering work already failed, a trace sink failure does not replace the primary engineering error.

Strict trace delivery errors are not ordinary CodeAct tool failures and cannot be turned into model-visible recoverable action observations.

## Opt-in retention

The default runtime uses a no-op tracer:

```text
createAgentRuntime(...)
→ zero retained spans unless tracer is injected
```

This avoids a hidden unbounded in-memory trace history on long-lived runtimes.

Consumers that want inspectable trace history explicitly inject `createTraceRecorder()` or another compatible tracer. `createHarness({ tracer })` composes that tracer into its internally created runtime and exposes `traces()` / `traceFailures()`.

When a consumer supplies a custom agent, that agent owns its tracing configuration. `createHarness({ agent, tracer })` fails fast rather than silently ignoring the tracer.

## Authority invariants

- spans never authorize promotion;
- spans are not verification artifacts unless a separate verifier explicitly derives evidence from them;
- tracing does not add capability/resource/model authority;
- trace failures do not become AgentEvent terminal authority;
- direct ResourceRef APIs retain their pre-N7 contract;
- CodeAct execution/cancellation semantics are unchanged.

## Verification findings

Manual/adversarial review changed the implementation in these material ways:

1. Strict sink failures initially risked becoming recoverable CodeAct action failures. A stable `TRACE_SINK_FAILED` operational error was introduced and CodeAct rethrows it.
2. A trace sink failure could have hidden an already-existing engineering failure. The primary engineering error now retains precedence.
3. Tracing direct ResourceRef calls was initially suspected of changing a sync API to async. Review against N5 showed `describe()` was already async; the false regression assumption was removed rather than changing the established API.
4. Default in-memory trace recording would have introduced hidden long-lived memory cost. The default is now a no-op tracer; recording is explicit opt-in.
5. Production composition initially had no tracer injection path. `createHarness({ tracer })` now composes tracing without forcing consumers down to `createAgentRuntime`.

Automated adversarial coverage includes:

- rooted Predict judgment trees;
- CodeAct model/action/executor/capability/resource nesting;
- stable AgentEvent call correlation;
- concurrent invocation isolation;
- recovered error child + successful parent;
- non-strict and strict sink behavior;
- typed judgment parse failure marking the root `ERROR`;
- instrumentation preserving trace APIs;
- default zero-retention tracing;
- production facade tracer composition;
- custom-agent tracer ownership.

## Residual boundaries

- no distributed trace propagation across process/network boundaries;
- no OpenTelemetry/vendor protocol requirement;
- no trace persistence/resume in this stage;
- no guarantee that an underlying non-cooperative operation stopped when the caller-visible CodeAct deadline closed its parent span;
- no correctness inference from trace shape;
- no model routing semantics.

Runtime snapshot/resume belongs to NOOA-09. Model routing belongs to NOOA-08.
