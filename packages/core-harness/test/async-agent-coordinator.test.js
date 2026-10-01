import assert from "node:assert/strict";
import test from "node:test";

import {
  AsyncAgentIngressKind,
  AsyncCoordinatorBindingError,
  AsyncCoordinatorDependencyContradictionError,
  createAsyncAgentCoordinator,
  getAsyncCoordinatorDependencyManifest,
  assertDependencyContract,
  resolveEffectConfirmationFromCoordinator,
  resolveProductAcceptanceFromCoordinator
} from "../src/async-agent-coordinator.js";
import { createInMemorySessionStore } from "../src/store.js";
import {
  createInMemoryDetachedOperationStore,
  deriveDetachedTransitionId
} from "../src/detached-operation-store.js";
import { createDetachedOperationManager } from "../src/detached-operation.js";
import {
  EffectReplayPolicy,
  createInMemoryEffectJournal,
  defineEffectCapability
} from "../src/effect-reconciliation.js";
import {
  AsyncResultDeliveryMode,
  ModelGenerationCancellationMode,
  defineModelAdapter,
  modelAdapterView,
  modelGenerationCancellation,
  normalizeGenerationCancellation
} from "../src/model.js";
import { createModelRegistry, resolveModelRoute, selectModelRoute } from "../src/model-routing.js";
import { createAgentRuntime } from "../src/agent-runtime.js";
import { createJavaScriptCodeActStrategy } from "../src/javascript-codeact-strategy.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function fakeClock(start = 1000) {
  let now = start;
  return {
    now: () => now,
    iso: () => new Date(now).toISOString(),
    advance: (ms) => { now += ms; }
  };
}

function exactDescriptors() {
  const manifest = getAsyncCoordinatorDependencyManifest();
  const [bb077, bb078, bb079] = manifest.requires;
  return {
    bb077: {
      status: bb077.status,
      implementationResultRef: bb077.implementationResultRef,
      judgmentRef: bb077.judgmentRef,
      deliveredRef: bb077.deliveredRef,
      accountingVocabulary: [...bb077.accountingVocabulary]
    },
    bb078: {
      status: bb078.status,
      implementationResultRef: bb078.implementationResultRef,
      judgmentRef: bb078.judgmentRef,
      deliveredRef: bb078.deliveredRef,
      transitionEnvelope: [...bb078.transitionEnvelope],
      storeApi: [...bb078.storeApi]
    },
    bb079: {
      status: bb079.status,
      implementationResultRef: bb079.implementationResultRef,
      judgmentRef: bb079.judgmentRef,
      deliveredRef: bb079.deliveredRef,
      checkpointApi: [...bb079.checkpointApi],
      providerModes: [...bb079.providerModes]
    }
  };
}

function mkTransition({ operationId, seq, status, generation = 1, callId = "call-1", effectOperationId = null }) {
  const effect = effectOperationId ?? `effect:${operationId}`;
  return {
    operationId,
    callId,
    effectOperationId: effect,
    generation,
    sequence: seq,
    transitionId: deriveDetachedTransitionId({ operationId, generation, sequence: seq, status }),
    status,
    result: status === "SUCCEEDED" ? { ok: true } : null
  };
}

function slowManagerFixture(scopeId, gate) {
  const journal = createInMemoryEffectJournal();
  const capability = defineEffectCapability({
    name: "slow.task",
    effect: {
      replayPolicy: EffectReplayPolicy.PURE,
      operationKey: ({ input }) => `slow:${input.id}`
    },
    async execute(value, runtime) {
      await gate.promise;
      return { ok: true, id: value.id };
    }
  }, { journal });
  const store = createInMemoryDetachedOperationStore({ scopeId });
  const manager = createDetachedOperationManager({ store, effectBindings: { "slow.task": { capability, journal } } });
  return { journal, capability, store, manager };
}

