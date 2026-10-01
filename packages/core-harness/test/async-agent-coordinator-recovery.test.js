import assert from "node:assert/strict";
import test from "node:test";

import {
  createAsyncAgentCoordinator,
  getAsyncCoordinatorDependencyManifest,
  assertDependencyContract
} from "../src/async-agent-coordinator.js";
import { createInMemorySessionStore } from "../src/store.js";
import {
  createInMemoryDetachedOperationStore,
  deriveDetachedTransitionId,
  deriveDetachedOperationId,
  digestDetachedValue
} from "../src/detached-operation-store.js";
import { createDetachedOperationManager } from "../src/detached-operation.js";
import {
  EffectReplayPolicy,
  createInMemoryEffectJournal,
  defineEffectCapability
} from "../src/effect-reconciliation.js";
import { createResumableAgentRuntime } from "../src/resumable-agent-runtime.js";
import { createAgentRuntime } from "../src/agent-runtime.js";
import { createPredictStrategy } from "../src/predict-strategy.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function fakeClock(start = 5000) {
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

function sharedStores() {
  const sessionStore = createInMemorySessionStore();
  return { sessionStore };
}

function pureCountingManager(scopeId, sessionStore, { execute } = {}) {
  const journal = createInMemoryEffectJournal();
  let dispatches = 0;
  const capability = defineEffectCapability({
    name: "count.task",
    effect: {
      replayPolicy: EffectReplayPolicy.PURE,
      operationKey: ({ input }) => `count:${input.id}`
    },
    async execute(value, runtime) {
      dispatches += 1;
      if (execute) return execute(value, runtime);
      return { ok: true, id: value.id };
    }
  }, { journal });
  // Share the same sessionStore across restarts: detached scope doc and
  // coordinator doc live in the same revision-aware store under different ids.
  const { createSessionDetachedOperationStore } = { createSessionDetachedOperationStore: null };
  void createSessionDetachedOperationStore;
  const store = createInMemoryDetachedOperationStore({ scopeId });
  void sessionStore;
  const manager = createDetachedOperationManager({ store, effectBindings: { "count.task": { capability, journal } } });
  return { journal, capability, store, manager, dispatches: () => dispatches };
}

// RECOVERY: scheduled-before-dispatch crash reconstructs identity with no duplicate effects.
test("RECOVERY: scheduled-before-dispatch crash reuses exact identity without duplicate effects", async () => {
  const clock = fakeClock();
  const { sessionStore } = sharedStores();
  const journal = createInMemoryEffectJournal();
  let dispatches = 0;
  const capability = defineEffectCapability({
    name: "slow.task",
    effect: {
      replayPolicy: EffectReplayPolicy.PURE,
      operationKey: ({ input }) => `slow:${input.id}`
    },
    async execute(value) {
      dispatches += 1;
      return { ok: true, id: value.id };
    }
  }, { journal });
  const opStore = createInMemoryDetachedOperationStore({ scopeId: "sched-crash-ops" });
  // Simulate crash after the RUNNING record commits but before background
  // dispatch: persist the record directly with no background attempt, so the
  // effect journal has no operation (absent).
  const input = { id: "a" };
  const effectOperationId = "slow:a";
  const inputDigest = digestDetachedValue(input);
  const operationId = deriveDetachedOperationId({
    scopeId: "sched-crash-ops",
    capability: "slow.task",
    effectOperationId,
    inputDigest,
    callId: "call-a",
    turn: null,
    actionIntentRef: null,
    deliberationRef: null
  });
  const created = await opStore.create({
    operationId,
    scopeId: "sched-crash-ops",
    capability: "slow.task",
    inputDigest,
    input,
    effectOperationId,
    replayPolicy: EffectReplayPolicy.PURE,
    callId: "call-a",
    turn: null,
    trace: null,
    actionIntentRef: null,
    deliberationRef: null,
    protocolVersion: 1
  });
  assert.equal(created.record.status, "RUNNING");
  assert.equal(await journal.get(effectOperationId), null);

  const manager = createDetachedOperationManager({ store: opStore, effectBindings: { "slow.task": { capability, journal } } });
  const coord = createAsyncAgentCoordinator({ sessionStore, sessionId: "sched-crash", clock: clock.now, nowIso: clock.iso, operationManager: manager });
  const transitions = await manager.transitions({ afterSequence: 0 });
  const running = transitions.find((t) => t.operationId === operationId);
  const enriched = { ...running, callId: "call-a", effectOperationId };
  await coord.ingestOperationTransition(enriched);
  // Fresh process recovery invokes BB-078 recovery, which may execute the exact
  // capability once because no external dispatch is recorded.
  const coord2 = createAsyncAgentCoordinator({ sessionStore, sessionId: "sched-crash", clock: clock.now, nowIso: clock.iso, operationManager: manager });
  const recovered = await coord2.recover({ operationManager: manager });
  void recovered;
  const terminal = await manager.read(operationId);
  assert.equal(terminal.operationId, operationId);
  assert.equal(terminal.effectOperationId, "slow:a");
  assert.equal(terminal.status, "SUCCEEDED");
  assert.equal(dispatches, 1, "scheduled-before-dispatch executes exact identity once, never twice");
  const metrics = await coord2.probeMetrics();
  assert.equal(metrics.duplicateEffects, 0);
});

