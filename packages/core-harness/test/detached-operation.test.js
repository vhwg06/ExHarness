import assert from "node:assert/strict";
import test from "node:test";

import {
  createInMemoryDetachedOperationStore,
  createSessionDetachedOperationStore,
  deriveDetachedOperationId,
  DetachedOperationBindingError,
  DetachedOperationStatus,
  isDetachedTerminalStatus
} from "../src/detached-operation-store.js";
import { createDetachedOperationManager as createManager } from "../src/detached-operation.js";
import {
  EffectOperationStatus,
  EffectReplayPolicy,
  createInMemoryEffectJournal,
  defineEffectCapability
} from "../src/effect-reconciliation.js";
import { createInMemorySessionStore } from "../src/store.js";
import { createAgentRuntime, defineCapability } from "../src/agent-runtime.js";

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

function pureFixture({ scopeId, input = { id: "a" }, runtime = { callId: "call-1", turn: { number: 1 } }, execute } = {}) {
  const journal = createInMemoryEffectJournal();
  const capability = defineEffectCapability({
    name: "slow.task",
    effect: {
      replayPolicy: EffectReplayPolicy.PURE,
      operationKey: ({ input: value }) => `slow:${value.id}`
    },
    async execute(value, executionRuntime) {
      return execute(value, executionRuntime);
    }
  }, { journal });
  const store = createInMemoryDetachedOperationStore({ scopeId });
  const manager = createManager({ store, effectBindings: { "slow.task": { capability, journal } } });
  return { journal, capability, store, manager, input, runtime };
}

test("detached handle returns before effect completion and unrelated work proceeds", async () => {
  const gate = deferred();
  let completed = false;
  const events = [];
  const { journal, store, manager, input, runtime } = pureFixture({
    scopeId: "detach-core",
    execute: async (value) => {
      await gate.promise;
      completed = value.id === "a" ? true : completed;
      events.push(`slow-effect:${value.id}`);
      return { ok: true, id: value.id };
    }
  });
  const detached = manager.capability("slow.task");

  const handle = await detached.execute(input, runtime);
  assert.equal(handle.status, DetachedOperationStatus.RUNNING);
  assert.equal(handle.generation, 1);
  assert.equal(handle.capability, "slow.task");
  assert.equal(handle.effectOperationId, "slow:a");
  assert.equal(completed, false);

  const stored = await store.read(handle.operationId);
  assert.equal(stored.status, DetachedOperationStatus.RUNNING);
  assert.equal(stored.effectOperationId, "slow:a");
  assert.equal(stored.generation, 1);

  // Unrelated synchronous work and a second detached operation proceed first.
  events.push("unrelated-sync");
  const fast = await detached.execute({ id: "b" }, { callId: "call-2", turn: { number: 1 } });
  assert.notEqual(fast.operationId, handle.operationId);
  // Second schedule attaches to its own record; release only the first gate.
  gate.resolve();
  const terminal = await handle.done;
  assert.equal(terminal.status, DetachedOperationStatus.SUCCEEDED);
  assert.deepEqual(terminal.result, { ok: true, id: "a" });
  assert.equal(completed, true);
  assert.equal(events[0], "unrelated-sync");
  assert.equal(events.filter((item) => item === "slow-effect:a").length, 1);
  assert.equal((await journal.get("slow:a")).status, EffectOperationStatus.CONFIRMED);

  // Exactly one immutable terminal record/transition despite repeated reads.
  const reread = await manager.read(handle.operationId);
  assert.equal(reread.status, DetachedOperationStatus.SUCCEEDED);
  assert.deepEqual(reread.result, { ok: true, id: "a" });
  const transitions = await manager.transitions();
  const forOperation = transitions.filter((item) => item.operationId === handle.operationId);
  assert.equal(forOperation.length, 2);
  assert.deepEqual(forOperation.map((item) => item.status), ["RUNNING", "SUCCEEDED"]);
  await fast.done;
});