// STEERING: retry-safe USER_INPUT durably ordered, fences old generation, one bounded replacement turn.
test("STEERING: user input while model active fences generation and schedules one replacement without waiting", async () => {
  const clock = fakeClock();
  const sessionStore = createInMemorySessionStore();
  const coord = createAsyncAgentCoordinator({ sessionStore, sessionId: "steer-1", clock: clock.now, nowIso: clock.iso });
  const gate = deferred();
  const { manager } = slowManagerFixture("steer-ops", gate);
  const handle = await manager.capability("slow.task").execute({ id: "long" }, { callId: "call-long", turn: null });
  assert.equal(handle.status, "RUNNING");

  const first = await coord.ingestUserInput({ inputId: "in-first", input: { text: "first" } });
  assert.equal(first.envelope.ingressSeq, 1);
  assert.equal(first.envelope.ingressKind, "USER_INPUT");
  const turn1 = await coord.takeNextModelTurn({});
  assert.equal(turn1.submission.generation, 1);
  assert.equal(turn1.submission.coveredIngressSeq, 1);

  // Steering while the model generation is active.
  const steer = await coord.ingestUserInput({ inputId: "in-steer", input: { text: "steer now" } });
  assert.equal(steer.envelope.ingressSeq, 2);
  assert.equal(steer.modelGeneration, 2);
  assert.equal(steer.fencedGeneration, 1);
  assert.ok(coord.signalFor(1).aborted, "old generation abort signal fires after persist");
  assert.equal(coord.signalFor(2).aborted, false);

  const snap = await coord.snapshot();
  assert.equal(snap.modelGeneration, 2);
  assert.equal(snap.currentSubmission.status, "ABANDONED");
  assert.ok(snap.wake != null, "exactly one replacement wake scheduled");
  assert.equal(snap.wake.coversUpToSeq, 2);

  // Retry with the same inputId is idempotent: no new seq, no second wake.
  const retry = await coord.ingestUserInput({ inputId: "in-steer", input: { text: "steer now" } });
  assert.equal(retry.duplicate, true);
  assert.equal(retry.envelope.ingressSeq, 2);
  const snap2 = await coord.snapshot();
  assert.equal(snap2.nextIngressSeq, 3);
  assert.equal(snap2.wake.coversUpToSeq, 2);

  // Replacement turn covers the steering input high-water mark.
  const turn2 = await coord.takeNextModelTurn({});
  assert.equal(turn2.submission.generation, 2);
  assert.equal(turn2.submission.coveredIngressSeq, 2);
  assert.ok(turn2.submission.coveredIngressSeq >= steer.envelope.ingressSeq);

  // Unrelated detached operation was not cancelled by steering.
  const stored = await manager.read(handle.operationId);
  assert.equal(stored.status, "RUNNING");
  gate.resolve();
});

// STALE_MODEL: late FENCE_ONLY response rejected before dispatch.
test("STALE_MODEL: fenced non-abortable model response cannot dispatch", async () => {
  const clock = fakeClock();
  const sessionStore = createInMemorySessionStore();
  const coord = createAsyncAgentCoordinator({ sessionStore, sessionId: "stale-1", clock: clock.now, nowIso: clock.iso });
  await coord.ingestUserInput({ inputId: "in-1", input: "first" });
  const turn1 = await coord.takeNextModelTurn({});
  await coord.ingestUserInput({ inputId: "in-2", input: "steer" });
  let dispatches = 0;
  const stale = await coord.dispatchModelResponse(turn1.submission.submissionId, { type: "execute_javascript", code: "return_result(1)" }, {
    dispatchFn: async () => { dispatches += 1; }
  });
  assert.equal(stale.accepted, false);
  assert.match(stale.reason, /FENCED|STALE|STOP/);
  assert.equal(dispatches, 0);

  const turn2 = await coord.takeNextModelTurn({});
  assert.equal(turn2.submission.generation, 2);
  const ok = await coord.dispatchModelResponse(turn2.submission.submissionId, { type: "execute_javascript", code: "return_result(2)" }, {
    dispatchFn: async () => { dispatches += 1; }
  });
  assert.equal(ok.accepted, true);
  assert.equal(dispatches, 1);
});

