import assert from "node:assert/strict";
import test from "node:test";

import {
  createInMemoryDetachedOperationStore,
  deriveDetachedOperationId,
  digestDetachedValue,
  DetachedOperationStatus
} from "../src/detached-operation-store.js";
import { createDetachedOperationManager } from "../src/detached-operation.js";
import {
  EffectOperationStatus,
  EffectReplayPolicy,
  createInMemoryEffectJournal,
  defineEffectCapability
} from "../src/effect-reconciliation.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const flush = (rounds = 5) => new Promise((resolve) => {
  let remaining = rounds;
  const tick = () => {
    remaining -= 1;
    if (remaining <= 0) resolve();
    else setTimeout(tick, 0);
  };
  setTimeout(tick, 0);
});

async function pollFor(label, predicate, { rounds = 200 } = {}) {
  for (let attempt = 0; attempt < rounds; attempt += 1) {
    if (await predicate()) return;
    await flush(1);
  }
  throw new Error(`timed out waiting for ${label}`);
}

function managerFixture({ scopeId, capabilityName = "w.task", replayPolicy = EffectReplayPolicy.IDEMPOTENT, observe = null, desiredEffect = null, execute }) {
  const journal = createInMemoryEffectJournal();
  let dispatches = 0;
  const capability = defineEffectCapability({
    name: capabilityName,
    effect: {
      replayPolicy,
      operationKey: ({ input }) => `${capabilityName}:${input.id}`,
      ...(observe == null ? {} : { observe }),
      ...(desiredEffect == null ? {} : { desiredEffect })
    },
    async execute(input, runtime) {
      dispatches += 1;
      return execute(input, runtime);
    }
  }, { journal });
  const store = createInMemoryDetachedOperationStore({ scopeId });
  const manager = createDetachedOperationManager({ store, effectBindings: { [capabilityName]: { capability, journal } } });
  return {
    journal,
    capability,
    store,
    manager,
    dispatches: () => dispatches,
    effectOperationId: (id) => `${capabilityName}:${id}`
  };
}

function craftBinding({ scopeId, capability, input, effectOperationId, replayPolicy, callId = "call-1", turn = null, extra = {} }) {
  const inputDigest = digestDetachedValue(input);
  return {
    operationId: deriveDetachedOperationId({
      scopeId, capability, effectOperationId, inputDigest, callId, turn,
      actionIntentRef: extra.actionIntentRef ?? null,
      deliberationRef: extra.deliberationRef ?? null
    }),
    scopeId,
    capability,
    inputDigest,
    input,
    effectOperationId,
    replayPolicy,
    callId,
    turn,
    trace: null,
    actionIntentRef: extra.actionIntentRef ?? null,
    deliberationRef: extra.deliberationRef ?? null,
    protocolVersion: 1
  };
}

async function seedJournal(journal, { capability, replayPolicy, input, effectOperationId, state, result = { ok: true }, desiredEffect = null }) {
  await journal.intend({ operationId: effectOperationId, capability, replayPolicy, input, ...(desiredEffect == null ? {} : { desiredEffect }) });
  if (state === "INTENDED") return;
  await journal.markDispatched(effectOperationId);
  if (state === "DISPATCHED") return;
  if (state === "UNKNOWN") {
    await journal.markUnknown(effectOperationId, new Error("response lost after dispatch"));
    return;
  }
  if (state === "CONFIRMED") {
    await journal.markConfirmed(effectOperationId, { result });
  }
}

test("recovery reuses confirmed work without redispatch", async () => {
  const fixture = managerFixture({
    scopeId: "recover-confirmed",
    replayPolicy: EffectReplayPolicy.NON_RECONCILABLE,
    execute: async () => { throw new Error("must not dispatch"); }
  });
  const input = { id: "c" };
  await seedJournal(fixture.journal, {
    capability: "w.task",
    replayPolicy: EffectReplayPolicy.NON_RECONCILABLE,
    input,
    effectOperationId: fixture.effectOperationId("c"),
    state: "CONFIRMED",
    result: { remote: 7 }
  });
  await fixture.store.create(craftBinding({
    scopeId: "recover-confirmed",
    capability: "w.task",
    input,
    effectOperationId: fixture.effectOperationId("c"),
    replayPolicy: EffectReplayPolicy.NON_RECONCILABLE
  }));
  const [settled] = await fixture.manager.recover();
  assert.equal(settled.status, DetachedOperationStatus.SUCCEEDED);
  assert.deepEqual(settled.result, { remote: 7 });
  assert.equal(settled.generation, 2);
  assert.equal(fixture.dispatches(), 0);
});