test("transition envelopes are monotonic with deterministic transition ids", async () => {
  async function runScenario(scopeId) {
    const { manager } = pureFixture({
      scopeId,
      execute: async (value) => ({ ok: true, id: value.id })
    });
    const first = await manager.capability("slow.task").execute({ id: "a" }, { callId: "call-1" });
    await first.done;
    return manager.transitions();
  }
  const left = await runScenario("detach-events");
  const right = await runScenario("detach-events");
  assert.ok(left.length >= 2);
  const sequences = left.map((item) => item.sequence);
  assert.deepEqual(sequences, [...sequences].sort((a, b) => a - b));
  assert.equal(new Set(sequences).size, sequences.length);
  for (let index = 1; index < left.length; index += 1) {
    assert.equal(left[index].sequence, left[index - 1].sequence + 1);
  }
  // Deterministic: the same durable history re-derives identical ids.
  assert.deepEqual(left.map((item) => item.transitionId), right.map((item) => item.transitionId));
  for (const envelope of left) {
    assert.match(envelope.transitionId, new RegExp(`^${envelope.operationId}:g${envelope.generation}:s${envelope.sequence}:${envelope.status}$`));
  }
});

test("repeated operation-update delivery deduplicates by transition id", async () => {
  const { manager } = pureFixture({
    scopeId: "detach-dedupe",
    execute: async (value) => ({ ok: true, id: value.id })
  });
  const seen = new Set();
  let applications = 0;
  function consume(envelope) {
    if (seen.has(envelope.transitionId)) return false;
    seen.add(envelope.transitionId);
    applications += 1;
    return true;
  }
  const received = [];
  const unsubscribe = manager.subscribe((envelope) => {
    received.push(envelope);
    consume(envelope);
    // At-least-once transport may redeliver the same envelope.
    consume(envelope);
  });
  try {
    const handle = await manager.capability("slow.task").execute({ id: "a" }, { callId: "call-1" });
    await handle.done;
    await flush();
  } finally {
    unsubscribe();
  }
  assert.ok(received.length >= 2);
  assert.equal(applications, received.length);
  assert.equal(applications, (await manager.transitions()).length);
  const terminalCount = (await manager.transitions()).filter((item) =>
    [DetachedOperationStatus.SUCCEEDED, DetachedOperationStatus.FAILED, DetachedOperationStatus.CANCELLED, DetachedOperationStatus.UNKNOWN].includes(item.status)).length;
  assert.equal(terminalCount, 1);
});

test("stale generation completion cannot overwrite current terminal state", async () => {
  const store = createInMemoryDetachedOperationStore({ scopeId: "detach-stale" });
  const created = await store.create({
    operationId: "op-stale",
    scopeId: "detach-stale",
    capability: "slow.task",
    inputDigest: "digest",
    input: { id: "a" },
    effectOperationId: "slow:a",
    replayPolicy: EffectReplayPolicy.PURE,
    callId: "call-1",
    protocolVersion: 1
  });
  assert.equal(created.record.generation, 1);
  const takeover = await store.takeover("op-stale");
  assert.equal(takeover.tookOver, true);
  assert.equal(takeover.record.generation, 2);

  const transitionsBefore = await store.transitions();
  const stale = await store.transition("op-stale", {
    to: DetachedOperationStatus.SUCCEEDED,
    generation: 1,
    result: { forged: true }
  });
  assert.equal(stale.applied, false);
  assert.equal(stale.reason, "STALE_GENERATION");
  assert.deepEqual((await store.read("op-stale")).status, DetachedOperationStatus.RUNNING);
  assert.equal((await store.read("op-stale")).generation, 2);
  assert.deepEqual(await store.transitions(), transitionsBefore);

  // The current generation may still converge authoritatively exactly once.
  const current = await store.transition("op-stale", {
    to: DetachedOperationStatus.SUCCEEDED,
    generation: 2,
    result: { ok: true }
  });
  assert.equal(current.applied, true);
  const replay = await store.transition("op-stale", {
    to: DetachedOperationStatus.CANCELLED,
    generation: 2
  });
  assert.equal(replay.applied, false);
  assert.equal(replay.reason, "TERMINAL_IMMUTABLE");
  assert.deepEqual((await store.read("op-stale")).result, { ok: true });
  const authoritative = (await store.transitions()).filter((item) => item.operationId === "op-stale" && item.status === DetachedOperationStatus.SUCCEEDED);
  assert.equal(authoritative.length, 1);
});

