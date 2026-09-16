import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  AVOCapability,
  EvaluationVerdict,
  VerificationStatus,
  verificationCapabilityName
} from "../../core-harness/src/index.js";
import {
  BackendEvidenceClaim,
  BackendQaWorkflowStage,
  BackendWorkStatus,
  BlackboardStatus,
  QaEvidenceClaim,
  QaWorkStatus,
  createApplicationOrchestrator,
  createBackendWorker,
  createDurableBackendQaWorkflow,
  createJsonBlackboardStore,
  createQaWorker,
  createSessionHandoffSurface,
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

function backendObjective() {
  return defineBackendObjective({
    id: "health-endpoint",
    task: "Add a GET /health endpoint without changing the existing /users behavior.",
    repository: {
      ref: "repo://example-backend",
      revision: "rev-1"
    },
    requiredFiles: ["src/server.js", "test/server.test.js"],
    constraints: ["preserve the existing /users response contract"]
  });
}

function qaObjective() {
  return defineQaObjective({
    id: "health-endpoint-qa",
    task: "Verify the health endpoint and regression-check existing users behavior.",
    requiredArtifactPaths: ["src/server.js", "test/server.test.js"],
    acceptanceCriteria: [
      "GET /health returns the expected healthy response",
      "GET /users preserves the existing response contract"
    ]
  });
}

function repositoryReader({ seen = [] } = {}) {
  return {
    async readFile({ repositoryRef, revision, path }) {
      seen.push({ repositoryRef, revision, path });
      return {
        content: `// source ${revision}:${path}\n`,
        sourceRef: `${repositoryRef}@${revision}:${path}`
      };
    }
  };
}

function nextRevision(current) {
  const match = /^rev-(\d+)$/.exec(current);
  assert.ok(match, `test revision must match rev-N: ${current}`);
  return `rev-${Number(match[1]) + 1}`;
}

function workspace() {
  return {
    async act({ candidate }) {
      const revision = nextRevision(candidate.version);
      return {
        mutated: true,
        candidate: { id: candidate.id, version: revision },
        result: {
          artifacts: [
            { ref: `workspace://${revision}/src/server.js`, path: "src/server.js" },
            { ref: `workspace://${revision}/test/server.test.js`, path: "test/server.test.js" }
          ]
        }
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
        summary: `${name} pass`
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

function qaVerifiers() {
  return [
    verifier("qa-behavior", QaEvidenceClaim.BEHAVIOR),
    verifier("qa-regression", QaEvidenceClaim.REGRESSION)
  ];
}

function backendStrategy() {
  return {
    async run({ invoke }) {
      const action = await invoke(AVOCapability.ACT, { kind: "APPLY_BACKEND_CHANGE" });
      await invoke(verificationCapabilityName("backend-typecheck"));
      await invoke(verificationCapabilityName("backend-tests"));
      const evaluation = await invoke(AVOCapability.EVALUATE);
      assert.equal(evaluation.verdict, EvaluationVerdict.PASS);
      await invoke(AVOCapability.PROMOTE);
      return {
        status: BackendWorkStatus.APPLIED,
        summary: "Applied Backend change.",
        revision: action.candidate.version,
        artifacts: action.result.artifacts,
        gaps: [],
        blockers: []
      };
    }
  };
}

function qaStrategy(statuses = [QaWorkStatus.VERIFIED]) {
  let call = 0;
  return {
    async run({ input, invoke }) {
      const revision = input.work.context.upstream.revision;
      const status = statuses[Math.min(call, statuses.length - 1)];
      call += 1;
      await invoke(verificationCapabilityName("qa-behavior"));
      await invoke(verificationCapabilityName("qa-regression"));
      const evaluation = await invoke(AVOCapability.EVALUATE);
      assert.equal(evaluation.verdict, EvaluationVerdict.PASS);
      return {
        status,
        summary: status === QaWorkStatus.ISSUES_FOUND ? "Regression issue found." : "QA checks passed.",
        verifiedRevision: revision,
        inspectedArtifacts: [{ ref: "worker-claimed-artifact" }],
        evidence: [{ fake: "worker evidence is replaced" }],
        issues: status === QaWorkStatus.ISSUES_FOUND ? ["/users response changed"] : [],
        blockers: []
      };
    }
  };
}

function artifactReader(control = { fail: false }) {
  return {
    async readArtifact({ ref }) {
      if (control.fail) throw new Error(`artifact store unavailable for ${ref}`);
      return {
        content: `resolved artifact: ${ref}\n`,
        sourceRef: `application-artifact:${ref}`
      };
    }
  };
}

function workItem() {
  return {
    id: "BB-300",
    work: "Deliver accepted Backend change through QA.",
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

const USER_INTENT = Object.freeze({
  id: "durable-backend-qa",
  objective: "Deliver Backend changes through durable QA verification across arbitrary sessions.",
  bullets: ["Backend acceptance must survive restart before QA runs."],
  constraints: ["Do not rely on previous conversation state."]
});

async function withBoard(run) {
  const directory = await mkdtemp(join(tmpdir(), "exharness-durable-backend-qa-"));
  try {
    const path = join(directory, "blackboard.json");
    const makeOrchestrator = () => createApplicationOrchestrator({
      store: createJsonBlackboardStore({ path }),
      reviewTrust: reviewTrustStub()
    });
    const orchestrator = makeOrchestrator();
    const handoff = createSessionHandoffSurface({ orchestrator });
    await handoff.initialize({ userIntent: USER_INTENT, items: [workItem()] });
    await run({ path, orchestrator, handoff, makeOrchestrator });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function makeWorkflow({ orchestrator, repo, artifacts, qaStatuses = [QaWorkStatus.VERIFIED] }) {
  return createDurableBackendQaWorkflow({
    orchestrator,
    repositoryReader: repo,
    artifactReader: artifacts,
    backendWorker: createBackendWorker({
      strategy: backendStrategy(),
      workspace: workspace(),
      verifiers: backendVerifiers()
    }),
    qaWorker: createQaWorker({
      strategy: qaStrategy(qaStatuses),
      verifiers: qaVerifiers()
    })
  });
}

test("BB-004 persists accepted Backend provenance so a fresh session can continue QA", async () => {
  await withBoard(async ({ path, orchestrator, makeOrchestrator }) => {
    const repo = repositoryReader();
    const artifacts = artifactReader();
    const sessionA = makeWorkflow({ orchestrator, repo, artifacts });

    const initialized = await sessionA.initialize({
      itemId: "BB-300",
      owner: "session-a",
      backendObjective: backendObjective(),
      qaObjective: qaObjective()
    });
    assert.equal(initialized.stage, BackendQaWorkflowStage.BACKEND_PENDING);
    assert.equal(initialized.item.status, BlackboardStatus.REOPENED);

    const backend = await sessionA.advance({ itemId: "BB-300", owner: "session-a" });
    assert.equal(backend.stage, BackendQaWorkflowStage.QA_PENDING);
    assert.equal(backend.item.status, BlackboardStatus.REOPENED);
    assert.equal(backend.item.checkpoint.acceptedBackend.handoff.revision, "rev-2");

    const sessionBOrchestrator = makeOrchestrator();
    const sessionBHandoff = createSessionHandoffSurface({ orchestrator: sessionBOrchestrator });
    const resumed = await sessionBHandoff.read();
    assert.equal(resumed.lifecycle.eligibleWork[0].checkpoint.stage, BackendQaWorkflowStage.QA_PENDING);
    assert.equal(resumed.lifecycle.eligibleWork[0].checkpoint.acceptedBackend.handoff.revision, "rev-2");
    assert.ok(resumed.references.artifacts.some((entry) => entry.ref === "workspace://rev-2/src/server.js"));

    const sessionB = makeWorkflow({ orchestrator: sessionBOrchestrator, repo, artifacts });
    const qa = await sessionB.advance({ itemId: "BB-300", owner: "session-b" });
    assert.equal(qa.stage, BackendQaWorkflowStage.AWAITING_REVIEW);
    assert.equal(qa.item.status, BlackboardStatus.PENDING_REVIEW);
    assert.equal(qa.item.checkpoint, null);
    assert.equal(qa.item.submission.stage, "QA_COMPLETED");
    assert.equal(qa.item.submission.acceptedRevision, "rev-2");
    assert.equal(qa.item.reviewRequirements[0].key, "BACKEND_QA_APPLICATION_ACCEPTANCE");

    const persisted = JSON.parse(await (await import("node:fs/promises")).readFile(path, "utf8"));
    assert.ok(persisted.items.some((item) => item.id === "BB-300" && item.status === BlackboardStatus.PENDING_REVIEW));
  });
});

test("BB-004 sends QA issues back to Backend remediation using the accepted revision as the new base", async () => {
  await withBoard(async ({ orchestrator }) => {
    const seen = [];
    const repo = repositoryReader({ seen });
    const artifacts = artifactReader();
    const workflow = makeWorkflow({
      orchestrator,
      repo,
      artifacts,
      qaStatuses: [QaWorkStatus.ISSUES_FOUND, QaWorkStatus.VERIFIED]
    });

    await workflow.initialize({
      itemId: "BB-300",
      owner: "session-1",
      backendObjective: backendObjective(),
      qaObjective: qaObjective()
    });
    await workflow.advance({ itemId: "BB-300", owner: "session-1" });

    const issue = await workflow.advance({ itemId: "BB-300", owner: "session-2" });
    assert.equal(issue.stage, BackendQaWorkflowStage.BACKEND_REMEDIATION_PENDING);
    assert.deepEqual(issue.item.checkpoint.qaIssues, ["/users response changed"]);

    const remediation = await workflow.advance({ itemId: "BB-300", owner: "session-3" });
    assert.equal(remediation.stage, BackendQaWorkflowStage.QA_PENDING);
    assert.equal(remediation.item.checkpoint.acceptedBackend.handoff.revision, "rev-3");
    assert.ok(seen.some((entry) => entry.revision === "rev-2"), "remediation must read the previously accepted revision");

    const qa = await workflow.advance({ itemId: "BB-300", owner: "session-4" });
    assert.equal(qa.stage, BackendQaWorkflowStage.AWAITING_REVIEW);
    assert.equal(qa.item.submission.acceptedRevision, "rev-3");
  });
});

test("BB-004 blocks on artifact lookup failure, then resumes the same QA checkpoint after source recovery", async () => {
  await withBoard(async ({ orchestrator, makeOrchestrator }) => {
    const repo = repositoryReader();
    const control = { fail: false };
    const artifacts = artifactReader(control);
    const workflow = makeWorkflow({ orchestrator, repo, artifacts });

    await workflow.initialize({
      itemId: "BB-300",
      owner: "session-1",
      backendObjective: backendObjective(),
      qaObjective: qaObjective()
    });
    await workflow.advance({ itemId: "BB-300", owner: "session-1" });

    control.fail = true;
    const blocked = await workflow.advance({ itemId: "BB-300", owner: "session-2" });
    assert.equal(blocked.stage, BackendQaWorkflowStage.BLOCKED);
    assert.equal(blocked.item.status, BlackboardStatus.BLOCKED);
    assert.equal(blocked.item.checkpoint.stage, BackendQaWorkflowStage.QA_PENDING);
    assert.match(blocked.item.blockers[0], /artifact store unavailable/);

    const freshOrchestrator = makeOrchestrator();
    const fresh = makeWorkflow({ orchestrator: freshOrchestrator, repo, artifacts });
    assert.equal((await fresh.current({ itemId: "BB-300" })).stage, BackendQaWorkflowStage.BLOCKED);

    control.fail = false;
    await fresh.resume({ itemId: "BB-300" });
    const completed = await fresh.advance({ itemId: "BB-300", owner: "session-3" });
    assert.equal(completed.stage, BackendQaWorkflowStage.AWAITING_REVIEW);
    assert.equal(completed.item.status, BlackboardStatus.PENDING_REVIEW);
  });
});

test("BB-004 cancel supersedes unfinished workflow and prevents later execution", async () => {
  await withBoard(async ({ orchestrator }) => {
    const workflow = makeWorkflow({
      orchestrator,
      repo: repositoryReader(),
      artifacts: artifactReader()
    });
    await workflow.initialize({
      itemId: "BB-300",
      owner: "session-1",
      backendObjective: backendObjective(),
      qaObjective: qaObjective()
    });

    const canceled = await workflow.cancel({ itemId: "BB-300", reason: "User canceled this objective." });
    assert.equal(canceled.stage, BackendQaWorkflowStage.CANCELED);
    assert.equal(canceled.item.status, BlackboardStatus.SUPERSEDED);

    const after = await workflow.advance({ itemId: "BB-300", owner: "session-2" });
    assert.equal(after.stage, BackendQaWorkflowStage.CANCELED);
  });
});