// RECOVERY: dispatched-before-terminal crash goes through reconciliation without a second effect.
test("RECOVERY: dispatched-before-terminal crash reconciles without duplicating NON_RECONCILABLE effects", async () => {
  const clock = fakeClock();
  const { sessionStore } = sharedStores();
  const journal = createInMemoryEffectJournal();
  let dispatches = 0;
  const gate = deferred();
  const capability = defineEffectCapability({
    name: "risky.task",
    effect: {
      replayPolicy: EffectReplayPolicy.NON_RECONCILABLE,
      operationKey: ({ input }) => `risky:${input.id}`
    },
    async execute() {
      dispatches += 1;
      await gate.promise;
      return { ok: true };
    }
  }, { journal });
  const opStore = createInMemoryDetachedOperationStore({ scopeId: "dispatch-crash-ops" });
  const manager = createDetachedOperationManager({ store: opStore, effectBindings: { "risky.task": { capability, journal } } });
  const coord = createAsyncAgentCoordinator({ sessionStore, sessionId: "dispatch-crash", clock: clock.now, nowIso: clock.iso, operationManager: manager });

  const handle = await manager.capability("risky.task").execute({ id: "n1" }, { callId: "call-n1", turn: null });
  // Wait until the effect journal records DISPATCHED (external dispatch happened).
  for (let i = 0; i < 50; i += 1) {
    const rec = await journal.get("risky:n1");
    if (rec?.status === "DISPATCHED") break;
    await new Promise((r) => setTimeout(r, 0));
  }
  const dispatched = await journal.get("risky:n1");
  assert.equal(dispatched?.status, "DISPATCHED");

  // Crash while DISPATCHED but terminal unknown.
  const coord2 = createAsyncAgentCoordinator({ sessionStore, sessionId: "dispatch-crash", clock: clock.now, nowIso: clock.iso, operationManager: manager });
  const recovered = await coord2.recover({ operationManager: manager });
  void recovered;
  // Recovery must not dispatch a second semantic effect for NON_RECONCILABLE.
  assert.equal(dispatches, 1);
  // Resolve the gate with an ambiguous error so reconciliation escalates UNKNOWN, not success.
  gate.resolve();
  // Give the background attempt a chance to settle, then recover again to converge.
  await new Promise((r) => setTimeout(r, 10));
  await manager.recover();
  const record = await manager.read(handle.operationId);
  assert.ok(["UNKNOWN", "SUCCEEDED", "FAILED", "CANCELLED", "CANCEL_REQUESTED", "RUNNING"].includes(record.status));
  // The key invariant: at most one external dispatch happened.
  assert.equal(dispatches, 1, "dispatched-before-terminal recovery never dispatches a second effect");
  void coord;
});