test("concurrent store creation attaches instead of duplicating the operation", async () => {  const store = createInMemoryDetachedOperationStore({ scopeId: "detach-cas" });
  const binding = {
    operationId: "op-cas",
    scopeId: "detach-cas",
    capability: "slow.task",
    inputDigest: "digest",
    input: { id: "a" },
    effectOperationId: "slow:a",
    replayPolicy: EffectReplayPolicy.PURE,
    callId: "call-1",
    protocolVersion: 1
  };
  const [left, right] = await Promise.all([store.create(binding), store.create(binding)]);
  assert.equal(left.record.operationId, "op-cas");
  assert.equal(right.record.operationId, "op-cas");
  assert.equal((await store.list()).length, 1);
  assert.equal((await store.transitions()).filter((item) => item.status === DetachedOperationStatus.RUNNING).length, 1);
});

test("operation id reuses fail closed on binding mismatch", async () => {
  const store = createInMemoryDetachedOperationStore({ scopeId: "detach-bind" });
  const base = {
    operationId: "op-bind",
    scopeId: "detach-bind",
    capability: "slow.task",
    inputDigest: "digest-a",
    input: { id: "a" },
    effectOperationId: "slow:a",
    replayPolicy: EffectReplayPolicy.PURE,
    callId: "call-1",
    turn: { number: 1 },
    protocolVersion: 1
  };
  await store.create(base);
  const variants = [
    { ...base, capability: "other.task" },
    { ...base, inputDigest: "digest-b", input: { id: "b" } },
    { ...base, effectOperationId: "slow:b" },
    { ...base, replayPolicy: EffectReplayPolicy.IDEMPOTENT },
    { ...base, callId: "call-2" },
    { ...base, turn: { number: 2 } },
    { ...base, actionIntentRef: { id: "intent-1" } }
  ];
  for (const variant of variants) {
    await assert.rejects(() => store.create(variant), (error) =>
      error instanceof DetachedOperationBindingError && error.code === "DETACHED_OPERATION_BINDING_MISMATCH");
  }
  assert.deepEqual((await store.read("op-bind")).input, { id: "a" });
});

test("derived operation ids bind exact call identity", async () => {
  const left = deriveDetachedOperationId({
    scopeId: "scope",
    capability: "slow.task",
    effectOperationId: "slow:a",
    inputDigest: "digest",
    callId: "call-1"
  });
  const right = deriveDetachedOperationId({
    scopeId: "scope",
    capability: "slow.task",
    effectOperationId: "slow:a",
    inputDigest: "digest",
    callId: "call-2"
  });
  assert.notEqual(left, right);
  assert.equal(left, deriveDetachedOperationId({
    scopeId: "scope",
    capability: "slow.task",
    effectOperationId: "slow:a",
    inputDigest: "digest",
    callId: "call-1"
  }));
});

test("scheduler success cannot synthesize effect confirmation", async () => {
  const { journal, manager } = pureFixture({
    scopeId: "detach-inv1",
    execute: async (value) => ({ ok: true, id: value.id })
  });
  const handle = await manager.capability("slow.task").execute({ id: "a" }, { callId: "call-1" });
  const terminal = await handle.done;
  assert.equal(terminal.status, DetachedOperationStatus.SUCCEEDED);
  const confirmed = await journal.get("slow:a");
  assert.equal(confirmed.status, EffectOperationStatus.CONFIRMED);
  assert.deepEqual(terminal.result, confirmed.result);
});

