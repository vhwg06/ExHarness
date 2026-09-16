import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  AVOCapability,
  VerificationStatus,
  verificationCapabilityName
} from "../../core-harness/src/index.js";
import { EffectReplayPolicy } from "../../core-harness/src/effect-reconciliation.js";
import {
  BackendCompletionAction,
  BackendEvidenceClaim,
  BackendQaWorkflowStage,
  BackendRecoveryAction,
  BackendWorkStatus,
  BlackboardStatus,
  createApplicationOrchestrator,
  createBackendWorker,
  createDurableBackendQaWorkflow,
  createJsonBackendSessionStore,
  createJsonBlackboardStore,
  defineBackendObjective,
  recoverBackendObjective,
  runBackendObjective
} from "../src/index.js";

function reviewTrustStub() {
  return {
    trustPolicyFor() { return {}; },
    verifySignature() { return false; },
    verifyEvaluatorAuthority() { return false; },
    verifyEvidenceAuthority() { return false; }
  };
}

function objective() {
  return defineBackendObjective({
    id: "bb017-backend",
    task: "Apply the Backend mutation exactly once and verify it.",
    repository: {
      ref: "repo://bb017",
      revision: "rev-1"
    },
    requiredFiles: ["src/server.js"],
    constraints: ["Do not redispatch an already confirmed mutation."]
  });
}

function qaObjective() {
  return {
    id: "bb017-qa",
    task: "Verify the recovered Backend revision.",
    requiredArtifactPaths: ["src/server.js"],
    acceptanceCriteria: ["Recovered revision is the accepted Backend revision."]
  };
}

function repositoryReader() {
  return {
    async readFile({ repositoryRef, revision, path }) {
      return {
        content: `// ${repositoryRef}@${revision}:${path}\n`,
        sourceRef: `${repositoryRef}@${revision}:${path}`
      };
    }
  };
}

function verifier(name, claim) {
  return {
    name,
    async verify() {
      return {
        claim,
        status: VerificationStatus.PASS,
        evidence: [`${name}:pass`],
        summary: `${name} passed`
      };
    }
  };
}

function backendVerifiers() {
  return [
    verifier("backend-typecheck", BackendEvidenceClaim.TYPECHECK),
    verifier("backend-tests", BackendEvidenceClaim.TESTS)
  ];
}

function appliedStrategy() {
  return {
    async run({ invoke }) {
      const action = await invoke(AVOCapability.ACT, { kind: "APPLY_BACKEND_CHANGE" });
      await invoke(verificationCapabilityName("backend-typecheck"));
      await invoke(verificationCapabilityName("backend-tests"));
      await invoke(AVOCapability.EVALUATE);
      await invoke(AVOCapability.PROMOTE);
      return {
        status: BackendWorkStatus.APPLIED,
        summary: "Applied recovered Backend change.",
        revision: action.candidate.version,
        artifacts: action.result.artifacts,
        evidence: [],
        gaps: [],
        blockers: []
      };
    }
  };
}