// COALESCE: concurrent transitions deduped to at most one wake per burst.
test("COALESCE: concurrent and duplicate transitions coalesce to one wake", async () => {
  const clock = fakeClock();
  const sessionStore = createInMemorySessionStore();
  const coord = createAsyncAgentCoordinator({
    sessionStore,
    sessionId: "coalesce-1",
    clock: clock.now,
    nowIso: clock.iso,
    profile: { completionIdleMs: 50, maxCoalescedTransitions: 100, quickCompletionGraceMs: 0 }
  });
  function mk(op, seq) {
    return mkTransition({ operationId: op, seq, status: "RUNNING" });
  }
  // Concurrent Promise.all ingress under CAS conflicts must not create two wakes.
  const results = await Promise.all([
    coord.ingestOperationTransition(mk("detached:opA", 1)),
    coord.ingestOperationTransition(mk("detached:opB", 1)),
    coord.ingestOperationTransition(mk("detached:opC", 1))
  ]);
  for (const r of results) assert.equal(r.duplicate, false);
  const seqs = results.map((r) => r.envelope.ingressSeq).sort((a, b) => a - b);
  assert.deepEqual(seqs, [1, 2, 3]);
  let snap = await coord.snapshot();
  assert.equal(snap.wake, null, "completions held for the idle drain, no premature wake");
  assert.equal(snap.completionBurst.count, 3);

  // Duplicate transitionId does not create a second item or wake.
  const dup = await coord.ingestOperationTransition(mk("detached:opA", 1));
  assert.equal(dup.duplicate, true);
  snap = await coord.snapshot();
  assert.equal(snap.nextIngressSeq, 4);
  assert.equal(snap.asyncContextStaged, 3);

  // Advance past the 1ms-style idle drain (here 50ms) and drain once.
  clock.advance(100);
  const drained = await coord.drainCompletions();
  assert.ok(drained.wake != null);
  assert.equal(drained.wake.coversUpToSeq, 3);
  snap = await coord.snapshot();
  assert.ok(snap.wake != null);
  const metrics = await coord.probeMetrics();
  assert.equal(metrics.coalescedTransitions, 3);

  // A second drain without new work creates no second wake.
  clock.advance(100);
  const drained2 = await coord.drainCompletions();
  assert.equal(drained2.wake?.wakeId, drained.wake.wakeId);
});

// COALESCE boundary: maxCoalescedTransitions bounds the burst.
test("COALESCE: max burst bound creates one wake at the limit", async () => {
  const clock = fakeClock();
  const sessionStore = createInMemorySessionStore();
  const coord = createAsyncAgentCoordinator({
    sessionStore,
    sessionId: "coalesce-max",
    clock: clock.now,
    nowIso: clock.iso,
    profile: { completionIdleMs: 100000, maxCoalescedTransitions: 3, quickCompletionGraceMs: 0 }
  });
  for (let i = 1; i <= 3; i += 1) {
    const r = await coord.ingestOperationTransition(mkTransition({ operationId: `detached:op${i}`, seq: 1, status: "RUNNING" }));
    if (i < 3) assert.equal(r.wake, null);
  }
  const snap = await coord.snapshot();
  assert.ok(snap.wake != null, "max burst creates exactly one wake");
  assert.equal(snap.wake.coversUpToSeq, 3);
});

// Negative: USER_INPUT waits behind grace/idle (must bypass).
test("STEERING bypasses completion grace and idle windows", async () => {
  const clock = fakeClock();
  const sessionStore = createInMemorySessionStore();
  const coord = createAsyncAgentCoordinator({
    sessionStore,
    sessionId: "bypass-1",
    clock: clock.now,
    nowIso: clock.iso,
    profile: { completionIdleMs: 100000, maxCoalescedTransitions: 100, quickCompletionGraceMs: 100000 }
  });
  await coord.ingestUserInput({ inputId: "seed", input: "seed" });
  const t = await coord.takeNextModelTurn({});
  await coord.completeModelTurn({ submissionId: t.submission.submissionId });
  // Quick grace is now armed; a completion is held.
  const held = await coord.ingestOperationTransition(mkTransition({ operationId: "detached:held", seq: 1, status: "RUNNING" }));
  assert.equal(held.held, "QUICK_GRACE");
  assert.equal(held.wake, null);
  // Steering cancels the grace immediately and schedules without waiting.
  const steer = await coord.ingestUserInput({ inputId: "steer-now", input: "now" });
  assert.ok(steer.wake != null);
  assert.equal(steer.wake.coversUpToSeq, steer.envelope.ingressSeq);
});