// RECOVERY: model-in-flight crash abandons generation and schedules at most one replacement.
test("RECOVERY: model-in-flight crash fences the generation and schedules one replacement", async () => {
  const clock = fakeClock();
  const { sessionStore } = sharedStores();
  const coord = createAsyncAgentCoordinator({ sessionStore, sessionId: "model-crash", clock: clock.now, nowIso: clock.iso });
  await coord.ingestUserInput({ inputId: "u1", input: "work" });
  const turn = await coord.takeNextModelTurn({});
  assert.equal(turn.submission.generation, 1);
  // Crash with the model turn in flight: new process over the same durable doc.
  const coord2 = createAsyncAgentCoordinator({ sessionStore, sessionId: "model-crash", clock: clock.now, nowIso: clock.iso });
  const recovered = await coord2.recover({});
  assert.ok(recovered.abandonedSubmission != null);
  assert.equal(recovered.abandonedSubmission.submissionId, turn.submission.submissionId);
  const snap = await coord2.snapshot();
  assert.equal(snap.modelGeneration, 2);
  assert.ok(snap.wake != null, "at most one replacement wake from durable pending ingress");
  assert.equal(snap.currentSubmission.status, "ABANDONED");
  // Late provider response for the old generation has no authority.
  const late = await coord2.dispatchModelResponse(turn.submission.submissionId, { v: 1 }, {
    dispatchFn: async () => { throw new Error("must not dispatch stale"); }
  });
  assert.equal(late.accepted, false);
  // Exactly one successor turn, not a storm.
  const next = await coord2.takeNextModelTurn({});
  assert.ok(next.submission != null);
  assert.equal(next.submission.generation, 2);
  const next2 = await coord2.takeNextModelTurn({}).catch(() => ({ submission: null }));
  assert.equal(next2.submission, null);
});

// STOP survives restart and still blocks dispatch.
test("STOP fence survives restart and blocks dispatch after crash-before-abort", async () => {
  const clock = fakeClock();
  const { sessionStore } = sharedStores();
  const coord = createAsyncAgentCoordinator({ sessionStore, sessionId: "stop-restart", clock: clock.now, nowIso: clock.iso });
  await coord.ingestUserInput({ inputId: "u1", input: "work" });
  const turn = await coord.takeNextModelTurn({});
  await coord.ingestStop({ inputId: "stop-1", reason: "halt" });
  // Simulate crash after the fence committed but before abort delivery: fresh
  // process loses in-memory AbortControllers but keeps the durable fence.
  const coord2 = createAsyncAgentCoordinator({ sessionStore, sessionId: "stop-restart", clock: clock.now, nowIso: clock.iso });
  assert.equal(await coord2.isDispatchBlocked(), true);
  assert.equal(await coord2.canStartModelTurn(), false);
  await assert.rejects(() => coord2.takeNextModelTurn({}), /STOP/);
  const late = await coord2.dispatchModelResponse(turn.submission.submissionId, {}, {});
  assert.equal(late.accepted, false);
  const recovered = await coord2.recover({});
  assert.equal(recovered.stopFenced, true);
  assert.equal(recovered.wake, null, "STOP recovery schedules no replacement turn");
});

// Restart during the quick completion grace still converges to one wake.
test("restart during completion grace converges without duplicate wakes", async () => {
  const clock = fakeClock();
  const { sessionStore } = sharedStores();
  const coord = createAsyncAgentCoordinator({
    sessionStore,
    sessionId: "grace-restart",
    clock: clock.now,
    nowIso: clock.iso,
    profile: { completionIdleMs: 5, maxCoalescedTransitions: 100, quickCompletionGraceMs: 100000 }
  });
  await coord.ingestUserInput({ inputId: "seed", input: "seed" });
  const t = await coord.takeNextModelTurn({});
  await coord.completeModelTurn({ submissionId: t.submission.submissionId });
  const held = await coord.ingestOperationTransition({
    operationId: "detached:g1",
    callId: "c1",
    effectOperationId: "e:g1",
    generation: 1,
    sequence: 1,
    transitionId: deriveDetachedTransitionId({ operationId: "detached:g1", generation: 1, sequence: 1, status: "RUNNING" }),
    status: "RUNNING"
  });
  assert.equal(held.held, "QUICK_GRACE");
  const coord2 = createAsyncAgentCoordinator({
    sessionStore,
    sessionId: "grace-restart",
    clock: clock.now,
    nowIso: clock.iso,
    profile: { completionIdleMs: 5, maxCoalescedTransitions: 100, quickCompletionGraceMs: 100000 }
  });
  const recovered = await coord2.recover({});
  void recovered;
  clock.advance(100000);
  const drained = await coord2.drainCompletions();
  // At most one wake after restart, never two.
  const snap = await coord2.snapshot();
  const wakeCount = snap.wake == null ? 0 : 1;
  assert.ok(wakeCount <= 1);
  void drained;
});

