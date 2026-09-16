import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  BackendQaWorkflowStage,
  BlackboardStatus,
  createApplicationOrchestrator,
  createDurableBackendQaWorkflow,
  createJsonBlackboardStore,
  defineBackendObjective,
  defineQaObjective
} from "../src/index.js";

function reviewTrustStub() {
  return {
    trustPolicyFor() { return {}; },
    verifySignature() { return false; },
    verifyEvaluatorAuthority() { return false; },
    verifyEvidenceAuthority() { return false; }
  };
}

function backendObjective(id) {
  return defineBackendObjective({
    id,
    task: "Apply one Backend change after resolving the declared repository context.",
    repository: {
      ref: "repo://bb033",
      revision: "rev-1"
    },
    requiredFiles: ["src/server.js"],
    constraints: ["Do not execute without the declared source context."]
  });
}

function qaObjective(id) {
  return defineQaObjective({
    id: `${id}-qa`,
    task: "Verify the accepted Backend revision.",
    requiredArtifactPaths: ["src/server.js"],
    acceptanceCriteria: ["The accepted Backend revision remains verifiable."]
  });
}

function workItem(id) {
  return {
    id,
    work: "Exercise the concrete Backend preparation boundary.",
    status: BlackboardStatus.READY,
    dependsOn: [],
    remainingWork: [],
    blockers: [],
    artifactRefs: [],
    evidenceRefs: [],
    followUpRefs: [],
    reviewRequirements: [],
    reviews: [],
    findings: []
  };
}

function controlledRepository(control) {
  return {
    async readFile({ repositoryRef, revision, path }) {
      if (!control.available) throw new Error("repository unavailable");
      return {
        content: `// ${revision}:${path}\n`,
        sourceRef: `${repositoryRef}@${revision}:${path}`
      };
    }
  };
}

function workerSpies() {
  const calls = { execute: 0, recover: 0 };
  return {
    calls,
    worker: {
      async execute() {
        calls.execute += 1;
        throw new Error("entered Backend execute after successful preflight");
      },
      async recover() {
        calls.recover += 1;
        throw new Error("entered Backend recover after successful preflight");
      }
    }
  };
}

function unusedQaWorker() {
  return {
    async execute() {
      throw new Error("QA is outside the BB-033 preflight regression");
    }
  };
}

function unusedArtifactReader() {
  return {
    async readArtifact() {
      throw new Error("artifact read is outside the BB-033 preflight regression");
    }
  };
}

async function withBoard(item, run) {
  const directory = await mkdtemp(join(tmpdir(), "exharness-bb033-preflight-"));
  try {
    const path = join(directory, "blackboard.json");
    const makeOrchestrator = () => createApplicationOrchestrator({
      store: createJsonBlackboardStore({ path }),
      reviewTrust: reviewTrustStub()
    });
    const orchestrator = makeOrchestrator();
    await orchestrator.seed([item]);
    await run({ orchestrator, makeOrchestrator });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function makeWorkflow({ orchestrator, repositoryReader, backendWorker }) {
  return createDurableBackendQaWorkflow({
    orchestrator,
    repositoryReader,
    artifactReader: unusedArtifactReader(),
    backendWorker,
    qaWorker: unusedQaWorker()
  });
}

test("BB-033 persists normal Backend preflight failure as resumable BLOCKED before Worker execution", async () => {
  const itemId = "BB-033-NORMAL";
  const control = { available: false };
  const spies = workerSpies();

  await withBoard(workItem(itemId), async ({ orchestrator }) => {
    const workflow = makeWorkflow({
      orchestrator,
      repositoryReader: controlledRepository(control),
      backendWorker: spies.worker
    });

    await workflow.initialize({
      itemId,
      owner: "bb033-init",
      backendObjective: backendObjective("bb033-normal"),
      qaObjective: qaObjective("bb033-normal")
    });

    const blocked = await workflow.advance({ itemId, owner: "bb033-run" });
    assert.equal(blocked.stage, BackendQaWorkflowStage.BLOCKED);
    assert.equal(blocked.item.status, BlackboardStatus.BLOCKED);
    assert.equal(blocked.item.checkpoint.stage, BackendQaWorkflowStage.BACKEND_PENDING);
    assert.equal(blocked.item.checkpoint.backendRecoveryRequired, false);
    assert.match(blocked.item.blockers[0], /Backend context preflight failed: .*repository unavailable/);
    assert.deepEqual(spies.calls, { execute: 0, recover: 0 });

    control.available = true;
    await workflow.resume({ itemId });
    await assert.rejects(
      () => workflow.advance({ itemId, owner: "bb033-resumed" }),
      /entered Backend execute after successful preflight/
    );
    assert.deepEqual(spies.calls, { execute: 1, recover: 0 });
  });
});

test("BB-033 preserves recovery-required mode when Oracle is unavailable after interrupted takeover", async () => {
  const itemId = "BB-033-RECOVERY";
  const control = { available: false };
  const spies = workerSpies();

  await withBoard(workItem(itemId), async ({ orchestrator }) => {
    const workflow = makeWorkflow({
      orchestrator,
      repositoryReader: controlledRepository(control),
      backendWorker: spies.worker
    });

    await workflow.initialize({
      itemId,
      owner: "bb033-init",
      backendObjective: backendObjective("bb033-recovery"),
      qaObjective: qaObjective("bb033-recovery")
    });

    await orchestrator.claim({ itemId, owner: "crashed-attempt" });
    const blocked = await workflow.recoverInterrupted({ itemId, owner: "replacement-attempt" });
    assert.equal(blocked.stage, BackendQaWorkflowStage.BLOCKED);
    assert.equal(blocked.item.status, BlackboardStatus.BLOCKED);
    assert.equal(blocked.item.checkpoint.stage, BackendQaWorkflowStage.BACKEND_PENDING);
    assert.equal(blocked.item.checkpoint.backendRecoveryRequired, true);
    assert.match(blocked.item.blockers[0], /Backend context preflight failed: .*repository unavailable/);
    assert.deepEqual(spies.calls, { execute: 0, recover: 0 });

    control.available = true;
    await workflow.resume({ itemId });
    await assert.rejects(
      () => workflow.advance({ itemId, owner: "bb033-resumed-recovery" }),
      /entered Backend recover after successful preflight/
    );
    assert.deepEqual(spies.calls, { execute: 0, recover: 1 });
  });
});
