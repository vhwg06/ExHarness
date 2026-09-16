import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  BlackboardStatus,
  createApplicationOrchestrator,
  createJsonBlackboardStore,
  defineBlackboardSnapshot
} from "../src/index.js";

function reviewTrust() {
  return {
    trustPolicyFor() { return {}; },
    verifySignature() { return false; },
    verifyEvaluatorAuthority() { return false; },
    verifyEvidenceAuthority() { return false; }
  };
}

function workItem(overrides = {}) {
  return {
    id: "BB-041-TASK",
    work: "Persist one generic checkpoint without semantic loss.",
    status: BlackboardStatus.READY,
    dependsOn: [],
    remainingWork: [],
    blockers: [],
    artifactRefs: [],
    evidenceRefs: [],
    followUpRefs: [],
    reviewRequirements: [],
    reviews: [],
    findings: [],
    ...overrides
  };
}

async function withStore(run) {
  const directory = await mkdtemp(join(tmpdir(), "exharness-blackboard-json-"));
  try {
    await run({ path: join(directory, "blackboard.json") });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function cyclePayload() {
  const value = { label: "cycle" };
  value.self = value;
  return value;
}

function unsupportedCases() {
  return [
    ["Map", { pending: new Map([["experiment-1", "needs-review"]]) }, /checkpoint\.pending: Map is not a plain JSON object/],
    ["Set", { pending: new Set(["experiment-1"]) }, /checkpoint\.pending: Set is not a plain JSON object/],
    ["Date", { startedAt: new Date("2026-09-16T00:00:00.000Z") }, /checkpoint\.startedAt: Date is not a plain JSON object/],
    ["undefined", { request: undefined }, /checkpoint\.request: unsupported undefined value/],
    ["NaN", { score: Number.NaN }, /checkpoint\.score: number must be finite/],
    ["Infinity", { score: Number.POSITIVE_INFINITY }, /checkpoint\.score: number must be finite/],
    ["negative Infinity", { score: Number.NEGATIVE_INFINITY }, /checkpoint\.score: number must be finite/],
    ["negative zero", { score: -0 }, /checkpoint\.score: negative zero is not preserved/],
    ["BigInt", { sequence: 1n }, /checkpoint\.sequence: unsupported bigint value/],
    ["cycle", cyclePayload(), /checkpoint\.self: object graph reuses or cycles to .*checkpoint/]
  ];
}

test("BB-041 rejects lossy checkpoint payloads before releasing ownership or changing durable state", async (t) => {
  for (const [name, checkpoint, expectedError] of unsupportedCases()) {
    await t.test(name, async () => {
      await withStore(async ({ path }) => {
        const store = createJsonBlackboardStore({ path });
        const orchestrator = createApplicationOrchestrator({ store, reviewTrust: reviewTrust() });
        await orchestrator.seed([workItem()]);
        const claimed = await orchestrator.claim({ itemId: "BB-041-TASK", owner: "session-1" });

        await assert.rejects(
          () => orchestrator.checkpoint({
            itemId: "BB-041-TASK",
            owner: "session-1",
            generation: claimed.result.claimGeneration,
            checkpoint
          }),
          expectedError
        );

        const restarted = createApplicationOrchestrator({
          store: createJsonBlackboardStore({ path }),
          reviewTrust: reviewTrust()
        });
        const item = (await restarted.readBlackboard()).items[0];
        assert.equal(item.status, BlackboardStatus.CLAIMED);
        assert.equal(item.owner, "session-1");
        assert.equal(item.checkpoint, null);
        assert.equal(item.checkpointedBy, null);
      });
    });
  }
});

test("BB-041 round-trips acknowledged nested JSON checkpoint state across a new store instance", async () => {
  await withStore(async ({ path }) => {
    const store = createJsonBlackboardStore({ path });
    const orchestrator = createApplicationOrchestrator({ store, reviewTrust: reviewTrust() });
    const checkpoint = {
      experiment: {
        id: "experiment-1",
        score: 0.75,
        passed: false,
        notes: null,
        evidence: [{ id: "ev-1", valid: true }, { id: "ev-2", valid: false }]
      }
    };

    await orchestrator.seed([workItem()]);
    const claimed = await orchestrator.claim({ itemId: "BB-041-TASK", owner: "session-1" });
    const acknowledged = await orchestrator.checkpoint({
      itemId: "BB-041-TASK",
      owner: "session-1",
      generation: claimed.result.claimGeneration,
      checkpoint
    });

    assert.deepEqual(acknowledged.result.checkpoint, checkpoint);
    assert.equal(acknowledged.result.status, BlackboardStatus.REOPENED);

    const restarted = createApplicationOrchestrator({
      store: createJsonBlackboardStore({ path }),
      reviewTrust: reviewTrust()
    });
    const reloaded = await restarted.readBlackboard();
    assert.deepEqual(reloaded.items[0].checkpoint, checkpoint);
    assert.deepEqual(reloaded.items[0].checkpoint, acknowledged.result.checkpoint);
  });
});

test("BB-041 applies the same persisted-value contract to checkpoint, submission and origin payloads", () => {
  assert.throws(
    () => defineBlackboardSnapshot({ version: 1, items: [workItem({ checkpoint: { pending: new Map() } })] }),
    /items\[0\]\.checkpoint\.pending: Map is not a plain JSON object/
  );
  assert.throws(
    () => defineBlackboardSnapshot({ version: 1, items: [workItem({ submission: { score: Number.NaN } })] }),
    /items\[0\]\.submission\.score: number must be finite/
  );
  assert.throws(
    () => defineBlackboardSnapshot({
      version: 1,
      items: [workItem({ origin: { observedAt: new Date("2026-09-16T00:00:00.000Z") } })]
    }),
    /items\[0\]\.origin\.observedAt: Date is not a plain JSON object/
  );
});

test("BB-041 rejects invalid seed and generic transaction payloads without changing the prior snapshot", async () => {
  await withStore(async ({ path }) => {
    const store = createJsonBlackboardStore({ path });
    const orchestrator = createApplicationOrchestrator({ store, reviewTrust: reviewTrust() });

    await assert.rejects(
      () => orchestrator.seed([workItem({ origin: { observedAt: new Date("2026-09-16T00:00:00.000Z") } })]),
      /items\[0\]\.origin\.observedAt: Date is not a plain JSON object/
    );
    assert.deepEqual((await store.load()).items, []);

    await orchestrator.seed([workItem()]);
    const before = await store.load();
    await assert.rejects(
      () => store.transact((snapshot) => { snapshot.items[0].submission = { score: Number.NaN }; }),
      /items\[0\]\.submission\.score: number must be finite/
    );
    assert.deepEqual(await store.load(), before);
  });
});

test("BB-041 rejects sparse arrays and shared object identity that JSON cannot preserve", () => {
  const sparse = [];
  sparse.length = 1;
  assert.throws(
    () => defineBlackboardSnapshot({ version: 1, items: [workItem({ checkpoint: { sparse } })] }),
    /checkpoint\.sparse: sparse arrays or extra array properties are not supported/
  );

  const shared = { evidence: "ev-1" };
  assert.throws(
    () => defineBlackboardSnapshot({ version: 1, items: [workItem({ checkpoint: { first: shared, second: shared } })] }),
    /checkpoint\.second: object graph reuses or cycles to .*checkpoint\.first/
  );
});

test("BB-041 preserves BB-025 graph diagnostics and repair surface through the JSON wrapper", async () => {
  await withStore(async ({ path }) => {
    const store = createJsonBlackboardStore({ path });
    assert.equal(typeof store.diagnoseDependencyGraph, "function");
    assert.equal(typeof store.repairDependencyGraph, "function");
  });
});