// Negative: USER_INPUT must not cancel detached operations.
test("steering does not cancel detached operations", async () => {
  const clock = fakeClock();
  const sessionStore = createInMemorySessionStore();
  const coord = createAsyncAgentCoordinator({ sessionStore, sessionId: "no-cancel-ops", clock: clock.now, nowIso: clock.iso });
  const gate = deferred();
  const { manager } = slowManagerFixture("no-cancel-scope", gate);
  const h1 = await manager.capability("slow.task").execute({ id: "a" }, { callId: "c-a", turn: null });
  const h2 = await manager.capability("slow.task").execute({ id: "b" }, { callId: "c-b", turn: null });
  await coord.ingestUserInput({ inputId: "i1", input: "x" });
  await coord.takeNextModelTurn({});
  await coord.ingestUserInput({ inputId: "i2", input: "steer" });
  assert.equal((await manager.read(h1.operationId)).status, "RUNNING");
  assert.equal((await manager.read(h2.operationId)).status, "RUNNING");
  gate.resolve();
});

// STOP: persisted before side effects, blocks dispatch.
test("STOP: fence persists, blocks dispatch, and aborts the model generation", async () => {
  const clock = fakeClock();
  const sessionStore = createInMemorySessionStore();
  const coord = createAsyncAgentCoordinator({ sessionStore, sessionId: "stop-1", clock: clock.now, nowIso: clock.iso });
  await coord.ingestUserInput({ inputId: "u1", input: "work" });
  const turn = await coord.takeNextModelTurn({});
  const stop = await coord.ingestStop({ inputId: "stop-1", reason: "user stop" });
  assert.ok(stop.stopFence != null);
  assert.equal(stop.stopFence.reason, "user stop");
  assert.ok(coord.signalFor(turn.submission.generation).aborted, "STOP aborts after the fence commits");
  assert.equal(await coord.isDispatchBlocked(), true);
  assert.equal(await coord.canStartModelTurn(), false);
  await assert.rejects(() => coord.takeNextModelTurn({}), /STOP/);
  const late = await coord.dispatchModelResponse(turn.submission.submissionId, {}, {});
  assert.equal(late.accepted, false);
  assert.equal(late.reason, "STOP_FENCED");
  // New input after STOP is durably ordered but creates no wake.
  const after = await coord.ingestUserInput({ inputId: "after-stop", input: "x" });
  assert.equal(after.stopFenced, true);
  assert.equal(after.wake, null);
});

// STOP negative: unresolved external effect is never labelled cancelled by the coordinator.
test("STOP cannot label an unresolved effect cancelled without BB-078 truth", async () => {
  const journal = createInMemoryEffectJournal();
  let observed = 0;
  const capability = defineEffectCapability({
    name: "risky.task",
    effect: {
      replayPolicy: EffectReplayPolicy.NON_RECONCILABLE,
      operationKey: ({ input }) => `risky:${input.id}`
    },
    async execute() {
      observed += 1;
      const err = new Error("ambiguous");
      err.code = "EFFECT_RECOVERY_REQUIRED";
      throw err;
    }
  }, { journal });
  const store = createInMemoryDetachedOperationStore({ scopeId: "stop-effect-scope" });
  const manager = createDetachedOperationManager({ store, effectBindings: { "risky.task": { capability, journal } } });
  const sessionStore = createInMemorySessionStore();
  const coord = createAsyncAgentCoordinator({ sessionStore, sessionId: "stop-effect", operationManager: manager });
  const handle = await manager.schedule("risky.task", { id: "n1" }, { callId: "c-n1", turn: null });
  await coord.ingestStop({ inputId: "s1", reason: "stop" });
  const record = await manager.read(handle.operationId);
  // NON_RECONCILABLE post-dispatch ambiguity escalates UNKNOWN, never CANCELLED.
  assert.notEqual(record.status, "CANCELLED");
  assert.ok(["UNKNOWN", "CANCEL_REQUESTED", "RUNNING"].includes(record.status));
  void observed;
});