test("recovery executes the exact operation for absent and intended journal states", async () => {
  for (const state of ["ABSENT", "INTENDED"]) {
    const fixture = managerFixture({
      scopeId: `recover-${state.toLowerCase()}`,
      replayPolicy: EffectReplayPolicy.NON_RECONCILABLE,
      execute: async (value) => ({ created: value.id })
    });
    const input = { id: state };
    if (state === "INTENDED") {
      await seedJournal(fixture.journal, {
        capability: "w.task",
        replayPolicy: EffectReplayPolicy.NON_RECONCILABLE,
        input,
        effectOperationId: fixture.effectOperationId(state),
        state: "INTENDED"
      });
    }
    const binding = craftBinding({
      scopeId: `recover-${state.toLowerCase()}`,
      capability: "w.task",
      input,
      effectOperationId: fixture.effectOperationId(state),
      replayPolicy: EffectReplayPolicy.NON_RECONCILABLE
    });
    await fixture.store.create(binding);
    const [settled] = await fixture.manager.recover();
    assert.equal(settled.status, DetachedOperationStatus.SUCCEEDED);
    assert.deepEqual(settled.result, { created: state });
    assert.equal(fixture.dispatches(), 1);
    assert.equal((await fixture.journal.get(fixture.effectOperationId(state))).status, EffectOperationStatus.CONFIRMED);
  }
});

test("recovery reconciles dispatched and unknown idempotent work with one retry", async () => {
  for (const state of ["DISPATCHED", "UNKNOWN"]) {
    const fixture = managerFixture({
      scopeId: `recover-idem-${state.toLowerCase()}`,
      replayPolicy: EffectReplayPolicy.IDEMPOTENT,
      execute: async (value) => ({ retried: value.id })
    });
    const input = { id: state };
    await seedJournal(fixture.journal, {
      capability: "w.task",
      replayPolicy: EffectReplayPolicy.IDEMPOTENT,
      input,
      effectOperationId: fixture.effectOperationId(state),
      state
    });
    await fixture.store.create(craftBinding({
      scopeId: `recover-idem-${state.toLowerCase()}`,
      capability: "w.task",
      input,
      effectOperationId: fixture.effectOperationId(state),
      replayPolicy: EffectReplayPolicy.IDEMPOTENT
    }));
    const [settled] = await fixture.manager.recover();
    assert.equal(settled.status, DetachedOperationStatus.SUCCEEDED);
    assert.deepEqual(settled.result, { retried: state });
    assert.equal(fixture.dispatches(), 1);
  }
});

test("recovery escalates ambiguous non-reconcilable work to unknown without dispatch", async () => {
  for (const state of ["DISPATCHED", "UNKNOWN"]) {
    const fixture = managerFixture({
      scopeId: `recover-nr-${state.toLowerCase()}`,
      replayPolicy: EffectReplayPolicy.NON_RECONCILABLE,
      execute: async () => { throw new Error("must not dispatch"); }
    });
    const input = { id: state };
    await seedJournal(fixture.journal, {
      capability: "w.task",
      replayPolicy: EffectReplayPolicy.NON_RECONCILABLE,
      input,
      effectOperationId: fixture.effectOperationId(state),
      state
    });
    await fixture.store.create(craftBinding({
      scopeId: `recover-nr-${state.toLowerCase()}`,
      capability: "w.task",
      input,
      effectOperationId: fixture.effectOperationId(state),
      replayPolicy: EffectReplayPolicy.NON_RECONCILABLE
    }));
    const [settled] = await fixture.manager.recover();
    assert.equal(settled.status, DetachedOperationStatus.UNKNOWN);
    assert.equal(fixture.dispatches(), 0);
    assert.notEqual((await fixture.journal.get(fixture.effectOperationId(state))).status, EffectOperationStatus.CONFIRMED);
  }
});