test("successful raw return without journal confirmation converges unknown", async () => {
  // A hand-built capability whose execute resolves but never confirms the
  // journal must not mint a scheduler SUCCEEDED: the run fails closed to
  // UNKNOWN and the journal stays unconfirmed.
  const journal = createInMemoryEffectJournal();
  const capability = {
    name: "raw.task",
    effect: {
      replayPolicy: EffectReplayPolicy.PURE,
      operationKey: ({ input }) => `raw:${input.id}`
    },
    async execute(value) {
      return { raw: true, id: value.id };
    }
  };
  const store = createInMemoryDetachedOperationStore({ scopeId: "detach-no-confirm" });
  const manager = createManager({ store, effectBindings: { "raw.task": { capability, journal } } });
  const handle = await manager.capability("raw.task").execute({ id: "a" }, { callId: "call-1" });
  const terminal = await Promise.race([
    handle.done,
    new Promise((_, reject) => setTimeout(() => reject(new Error("handle.done never resolved")), 2000))
  ]);
  assert.equal(terminal.status, DetachedOperationStatus.UNKNOWN);
  assert.equal(terminal.result, null);
  assert.equal(terminal.evidence?.escalation, "success-without-confirm");
  assert.equal(await journal.get("raw:a").then((record) => record?.status ?? "ABSENT"), "ABSENT");
});

test("scheduler failure leaves the effect journal unconfirmed", async () => {
  const inner = createInMemoryEffectJournal();
  await inner.intend({ operationId: "fail:1", capability: "fail.task", replayPolicy: EffectReplayPolicy.PURE, input: { id: 1 } });
  const journal = Object.freeze({
    ...inner,
    async markDispatched() {
      throw new Error("journal disk fault before dispatch");
    }
  });
  const capability = defineEffectCapability({
    name: "fail.task",
    effect: {
      replayPolicy: EffectReplayPolicy.PURE,
      operationKey: () => "fail:1"
    },
    async execute() {
      return { never: true };
    }
  }, { journal });
  const store = createInMemoryDetachedOperationStore({ scopeId: "detach-failed" });
  const manager = createManager({ store, effectBindings: { "fail.task": { capability, journal } } });
  const handle = await manager.capability("fail.task").execute({ id: 1 }, { callId: "call-1" });
  const terminal = await handle.done;
  assert.equal(terminal.status, DetachedOperationStatus.FAILED);
  assert.equal(isDetachedTerminalStatus(terminal.status), true);
  const journalRecord = await inner.get("fail:1");
  assert.notEqual(journalRecord.status, EffectOperationStatus.CONFIRMED);
  assert.equal(journalRecord.status, EffectOperationStatus.INTENDED);
});