// NO_HEARTBEAT: idle inspection never calls the model.
test("NO_HEARTBEAT: liveness inspection creates no model turn without semantic work", async () => {
  const clock = fakeClock();
  const sessionStore = createInMemorySessionStore();
  const coord = createAsyncAgentCoordinator({ sessionStore, sessionId: "heartbeat-1", clock: clock.now, nowIso: clock.iso });
  let modelCalls = 0;
  for (let i = 0; i < 5; i += 1) {
    clock.advance(1000);
    const live = await coord.inspectLiveness();
    assert.equal(live.modelCalls, 0);
    assert.equal(live.pendingWork, false);
    const taken = await coord.takeNextModelTurn({});
    assert.equal(taken.submission, null);
    assert.equal(taken.empty, true);
  }
  assert.equal(modelCalls, 0);
  // New semantic work immediately enables a turn.
  await coord.ingestUserInput({ inputId: "wake-me", input: "hi" });
  const live2 = await coord.inspectLiveness();
  assert.equal(live2.pendingWork, true);
  const turn = await coord.takeNextModelTurn({});
  assert.ok(turn.submission != null);
});

// DEPENDENCY: exact DONE outputs consumed, incompatible rejected.
test("DEPENDENCY: exact DONE BB-077/078/079 contracts required", () => {
  const good = exactDescriptors();
  assert.deepEqual(assertDependencyContract(good), { satisfied: true, contract: "BB-080_DEPENDENCY_MANIFEST_V1" });
  assert.throws(
    () => assertDependencyContract({ ...good, bb078: { ...good.bb078, status: "READY" } }),
    /BB-078 is not DONE/
  );
  assert.throws(
    () => assertDependencyContract({ ...good, bb079: { ...good.bb079, checkpointApi: ["createAsyncResultContextState"] } }),
    /checkpoint API is incompatible/
  );
  assert.throws(
    () => assertDependencyContract({ bb077: good.bb077, bb078: good.bb078 }),
    /BB-079 dependency descriptor is missing/
  );
  // Coordinator factory rejects incompatible contracts instead of adapting.
  assert.throws(
    () => createAsyncAgentCoordinator({
      sessionStore: createInMemorySessionStore(),
      sessionId: "dep-fail",
      dependencies: { ...good, bb077: { ...good.bb077, accountingVocabulary: ["stable-prefix"] } }
    }),
    /accounting vocabulary is incompatible/
  );
});

test("PLAN_INPUT_CONTRADICTION fixtures carry task identity", () => {
  try {
    assertDependencyContract({ bb077: null, bb078: null, bb079: null });
    assert.fail("expected contradiction");
  } catch (error) {
    assert.equal(error.code, "PLAN_INPUT_CONTRADICTION");
  }
  try {
    createAsyncAgentCoordinator({
      sessionStore: createInMemorySessionStore(),
      sessionId: "x",
      dependencies: { bb077: { status: "DONE" }, bb078: { status: "DONE" }, bb079: { status: "DONE" } }
    });
    assert.fail("expected contradiction");
  } catch (error) {
    assert.equal(error.code, "PLAN_INPUT_CONTRADICTION");
    assert.ok(error.taskId != null || error.message.includes("BB-"));
  }
});

// INV-1: coordinator cannot become correctness/acceptance/effect authority.
test("INV-1: coordinator state cannot confirm effects or accept products", () => {
  assert.throws(() => resolveEffectConfirmationFromCoordinator(), /cannot confirm EffectOperation/);
  assert.throws(() => resolveProductAcceptanceFromCoordinator(), /cannot accept a product/);
});

