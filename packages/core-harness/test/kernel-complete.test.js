import test from "node:test";
import assert from "node:assert/strict";
import {
  AVOCapability,
  EvaluationValidity,
  EvaluationVerdict,
  ExHarnessErrorCode,
  SearchSignalKind,
  VariationTermination,
  buildSearchHealth,
  createDeterministicClock,
  createDeterministicIdFactory,
  createFakeExecutor,
  createHarness,
  createInMemorySessionStore,
  executeWithPolicy,
  verifyExecutorContract,
  verifySessionStoreContract
} from "../src/index.js";

function makeHarness(strategy, overrides = {}) {
  const clock = overrides.clock ?? createDeterministicClock();
  return createHarness({
    strategy,
    clock,
    idFactory: overrides.idFactory ?? createDeterministicIdFactory("kernel"),
    environment: overrides.environment ?? {
      async observe({ request }) {
        return { request };
      },
      async act({ candidate, action }) {
        if (action?.mutated === false) return { mutated: false, candidate, result: null };
        return {
          mutated: true,
          candidate: { id: candidate.id, version: action.nextVersion },
          result: { applied: action.nextVersion }
        };
      }
    },
    objective: overrides.objective ?? {
      async evaluate() {
        return {
          validity: EvaluationValidity.VALID,
          verdict: EvaluationVerdict.PASS
        };
      }
    },
    supervisor: overrides.supervisor ?? null,
    supervisionPolicy: overrides.supervisionPolicy ?? {},
    recoveryPolicy: overrides.recoveryPolicy ?? {},
    sessionStore: overrides.sessionStore ?? null
  });
}

async function start(harness, sessionId = "s1") {
  return harness.start({
    sessionId,
    work: { objective: "kernel completion" },
    seedCandidate: { id: "candidate", version: "v0" }
  });
}

test("production facade composes AVO + NOOA and emits observable lifecycle", async () => {
  const harness = makeHarness({
    async run({ invoke }) {
      await invoke(AVOCapability.ACT, { nextVersion: "v1" });
      await invoke(AVOCapability.EVALUATE);
      await invoke(AVOCapability.PROMOTE);
      return { finished: true };
    }
  });

  const snapshot = await start(harness);
  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.revision, 1);

  const result = await harness.vary("s1");
  assert.equal(result.lineage.advanced, true);
  assert.equal(result.lineage.after.candidate.version, "v1");

  const types = new Set(harness.events().map((event) => event.type));
  assert.equal(types.has("HARNESS_SESSION_STARTED"), true);
  assert.equal(types.has("AGENT_RUN_STARTED"), true);
  assert.equal(types.has("CAPABILITY_STARTED"), true);
  assert.equal(types.has("HARNESS_VARIATION_COMPLETED"), true);
});

test("interrupted RUNNING variation requires explicit recovery and remains inspectable", async () => {
  const harness = makeHarness({ async run() { return null; } });
  await start(harness);
  const running = await harness.beginVariation("s1", { problem: "simulate crash" });

  await assert.rejects(
    () => harness.resume("s1"),
    (error) => error.code === ExHarnessErrorCode.RECOVERY_REQUIRED
  );

  const recovered = await harness.recover("s1", { force: true });
  assert.equal(recovered.recovered, true);
  assert.equal(recovered.variation.id, running.id);
  assert.equal(recovered.variation.termination, VariationTermination.INTERRUPTED);

  const snapshot = await harness.resume("s1");
  assert.equal(snapshot.id, "s1");
});

test("search health grounds plateau signals in persisted variation history", async () => {
  const harness = makeHarness({ async run() { return "no-op"; } }, {
    supervisionPolicy: { noChangeThreshold: 2 }
  });
  await start(harness);
  await harness.vary("s1");
  await harness.vary("s1");

  const health = await harness.searchHealth("s1");
  assert.equal(health.noChangeStreak, 2);
  assert.equal(health.attentionSuggested, true);
  assert.equal(health.signals.some((signal) => signal.kind === SearchSignalKind.NO_CHANGE_STREAK), true);
});

test("completed no-op variation can trigger a persisted supervisor redirect", async () => {
  const harness = makeHarness({ async run() { return "no-op"; } }, {
    supervisionPolicy: { noChangeThreshold: 1 },
    supervisor: {
      async inspect({ context }) {
        assert.equal(context.searchHealth.attentionSuggested, true);
        return { reason: "plateau", guidance: "change search direction" };
      }
    }
  });
  await start(harness);

  const result = await harness.vary("s1");
  assert.equal(result.trajectoryReview.intervention.reason, "plateau");

  const context = await harness.context("s1");
  assert.equal(context.latestIntervention.reason, "plateau");
  assert.equal(
    harness.events().some((event) => event.type === "SUPERVISOR_REDIRECTED"),
    true
  );
});

test("supervision signal builder does not label a candidate change as a no-change plateau", () => {
  const health = buildSearchHealth({
    currentCandidate: { id: "candidate", version: "v2" },
    persistentMemory: {
      variations: [
        { status: "COMPLETED", outcome: "NO_CHANGE", termination: "RETURNED" },
        { status: "COMPLETED", outcome: "CANDIDATE_CHANGED", termination: "RETURNED" }
      ],
      knowledge: [],
      lineage: [{ candidate: { id: "candidate", version: "v0" } }]
    },
    supervision: { interventions: [] }
  }, { noChangeThreshold: 1 });

  assert.equal(health.noChangeStreak, 0);
  assert.equal(health.signals.some((signal) => signal.kind === SearchSignalKind.NO_CHANGE_STREAK), false);
});

test("in-memory persistence and executor implementations satisfy public contract kits", async () => {
  const storeReport = await verifySessionStoreContract(() => createInMemorySessionStore());
  assert.equal(storeReport.passed, true);

  const executor = createFakeExecutor();
  const executorReport = await verifyExecutorContract(executor);
  assert.equal(executorReport.passed, true);
});

test("execution boundary times out without trusting executor cooperation", async () => {
  const executor = {
    async execute() {
      return new Promise(() => {});
    }
  };

  await assert.rejects(
    () => executeWithPolicy(executor, { action: "hang" }, { policy: { timeoutMs: 5 } }),
    (error) => error.code === ExHarnessErrorCode.EXECUTION_TIMED_OUT
  );
});

test("validated store rejects a future schema before it enters kernel state", async () => {
  const futureStore = {
    supportsRevisions: true,
    async load() {
      return {
        schemaVersion: 999,
        revision: 1,
        id: "future",
        work: {},
        currentCandidate: { id: "candidate", version: "v0" },
        persistentMemory: {},
        trajectory: [],
        supervision: {}
      };
    },
    async save() {
      throw new Error("not expected");
    }
  };
  const harness = makeHarness({ async run() { return null; } }, { sessionStore: futureStore });

  await assert.rejects(
    () => harness.resume("future"),
    (error) => error.code === ExHarnessErrorCode.SCHEMA_UNSUPPORTED
  );
});
