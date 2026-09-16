import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  BlackboardStatus,
  ReviewRequirementSource,
  createApplicationOrchestrator,
  createJsonBlackboardStore
} from "../src/index.js";

function reviewTrust() {
  return {
    trustPolicyFor() {
      return {};
    },
    verifySignature() {
      return true;
    },
    verifyEvaluatorAuthority() {
      return true;
    },
    verifyEvidenceAuthority() {
      return true;
    }
  };
}

function workItem(id, overrides = {}) {
  return {
    id,
    work: `Work ${id}`,
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

function proposedWork(id, work = `Work ${id}`, overrides = {}) {
  return {
    ...workItem(id, { work }),
    origin: {
      rootIntentId: "intent",
      rootItemId: "root",
      parentItemId: "A",
      coordinationProposalRef: "coordination:proposal"
    },
    ...overrides
  };
}

function targetState(item) {
  return {
    itemId: item.id,
    status: item.status,
    claimGeneration: item.claimGeneration,
    reviewGeneration: item.reviewGeneration
  };
}

async function expectedTarget(orchestrator, itemId) {
  const board = await orchestrator.readBlackboard();
  return targetState(board.items.find((item) => item.id === itemId));
}

async function withOrchestrator(run) {
  const directory = await mkdtemp(join(tmpdir(), "exharness-bb021-graph-"));
  try {
    const store = createJsonBlackboardStore({ path: join(directory, "blackboard.json") });
    const orchestrator = createApplicationOrchestrator({ store, reviewTrust: reviewTrust() });
    await orchestrator.seed([workItem("A"), workItem("B"), workItem("C")]);
    await run(orchestrator);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("BB-021 work graph extension is additive, atomic and idempotent for the same proposal", async () => {
  await withOrchestrator(async (orchestrator) => {
    const extension = {
      targetItemId: "A",
      expectedTarget: await expectedTarget(orchestrator, "A"),
      newItems: [proposedWork("N")],
      dependencyEdges: [{ itemId: "A", dependencyId: "N" }],
      artifactRefs: ["coordination:proposal"],
      evidenceRefs: ["evidence:architecture"],
      reviewRequirements: [{
        key: "architecture",
        source: ReviewRequirementSource.PM,
        reason: "coordination:assessment"
      }]
    };

    const first = await orchestrator.extendWorkGraph(extension);
    const second = await orchestrator.extendWorkGraph(extension);
    assert.deepEqual(first.result.createdItemIds, ["N"]);
    assert.deepEqual(second.result.createdItemIds, []);
    assert.deepEqual(second.result.reviewRequirementKeys, ["architecture"]);

    const board = await orchestrator.readBlackboard();
    const a = board.items.find((item) => item.id === "A");
    assert.deepEqual(a.dependsOn, ["N"]);
    assert.deepEqual(a.artifactRefs, ["coordination:proposal"]);
    assert.deepEqual(a.evidenceRefs, ["evidence:architecture"]);
    assert.deepEqual(a.reviewRequirements, [{
      key: "architecture",
      source: ReviewRequirementSource.PM,
      reason: "coordination:assessment"
    }]);
    assert.equal(board.items.filter((item) => item.id === "N").length, 1);
  });
});

test("BB-021 work graph extension rejects unrelated dependency rewrites and preserves prior state", async () => {
  await withOrchestrator(async (orchestrator) => {
    const before = await orchestrator.readBlackboard();
    await assert.rejects(
      () => orchestrator.extendWorkGraph({
        targetItemId: "A",
        expectedTarget: targetState(before.items.find((item) => item.id === "A")),
        dependencyEdges: [{ itemId: "B", dependencyId: "C" }]
      }),
      /cannot rewrite unrelated item B/
    );
    assert.deepEqual(await orchestrator.readBlackboard(), before);
  });
});

test("BB-021 work graph extension rejects cycles and conflicting duplicate work without partial publication", async () => {
  await withOrchestrator(async (orchestrator) => {
    await orchestrator.extendWorkGraph({
      targetItemId: "A",
      expectedTarget: await expectedTarget(orchestrator, "A"),
      dependencyEdges: [{ itemId: "A", dependencyId: "B" }]
    });
    const beforeCycle = await orchestrator.readBlackboard();
    await assert.rejects(
      () => orchestrator.extendWorkGraph({
        targetItemId: "B",
        expectedTarget: targetState(beforeCycle.items.find((item) => item.id === "B")),
        dependencyEdges: [{ itemId: "B", dependencyId: "A" }]
      }),
      /dependency graph invalid after extension/
    );
    assert.deepEqual(await orchestrator.readBlackboard(), beforeCycle);

    await orchestrator.extendWorkGraph({
      targetItemId: "A",
      expectedTarget: await expectedTarget(orchestrator, "A"),
      newItems: [proposedWork("N")]
    });
    const beforeConflict = await orchestrator.readBlackboard();
    await assert.rejects(
      () => orchestrator.extendWorkGraph({
        targetItemId: "A",
        expectedTarget: targetState(beforeConflict.items.find((item) => item.id === "A")),
        newItems: [proposedWork("N", "Conflicting work N")]
      }),
      /conflicts with existing item N/
    );
    assert.deepEqual(await orchestrator.readBlackboard(), beforeConflict);
  });
});

test("BB-021 work graph extension fences a target that changed after proposal validation", async () => {
  await withOrchestrator(async (orchestrator) => {
    const staleExpected = await expectedTarget(orchestrator, "A");
    await orchestrator.extendWorkGraph({
      targetItemId: "A",
      expectedTarget: staleExpected,
      blockers: ["external coordination blocker"]
    });
    const beforeStaleApply = await orchestrator.readBlackboard();

    await assert.rejects(
      () => orchestrator.extendWorkGraph({
        targetItemId: "A",
        expectedTarget: staleExpected,
        artifactRefs: ["coordination:stale"]
      }),
      /lifecycle state changed before work graph extension/
    );
    assert.deepEqual(await orchestrator.readBlackboard(), beforeStaleApply);
  });
});

test("BB-021 work graph extension commits blockers and PM review requirements in one transaction", async () => {
  await withOrchestrator(async (orchestrator) => {
    const result = await orchestrator.extendWorkGraph({
      targetItemId: "A",
      expectedTarget: await expectedTarget(orchestrator, "A"),
      artifactRefs: ["coordination:proposal"],
      blockers: ["artifact unavailable"],
      reviewRequirements: [{
        key: "architecture",
        source: ReviewRequirementSource.PM,
        reason: "coordination:assessment"
      }]
    });

    assert.equal(result.result.target.status, BlackboardStatus.BLOCKED);
    assert.deepEqual(result.result.target.reviewRequirements, [{
      key: "architecture",
      source: ReviewRequirementSource.PM,
      reason: "coordination:assessment"
    }]);

    const board = await orchestrator.readBlackboard();
    const a = board.items.find((item) => item.id === "A");
    assert.deepEqual(a.artifactRefs, ["coordination:proposal"]);
    assert.deepEqual(a.blockers, ["artifact unavailable"]);
    assert.equal(a.status, BlackboardStatus.BLOCKED);
  });
});

test("BB-021 fresh work cannot carry forged lifecycle history", async () => {
  await withOrchestrator(async (orchestrator) => {
    const before = await orchestrator.readBlackboard();
    await assert.rejects(
      () => orchestrator.extendWorkGraph({
        targetItemId: "A",
        expectedTarget: targetState(before.items.find((item) => item.id === "A")),
        newItems: [proposedWork("N", "Work N", { claimGeneration: 7 })]
      }),
      /cannot start with claim generation history/
    );
    assert.deepEqual(await orchestrator.readBlackboard(), before);
  });
});

test("BB-021 work graph extension cannot mutate claimed or superseded targets", async () => {
  await withOrchestrator(async (orchestrator) => {
    await orchestrator.claim({ itemId: "A", owner: "worker" });
    await assert.rejects(
      () => orchestrator.extendWorkGraph({
        targetItemId: "A",
        expectedTarget: await expectedTarget(orchestrator, "A"),
        artifactRefs: ["coordination:x"]
      }),
      /cannot extend its work graph from CLAIMED/
    );

    await orchestrator.supersede({ itemId: "B", reason: "canceled" });
    await assert.rejects(
      () => orchestrator.extendWorkGraph({
        targetItemId: "B",
        expectedTarget: await expectedTarget(orchestrator, "B"),
        artifactRefs: ["coordination:y"]
      }),
      /cannot extend its work graph from SUPERSEDED/
    );
  });
});