test("concurrent recovery dispatches one semantic effect and keeps one terminal", async () => {
  const gate = deferred();
  const fixture = managerFixture({
    scopeId: "recover-concurrent",
    replayPolicy: EffectReplayPolicy.NON_RECONCILABLE,
    execute: async (value) => {
      await gate.promise;
      return { created: value.id };
    }
  });
  const input = { id: "shared" };
  const binding = craftBinding({
    scopeId: "recover-concurrent",
    capability: "w.task",
    input,
    effectOperationId: fixture.effectOperationId("shared"),
    replayPolicy: EffectReplayPolicy.NON_RECONCILABLE
  });
  await fixture.store.create(binding);
  const second = createDetachedOperationManager({
    store: fixture.store,
    effectBindings: { "w.task": { capability: fixture.capability, journal: fixture.journal } }
  });

  const firstRecover = fixture.manager.recover();
  await pollFor("first dispatch", () => fixture.dispatches() === 1);
  await pollFor("journal dispatched", async () =>
    (await fixture.journal.get(fixture.effectOperationId("shared")))?.status === EffectOperationStatus.DISPATCHED);
  const secondResult = await second.recover();
  assert.equal(fixture.dispatches(), 1);
  gate.resolve();
  const firstResult = await firstRecover;
  assert.equal(fixture.dispatches(), 1);

  const statuses = [...firstResult, ...secondResult].map((item) => item.status);
  assert.ok(statuses.includes(DetachedOperationStatus.UNKNOWN));
  const current = await fixture.store.read(binding.operationId);
  assert.equal(fixture.dispatches(), 1);
  assert.equal((await fixture.store.list()).length, 1);
  const terminals = (await fixture.store.transitions()).filter((item) =>
    [DetachedOperationStatus.SUCCEEDED, DetachedOperationStatus.FAILED, DetachedOperationStatus.CANCELLED, DetachedOperationStatus.UNKNOWN].includes(item.status));
  assert.equal(terminals.length, 1);
  assert.equal(current.status, terminals[0].status);
});

test("cancellation before dispatch converges cancelled and fences every later dispatch", async () => {
  for (const replayPolicy of [EffectReplayPolicy.PURE, EffectReplayPolicy.IDEMPOTENT, EffectReplayPolicy.OBSERVABLE, EffectReplayPolicy.NON_RECONCILABLE]) {
    const fixture = managerFixture({
      scopeId: `cancel-predispatch-${replayPolicy.toLowerCase()}`,
      replayPolicy,
      observe: replayPolicy === EffectReplayPolicy.OBSERVABLE
        ? async () => ({ satisfied: false, result: null, evidence: { source: "remote-read" } })
        : null,
      execute: async () => { throw new Error("must not dispatch after cancel fence"); }
    });
    const input = { id: "pre" };
    const binding = craftBinding({
      scopeId: `cancel-predispatch-${replayPolicy.toLowerCase()}`,
      capability: "w.task",
      input,
      effectOperationId: fixture.effectOperationId("pre"),
      replayPolicy
    });
    const created = await fixture.store.create(binding);
    assert.equal(created.record.status, DetachedOperationStatus.RUNNING);
    const cancelled = await fixture.manager.cancel(binding.operationId, { reason: "no-longer-needed" });
    assert.equal(cancelled.status, DetachedOperationStatus.CANCELLED);
    const fenced = (await fixture.store.transitions()).map((item) => item.status);
    assert.deepEqual(fenced, [DetachedOperationStatus.RUNNING, DetachedOperationStatus.CANCEL_REQUESTED, DetachedOperationStatus.CANCELLED]);

    // Neither recovery nor a late attach may dispatch or retry afterwards.
    const [recovered] = await fixture.manager.recover();
    assert.equal(recovered.status, DetachedOperationStatus.CANCELLED);
    const attached = await fixture.manager.capability("w.task").execute(input, { callId: "call-1" });
    assert.equal(attached.operationId, binding.operationId);
    assert.equal((await attached.done).status, DetachedOperationStatus.CANCELLED);
    assert.equal(fixture.dispatches(), 0);
    assert.equal(await fixture.journal.get(fixture.effectOperationId("pre")).then((record) => record?.status ?? "ABSENT"), "ABSENT");
  }
});