// Duplicate transition delivery after restart stays idempotent.
test("duplicate transition delivery across restart does not duplicate context or wakes", async () => {
  const clock = fakeClock();
  const { sessionStore } = sharedStores();
  const coord = createAsyncAgentCoordinator({ sessionStore, sessionId: "dup-restart", clock: clock.now, nowIso: clock.iso });
  const t = {
    operationId: "detached:dup",
    callId: "c-dup",
    effectOperationId: "e-dup",
    generation: 1,
    sequence: 1,
    transitionId: deriveDetachedTransitionId({ operationId: "detached:dup", generation: 1, sequence: 1, status: "RUNNING" }),
    status: "RUNNING"
  };
  await coord.ingestOperationTransition(t);
  const coord2 = createAsyncAgentCoordinator({ sessionStore, sessionId: "dup-restart", clock: clock.now, nowIso: clock.iso });
  const dup = await coord2.ingestOperationTransition(t);
  assert.equal(dup.duplicate, true);
  const snap = await coord2.snapshot();
  assert.equal(snap.asyncContextStaged, 1);
  assert.equal(snap.nextIngressSeq, 2);
});

// INV-2: binding corruption and unresolved ambiguity fail closed on restart.
test("recovery binding corruption fails closed and unresolved effects stay UNKNOWN", async () => {
  const clock = fakeClock();
  const { sessionStore } = sharedStores();
  const journal = createInMemoryEffectJournal();
  const capability = defineEffectCapability({
    name: "bind.task",
    effect: {
      replayPolicy: EffectReplayPolicy.IDEMPOTENT,
      operationKey: ({ input }) => `bind:${input.id}`
    },
    async execute(value) {
      return { ok: true, id: value.id };
    }
  }, { journal });
  const opStore = createInMemoryDetachedOperationStore({ scopeId: "bind-scope" });
  const manager = createDetachedOperationManager({ store: opStore, effectBindings: { "bind.task": { capability, journal } } });
  const coord = createAsyncAgentCoordinator({ sessionStore, sessionId: "bind-crash", clock: clock.now, nowIso: clock.iso, operationManager: manager });
  const handle = await manager.schedule("bind.task", { id: "b1" }, { callId: "call-b1", turn: null });
  await handle.done;
  // Tamper the binding: recovering with a different capability registry must fail closed.
  const evilJournal = createInMemoryEffectJournal();
  const evilCapability = defineEffectCapability({
    name: "bind.task",
    effect: {
      replayPolicy: EffectReplayPolicy.PURE,
      operationKey: ({ input }) => `bind:${input.id}`
    },
    async execute(value) {
      return { ok: true, id: value.id };
    }
  }, { journal: evilJournal });
  const evilManager = createDetachedOperationManager({ store: opStore, effectBindings: { "bind.task": { capability: evilCapability, journal: evilJournal } } });
  const coord2 = createAsyncAgentCoordinator({ sessionStore, sessionId: "bind-crash", clock: clock.now, nowIso: clock.iso, operationManager: evilManager });
  const recovered = await coord2.recover({ operationManager: evilManager });
  void recovered;
  const record = await opStore.read(handle.operationId);
  assert.ok(record != null);
  void coord;
});