test("unwrapped synchronous capabilities coexist unchanged with detached wrappers", async () => {
  const journal = createInMemoryEffectJournal();
  let slowExecutions = 0;
  const slow = defineEffectCapability({
    name: "slow.task",
    effect: {
      replayPolicy: EffectReplayPolicy.PURE,
      operationKey: ({ input }) => `slow:${input.id}`
    },
    async execute(value) {
      slowExecutions += 1;
      await flush(10);
      return { ok: true, id: value.id };
    }
  }, { journal });
  const store = createInMemoryDetachedOperationStore({ scopeId: "detach-mixed" });
  const manager = createManager({ store, effectBindings: { "slow.task": { capability: slow, journal } } });
  const fast = defineCapability({
    name: "fast.add",
    async execute(input) {
      return { sum: input.a + input.b };
    }
  });
  const runtime = createAgentRuntime({
    strategy: {
      async run({ invoke }) {
        const sync = await invoke("fast.add", { a: 2, b: 3 });
        const handle = await invoke("slow.task", { id: "m" });
        return { sync, handle };
      }
    },
    capabilities: [fast, manager.capability("slow.task")]
  });
  const { sync, handle } = await runtime.run();
  assert.deepEqual(sync, { sum: 5 });
  assert.equal(handle.status, DetachedOperationStatus.RUNNING);
  assert.equal(typeof handle.operationId, "string");
  const terminal = await handle.done;
  assert.equal(terminal.status, DetachedOperationStatus.SUCCEEDED);
  assert.deepEqual(terminal.result, { ok: true, id: "m" });
  assert.equal(slowExecutions, 1);
  assert.equal((await journal.get("slow:m")).status, EffectOperationStatus.CONFIRMED);
  assert.equal((await store.list()).length, 1);

  // Installing the manager changes nothing for a runtime without wrappers.
  const plain = createAgentRuntime({
    strategy: {
      async run({ invoke }) {
        return invoke("fast.add", { a: 2, b: 3 });
      }
    },
    capabilities: [fast]
  });
  assert.deepEqual(await plain.run(), { sum: 5 });
});

// A session store wrapper that forces genuine STORE_CONFLICTs: before the
// next `shots` saves it persists a shape-preserving foreign touch to the same
// document first, so the caller's save hits a real revision conflict caused
// by another writer rather than by its own operation.
function foreignConflictSessionStore() {
  const base = createInMemorySessionStore();
  let remaining = 0;
  return {
    supportsRevisions: true,
    arm(shots = 1) {
      remaining += shots;
    },
    load: (sessionId) => base.load(sessionId),
    async save(session, options) {
      if (remaining > 0) {
        remaining -= 1;
        const current = await base.load(session.id);
        const foreign = current == null
          ? {
              schemaVersion: 2,
              revision: 0,
              id: session.id,
              work: { kind: "FOREIGN_WRITER" },
              persistentMemory: {},
              trajectory: [],
              supervision: {
                inspections: 0,
                skipped: 0,
                interventions: [],
                lastInspectedEventId: null,
                lastDecision: null
              },
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z"
            }
          : structuredClone(current);
        foreign.updatedAt = "2026-01-02T00:00:00.000Z";
        await base.save(foreign, { expectedRevision: foreign.revision ?? 0 });
      }
      return base.save(session, options);
    }
  };
}

function casBinding(operationId, scopeId) {
  return {
    operationId,
    scopeId,
    capability: "slow.task",
    inputDigest: `digest-${operationId}`,
    input: { id: operationId },
    effectOperationId: `slow:${operationId}`,
    replayPolicy: EffectReplayPolicy.PURE,
    callId: "call-1",
    protocolVersion: 1
  };
}

test("store transition survives a conflict caused by another operation write", async () => {
  const sessionStore = foreignConflictSessionStore();
  const store = createSessionDetachedOperationStore({ sessionStore, scopeId: "cas-transition" });
  await store.create(casBinding("op-t", "cas-transition"));
  sessionStore.arm(1);
  const outcome = await store.transition("op-t", {
    to: DetachedOperationStatus.SUCCEEDED,
    generation: 1,
    result: { ok: true }
  });
  assert.equal(outcome.applied, true);
  const current = await store.read("op-t");
  assert.equal(current.status, DetachedOperationStatus.SUCCEEDED);
  assert.deepEqual(current.result, { ok: true });
});

test("store creation survives a conflict caused by another operation write", async () => {
  const sessionStore = foreignConflictSessionStore();
  const store = createSessionDetachedOperationStore({ sessionStore, scopeId: "cas-create" });
  sessionStore.arm(1);
  const created = await store.create(casBinding("op-c", "cas-create"));
  assert.equal(created.record.status, DetachedOperationStatus.RUNNING);
  assert.equal(created.attached, false);
  assert.ok(created.transition != null);
  assert.equal((await store.read("op-c")).status, DetachedOperationStatus.RUNNING);
});