test("pure cooperative cancellation converges cancelled once the attempt settles", async () => {
  let observedAbort = false;
  const fixture = managerFixture({
    scopeId: "cancel-pure",
    replayPolicy: EffectReplayPolicy.PURE,
    execute: async (_input, runtime) => {
      if (runtime.signal.aborted) {
        observedAbort = true;
        throw Object.assign(new Error("aborted"), { code: "EXECUTION_ABORTED" });
      }
      await new Promise((_resolve, reject) => {
        runtime.signal.addEventListener("abort", () => {
          observedAbort = true;
          reject(Object.assign(new Error("aborted"), { code: "EXECUTION_ABORTED" }));
        }, { once: true });
      });
      throw new Error("unreachable");
    }
  });
  const handle = await fixture.manager.capability("w.task").execute({ id: "p" }, { callId: "call-1" });
  await pollFor("journal dispatched", async () =>
    (await fixture.journal.get(fixture.effectOperationId("p")))?.status === EffectOperationStatus.DISPATCHED);
  const cancelling = await fixture.manager.cancel(handle.operationId, { reason: "superseded" });
  assert.equal(cancelling.status, DetachedOperationStatus.CANCEL_REQUESTED);
  const terminal = await handle.done;
  assert.equal(terminal.status, DetachedOperationStatus.CANCELLED);
  assert.equal(observedAbort, true);
  assert.notEqual((await fixture.journal.get(fixture.effectOperationId("p"))).status, EffectOperationStatus.CONFIRMED);
});

test("non-cooperating abort keeps cancel requested and confirmed work still wins", async () => {
  const gate = deferred();
  const fixture = managerFixture({
    scopeId: "cancel-noncooperating",
    replayPolicy: EffectReplayPolicy.PURE,
    execute: async (value) => {
      await gate.promise;
      return { finished: value.id };
    }
  });
  const handle = await fixture.manager.capability("w.task").execute({ id: "n" }, { callId: "call-1" });
  await pollFor("journal dispatched", async () =>
    (await fixture.journal.get(fixture.effectOperationId("n")))?.status === EffectOperationStatus.DISPATCHED);
  const cancelling = await fixture.manager.cancel(handle.operationId, { reason: "stop" });
  // A non-cooperating processor cannot be relabelled CANCELLED by the abort
  // request alone while its attempt is still capable of committing later.
  assert.equal(cancelling.status, DetachedOperationStatus.CANCEL_REQUESTED);
  await flush(10);
  assert.equal((await fixture.manager.read(handle.operationId)).status, DetachedOperationStatus.CANCEL_REQUESTED);
  gate.resolve();
  const terminal = await handle.done;
  assert.equal(terminal.status, DetachedOperationStatus.SUCCEEDED);
  assert.deepEqual(terminal.result, { finished: "n" });
  const transitions = (await fixture.store.transitions()).map((item) => item.status);
  assert.ok(!transitions.includes(DetachedOperationStatus.CANCELLED));
});

