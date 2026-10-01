import assert from "node:assert/strict";
import test from "node:test";

import {
  AsyncResultContextPairingError,
  assertProviderToolResultAllowed,
  createAsyncResultContextState,
  projectAsyncResultRequest,
  stageAsyncResultTransitions,
  translateAsyncResultForProvider
} from "../src/async-result-context.js";
import { AsyncResultDeliveryMode, defineModelAdapter, modelAdapterView, modelAsyncResultDelivery } from "../src/model.js";
import { createModelRegistry, resolveModelRoute, selectModelRoute } from "../src/model-routing.js";

function runningItem() {
  const state = createAsyncResultContextState();
  stageAsyncResultTransitions({
    state,
    transitions: [{
      operationId: "detached:op-provider",
      callId: "call-provider",
      effectOperationId: "effect-provider",
      generation: 1,
      sequence: 1,
      transitionId: "detached:op-provider:g1:s1:RUNNING",
      status: "RUNNING"
    }]
  });
  return state.stagedItems[0];
}

function terminalItem() {
  const state = createAsyncResultContextState();
  stageAsyncResultTransitions({
    state,
    transitions: [{
      operationId: "detached:op-provider",
      callId: "call-provider",
      effectOperationId: "effect-provider",
      generation: 1,
      sequence: 2,
      transitionId: "detached:op-provider:g1:s2:SUCCEEDED",
      status: "SUCCEEDED",
      result: { text: "done" }
    }]
  });
  return state.stagedItems[0];
}

test("adapter normalization declares all three delivery modes", () => {
  for (const mode of Object.values(AsyncResultDeliveryMode)) {
    const adapter = defineModelAdapter({ name: "m", generate: async () => ({}), asyncResultDelivery: mode });
    assert.equal(adapter.asyncResultDelivery, mode);
    assert.equal(modelAsyncResultDelivery(adapter), mode);
    assert.equal(modelAsyncResultDelivery(modelAdapterView(adapter)), mode);
  }
  const nativeView = modelAdapterView(
    defineModelAdapter({ name: "m", version: "1", generate: async () => ({}), asyncResultDelivery: "NATIVE_PENDING_CALL" })
  );
  assert.equal(nativeView.asyncResultDelivery, "NATIVE_PENDING_CALL");
  const handleView = modelAdapterView(
    defineModelAdapter({ name: "m", version: "1", generate: async () => ({}), asyncResultDelivery: "HANDLE_THEN_EVENT" })
  );
  assert.equal(handleView.asyncResultDelivery, "HANDLE_THEN_EVENT");
});

test("legacy adapters without capability metadata default to SYNCHRONOUS", () => {
  const adapter = defineModelAdapter({ name: "legacy", generate: async () => ({}) });
  assert.equal(adapter.asyncResultDelivery, "SYNCHRONOUS");
  assert.equal(modelAsyncResultDelivery(adapter), "SYNCHRONOUS");
  assert.equal(modelAsyncResultDelivery(modelAdapterView(adapter)), "SYNCHRONOUS");
  assert.equal(modelAsyncResultDelivery(null), "SYNCHRONOUS");
  assert.equal(modelAsyncResultDelivery({}), "SYNCHRONOUS");
  const rewrapped = defineModelAdapter(adapter);
  assert.equal(rewrapped.asyncResultDelivery, "SYNCHRONOUS");
});

test("legacy serialized route/usage views stay byte-compatible with the pre-existing shape", () => {
  const adapter = defineModelAdapter({ name: "legacy", version: "reference-v1", generate: async () => ({}) });
  assert.deepEqual(modelAdapterView(adapter), { name: "legacy", version: "reference-v1" });
  assert.deepEqual(JSON.parse(JSON.stringify(modelAdapterView(adapter))), { name: "legacy", version: "reference-v1" });
  assert.doesNotMatch(JSON.stringify(modelAdapterView(adapter)), /asyncResultDelivery/);
});

test("invalid capability metadata fails closed at the adapter boundary", () => {
  assert.throws(
    () => defineModelAdapter({ name: "m", generate: async () => ({}), asyncResultDelivery: "NATIVE_GUESS" }),
    /must be one of NATIVE_PENDING_CALL\|HANDLE_THEN_EVENT\|SYNCHRONOUS/
  );
});

