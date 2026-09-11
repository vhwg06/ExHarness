# Agent working history vs telemetry

NOOA-03 introduces `AgentEvent` as the runtime-owned chronological working history of an agent call. It is intentionally separate from ExHarness telemetry.

```text
AgentRuntime
  |
  +-- AgentEvent journal
  |     TASK
  |     MODEL_OUTPUT
  |     VALIDATION_ERROR
  |     RESULT / ERROR
  |
  `-- observability wrapper
        TelemetryEvent
        AGENT_RUN_STARTED
        CAPABILITY_INVOKED
        AGENT_RUN_COMPLETED / FAILED
```

## Why these are different

`AgentEvent` exists so later substrate stages can reason about what the agent/model attempted and observed. It is part of the agent runtime's working state.

Telemetry exists so external systems can observe runtime behavior. Telemetry sinks may be absent, delayed, unavailable or configured non-strictly without changing the agent's authoritative working history.

Therefore:

```text
AgentEvent != TelemetryEvent
```

They have different owners, storage, failure semantics and future consumers.

## Authority boundary

The runtime owns terminal working events:

- `TASK`
- `RESULT`
- `ERROR`

A strategy receives a bounded `recordAgentEvent()` interface and may append only:

- `MODEL_OUTPUT`
- `VALIDATION_ERROR`

This prevents a model/strategy from fabricating its own successful `RESULT` record. A result is recorded only after the runtime's typed boundary accepts the returned value.

For the same reason, an invalid typed output produces `ERROR` without a preceding false `RESULT`.

## Call correlation

Every runtime invocation receives a unique `callId`. All working events created during that invocation carry the same `callId`.

This is not yet nested tracing. Parent/child span relationships belong to NOOA-07. `callId` here only establishes one chronological agent-call boundary.

## What NOOA-03 does not do

This stage deliberately does not implement:

- history filtering or summarization;
- prompt/context selection;
- persistent runtime snapshot/resume;
- CodeAct execution events;
- nested trace spans;
- automatic conversion of AgentEvents into objective-verification evidence.

Those concerns belong to later pipeline stages.

## Compatibility

Existing caller-supplied `events` remain a compatibility input to strategies. NOOA-03 adds runtime-owned `agentEvents` and `recordAgentEvent`; it does not yet decide which working-history subset should be rendered into a model prompt. That policy belongs to NOOA-04.