test("idempotent cancellation after dispatch waits for the in-flight attempt", async () => {
  // (a) Cancel while in flight keeps CANCEL_REQUESTED; the confirmed attempt
  // then wins as SUCCEEDED with exactly one dispatch.
  {
    const gate = deferred();
    const fixture = managerFixture({
      scopeId: "cancel-idem-race",
      replayPolicy: EffectReplayPolicy.IDEMPOTENT,
      execute: async (value) => {
        await gate.promise;
        return { done: value.id };
      }
    });
    const handle = await fixture.manager.capability("w.task").execute({ id: "a" }, { callId: "call-1" });
    await pollFor("journal dispatched", async () =>
      (await fixture.journal.get(fixture.effectOperationId("a")))?.status === EffectOperationStatus.DISPATCHED);
    const cancelling = await fixture.manager.cancel(handle.operationId, { reason: "stop" });
    assert.equal(cancelling.status, DetachedOperationStatus.CANCEL_REQUESTED);
    gate.resolve();
    const terminal = await handle.done;
    assert.equal(terminal.status, DetachedOperationStatus.SUCCEEDED);
    assert.deepEqual(terminal.result, { done: "a" });
    assert.equal((await fixture.journal.get(fixture.effectOperationId("a"))).status, EffectOperationStatus.CONFIRMED);
    assert.equal(fixture.dispatches(), 1);
  }

  // (b) Cancel while in flight; the attempt then fails without confirming, so
  // the operation converges UNKNOWN rather than guessing cancellation.
  {
    const gate = deferred();
    const fixture = managerFixture({
      scopeId: "cancel-idem-fail",
      replayPolicy: EffectReplayPolicy.IDEMPOTENT,
      execute: async () => {
        await gate.promise;
        throw new Error("response lost after dispatch");
      }
    });
    const handle = await fixture.manager.capability("w.task").execute({ id: "b" }, { callId: "call-1" });
    await pollFor("journal dispatched", async () =>
      (await fixture.journal.get(fixture.effectOperationId("b")))?.status === EffectOperationStatus.DISPATCHED);
    const cancelling = await fixture.manager.cancel(handle.operationId, { reason: "stop" });
    assert.equal(cancelling.status, DetachedOperationStatus.CANCEL_REQUESTED);
    gate.resolve();
    const terminal = await handle.done;
    assert.equal(terminal.status, DetachedOperationStatus.UNKNOWN);
    assert.equal(terminal.result, null);
    assert.notEqual((await fixture.journal.get(fixture.effectOperationId("b"))).status, EffectOperationStatus.CONFIRMED);
    assert.equal(fixture.dispatches(), 1);
  }

  // (c) Cancel with journal DISPATCHED and no live attempt (fresh manager on
  // the same store/journal, as after a restart) converges UNKNOWN at once.
  {
    const fixture = managerFixture({
      scopeId: "cancel-idem-restart",
      replayPolicy: EffectReplayPolicy.IDEMPOTENT,
      execute: async () => { throw new Error("must not dispatch"); }
    });
    const input = { id: "c" };
    await seedJournal(fixture.journal, {
      capability: "w.task",
      replayPolicy: EffectReplayPolicy.IDEMPOTENT,
      input,
      effectOperationId: fixture.effectOperationId("c"),
      state: "DISPATCHED"
    });
    const binding = craftBinding({
      scopeId: "cancel-idem-restart",
      capability: "w.task",
      input,
      effectOperationId: fixture.effectOperationId("c"),
      replayPolicy: EffectReplayPolicy.IDEMPOTENT
    });
    await fixture.store.create(binding);
    const restarted = createDetachedOperationManager({
      store: fixture.store,
      effectBindings: { "w.task": { capability: fixture.capability, journal: fixture.journal } }
    });
    const cancelled = await restarted.cancel(binding.operationId, { reason: "stop" });
    assert.equal(cancelled.status, DetachedOperationStatus.UNKNOWN);
    assert.equal(cancelled.result, null);
    assert.equal(fixture.dispatches(), 0);
    assert.notEqual((await fixture.journal.get(fixture.effectOperationId("c"))).status, EffectOperationStatus.CONFIRMED);
  }
});

test("non-reconcilable cancellation after dispatch escalates unknown", async () => {
  const fixture = managerFixture({
    scopeId: "cancel-nonreconcilable",
    replayPolicy: EffectReplayPolicy.NON_RECONCILABLE,
    execute: async () => { throw new Error("must not execute"); }
  });
  const input = { id: "nr" };
  await seedJournal(fixture.journal, {
    capability: "w.task",
    replayPolicy: EffectReplayPolicy.NON_RECONCILABLE,
    input,
    effectOperationId: fixture.effectOperationId("nr"),
    state: "DISPATCHED"
  });
  const binding = craftBinding({
    scopeId: "cancel-nonreconcilable",
    capability: "w.task",
    input,
    effectOperationId: fixture.effectOperationId("nr"),
    replayPolicy: EffectReplayPolicy.NON_RECONCILABLE
  });
  await fixture.store.create(binding);
  const cancelled = await fixture.manager.cancel(binding.operationId, { reason: "stop" });
  assert.equal(cancelled.status, DetachedOperationStatus.UNKNOWN);
  assert.equal(fixture.dispatches(), 0);
});