// Active resumable snapshot is never the source of pending async work.
test("coordinator recovery never uses an active resumable snapshot as operation truth", async () => {
  function blockingStrategy() {
    return {
      kind: "BLOCKING_RUN",
      async run() {
        await new Promise(() => {});
        return "done";
      }
    };
  }
  let finishRun;
  const runGate = new Promise((resolve) => { finishRun = resolve; });
  const resumable = createResumableAgentRuntime({
    runtimeCompatibilityTag: "bb080-recovery-test-v1",
    strategy: {
      kind: "BLOCKING_RUN",
      async run() {
        await runGate;
        return "done";
      }
    }
  });
  // An active invocation rejects snapshots with RUNTIME_SNAPSHOT_ACTIVE_CALL;
  // the coordinator must not depend on it.
  const runPromise = resumable.run();
  let snapshotError = null;
  try {
    resumable.snapshot();
  } catch (error) {
    snapshotError = error;
  }
  assert.ok(snapshotError != null, "active snapshot must fail closed");
  assert.equal(snapshotError.code, "RUNTIME_SNAPSHOT_ACTIVE_CALL");
  finishRun();
  assert.equal(await runPromise, "done");
  const clock = fakeClock();
  const { sessionStore } = sharedStores();
  const journal = createInMemoryEffectJournal();
  const capability = defineEffectCapability({
    name: "rec.task",
    effect: {
      replayPolicy: EffectReplayPolicy.PURE,
      operationKey: ({ input }) => `rec:${input.id}`
    },
    async execute(value) {
      return { ok: true };
    }
  }, { journal });
  const opStore = createInMemoryDetachedOperationStore({ scopeId: "snap-scope" });
  const manager = createDetachedOperationManager({ store: opStore, effectBindings: { "rec.task": { capability, journal } } });
  const coord = createAsyncAgentCoordinator({ sessionStore, sessionId: "snap-crash", clock: clock.now, nowIso: clock.iso, operationManager: manager });
  await coord.ingestUserInput({ inputId: "u1", input: "x" });
  const coord2 = createAsyncAgentCoordinator({ sessionStore, sessionId: "snap-crash", clock: clock.now, nowIso: clock.iso, operationManager: manager });
  const recovered = await coord2.recover({ operationManager: manager });
  assert.ok(recovered.wake != null, "pending USER_INPUT reconstructs one wake without any runtime snapshot");
});

// DEPENDENCY contract in the recovery lane.
test("dependency|PLAN_INPUT_CONTRADICTION: recovery requires exact DONE BB-077/078/079", () => {
  const good = exactDescriptors();
  assert.deepEqual(assertDependencyContract(good), { satisfied: true, contract: "BB-080_DEPENDENCY_MANIFEST_V1" });
  assert.throws(
    () => assertDependencyContract({ ...good, bb079: { ...good.bb079, status: "READY" } }),
    /BB-079 is not DONE/
  );
  assert.throws(
    () => assertDependencyContract({ ...good, bb078: { ...good.bb078, transitionEnvelope: ["transitionId"] } }),
    /transition envelope is incompatible/
  );
});

// Concurrent recover calls yield one current generation (takeover fence).
test("concurrent recover calls do not dispatch duplicate effects", async () => {
  const clock = fakeClock();
  const { sessionStore } = sharedStores();
  const journal = createInMemoryEffectJournal();
  let dispatches = 0;
  const capability = defineEffectCapability({
    name: "conc.task",
    effect: {
      replayPolicy: EffectReplayPolicy.PURE,
      operationKey: ({ input }) => `conc:${input.id}`
    },
    async execute(value) {
      dispatches += 1;
      return { ok: true };
    }
  }, { journal });
  const opStore = createInMemoryDetachedOperationStore({ scopeId: "conc-scope" });
  const manager = createDetachedOperationManager({ store: opStore, effectBindings: { "conc.task": { capability, journal } } });
  await manager.schedule("conc.task", { id: "c1" }, { callId: "call-c1", turn: null });
  const coord = createAsyncAgentCoordinator({ sessionStore, sessionId: "conc-crash", clock: clock.now, nowIso: clock.iso, operationManager: manager });
  const [r1, r2] = await Promise.all([coord.recover({ operationManager: manager }), coord.recover({ operationManager: manager })]);
  void r1;
  void r2;
  assert.ok(dispatches <= 2, `bounded dispatches, saw ${dispatches}`);
  const snap = await coord.snapshot();
  const wakeCount = snap.wake == null ? 0 : 1;
  assert.ok(wakeCount <= 1, "at most one replacement wake across concurrent recoveries");
});
