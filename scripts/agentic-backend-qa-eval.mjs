import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  AVOCapability,
  EvaluationVerdict,
  VerificationStatus,
  verificationCapabilityName
} from "../packages/core-harness/src/index.js";
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
} from "../packages/agentic-system/src/index.js";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

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
    repository: { ref: "repo://example-backend", revision: "rev-1" },
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

function nextRevision(current) {
  const match = /^rev-(\d+)$/.exec(current);
  assert.ok(match, `reference revision must match rev-N: ${current}`);
  return `rev-${Number(match[1]) + 1}`;
}

function createMetrics() {
  return {
    scenarioCount: 0,
    scenarioPasses: 0,
    deliveryScenarios: 0,
    deliveryReachedReviewGate: 0,
    expectedCancellation: 0,
    falseCompletionCount: 0,
    backendRuns: 0,
    qaRuns: 0,
    repositoryReads: 0,
    repositoryContextChars: 0,
    artifactReadAttempts: 0,
    artifactReadSuccesses: 0,
    artifactContextChars: 0,
    artifactResolutionFailures: 0,
    unexpectedSourceReads: 0,
    handoffChecks: 0,
    handoffArtifactsChecked: 0,
    handoffMismatchCount: 0,
    workerEvidenceAcceptedCount: 0,
    qaIssues: 0,
    remediationCycles: 0,
    processRestarts: 0,
    recoveryResumes: 0,
    reviewGates: 0,
    advisorInvocations: 0,
    advisorValueAddEvaluated: 0
  };
}

const metrics = createMetrics();
const provenance = {
  scenarios: [],
  terminalStatuses: {},
  acceptedRevisions: {}
};

function repositoryReader() {
  const allowed = new Set(["src/server.js", "test/server.test.js"]);
  return {
    async readFile({ repositoryRef, revision, path }) {
      metrics.repositoryReads += 1;
      if (repositoryRef !== "repo://example-backend" || !allowed.has(path)) {
        metrics.unexpectedSourceReads += 1;
      }
      const content = `// source ${revision}:${path}\n`;
      metrics.repositoryContextChars += content.length;
      return {
        content,
        sourceRef: `${repositoryRef}@${revision}:${path}`
      };
    }
  };
}