test("non-reconcilable cancellation waits for the in-flight attempt, then escalates or confirms", async () => {
  // Cancel while in flight keeps CANCEL_REQUESTED; a confirming attempt still
  // wins as SUCCEEDED because confirmation outranks cancellation.
  {
    const gate = deferred();
    const fixture = managerFixture({
      scopeId: "cancel-nr-race",
      replayPolicy: EffectReplayPolicy.NON_RECONCILABLE,
      execute: async (value) => {
        await gate.promise;
        return { done: value.id };
      }
    });
    const handle = await fixture.manager.capability("w.task").execute({ id: "r" }, { callId: "call-1" });
    await pollFor("journal dispatched", async () =>
      (await fixture.journal.get(fixture.effectOperationId("r")))?.status === EffectOperationStatus.DISPATCHED);
    const cancelling = await fixture.manager.cancel(handle.operationId, { reason: "stop" });
    assert.equal(cancelling.status, DetachedOperationStatus.CANCEL_REQUESTED);
    gate.resolve();
    const terminal = await handle.done;
    assert.equal(terminal.status, DetachedOperationStatus.SUCCEEDED);
    assert.deepEqual(terminal.result, { done: "r" });
    assert.equal(fixture.dispatches(), 1);
  }

  // A failing in-flight attempt escalates UNKNOWN without a second dispatch.
  {
    const gate = deferred();
    const fixture = managerFixture({
      scopeId: "cancel-nr-fail",
      replayPolicy: EffectReplayPolicy.NON_RECONCILABLE,
      execute: async () => {
        await gate.promise;
        throw new Error("ambiguous external outcome");
      }
    });
    const handle = await fixture.manager.capability("w.task").execute({ id: "f" }, { callId: "call-1" });
    await pollFor("journal dispatched", async () =>
      (await fixture.journal.get(fixture.effectOperationId("f")))?.status === EffectOperationStatus.DISPATCHED);
    const cancelling = await fixture.manager.cancel(handle.operationId, { reason: "stop" });
    assert.equal(cancelling.status, DetachedOperationStatus.CANCEL_REQUESTED);
    gate.resolve();
    const terminal = await handle.done;
    assert.equal(terminal.status, DetachedOperationStatus.UNKNOWN);
    assert.equal(fixture.dispatches(), 1);
  }
});

test("observable cancellation resolves only from settled plus observed truth", async () => {
  async function observableFixture(scopeId, external) {
    return managerFixture({
      scopeId,
      replayPolicy: EffectReplayPolicy.OBSERVABLE,
      observe: async ({ operation }) => {
        const actual = external.get(operation.input.id) ?? null;
        return {
          satisfied: actual?.value === operation.desiredEffect?.value,
          result: actual,
          evidence: { source: "remote-read", actual }
        };
      },
      desiredEffect: ({ input }) => ({ id: input.id, value: input.id === "f" ? 1 : 7 }),
      execute: async () => { throw new Error("must not execute"); }
    });
  }

  // Satisfied observation converges SUCCEEDED with the observed result.
  {
    const external = new Map([["s", { id: "s", value: 7 }]]);
    const fixture = await observableFixture("cancel-obs-sat", external);
    const input = { id: "s" };
    await seedJournal(fixture.journal, {
      capability: "w.task",
      replayPolicy: EffectReplayPolicy.OBSERVABLE,
      input,
      effectOperationId: fixture.effectOperationId("s"),
      state: "UNKNOWN",
      desiredEffect: { id: "s", value: 7 }
    });
    const binding = craftBinding({
      scopeId: "cancel-obs-sat",
      capability: "w.task",
      input,
      effectOperationId: fixture.effectOperationId("s"),
      replayPolicy: EffectReplayPolicy.OBSERVABLE
    });
    await fixture.store.create(binding);
    const settled = await fixture.manager.cancel(binding.operationId, { reason: "stop" });
    assert.equal(settled.status, DetachedOperationStatus.SUCCEEDED);
    assert.deepEqual(settled.result, { id: "s", value: 7 });
    assert.equal(fixture.dispatches(), 0);
  }

  // Unsatisfied observation with a proven-settled attempt converges CANCELLED.
  {
    const external = new Map();
    const fixture = await observableFixture("cancel-obs-absent", external);
    const input = { id: "u" };
    await seedJournal(fixture.journal, {
      capability: "w.task",
      replayPolicy: EffectReplayPolicy.OBSERVABLE,
      input,
      effectOperationId: fixture.effectOperationId("u"),
      state: "UNKNOWN",
      desiredEffect: { id: "u", value: 7 }
    });
    const binding = craftBinding({
      scopeId: "cancel-obs-absent",
      capability: "w.task",
      input,
      effectOperationId: fixture.effectOperationId("u"),
      replayPolicy: EffectReplayPolicy.OBSERVABLE
    });
    await fixture.store.create(binding);
    const settled = await fixture.manager.cancel(binding.operationId, { reason: "stop" });
    assert.equal(settled.status, DetachedOperationStatus.CANCELLED);
    assert.equal(fixture.dispatches(), 0);
  }

  // Observer failure converges UNKNOWN rather than guessing.
  {
    const external = new Map();
    const fixture = managerFixture({
      scopeId: "cancel-obs-error",
      replayPolicy: EffectReplayPolicy.OBSERVABLE,
      observe: async () => { throw new Error("observer unavailable"); },
      execute: async () => { throw new Error("must not execute"); }
    });
    const input = { id: "e" };
    await seedJournal(fixture.journal, {
      capability: "w.task",
      replayPolicy: EffectReplayPolicy.OBSERVABLE,
      input,
      effectOperationId: fixture.effectOperationId("e"),
      state: "DISPATCHED"
    });
    const binding = craftBinding({
      scopeId: "cancel-obs-error",
      capability: "w.task",
      input,
      effectOperationId: fixture.effectOperationId("e"),
      replayPolicy: EffectReplayPolicy.OBSERVABLE
    });
    await fixture.store.create(binding);
    const settled = await fixture.manager.cancel(binding.operationId, { reason: "stop" });
    assert.equal(settled.status, DetachedOperationStatus.UNKNOWN);
    assert.equal(fixture.dispatches(), 0);
  }

  // Unsatisfied observation while the attempt can still commit never reports CANCELLED.
  {
    const gate = deferred();
    const external = new Map();
    const fixture = managerFixture({
      scopeId: "cancel-obs-inflight",
      replayPolicy: EffectReplayPolicy.OBSERVABLE,
      observe: async () => ({ satisfied: false, result: null, evidence: { source: "remote-read" } }),
      execute: async (value) => {
        await gate.promise;
        external.set(value.id, { id: value.id, value: 1 });
        return { id: value.id, value: 1 };
      }
    });
    const handle = await fixture.manager.capability("w.task").execute({ id: "f" }, { callId: "call-1" });
    await pollFor("journal dispatched", async () =>
      (await fixture.journal.get(fixture.effectOperationId("f")))?.status === EffectOperationStatus.DISPATCHED);
    const cancelling = await fixture.manager.cancel(handle.operationId, { reason: "stop" });
    assert.equal(cancelling.status, DetachedOperationStatus.CANCEL_REQUESTED);
    await flush(10);
    assert.equal((await fixture.manager.read(handle.operationId)).status, DetachedOperationStatus.CANCEL_REQUESTED);
    gate.resolve();
    const terminal = await handle.done;
    assert.equal(terminal.status, DetachedOperationStatus.SUCCEEDED);
    const transitions = (await fixture.store.transitions()).map((item) => item.status);
    assert.ok(!transitions.includes(DetachedOperationStatus.CANCELLED));
  }
});