test("model routing preserves the declared capability exactly", async () => {
  for (const mode of Object.values(AsyncResultDeliveryMode)) {
    const registry = createModelRegistry({
      models: [{ name: "routed", version: "1", generate: async () => ({}), asyncResultDelivery: mode }]
    });
    const route = await resolveModelRoute(registry, selectModelRoute({ invocation: "routed" }));
    assert.equal(route.adapter.asyncResultDelivery, mode);
    assert.equal(modelAsyncResultDelivery(route.adapter), mode);
    assert.equal(modelAsyncResultDelivery(route.provenance.adapter), mode);
    if (mode === "SYNCHRONOUS") {
      assert.deepEqual(route.provenance.adapter, { name: "routed", version: "1" });
    } else {
      assert.equal(route.provenance.adapter.asyncResultDelivery, mode);
    }
    assert.equal(modelAsyncResultDelivery(route.usage().adapter), mode);
  }
  const legacy = createModelRegistry({
    models: [{ name: "legacy", generate: async () => ({}) }]
  });
  const legacyRoute = await resolveModelRoute(legacy, selectModelRoute({ invocation: "legacy" }));
  assert.equal(legacyRoute.adapter.asyncResultDelivery, "SYNCHRONOUS");
  assert.equal(modelAsyncResultDelivery(legacyRoute.provenance.adapter), "SYNCHRONOUS");
  assert.deepEqual(legacyRoute.provenance.adapter, { name: "legacy", version: null });
  assert.doesNotMatch(JSON.stringify(legacyRoute.usage()), /asyncResultDelivery/);
});

test("native fulfilled call rejects a second terminal result even with a different transition id", () => {
  const state = createAsyncResultContextState();
  stageAsyncResultTransitions({
    state,
    transitions: [{
      operationId: "detached:op-provider",
      callId: "call-provider",
      effectOperationId: "effect-provider",
      generation: 1,
      sequence: 3,
      transitionId: "detached:op-provider:g1:s3:FAILED",
      status: "FAILED",
      error: { message: "late" }
    }]
  });
  const otherTerminal = state.stagedItems[0];
  assert.throws(
    () => translateAsyncResultForProvider({
      mode: "NATIVE_PENDING_CALL",
      item: otherTerminal,
      providerCallId: "provider-call-1",
      fulfilledProviderCallIds: ["provider-call-1"]
    }),
    (error) => error instanceof AsyncResultContextPairingError
      && error.code === "ASYNC_RESULT_CONTEXT_PAIRING_VIOLATION"
  );
  const pending = translateAsyncResultForProvider({
    mode: "NATIVE_PENDING_CALL",
    item: runningItem(),
    providerCallId: "provider-call-1",
    fulfilledProviderCallIds: ["provider-call-1"]
  });
  assert.equal(pending.pendingCall, true);
  assert.equal(pending.toolResult, null);
});

test("native terminal output is delivered once; repeats are rejected", () => {
  const first = translateAsyncResultForProvider({
    mode: "NATIVE_PENDING_CALL",
    item: terminalItem(),
    providerCallId: "provider-call-1"
  });
  assert.deepEqual(first.toolResult.output, { text: "done" });
  assert.throws(
    () => translateAsyncResultForProvider({
      mode: "NATIVE_PENDING_CALL",
      item: terminalItem(),
      providerCallId: "provider-call-1",
      deliveredTerminalTransitionIds: ["detached:op-provider:g1:s2:SUCCEEDED"]
    }),
    (error) => error instanceof AsyncResultContextPairingError
      && error.code === "ASYNC_RESULT_CONTEXT_PAIRING_VIOLATION"
  );
});

test("native pending-call keeps the original call pending with no interim tool result", () => {
  const pending = translateAsyncResultForProvider({
    mode: "NATIVE_PENDING_CALL",
    item: runningItem(),
    providerCallId: "provider-call-1"
  });
  assert.equal(pending.pendingCall, true);
  assert.equal(pending.toolResult, null);
  assert.equal(pending.asyncEvent, null);

  const terminal = translateAsyncResultForProvider({
    mode: "NATIVE_PENDING_CALL",
    item: terminalItem(),
    providerCallId: "provider-call-1"
  });
  assert.equal(terminal.pendingCall, false);
  assert.equal(terminal.toolResult.providerCallId, "provider-call-1");
  assert.deepEqual(terminal.toolResult.output, { text: "done" });
});

test("handle-then-event emits one RUNNING handle then terminal state only as an async event", () => {
  const handle = translateAsyncResultForProvider({
    mode: "HANDLE_THEN_EVENT",
    item: runningItem(),
    providerCallId: "provider-call-2"
  });
  assert.equal(handle.toolResult.providerCallId, "provider-call-2");
  assert.equal(handle.toolResult.handle.status, "RUNNING");
  assert.equal(handle.asyncEvent, null);

  const terminal = translateAsyncResultForProvider({
    mode: "HANDLE_THEN_EVENT",
    item: terminalItem(),
    providerCallId: "provider-call-2",
    fulfilledProviderCallIds: ["provider-call-2"]
  });
  assert.equal(terminal.toolResult, null);
  assert.equal(terminal.asyncEvent.transitionId, "detached:op-provider:g1:s2:SUCCEEDED");
});