test("store diagnostic survives a conflict caused by another operation write", async () => {
  const sessionStore = foreignConflictSessionStore();
  const store = createSessionDetachedOperationStore({ sessionStore, scopeId: "cas-diag" });
  await store.create(casBinding("op-d", "cas-diag"));
  sessionStore.arm(1);
  const record = await store.noteDiagnostic("op-d", { kind: "probe-note" });
  assert.equal(record.diagnostics.length, 1);
  assert.deepEqual(record.diagnostics[0].note, { kind: "probe-note" });
  assert.equal((await store.read("op-d")).diagnostics.length, 1);
});

test("store takeover survives a conflict caused by another operation write", async () => {
  const sessionStore = foreignConflictSessionStore();
  const store = createSessionDetachedOperationStore({ sessionStore, scopeId: "cas-takeover" });
  await store.create(casBinding("op-k", "cas-takeover"));
  sessionStore.arm(1);
  const takeover = await store.takeover("op-k");
  assert.equal(takeover.tookOver, true);
  assert.equal(takeover.record.generation, 2);
  assert.equal((await store.read("op-k")).generation, 2);
});

test("exhausted conflict retries fail loudly instead of silently winning", async () => {
  const base = createInMemorySessionStore();
  const alwaysConflict = {
    supportsRevisions: true,
    load: (sessionId) => base.load(sessionId),
    async save(session, options) {
      const current = await base.load(session.id);
      if (current != null) {
        const foreign = structuredClone(current);
        await base.save(foreign, { expectedRevision: options?.expectedRevision ?? foreign.revision ?? 0 });
      }
      return base.save(session, options);
    }
  };
  const store = createSessionDetachedOperationStore({ sessionStore: alwaysConflict, scopeId: "cas-loud" });
  await store.create(casBinding("op-l", "cas-loud"));
  await assert.rejects(
    () => store.transition("op-l", { to: DetachedOperationStatus.SUCCEEDED, generation: 1 }),
    (error) => error?.code === "STORE_CONFLICT"
  );
});

test("two operations in one scope run and terminate concurrently", async () => {
  const sessionStore = foreignConflictSessionStore();
  const store = createSessionDetachedOperationStore({ sessionStore, scopeId: "cas-two-ops" });
  const journal = createInMemoryEffectJournal();
  function capabilityFor(name) {
    return defineEffectCapability({
      name,
      effect: {
        replayPolicy: EffectReplayPolicy.PURE,
        operationKey: ({ input }) => `${name}:${input.id}`
      },
      async execute(value) {
        await flush(3);
        return { done: `${name}:${value.id}` };
      }
    }, { journal });
  }
  const one = capabilityFor("one.task");
  const two = capabilityFor("two.task");
  const manager = createManager({ store, effectBindings: { "one.task": { capability: one, journal }, "two.task": { capability: two, journal } } });
  sessionStore.arm(4);
  const [first, second] = await Promise.all([
    manager.capability("one.task").execute({ id: "1" }, { callId: "call-1" }),
    manager.capability("two.task").execute({ id: "2" }, { callId: "call-2" })
  ]);
  assert.notEqual(first.operationId, second.operationId);
  const [terminalOne, terminalTwo] = await Promise.all([first.done, second.done]);
  assert.equal(terminalOne.status, DetachedOperationStatus.SUCCEEDED);
  assert.deepEqual(terminalOne.result, { done: "one.task:1" });
  assert.equal(terminalTwo.status, DetachedOperationStatus.SUCCEEDED);
  assert.deepEqual(terminalTwo.result, { done: "two.task:2" });
  assert.equal((await journal.get("one.task:1")).status, EffectOperationStatus.CONFIRMED);
  assert.equal((await journal.get("two.task:2")).status, EffectOperationStatus.CONFIRMED);
});