function artifactReader(control = { fail: false }) {
  return {
    async readArtifact({ ref }) {
      metrics.artifactReadAttempts += 1;
      if (!ref.startsWith("workspace://")) metrics.unexpectedSourceReads += 1;
      if (control.fail) {
        metrics.artifactResolutionFailures += 1;
        throw new Error(`artifact store unavailable for ${ref}`);
      }
      metrics.artifactReadSuccesses += 1;
      const content = `resolved artifact: ${ref}\n`;
      metrics.artifactContextChars += content.length;
      return {
        content,
        sourceRef: `application-artifact:${ref}`
      };
    }
  };
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

function backendStrategy() {
  return {
    async run({ invoke }) {
      metrics.backendRuns += 1;
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

function qaStrategy(statuses) {
  let call = 0;
  return {
    async run({ input, invoke }) {
      metrics.qaRuns += 1;
      const revision = input.work.context.upstream.revision;
      const status = statuses[Math.min(call, statuses.length - 1)];
      call += 1;
      await invoke(verificationCapabilityName("qa-behavior"));
      await invoke(verificationCapabilityName("qa-regression"));
      const evaluation = await invoke(AVOCapability.EVALUATE);
      assert.equal(evaluation.verdict, EvaluationVerdict.PASS);
      const issues = status === QaWorkStatus.ISSUES_FOUND ? ["/users response changed"] : [];
      metrics.qaIssues += issues.length;
      return {
        status,
        summary: issues.length > 0 ? "Regression issue found." : "QA checks passed.",
        verifiedRevision: revision,
        inspectedArtifacts: [{ ref: "worker-claimed-artifact" }],
        evidence: [{ fake: "worker evidence is replaced" }],
        issues,
        blockers: []
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

function workItem(id) {
  return {
    id,
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

async function withBoard(name, run) {
  const directory = await mkdtemp(join(tmpdir(), `exharness-agentic-eval-${name}-`));
  try {
    const path = join(directory, "blackboard.json");
    const itemId = `BB-EVAL-${name}`;
    const makeOrchestrator = () => createApplicationOrchestrator({
      store: createJsonBlackboardStore({ path }),
      reviewTrust: reviewTrustStub()
    });
    const orchestrator = makeOrchestrator();
    const handoff = createSessionHandoffSurface({ orchestrator });
    await handoff.initialize({
      userIntent: {
        id: `intent-${name}`,
        objective: "Evaluate durable Backend to QA application behavior.",
        bullets: ["Preserve accepted revision provenance across workflow transitions."],
        constraints: ["A Worker submission must not self-authorize Board DONE."]
      },
      items: [workItem(itemId)]
    });
    await run({ itemId, orchestrator, handoff, makeOrchestrator });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function assessHandoff(item, expectedRevision) {
  const handoff = item.checkpoint?.acceptedBackend?.handoff ?? null;
  metrics.handoffChecks += 1;
  if (handoff == null || handoff.revision !== expectedRevision) {
    metrics.handoffMismatchCount += 1;
    return;
  }
  metrics.handoffArtifactsChecked += handoff.artifacts.length;
  if (
    handoff.artifacts.length !== 2 ||
    handoff.artifacts.some((artifact) => artifact.content != null || !artifact.ref.startsWith(`workspace://${expectedRevision}/`))
  ) {
    metrics.handoffMismatchCount += 1;
  }
}

function assessReviewGate(name, item, expectedRevision) {
  metrics.deliveryScenarios += 1;
  if (item.status === BlackboardStatus.DONE) metrics.falseCompletionCount += 1;
  assert.equal(item.status, BlackboardStatus.PENDING_REVIEW);
  assert.equal(item.submission?.acceptedRevision, expectedRevision);
  assert.equal(item.checkpoint, null);
  if (Object.prototype.hasOwnProperty.call(item.submission ?? {}, "evidence")) {
    metrics.workerEvidenceAcceptedCount += 1;
  }
  metrics.deliveryReachedReviewGate += 1;
  metrics.reviewGates += 1;
  provenance.terminalStatuses[name] = item.status;
  provenance.acceptedRevisions[name] = expectedRevision;
}

async function scenario(name, run) {
  metrics.scenarioCount += 1;
  provenance.scenarios.push(name);
  await run();
  metrics.scenarioPasses += 1;
}

await scenario("happy", async () => {
  await withBoard("happy", async ({ itemId, orchestrator }) => {
    const workflow = makeWorkflow({
      orchestrator,
      repo: repositoryReader(),
      artifacts: artifactReader()
    });
    await workflow.initialize({ itemId, owner: "happy-backend", backendObjective: backendObjective(), qaObjective: qaObjective() });
    const backend = await workflow.advance({ itemId, owner: "happy-backend" });
    assessHandoff(backend.item, "rev-2");
    const qa = await workflow.advance({ itemId, owner: "happy-qa" });
    assessReviewGate("happy", qa.item, "rev-2");
  });
});

await scenario("restart", async () => {
  await withBoard("restart", async ({ itemId, orchestrator, makeOrchestrator }) => {
    const repo = repositoryReader();
    const artifacts = artifactReader();
    const first = makeWorkflow({ orchestrator, repo, artifacts });
    await first.initialize({ itemId, owner: "restart-backend", backendObjective: backendObjective(), qaObjective: qaObjective() });
    const backend = await first.advance({ itemId, owner: "restart-backend" });
    assessHandoff(backend.item, "rev-2");

    metrics.processRestarts += 1;
    const freshOrchestrator = makeOrchestrator();
    const freshHandoff = createSessionHandoffSurface({ orchestrator: freshOrchestrator });
    const resumed = await freshHandoff.read();
    assert.equal(resumed.lifecycle.eligibleWork[0].checkpoint.stage, BackendQaWorkflowStage.QA_PENDING);
    assert.equal(resumed.lifecycle.eligibleWork[0].checkpoint.acceptedBackend.handoff.revision, "rev-2");

    const second = makeWorkflow({ orchestrator: freshOrchestrator, repo, artifacts });
    const qa = await second.advance({ itemId, owner: "restart-qa" });
    assessReviewGate("restart", qa.item, "rev-2");
  });
});

await scenario("remediation", async () => {
  await withBoard("remediation", async ({ itemId, orchestrator }) => {
    const workflow = makeWorkflow({
      orchestrator,
      repo: repositoryReader(),
      artifacts: artifactReader(),
      qaStatuses: [QaWorkStatus.ISSUES_FOUND, QaWorkStatus.VERIFIED]
    });
    await workflow.initialize({ itemId, owner: "remediation-1", backendObjective: backendObjective(), qaObjective: qaObjective() });
    const backend = await workflow.advance({ itemId, owner: "remediation-1" });
    assessHandoff(backend.item, "rev-2");

    const issue = await workflow.advance({ itemId, owner: "remediation-2" });
    assert.equal(issue.stage, BackendQaWorkflowStage.BACKEND_REMEDIATION_PENDING);
    metrics.remediationCycles += 1;

    const remediation = await workflow.advance({ itemId, owner: "remediation-3" });
    assessHandoff(remediation.item, "rev-3");
    const qa = await workflow.advance({ itemId, owner: "remediation-4" });
    assessReviewGate("remediation", qa.item, "rev-3");
  });
});

await scenario("blocked-recovery", async () => {
  await withBoard("blocked-recovery", async ({ itemId, orchestrator, makeOrchestrator }) => {
    const repo = repositoryReader();
    const control = { fail: false };
    const artifacts = artifactReader(control);
    const first = makeWorkflow({ orchestrator, repo, artifacts });
    await first.initialize({ itemId, owner: "blocked-1", backendObjective: backendObjective(), qaObjective: qaObjective() });
    const backend = await first.advance({ itemId, owner: "blocked-1" });
    assessHandoff(backend.item, "rev-2");

    control.fail = true;
    const blocked = await first.advance({ itemId, owner: "blocked-2" });
    assert.equal(blocked.stage, BackendQaWorkflowStage.BLOCKED);
    assert.equal(blocked.item.status, BlackboardStatus.BLOCKED);

    metrics.processRestarts += 1;
    const freshOrchestrator = makeOrchestrator();
    const second = makeWorkflow({ orchestrator: freshOrchestrator, repo, artifacts });
    control.fail = false;
    await second.resume({ itemId });
    metrics.recoveryResumes += 1;
    const qa = await second.advance({ itemId, owner: "blocked-3" });
    assessReviewGate("blocked-recovery", qa.item, "rev-2");
  });
});

await scenario("cancel", async () => {
  await withBoard("cancel", async ({ itemId, orchestrator }) => {
    const workflow = makeWorkflow({
      orchestrator,
      repo: repositoryReader(),
      artifacts: artifactReader()
    });
    await workflow.initialize({ itemId, owner: "cancel-1", backendObjective: backendObjective(), qaObjective: qaObjective() });
    const canceled = await workflow.cancel({ itemId, reason: "Reference evaluation cancellation." });
    assert.equal(canceled.stage, BackendQaWorkflowStage.CANCELED);
    assert.equal(canceled.item.status, BlackboardStatus.SUPERSEDED);
    metrics.expectedCancellation += 1;
    provenance.terminalStatuses.cancel = canceled.item.status;
    provenance.acceptedRevisions.cancel = null;
  });
});

const result = {
  schemaVersion: 1,
  reference: "agentic-backend-qa-v1",
  evidenceClass: "DETERMINISTIC_REFERENCE",
  productionEvidence: false,
  metrics,
  provenance,
  limitations: {
    realRepositories: false,
    externalModelProviders: false,
    productionLatencyCost: false,
    advisorValueAdd: false,
    genericAbstractionJustified: false
  }
};

assert.equal(metrics.scenarioCount, 5);
assert.equal(metrics.scenarioPasses, 5);
assert.equal(metrics.deliveryScenarios, 4);
assert.equal(metrics.deliveryReachedReviewGate, 4);
assert.equal(metrics.expectedCancellation, 1);
assert.equal(metrics.falseCompletionCount, 0);
assert.equal(metrics.backendRuns, 5);
assert.equal(metrics.qaRuns, 5);
assert.equal(metrics.repositoryReads, 10);
assert.equal(metrics.repositoryContextChars, 330);
assert.equal(metrics.artifactReadAttempts, 11);
assert.equal(metrics.artifactReadSuccesses, 10);
assert.equal(metrics.artifactContextChars, 540);
assert.equal(metrics.artifactResolutionFailures, 1);
assert.equal(metrics.unexpectedSourceReads, 0);
assert.equal(metrics.handoffChecks, 5);
assert.equal(metrics.handoffArtifactsChecked, 10);
assert.equal(metrics.handoffMismatchCount, 0);
assert.equal(metrics.workerEvidenceAcceptedCount, 0);
assert.equal(metrics.qaIssues, 1);
assert.equal(metrics.remediationCycles, 1);
assert.equal(metrics.processRestarts, 2);
assert.equal(metrics.recoveryResumes, 1);
assert.equal(metrics.reviewGates, 4);
assert.equal(metrics.advisorInvocations, 0);
assert.equal(metrics.advisorValueAddEvaluated, 0);

const expected = JSON.parse(await readFile(
  join(root, "artifacts", "agentic-backend-qa-reference-eval.json"),
  "utf8"
));
assert.deepEqual(result, expected, "Agentic Backend/QA reference evaluation drifted from its measured stable artifact");

console.log(`agentic-backend-qa-eval:${JSON.stringify(result)}`);