test("confirmed effect wins a racing cancel as succeeded", async () => {
  const fixture = managerFixture({
    scopeId: "cancel-race",
    replayPolicy: EffectReplayPolicy.PURE,
    execute: async (value) => ({ finished: value.id })
  });
  const handle = await fixture.manager.capability("w.task").execute({ id: "r" }, { callId: "call-1" });
  const terminal = await handle.done;
  assert.equal(terminal.status, DetachedOperationStatus.SUCCEEDED);
  const afterCancel = await fixture.manager.cancel(handle.operationId, { reason: "late" });
  assert.equal(afterCancel.status, DetachedOperationStatus.SUCCEEDED);
  assert.deepEqual(afterCancel.result, { finished: "r" });
});

test("recovery with changed replay policy or effect binding fails closed", async () => {
  // Changed replay policy.
  {
    const journal = createInMemoryEffectJournal();
    const capability = defineEffectCapability({
      name: "w.task",
      effect: {
        replayPolicy: EffectReplayPolicy.IDEMPOTENT,
        operationKey: ({ input }) => `w.task:${input.id}`
      },
      async execute() { throw new Error("must not dispatch"); }
    }, { journal });
    const store = createInMemoryDetachedOperationStore({ scopeId: "recover-policy" });
    await store.create(craftBinding({
      scopeId: "recover-policy",
      capability: "w.task",
      input: { id: "p" },
      effectOperationId: "w.task:p",
      replayPolicy: EffectReplayPolicy.PURE
    }));
    const manager = createDetachedOperationManager({ store, effectBindings: { "w.task": { capability, journal } } });
    const [settled] = await manager.recover();
    assert.equal(settled.status, DetachedOperationStatus.UNKNOWN);
  }

  // Changed effect operation binding.
  {
    const journal = createInMemoryEffectJournal();
    const capability = defineEffectCapability({
      name: "w.task",
      effect: {
        replayPolicy: EffectReplayPolicy.PURE,
        operationKey: ({ input }) => `changed:${input.id}`
      },
      async execute() { throw new Error("must not dispatch"); }
    }, { journal });
    const store = createInMemoryDetachedOperationStore({ scopeId: "recover-effect" });
    await store.create(craftBinding({
      scopeId: "recover-effect",
      capability: "w.task",
      input: { id: "p" },
      effectOperationId: "w.task:p",
      replayPolicy: EffectReplayPolicy.PURE
    }));
    const manager = createDetachedOperationManager({ store, effectBindings: { "w.task": { capability, journal } } });
    const [settled] = await manager.recover();
    assert.equal(settled.status, DetachedOperationStatus.UNKNOWN);
  }

  // Unknown capability binding.
  {
    const journal = createInMemoryEffectJournal();
    const other = defineEffectCapability({
      name: "other.task",
      effect: {
        replayPolicy: EffectReplayPolicy.PURE,
        operationKey: ({ input }) => `other.task:${input.id}`
      },
      async execute() { throw new Error("must not dispatch"); }
    }, { journal });
    const store = createInMemoryDetachedOperationStore({ scopeId: "recover-unknown-cap" });
    await store.create(craftBinding({
      scopeId: "recover-unknown-cap",
      capability: "w.task",
      input: { id: "p" },
      effectOperationId: "w.task:p",
      replayPolicy: EffectReplayPolicy.PURE
    }));
    const manager = createDetachedOperationManager({ store, effectBindings: { "other.task": { capability: other, journal } } });
    const [settled] = await manager.recover();
    assert.equal(settled.status, DetachedOperationStatus.UNKNOWN);
  }

  // Tampered call binding: the stored operation id no longer re-derives.
  {
    const fixture = managerFixture({
      scopeId: "recover-tampered",
      replayPolicy: EffectReplayPolicy.PURE,
      execute: async () => { throw new Error("must not dispatch"); }
    });
    const binding = craftBinding({
      scopeId: "recover-tampered",
      capability: "w.task",
      input: { id: "t" },
      effectOperationId: fixture.effectOperationId("t"),
      replayPolicy: EffectReplayPolicy.PURE
    });
    await fixture.store.create({ ...binding, callId: "call-2" });
    const [settled] = await fixture.manager.recover();
    assert.equal(settled.status, DetachedOperationStatus.UNKNOWN);
    assert.equal(fixture.dispatches(), 0);
  }
});

