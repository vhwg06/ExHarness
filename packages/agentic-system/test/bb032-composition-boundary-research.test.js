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
  defineQaObjective,
  makeBackendWorkOrder,
  resolveBackendContext
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
      ref: "repo://bb032",
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
    work: "Research the durable Application / Oracle / Core composition boundary.",
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

function unavailableRepository() {
  return {
    async readFile() {
      throw new Error("repository unavailable");
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
        throw new Error("Backend Worker must not execute when context resolution fails");
      },
      async recover() {
        calls.recover += 1;
        throw new Error("Backend Worker recovery must not run when context resolution fails");
      }
    }
  };
}

function unusedQaWorker() {
  return {
    async execute() {
      throw new Error("QA is outside the BB-032 preflight probe");
    }
  };
}

function unusedArtifactReader() {
  return {
    async readArtifact() {
      throw new Error("artifact read is outside the BB-032 preflight probe");
    }
  };
}

async function withBoard(items, run) {
  const directory = await mkdtemp(join(tmpdir(), "exharness-bb032-composition-"));
  try {
    const path = join(directory, "blackboard.json");
    const makeOrchestrator = () => createApplicationOrchestrator({
      store: createJsonBlackboardStore({ path }),
      reviewTrust: reviewTrustStub()
    });
    const orchestrator = makeOrchestrator();
    await orchestrator.seed(items);
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

test("BB-032 baseline leaves a claimed Backend stage when Oracle context resolution fails before Worker execution", async () => {
  const itemId = "BB-032-BASELINE";
  const objective = backendObjective("bb032-baseline");
  const spies = workerSpies();

  await withBoard([workItem(itemId)], async ({ orchestrator }) => {
    const workflow = makeWorkflow({
      orchestrator,
      repositoryReader: unavailableRepository(),
      backendWorker: spies.worker
    });

    await workflow.initialize({
      itemId,
      owner: "bb032-init",
      backendObjective: objective,
      qaObjective: qaObjective("bb032-baseline")
    });

    await assert.rejects(
      () => workflow.advance({ itemId, owner: "bb032-run" }),
      /backend context resolution failed .* repository unavailable/
    );

    const afterFailure = (await orchestrator.readBlackboard()).items.find((item) => item.id === itemId);
    assert.equal(afterFailure.status, BlackboardStatus.CLAIMED);
    assert.equal(afterFailure.checkpoint.stage, BackendQaWorkflowStage.BACKEND_PENDING);
    assert.deepEqual(afterFailure.blockers, []);
    assert.equal(spies.calls.execute, 0, "Oracle failure must occur before Backend Worker execution");
    const firstGeneration = afterFailure.claimGeneration;

    await assert.rejects(
      () => workflow.recoverInterrupted({ itemId, owner: "bb032-recovery" }),
      /backend context resolution failed .* repository unavailable/
    );

    const afterRecoveryAttempt = (await orchestrator.readBlackboard()).items.find((item) => item.id === itemId);
    assert.equal(afterRecoveryAttempt.status, BlackboardStatus.CLAIMED);
    assert.equal(afterRecoveryAttempt.checkpoint.stage, BackendQaWorkflowStage.BACKEND_PENDING);
    assert.deepEqual(afterRecoveryAttempt.blockers, []);
    assert.ok(afterRecoveryAttempt.claimGeneration > firstGeneration, "explicit takeover must still fence the old attempt");
    assert.equal(spies.calls.recover, 0, "Core recovery must not run before required context resolves");
  });
});

test("BB-032 phase-separated Backend preflight prototype persists pre-Worker Oracle failure without claiming Core effect truth", async () => {
  const itemId = "BB-032-CANDIDATE";
  const objective = backendObjective("bb032-candidate");
  const spies = workerSpies();
  const repositoryReader = unavailableRepository();

  await withBoard([workItem(itemId)], async ({ orchestrator }) => {
    const workflow = makeWorkflow({
      orchestrator,
      repositoryReader,
      backendWorker: spies.worker
    });

    await workflow.initialize({
      itemId,
      owner: "bb032-init",
      backendObjective: objective,
      qaObjective: qaObjective("bb032-candidate")
    });

    const claimed = await orchestrator.claim({ itemId, owner: "bb032-preflight" });
    const generation = claimed.result.claimGeneration;
    const checkpoint = claimed.result.checkpoint;
    const order = makeBackendWorkOrder(objective);

    let resolutionError = null;
    try {
      await resolveBackendContext(order, { repositoryReader });
    } catch (error) {
      resolutionError = error;
    }
    assert.ok(resolutionError, "probe requires a pre-Worker Oracle failure");

    const persisted = await orchestrator.checkpoint({
      itemId,
      owner: "bb032-preflight",
      generation,
      checkpoint,
      status: BlackboardStatus.BLOCKED,
      blockers: [`Backend context preflight failed: ${resolutionError.message}`]
    });

    assert.equal(persisted.result.status, BlackboardStatus.BLOCKED);
    assert.equal(persisted.result.checkpoint.stage, BackendQaWorkflowStage.BACKEND_PENDING);
    assert.match(persisted.result.blockers[0], /repository unavailable/);
    assert.equal(spies.calls.execute, 0);
    assert.equal(spies.calls.recover, 0);

    await workflow.resume({ itemId });
    const resumed = await workflow.current({ itemId });
    assert.equal(resumed.stage, BackendQaWorkflowStage.BACKEND_PENDING);
    assert.equal(resumed.item.status, BlackboardStatus.REOPENED);
  });
});