// INV-2: binding corruption fails closed.
test("INV-2: conflicting transitionId reuse and missing effect identity fail closed", async () => {
  const clock = fakeClock();
  const sessionStore = createInMemorySessionStore();
  const coord = createAsyncAgentCoordinator({ sessionStore, sessionId: "inv2-1", clock: clock.now, nowIso: clock.iso });
  const first = mkTransition({ operationId: "detached:opX", seq: 1, status: "RUNNING" });
  await coord.ingestOperationTransition(first);
  const conflicting = { ...first, callId: "call-EVIL" };
  await assert.rejects(() => coord.ingestOperationTransition(conflicting), /conflicting binding/);
  const missing = {
    operationId: "detached:opY",
    callId: "call-y",
    generation: 1,
    sequence: 1,
    transitionId: deriveDetachedTransitionId({ operationId: "detached:opY", generation: 1, sequence: 1, status: "RUNNING" }),
    status: "RUNNING"
  };
  await assert.rejects(() => coord.ingestOperationTransition(missing), /effectOperationId|unresolved|Binding/i);
  // Conflicting inputId reuse also fails closed.
  await coord.ingestUserInput({ inputId: "dup-in", input: { a: 1 } });
  await assert.rejects(() => coord.ingestUserInput({ inputId: "dup-in", input: { a: 2 } }), /conflicting payload/);
});

// INV-3: metrics cannot authorize promotion.
test("INV-3: probe metrics are DEV-only with no promotion verdict", async () => {
  const clock = fakeClock();
  const sessionStore = createInMemorySessionStore();
  const coord = createAsyncAgentCoordinator({ sessionStore, sessionId: "inv3-1", clock: clock.now, nowIso: clock.iso });
  await coord.ingestUserInput({ inputId: "m1", input: "x" });
  const metrics = await coord.probeMetrics();
  assert.equal(metrics.kind, "BB-080_ASYNC_PROBE_METRICS_V1");
  assert.equal(metrics.promotionVerdict, null);
  assert.ok(!("PROMOTE_ASYNC" in metrics) || metrics.promotionVerdict == null);
  assert.equal(typeof metrics.duplicateEffects, "number");
});

// Generation cancellation capability: normalization, routing, runtime plumbing.
test("generationCancellation normalizes to FENCE_ONLY and preserves ABORT_SIGNAL", () => {
  assert.equal(normalizeGenerationCancellation(null), "FENCE_ONLY");
  assert.equal(normalizeGenerationCancellation(undefined), "FENCE_ONLY");
  assert.equal(normalizeGenerationCancellation("ABORT_SIGNAL"), "ABORT_SIGNAL");
  assert.throws(() => normalizeGenerationCancellation("GUESS"), /must be one of/);
  const legacy = defineModelAdapter({ name: "legacy", generate: async () => ({}) });
  assert.equal(legacy.generationCancellation, "FENCE_ONLY");
  assert.equal(modelGenerationCancellation(legacy), "FENCE_ONLY");
  assert.deepEqual(modelAdapterView(legacy), { name: "legacy", version: null });
  const abortable = defineModelAdapter({ name: "m", generate: async () => ({}), generationCancellation: "ABORT_SIGNAL" });
  assert.equal(modelGenerationCancellation(abortable), "ABORT_SIGNAL");
  assert.equal(modelAdapterView(abortable).generationCancellation, "ABORT_SIGNAL");
});

test("model routing preserves generationCancellation exactly", async () => {
  for (const mode of Object.values(ModelGenerationCancellationMode)) {
    const registry = createModelRegistry({
      models: [{ name: "routed", version: "1", generate: async () => ({}), generationCancellation: mode }]
    });
    const route = await resolveModelRoute(registry, selectModelRoute({ invocation: "routed" }));
    assert.equal(modelGenerationCancellation(route.adapter), mode);
    assert.equal(modelGenerationCancellation(route.provenance.adapter), mode);
  }
  const legacy = createModelRegistry({ models: [{ name: "legacy", generate: async () => ({}) }] });
  const legacyRoute = await resolveModelRoute(legacy, selectModelRoute({ invocation: "legacy" }));
  assert.equal(modelGenerationCancellation(legacyRoute.adapter), "FENCE_ONLY");
  assert.deepEqual(legacyRoute.provenance.adapter, { name: "legacy", version: null });
});

