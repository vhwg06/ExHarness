import test from "node:test";
import assert from "node:assert/strict";
import {
  EvaluationValidity,
  EvaluationVerdict,
  ExHarnessErrorCode,
  VariationTermination,
  createDeterministicClock,
  createEventBus,
  createHarness,
  createIdempotentEnvironment,
  createInMemorySessionStore,
  createStateMigrator,
  createValidatedSessionStore,
  environmentActionKey
} from "../src/index.js";

function harnessWith(overrides = {}) {
  return createHarness({
    strategy: overrides.strategy ?? { async run() { return null; } },
    environment: overrides.environment ?? {
      async observe({ request }) { return { request }; },
      async act({ candidate, action }) {
        return {
          mutated: true,
          candidate: { id: candidate.id, version: action.nextVersion }
        };
      }
    },
    objective: {
      async evaluate() {
        return { validity: EvaluationValidity.VALID, verdict: EvaluationVerdict.PASS };
      }
    },
    sessionStore: overrides.sessionStore ?? null,
    eventSinks: overrides.eventSinks ?? [],
    strictObservability: overrides.strictObservability ?? false,
    recoveryPolicy: overrides.recoveryPolicy ?? {},
    clock: overrides.clock
  });
}

async function start(harness, id = "s1") {
  return harness.start({
    sessionId: id,
    work: { objective: "hardening" },
    seedCandidate: { id: "candidate", version: "v0" }
  });
}

test("semantic action key is stable across object key order and changes with candidate/action", () => {
  const left = environmentActionKey({
    sessionId: "s1",
    candidate: { id: "candidate", version: "v1" },
    action: { command: "build", options: { b: 2, a: 1 } }
  });
  const reordered = environmentActionKey({
    sessionId: "s1",
    candidate: { id: "candidate", version: "v1" },
    action: { options: { a: 1, b: 2 }, command: "build" }
  });
  const newerCandidate = environmentActionKey({
    sessionId: "s1",
    candidate: { id: "candidate", version: "v2" },
    action: { command: "build", options: { a: 1, b: 2 } }
  });
  const changedAction = environmentActionKey({
    sessionId: "s1",
    candidate: { id: "candidate", version: "v1" },
    action: { command: "test", options: { a: 1, b: 2 } }
  });

  assert.equal(left, reordered);
  assert.notEqual(left, newerCandidate);
  assert.notEqual(left, changedAction);
});

test("idempotent environment gives retries the same actionKey", async () => {
  const keys = [];
  const environment = createIdempotentEnvironment({
    async observe() { return null; },
    async act({ actionKey }) {
      keys.push(actionKey);
      return { mutated: false, result: "already-applied-or-noop" };
    }
  });
  const input = {
    sessionId: "s1",
    work: {},
    candidate: { id: "candidate", version: "v1" },
    action: { command: "deploy", target: "sandbox" }
  };

  await environment.act(input);
  await environment.act(structuredClone(input));
  assert.equal(keys.length, 2);
  assert.equal(keys[0], keys[1]);
});

test("createHarness passes deterministic actionKey to consumer environment", async () => {
  let received = null;
  const harness = harnessWith({
    strategy: {
      async run({ invoke }) {
        await invoke("avo.act", { nextVersion: "v1", intent: "change" });
      }
    },
    environment: {
      async observe() { return null; },
      async act(input) {
        received = input;
        return {
          mutated: true,
          candidate: { id: input.candidate.id, version: input.action.nextVersion }
        };
      }
    }
  });
  await start(harness);
  await harness.vary("s1");

  assert.equal(typeof received.actionKey, "string");
  assert.equal(received.actionKey.length, 64);
});

test("concurrent stale writes conflict instead of silently losing observations", async () => {
  const harness = harnessWith();
  await start(harness);

  const results = await Promise.allSettled([
    harness.observe("s1", { probe: "left" }),
    harness.observe("s1", { probe: "right" })
  ]);
  const fulfilled = results.filter((item) => item.status === "fulfilled");
  const rejected = results.filter((item) => item.status === "rejected");

  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason.code, ExHarnessErrorCode.STORE_CONFLICT);
  assert.equal((await harness.observations("s1")).length, 1);
});

test("revision-aware store cannot claim compatibility while omitting persisted revision", async () => {
  const raw = {
    supportsRevisions: true,
    async load() { return null; },
    async save() { return null; }
  };
  const store = createValidatedSessionStore(raw);
  await assert.rejects(
    () => store.save({
      schemaVersion: 1,
      revision: 0,
      id: "bad-store",
      work: {},
      currentCandidate: { id: "candidate", version: "v0" },
      persistentMemory: {},
      trajectory: [],
      supervision: {}
    }),
    /must return the persisted revision/
  );
});

test("state migration contract requires every sequential version and preserves explicit result version", async () => {
  const migrator = createStateMigrator({
    targetVersion: 3,
    migrations: [
      {
        fromVersion: 1,
        migrate(state) {
          return { ...state, schemaVersion: 2, migrated1to2: true };
        }
      },
      {
        fromVersion: 2,
        migrate(state) {
          return { ...state, schemaVersion: 3, migrated2to3: true };
        }
      }
    ]
  });

  const result = await migrator.migrate({ schemaVersion: 1, id: "s" });
  assert.equal(result.schemaVersion, 3);
  assert.equal(result.migrated1to2, true);
  assert.equal(result.migrated2to3, true);

  const missing = createStateMigrator({ targetVersion: 3, migrations: [] });
  await assert.rejects(() => missing.migrate({ schemaVersion: 1 }), /missing state migration from version 1/);
});

test("non-strict observability failure is recorded without changing harness correctness", async () => {
  const harness = harnessWith({
    eventSinks: [{
      name: "broken",
      async write() { throw new Error("telemetry down"); }
    }]
  });
  const snapshot = await start(harness);
  assert.equal(snapshot.id, "s1");
  assert.equal(harness.observabilityFailures().length > 0, true);
});

test("strict event bus makes telemetry loss explicit", async () => {
  const bus = createEventBus({
    strict: true,
    sinks: [{ async write() { throw new Error("required telemetry down"); } }]
  });
  await assert.rejects(() => bus.emit("PROBE"), /required telemetry down/);
});

test("non-stale interrupted work cannot be recovered implicitly", async () => {
  const clock = createDeterministicClock({ stepMs: 0 });
  const harness = harnessWith({
    clock,
    recoveryPolicy: { staleAfterMs: 60_000 }
  });
  await start(harness);
  await harness.beginVariation("s1", { problem: "live worker" });

  await assert.rejects(
    () => harness.recover("s1"),
    (error) => error.code === ExHarnessErrorCode.RECOVERY_REQUIRED
  );

  clock.advance(60_000);
  const recovered = await harness.recover("s1");
  assert.equal(recovered.recovered, true);
  assert.equal(recovered.variation.termination, VariationTermination.INTERRUPTED);
});
