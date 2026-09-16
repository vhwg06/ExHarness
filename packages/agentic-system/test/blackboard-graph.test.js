import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  BlackboardDependencyIssueCode,
  BlackboardStatus,
  FollowUpDisposition,
  createApplicationOrchestrator,
  createJsonBlackboardStore,
  defineBlackboardSnapshot,
  diagnoseBlackboardDependencyGraph
} from "../src/index.js";

function item(id, dependsOn = [], overrides = {}) {
  return { id, work: `Work ${id}`, status: BlackboardStatus.READY, dependsOn, ...overrides };
}

function unusedReviewTrust() {
  return {
    trustPolicyFor() { return {}; },
    verifySignature() { return true; },
    verifyEvaluatorAuthority() { return true; },
    verifyEvidenceAuthority() { return true; }
  };
}

async function withStore(run) {
  const directory = await mkdtemp(join(tmpdir(), "exharness-blackboard-graph-"));
  try {
    const path = join(directory, "blackboard.json");
    const store = createJsonBlackboardStore({ path });
    await run({ path, store });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("BB-025 rejects dangling, self and cyclic dependencies with item/edge diagnostics", () => {
  assert.throws(() => defineBlackboardSnapshot({ version: 1, items: [item("A", ["MISSING"])] }), /DANGLING_DEPENDENCY A -> MISSING/);
  assert.throws(() => defineBlackboardSnapshot({ version: 1, items: [item("A", ["A"])] }), /SELF_DEPENDENCY A -> A/);
  assert.throws(
    () => defineBlackboardSnapshot({ version: 1, items: [item("A", ["B"]), item("B", ["A"])] }),
    /CYCLIC_DEPENDENCY B -> A \(cycle: A -> B -> A\)/
  );

  assert.deepEqual(diagnoseBlackboardDependencyGraph({
    version: 1,
    items: [item("A", ["MISSING"]), item("B", ["B"])]
  }), [
    { code: BlackboardDependencyIssueCode.DANGLING_DEPENDENCY, itemId: "A", dependencyId: "MISSING" },
    { code: BlackboardDependencyIssueCode.SELF_DEPENDENCY, itemId: "B", dependencyId: "B" }
  ]);
});

test("BB-025 accepts unordered DAGs and durable intent-root dependencies", () => {
  const snapshot = defineBlackboardSnapshot({
    version: 1,
    items: [
      item("CHILD", ["INTENT:root", "PARENT"]),
      item("PARENT", ["INTENT:root"], { status: BlackboardStatus.DONE }),
      item("INTENT:root", [], { status: BlackboardStatus.DONE })
    ]
  });
  assert.deepEqual(snapshot.items.map((entry) => entry.id), ["CHILD", "PARENT", "INTENT:root"]);
});

test("BB-025 rejects an invalid transactional mutation before fenced persistence", async () => {
  await withStore(async ({ store }) => {
    await store.transact((snapshot) => { snapshot.items.push(item("A")); });
    await assert.rejects(
      () => store.transact((snapshot) => { snapshot.items.push(item("B", ["MISSING"])); }),
      /DANGLING_DEPENDENCY B -> MISSING/
    );
    assert.deepEqual((await store.load()).items.map((entry) => entry.id), ["A"]);
  });
});

test("BB-025 diagnoses and explicitly repairs a legacy invalid snapshot before normal use", async () => {
  await withStore(async ({ path, store }) => {
    const legacyInvalid = { version: 1, items: [item("A", ["B"]), item("B", ["A"])] };
    await writeFile(path, `${JSON.stringify(legacyInvalid, null, 2)}\n`, "utf8");

    await assert.rejects(() => store.load(), /CYCLIC_DEPENDENCY/);
    const issues = await store.diagnoseDependencyGraph();
    assert.equal(issues.length, 1);
    assert.equal(issues[0].code, BlackboardDependencyIssueCode.CYCLIC_DEPENDENCY);

    const beforeFailedRepair = await readFile(path, "utf8");
    await assert.rejects(
      () => store.repairDependencyGraph({ replacements: [{ itemId: "A", dependsOn: ["MISSING"] }] }),
      /DANGLING_DEPENDENCY A -> MISSING/
    );
    assert.equal(await readFile(path, "utf8"), beforeFailedRepair);

    const repaired = await store.repairDependencyGraph({ replacements: [{ itemId: "A", dependsOn: [] }] });
    assert.deepEqual(repaired.result.replacements, [{ itemId: "A", dependsOn: [] }]);
    const restored = await store.load();
    assert.deepEqual(restored.items.find((entry) => entry.id === "A").dependsOn, []);
    assert.deepEqual(restored.items.find((entry) => entry.id === "B").dependsOn, ["A"]);
  });
});

test("BB-025 validates NEW_WORK reconciliation against the resulting complete graph", async () => {
  await withStore(async ({ store }) => {
    const orchestrator = createApplicationOrchestrator({ store, reviewTrust: unusedReviewTrust() });
    await orchestrator.seed([
      item("PARENT", [], {
        status: BlackboardStatus.PENDING_RECONCILIATION,
        findings: [{
          id: "finding-1",
          summary: "Create grounded follow-up work.",
          sourceRef: "attestation:1",
          reviewKey: "review:1",
          disposition: null,
          targetItemId: null
        }]
      })
    ]);

    await assert.rejects(
      () => orchestrator.reconcileFinding({
        itemId: "PARENT",
        findingId: "finding-1",
        disposition: FollowUpDisposition.NEW_WORK,
        newItem: item("CHILD", ["CHILD"])
      }),
      /SELF_DEPENDENCY CHILD -> CHILD/
    );

    const restored = await orchestrator.readBlackboard();
    assert.equal(restored.items.length, 1);
    assert.equal(restored.items[0].findings[0].disposition, null);
    assert.deepEqual(restored.items[0].followUpRefs, []);
  });
});