test("AgentRuntime forwards AbortSignal and strategy passes it for ABORT_SIGNAL routes", async () => {
  let seenSignal = "unset";
  const abortable = defineModelAdapter({
    name: "abortable",
    generate: async (request, options) => {
      seenSignal = options?.signal ?? null;
      return { type: "execute_javascript", code: "return_result(1)" };
    },
    generationCancellation: "ABORT_SIGNAL"
  });
  function codeactExecutor() {
    return {
      async open({ host }) {
        return {
          features: ["CELL_ABORT"],
          async execute({ code }, { signal = null } = {}) {
            void signal;
            try {
              if (code === "return_result(1)") {
                await host.request({ type: "RETURN_RESULT", value: 1 });
              } else if (code === "return_result(2)") {
                await host.request({ type: "RETURN_RESULT", value: 2 });
              } else {
                throw new Error(`unknown code ${code}`);
              }
            } catch (error) {
              if (error?.code === "EXHARNESS_JAVASCRIPT_TERMINAL_INTERRUPT") {
                return { stdout: "", stderr: "", value: null, terminated: true };
              }
              throw error;
            }
            return { stdout: "", stderr: "", value: null, terminated: true };
          },
          async close() {}
        };
      }
    };
  }
  const strategy = createJavaScriptCodeActStrategy({ model: abortable, executor: codeactExecutor(), maxTurns: 1 });
  const runtime = createAgentRuntime({ strategy, models: [{ name: "abortable", load: async () => abortable }], model: "abortable" });
  const controller = new AbortController();
  const report = await runtime.runWithReport({ signal: controller.signal });
  assert.equal(report.result, 1);
  assert.equal(seenSignal, controller.signal);

  let fenceOnlySeen = "unset";
  const fenceOnly = defineModelAdapter({
    name: "fenceonly",
    generate: async (request, options) => {
      fenceOnlySeen = options?.signal ?? null;
      return { type: "execute_javascript", code: "return_result(2)" };
    }
  });
  const strategy2 = createJavaScriptCodeActStrategy({ model: fenceOnly, executor: codeactExecutor(), maxTurns: 1 });
  const runtime2 = createAgentRuntime({ strategy: strategy2, models: [{ name: "fenceonly", load: async () => fenceOnly }], model: "fenceonly" });
  const report2 = await runtime2.runWithReport({ signal: controller.signal });
  assert.equal(report2.result, 2);
  assert.equal(fenceOnlySeen, null);
});

test("ABORT_SIGNAL strategy fences an aborted turn before action dispatch", async () => {
  const controller = new AbortController();
  controller.abort("steering");
  const abortable = defineModelAdapter({
    name: "abortable",
    generate: async () => ({ type: "execute_javascript", code: "return_result(1)" }),
    generationCancellation: "ABORT_SIGNAL"
  });
  const executor = {
    async open() {
      return {
        features: ["CELL_ABORT"],
        async execute() {
          throw new Error("must not execute after fence");
        },
        async close() {}
      };
    }
  };
  const strategy = createJavaScriptCodeActStrategy({ model: abortable, executor, maxTurns: 1 });
  await assert.rejects(() => strategy.run({
    input: null,
    context: null,
    capabilities: [],
    liveObjects: [],
    invoke: async () => { throw new Error("must not dispatch after fence"); },
    describeLiveObject: async () => ({}),
    invokeLiveObject: async () => ({}),
    readLiveObject: async () => ({}),
    model: abortable,
    modelSignal: controller.signal
  }), /fenced/);
});

// AsyncResultDelivery still defaults safely alongside the new capability.
test("legacy adapters default both async capabilities safely", () => {
  const adapter = defineModelAdapter({ name: "legacy", generate: async () => ({}) });
  assert.equal(adapter.asyncResultDelivery, "SYNCHRONOUS");
  assert.equal(adapter.generationCancellation, "FENCE_ONLY");
  assert.ok(!("asyncResultDelivery" in modelAdapterView(adapter)));
  assert.ok(!("generationCancellation" in modelAdapterView(adapter)));
  void AsyncResultDeliveryMode;
});