test("scheduler terminal never marks the effect operation confirmed", async () => {
  // A scheduler terminal reached without effect confirmation carries no
  // effect authority: when the effect layer later confirms through its own
  // journal, the scheduler does not adopt or rewrite that truth.
  const fixture = managerFixture({
    scopeId: "inv-terminal-truth",
    replayPolicy: EffectReplayPolicy.IDEMPOTENT,
    execute: async () => { throw new Error("must not dispatch"); }
  });
  const input = { id: "z" };
  await seedJournal(fixture.journal, {
    capability: "w.task",
    replayPolicy: EffectReplayPolicy.IDEMPOTENT,
    input,
    effectOperationId: fixture.effectOperationId("z"),
    state: "DISPATCHED"
  });
  const binding = craftBinding({
    scopeId: "inv-terminal-truth",
    capability: "w.task",
    input,
    effectOperationId: fixture.effectOperationId("z"),
    replayPolicy: EffectReplayPolicy.IDEMPOTENT
  });
  await fixture.store.create(binding);
  const restarted = createDetachedOperationManager({
    store: fixture.store,
    effectBindings: { "w.task": { capability: fixture.capability, journal: fixture.journal } }
  });
  const cancelled = await restarted.cancel(binding.operationId, { reason: "stop" });
  assert.equal(cancelled.status, DetachedOperationStatus.UNKNOWN);
  assert.equal(cancelled.result, null);
  assert.equal((await fixture.journal.get(fixture.effectOperationId("z"))).status, EffectOperationStatus.DISPATCHED);

  // The effect layer confirms later through its own authority only.
  await fixture.journal.markConfirmed(fixture.effectOperationId("z"), { result: { done: "z" } });
  assert.equal((await fixture.journal.get(fixture.effectOperationId("z"))).status, EffectOperationStatus.CONFIRMED);
  const current = await fixture.manager.read(binding.operationId);
  assert.equal(current.status, DetachedOperationStatus.UNKNOWN);
  assert.equal(current.result, null);
  assert.equal(fixture.dispatches(), 0);
});
