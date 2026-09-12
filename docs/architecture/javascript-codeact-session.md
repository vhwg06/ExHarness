# NOOA-F4 — Language-native JavaScript CodeAct session

## Stage claim

F4 adds an additional CodeAct strategy in which the model emits real JavaScript cells into one persistent execution session per runtime invocation. The kernel owns the model/cell/host/time/output budgets and all capability/live-object authority; the injected executor owns actual code execution and containment.

This does not replace finite action-protocol CodeAct and does not claim that Node `vm` is a production sandbox.

## Runtime shape

```text
model
  ↓
{ type: "execute_javascript", code }
  ↓
createJavaScriptCodeActStrategy
  ↓
injected session executor
  ├─ open({ host, bindings })
  ├─ execute(cell, { signal })
  └─ close()
       ↓
  persistent JavaScript realm
       ├─ self.method(...)
       ├─ liveObject.method(...)
       ├─ doc(self | liveObject)
       ├─ stdout / stderr / execution observation
       └─ return_result(value)
```

The JavaScript realm is session-local and persistent across cells in the same invocation. Live-object results remain authority handles/proxies backed by the F2 registry rather than serialized clones.

## Terminal semantics

`return_result(value)` is a host-mediated terminal operation. Strong terminal semantics require an executor that advertises `JavaScriptSessionFeature.CELL_ABORT`.

```text
RETURN_RESULT
  ↓
kernel validates candidate terminal value
  ↓
host marks terminal + aborts cell with terminal reason
  ↓
executor stops remaining statements in the current cell
  ↓
execute() confirms terminated: true
  ↓
runtime accepts typed result
```

If an executor cannot provide cell-abort semantics, the strategy fails closed instead of pretending code after `return_result()` cannot run.

A terminal interrupt is distinct from a sandbox/process failure. The public `isJavaScriptTerminalInterrupt()` helper lets an injected executor recognize that one intentional control signal without treating arbitrary execution failures as successful termination.

## Error boundary

Generated-code failures and executor/infrastructure failures are deliberately different:

```text
syntax/runtime error produced by generated code
→ bounded model-visible JAVASCRIPT_ERROR observation
→ model may repair within outer budgets

executor crash / process abort / infrastructure failure
→ propagate immediately
→ never converted into recoverable generated-code feedback
```

This boundary prevents a dead or compromised execution substrate from being mislabeled as ordinary code feedback.

## Authority and containment

The generated JavaScript never receives raw kernel/runtime objects. It can reach only host operations explicitly bound by ExHarness:

- declared deterministic capabilities through `self`;
- declared live-object surfaces and nested live refs;
- bounded `doc()` discovery;
- terminal `return_result()`.

Host calls are counted independently from JavaScript cells. Existing live-object authorization, stale-ref rejection, tracing and typed result validation remain authoritative.

The checked-in reference worker uses a child process plus a Node `vm` realm only to prove language/session semantics. The parent process owns timeout/kill behavior in that proof. The worker is **not** a production isolation implementation; consumers must inject the sandbox/process/OS isolation appropriate to their threat model.

## Verification evidence

The public packed-package consumer executes two real JavaScript cells through a child-process session and proves:

```text
real JavaScript cells      2
host calls                 8
execution errors           0
worker opens               1
worker closes              1
result.total               12
result.name                after
nested discovered members  3
original child mutation    after
infinite loop contained    true
forced worker kills        1
```

The success path requires normal JavaScript looping, persistent locals across cells, multiple capability/live calls, nested live-object discovery, mutation plus reread, and in-cell `return_result()`.

The infinite-loop path is bounded by the parent runtime and observed as `CODEACT_TIME_BUDGET_EXCEEDED` in the reference gate.

Focused adversarial coverage also checks forbidden host calls, typed terminal correction, direct terminal-action smuggling, huge stdout, recoverable syntax/runtime failures, executor crash propagation, host-call budget exhaustion, and failure when strong terminal semantics are unavailable.

## Material findings caught during the stage

Three bugs were found by the stage verification track rather than inferred from unit-green status:

1. **Executor crash laundering.** An `EXECUTION_ABORTED` infrastructure failure was initially converted into a recoverable JavaScript error observation. F4 now propagates infrastructure failures immediately.
2. **Weak in-cell termination.** Merely setting terminal state allowed pure JavaScript statements after `return_result()` to continue. F4 introduced an explicit `CELL_ABORT` executor contract and requires termination confirmation.
3. **Double live-ref revival in the packed process bridge.** A nested live ref was revived twice and the second pass collapsed the proxy into an ordinary object. The reference bridge now performs one transport revival, preserving live identity through `doc()` and mutation.

These findings are why the packed real-language consumer remains part of `npm run verify` rather than being replaced by handler-only unit tests.

## Claim boundary

F4 proves the language-native CodeAct contract, host authority bridge, persistent per-call JavaScript state, strong terminal handshake, bounded observations, and a consumer-owned process-backed reference execution proof.

It does **not** prove universal model code quality, production-grade JavaScript sandbox security, cross-process snapshot/resume of JavaScript locals, or provider-specific reliability. Those are outside this stage.
