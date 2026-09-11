# NOOA-06 — Bounded CodeAct

CodeAct is the multi-turn action strategy in the ExHarness NOOA-style substrate. It lets a model inspect and act through already-authorized runtime boundaries, observe grounded results, repair, and eventually return a typed terminal value.

It is orchestration, not containment.

## Control flow

```text
model turn
   |
   +-- execute / EXECUTOR --------> injected executor + execution policy
   +-- execute / CAPABILITY ------> runtime capability boundary
   +-- execute / RESOURCE --------> ResourceRef declared operation
   +-- execute / RESOURCE_DESCRIBE> bounded progressive discovery
   `-- return_result -------------> typed output validation

ACTION_OUTPUT / ACTION_ERROR
          |
          v
bounded current-call observation buffer
          |
          v
next model turn
```

The model never receives a raw live resource object or a direct JS closure. It selects one action from the protocol; the runtime-owned boundary resolves the authority.

## Authority ownership

CodeAct does not create new authority.

- capabilities are those already exposed by `AgentRuntime`;
- resources remain opaque `ResourceRef` handles from NOOA-05;
- executor work goes through `executeWithPolicy()`;
- typed terminal correctness is still owned by the judgment output contract;
- terminal `RESULT` / invocation `ERROR` remain runtime-owned AgentEvents.

A strategy may record `MODEL_OUTPUT`, `VALIDATION_ERROR`, `ACTION_OUTPUT`, and `ACTION_ERROR`. It cannot fabricate terminal `RESULT` or `ERROR` authority.

## Independent bounds

CodeAct has distinct hard ceilings:

- `maxTurns`: model-loop turns;
- `maxActionCalls`: all model-requested executor/capability/resource actions;
- `maxDurationMs`: caller-visible orchestration deadline across model and action awaits;
- `maxObservationChars`: aggregate serialized current-call observation replay.

These do not replace existing outer boundaries:

- `maxCapabilityCalls` remains owned by the agent runtime/variation boundary;
- executor timeout/constraints remain owned by the execution adapter;
- ResourceRef authorization/lifetime remains owned by the resource registry.

A CodeAct boundary may be stricter than an inner adapter, but it cannot weaken an outer hard ceiling.

## Caller deadline is not cancellation

`maxDurationMs` races awaited model/action work so a non-returning adapter cannot hold the CodeAct caller forever.

This does **not** prove that the underlying provider/process was killed. If a model, capability, or resource adapter does not support cancellation, its promise or external side effect may continue after the caller receives `CODEACT_TIME_BUDGET_EXCEEDED`.

Consumers that need hard cancellation, process containment, or side-effect reconciliation must implement those semantics in the concrete adapter/executor boundary (for example AbortSignal support, process termination, idempotency keys, or remote job cancellation).

## Observation containment

NOOA-04 bounds selected cross-call prompt context. CodeAct also creates a new current-call replay surface: action observations accumulated between model turns.

Therefore CodeAct enforces `maxObservationChars` on the aggregate JSON representation before a new observation becomes model-visible. Oversized action output fails closed with `CODEACT_OBSERVATION_LIMIT_EXCEEDED`; it is not silently truncated or summarized.

Observation state is:

- current-call working state;
- JSON-style transport data only;
- visible to subsequent turns in that CodeAct invocation;
- separately mirrored into `ACTION_OUTPUT` / `ACTION_ERROR` AgentEvents for chronological working history.

It is not persistent semantic knowledge, verification evidence, or a correctness decision.

## Error semantics

- malformed action and plain-text turns follow explicit `RETRY` / `FAIL` recovery policies;
- invalid `return_result` becomes validation feedback and re-enters the bounded loop;
- executor/action failures may become model-visible observations when configured;
- model/provider failures remain distinct and escape the action-recovery path;
- capability-budget, CodeAct-budget, time-budget, and observation-boundary failures propagate outward rather than being swallowed as ordinary observations;
- terminal `return_result` closes further model/action activity immediately after typed validation succeeds.

## Non-goals

CodeAct does not implement:

- an OS/process/container sandbox;
- a universal programming language or REPL;
- arbitrary reflection over live JS objects;
- hard cancellation for adapters that provide no cancellation contract;
- nested tracing (NOOA-07);
- model routing (NOOA-08);
- runtime snapshot/resume (NOOA-09).

Concrete executor adapters own concrete code execution semantics and actual containment.