function workItem() {
  return {
    id: "BB-017-RUN",
    work: "Run the crash-recoverable Backend to QA workflow.",
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

function crashableBackendStore(directory, mainSessionId) {
  const base = createJsonBackendSessionStore({ directory });
  let crashMainWrites = false;
  return Object.freeze({
    supportsRevisions: true,
    supportsDurableRecovery: true,
    load: (sessionId) => base.load(sessionId),
    save(session, options) {
      if (session.id === mainSessionId && crashMainWrites) {
        throw new Error("simulated Backend process crash before Core session persistence");
      }
      return base.save(session, options);
    },
    crashMainWrites() {
      crashMainWrites = true;
    }
  });
}

async function withTempDirs(run) {
  const root = await mkdtemp(join(tmpdir(), "exharness-bb017-"));
  try {
    await run({
      root,
      coreDirectory: join(root, "backend-core"),
      boardPath: join(root, "blackboard.json")
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("BB-017 empty non-durable Backend recovery state blocks instead of pretending no effect happened", async () => {
  let externalCalls = 0;
  const worker = createBackendWorker({
    strategy: appliedStrategy(),
    workspace: {
      async act() {
        externalCalls += 1;
        throw new Error("recovery must not dispatch without durable authority");
      }
    },
    verifiers: backendVerifiers()
  });

  const recovered = await recoverBackendObjective(objective(), {
    repositoryReader: repositoryReader(),
    backendWorker: worker
  });

  assert.equal(recovered.recovery.action, BackendRecoveryAction.BLOCKED);
  assert.equal(recovered.result, null);
  assert.equal(recovered.completion, null);
  assert.equal(recovered.decision.action, "BLOCK");
  assert.match(recovered.decision.reason, /durable recovery authority is required/);
  assert.equal(externalCalls, 0);
});

test("BB-017 durable workflow consumes a confirmed Backend effect after crash without external redispatch", async () => {
  await withTempDirs(async ({ coreDirectory, boardPath }) => {
    const mainSessionId = "backend:bb017-backend:backend";
    const crashingStore = crashableBackendStore(coreDirectory, mainSessionId);
    let externalCalls = 0;
    const workspace = {
      async act({ candidate, actionKey }) {
        externalCalls += 1;
        assert.equal(typeof actionKey, "string");
        crashingStore.crashMainWrites();
        return {
          mutated: true,
          candidate: { id: candidate.id, version: "rev-2" },
          result: {
            artifacts: [{ ref: "workspace://rev-2/src/server.js", path: "src/server.js" }]
          }
        };
      }
    };

    const orchestratorA = createApplicationOrchestrator({
      store: createJsonBlackboardStore({ path: boardPath }),
      reviewTrust: reviewTrustStub()
    });
    await orchestratorA.seed([workItem()]);
    const workerA = createBackendWorker({
      strategy: appliedStrategy(),
      workspace,
      verifiers: backendVerifiers(),
      sessionStore: crashingStore
    });
    const workflowA = createDurableBackendQaWorkflow({
      orchestrator: orchestratorA,
      repositoryReader: repositoryReader(),
      artifactReader: {},
      backendWorker: workerA,
      qaWorker: {}
    });
    await workflowA.initialize({
      itemId: "BB-017-RUN",
      owner: "backend-session-a",
      backendObjective: objective(),
      qaObjective: qaObjective()
    });

    await assert.rejects(
      () => workflowA.advance({ itemId: "BB-017-RUN", owner: "backend-session-a" }),
      /simulated Backend process crash before Core session persistence/
    );
    assert.equal(externalCalls, 1);
    const stranded = (await orchestratorA.readBlackboard()).items[0];
    assert.equal(stranded.status, BlackboardStatus.CLAIMED);
    assert.equal(stranded.claimGeneration, 2);
    assert.equal(stranded.checkpoint.stage, BackendQaWorkflowStage.BACKEND_PENDING);

    const orchestratorB = createApplicationOrchestrator({
      store: createJsonBlackboardStore({ path: boardPath }),
      reviewTrust: reviewTrustStub()
    });
    const workerB = createBackendWorker({
      strategy: appliedStrategy(),
      workspace: {
        async act(args) {
          externalCalls += 1;
          return workspace.act(args);
        }
      },
      verifiers: backendVerifiers(),
      sessionStore: createJsonBackendSessionStore({ directory: coreDirectory })
    });
    const workflowB = createDurableBackendQaWorkflow({
      orchestrator: orchestratorB,
      repositoryReader: repositoryReader(),
      artifactReader: {},
      backendWorker: workerB,
      qaWorker: {}
    });

    const recovered = await workflowB.recoverInterrupted({
      itemId: "BB-017-RUN",
      owner: "backend-session-b"
    });

    assert.equal(recovered.stage, BackendQaWorkflowStage.QA_PENDING);
    assert.equal(recovered.recovery.action, BackendRecoveryAction.COMPLETED);
    assert.equal(recovered.backend.completion.action, BackendCompletionAction.ACCEPT);
    assert.equal(recovered.handoff.revision, "rev-2");
    assert.equal(recovered.item.status, BlackboardStatus.REOPENED);
    assert.equal(recovered.item.claimGeneration, 3);
    assert.equal(externalCalls, 1, "confirmed effect must be replayed from the durable journal, not dispatched again");
  });
});

test("BB-017 idempotent Backend ambiguity retries with the same action key before normal completion", async () => {
  await withTempDirs(async ({ coreDirectory }) => {
    const mainSessionId = "backend:bb017-backend:backend";
    const crashingStore = crashableBackendStore(coreDirectory, mainSessionId);
    let externalCalls = 0;
    const actionKeys = [];
    const workspace = {
      async act({ candidate, actionKey }) {
        externalCalls += 1;
        actionKeys.push(actionKey);
        if (externalCalls === 1) {
          crashingStore.crashMainWrites();
          throw new Error("ambiguous Backend dispatch");
        }
        return {
          mutated: true,
          candidate: { id: candidate.id, version: "rev-2" },
          result: {
            artifacts: [{ ref: "workspace://rev-2/src/server.js", path: "src/server.js" }]
          }
        };
      }
    };

    const workerA = createBackendWorker({
      strategy: appliedStrategy(),
      workspace,
      verifiers: backendVerifiers(),
      sessionStore: crashingStore,
      actionEffect: { replayPolicy: EffectReplayPolicy.IDEMPOTENT }
    });
    await assert.rejects(
      () => runBackendObjective(objective(), {
        repositoryReader: repositoryReader(),
        backendWorker: workerA
      }),
      /simulated Backend process crash before Core session persistence/
    );

    const workerB = createBackendWorker({
      strategy: appliedStrategy(),
      workspace,
      verifiers: backendVerifiers(),
      sessionStore: createJsonBackendSessionStore({ directory: coreDirectory }),
      actionEffect: { replayPolicy: EffectReplayPolicy.IDEMPOTENT }
    });
    const recovered = await recoverBackendObjective(objective(), {
      repositoryReader: repositoryReader(),
      backendWorker: workerB
    });

    assert.equal(recovered.recovery.action, BackendRecoveryAction.COMPLETED);
    assert.equal(recovered.completion.action, BackendCompletionAction.ACCEPT);
    assert.equal(externalCalls, 2);
    assert.equal(actionKeys.length, 2);
    assert.equal(actionKeys[0], actionKeys[1], "idempotent recovery must preserve the Core action key");
  });
});

test("BB-017 non-reconcilable Backend ambiguity blocks without blind retry", async () => {
  await withTempDirs(async ({ coreDirectory }) => {
    const mainSessionId = "backend:bb017-backend:backend";
    const crashingStore = crashableBackendStore(coreDirectory, mainSessionId);
    let externalCalls = 0;
    const workspace = {
      async act() {
        externalCalls += 1;
        crashingStore.crashMainWrites();
        throw new Error("ambiguous non-reconcilable Backend dispatch");
      }
    };

    const workerA = createBackendWorker({
      strategy: appliedStrategy(),
      workspace,
      verifiers: backendVerifiers(),
      sessionStore: crashingStore
    });
    await assert.rejects(
      () => runBackendObjective(objective(), {
        repositoryReader: repositoryReader(),
        backendWorker: workerA
      }),
      /simulated Backend process crash before Core session persistence/
    );

    const workerB = createBackendWorker({
      strategy: appliedStrategy(),
      workspace,
      verifiers: backendVerifiers(),
      sessionStore: createJsonBackendSessionStore({ directory: coreDirectory })
    });
    const recovered = await recoverBackendObjective(objective(), {
      repositoryReader: repositoryReader(),
      backendWorker: workerB
    });

    assert.equal(recovered.recovery.action, BackendRecoveryAction.BLOCKED);
    assert.equal(recovered.result, null);
    assert.equal(recovered.completion, null);
    assert.equal(recovered.decision.action, "BLOCK");
    assert.match(recovered.decision.reason, /cannot be reconciled safely/);
    assert.equal(externalCalls, 1, "non-reconcilable ambiguity must not redispatch");
  });
});