test("handle terminal without a prior fulfilled handle becomes the single pairing-safe tool result", () => {
  const terminal = translateAsyncResultForProvider({
    mode: "HANDLE_THEN_EVENT",
    item: terminalItem(),
    providerCallId: "provider-call-7"
  });
  assert.deepEqual(terminal.toolResult.output, { text: "done" });
  assert.equal(terminal.asyncEvent, null);
  assert.throws(
    () => translateAsyncResultForProvider({
      mode: "HANDLE_THEN_EVENT",
      item: terminalItem(),
      providerCallId: "provider-call-7",
      fulfilledProviderCallIds: ["provider-call-7"],
      deliveredTerminalTransitionIds: ["detached:op-provider:g1:s2:SUCCEEDED"]
    }),
    AsyncResultContextPairingError
  );
});

test("a second tool result for an already-fulfilled strict call is rejected", () => {
  assert.throws(
    () => translateAsyncResultForProvider({
      mode: "HANDLE_THEN_EVENT",
      item: runningItem(),
      providerCallId: "provider-call-2",
      fulfilledProviderCallIds: ["provider-call-2"]
    }),
    (error) => error instanceof AsyncResultContextPairingError
      && error.code === "ASYNC_RESULT_CONTEXT_PAIRING_VIOLATION"
  );
  assert.throws(
    () => assertProviderToolResultAllowed({
      mode: "HANDLE_THEN_EVENT",
      providerCallId: "provider-call-2",
      fulfilledProviderCallIds: ["provider-call-2"]
    }),
    AsyncResultContextPairingError
  );
  const allowed = assertProviderToolResultAllowed({
    mode: "HANDLE_THEN_EVENT",
    providerCallId: "provider-call-3",
    fulfilledProviderCallIds: ["provider-call-2"]
  });
  assert.equal(allowed.allowed, true);
});

test("synchronous fallback waits for terminal truth and preserves one-call/one-result pairing", () => {
  const waiting = translateAsyncResultForProvider({
    mode: "SYNCHRONOUS",
    item: runningItem(),
    providerCallId: "provider-call-4"
  });
  assert.equal(waiting.waiting, true);
  assert.equal(waiting.toolResult, null);
  assert.equal(waiting.asyncEvent, null);

  const terminal = translateAsyncResultForProvider({
    mode: "SYNCHRONOUS",
    item: terminalItem(),
    providerCallId: "provider-call-4"
  });
  assert.deepEqual(terminal.toolResult.output, { text: "done" });
  assert.throws(
    () => translateAsyncResultForProvider({
      mode: "SYNCHRONOUS",
      item: terminalItem(),
      providerCallId: "provider-call-4",
      fulfilledProviderCallIds: ["provider-call-4"]
    }),
    AsyncResultContextPairingError
  );
});

test("unknown provider mode fails closed to synchronous semantics", () => {
  const waiting = translateAsyncResultForProvider({
    mode: "FUTURE_MODE",
    item: runningItem(),
    providerCallId: "provider-call-5"
  });
  assert.equal(waiting.mode, "SYNCHRONOUS");
  assert.equal(waiting.waiting, true);
  assert.equal(waiting.toolResult, null);
});

test("omitted capability metadata never attempts progressive delivery", () => {
  const adapter = defineModelAdapter({ name: "plain", generate: async () => ({}) });
  const resolvedMode = adapter.asyncResultDelivery;
  assert.equal(resolvedMode, "SYNCHRONOUS");
  const translated = translateAsyncResultForProvider({
    mode: resolvedMode,
    item: runningItem(),
    providerCallId: "provider-call-6"
  });
  assert.equal(translated.toolResult, null);
  assert.equal(translated.waiting, true);
});

test("prefix digests are structural evidence only and missing telemetry stays null", () => {
  const withTelemetry = projectAsyncResultRequest({
    state: createAsyncResultContextState(),
    providerTelemetry: { cachedTokens: 10 }
  });
  assert.equal(withTelemetry.providerCachedTokens, 10);
  assert.equal(withTelemetry.providerCacheWriteTokens, null);
  const withoutTelemetry = projectAsyncResultRequest({ state: createAsyncResultContextState() });
  assert.equal(withoutTelemetry.providerCachedTokens, null);
  assert.equal(withoutTelemetry.providerTelemetryStatus, "missing");
});
