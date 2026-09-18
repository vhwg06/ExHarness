import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  BackendAdvisorAction,
  BackendQaWorkflowStage,
  BackendRunAction,
  BackendWorkStatus,
  BlackboardStatus,
  createApplicationOrchestrator,
  createBackendAdvisor,
  createDurableBackendQaWorkflow,
  createJsonBlackboardStore,
  defineBackendCompletionPolicy,
  defineBackendObjective,
  defineQaObjective
} from "../src/index.js";

function reviewTrust() {
  return {
    trustPolicyFor() { return {}; },
    verifySignature() { return false; },
    verifyEvaluatorAuthority() { return false; },
    verifyEvidenceAuthority() { return false; }
  };
}

function workItem() {
  return {
    id: "BB-042-TASK",
    work: "Preserve Backend Advisor continuation requirements.",
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

function backendObjective() {
  return defineBackendObjective({
    id: "advisor-continuation",
    task: "Apply the Backend change with the required compatibility context.",
    repository: { ref: "repo://bb042", revision: "rev-1" },
    requiredFiles: ["src/server.js"],
    constraints: []
  });
}

function qaObjective() {
  return defineQaObjective({
    id: "advisor-continuation-qa",
    task: "Verify the accepted Backend change.",
    requiredArtifactPaths: ["src/server.js"],
    acceptanceCriteria: ["Backend change remains compatible."]
  });
}

function repositoryReader(seen) {
  return {
    async readFile({ path, revision }) {
      seen.push({ path, revision });
      return {
        content: `// ${revision}:${path}\n`,
        sourceRef: `repo://bb042@${revision}:${path}`
      };
    }
  };
}

function backendWorker(execute) {
  return { execute };
}

function result({ revision = "rev-2", gaps = [] } = {}) {
  return {
    status: BackendWorkStatus.APPLIED,
    summary: gaps.length > 0 ? "Applied with unresolved semantic gaps." : "Applied with no unresolved gaps.",
    revision,
    artifacts: [{ ref: `workspace://${revision}/src/server.js`, path: "src/server.js" }],
    evidence: [],
    gaps,
    blockers: []
  };
}

function unusedQaWorker() {
  return {
    async execute() {
      throw new Error("QA must not run in BB-042 coordination tests");
    }
  };
}

const permissiveCompletionPolicy = defineBackendCompletionPolicy({
  requiredEvidenceClaims: [],
  requireArtifacts: true
});

async function withWorkflow({ worker, advisor = null, seen = [] }, run) {
  const directory = await mkdtemp(join(tmpdir(), "exharness-bb042-"));
  try {
    const path = join(directory, "blackboard.json");
    const makeOrchestrator = () => createApplicationOrchestrator({
      store: createJsonBlackboardStore({ path }),
      reviewTrust: reviewTrust()
    });
    const makeWorkflow = (orchestrator = makeOrchestrator()) => createDurableBackendQaWorkflow({
      orchestrator,
      repositoryReader: repositoryReader(seen),
      artifactReader: { async readArtifact() { throw new Error("QA must not read artifacts yet"); } },
      backendWorker: worker,
      qaWorker: unusedQaWorker(),
      backendCompletionPolicy: permissiveCompletionPolicy,
      backendAdvisor: advisor
    });

    const orchestrator = makeOrchestrator();
    await orchestrator.seed([workItem()]);
    const workflow = makeWorkflow(orchestrator);
    await workflow.initialize({
      itemId: "BB-042-TASK",
      owner: "session-init",
      backendObjective: backendObjective(),
      qaObjective: qaObjective()
    });
    await run({ path, orchestrator, workflow, makeOrchestrator, makeWorkflow, seen });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("BB-042 persists REQUEST_CONTEXT across sessions and refuses unchanged redispatch until application resolution", async () => {
  let dispatches = 0;
  const seen = [];
  const worker = backendWorker(async (_order, context) => {
    dispatches += 1;
    const hasContract = context.files.some((file) => file.path === "src/client-contract.md");
    return result({
      revision: `rev-${dispatches + 1}`,
      gaps: hasContract ? [] : [{ id: "gap-contract", summary: "Client compatibility contract is missing." }]
    });
  });
  const advisor = createBackendAdvisor({
    async assess() {
      return {
        action: BackendAdvisorAction.REQUEST_CONTEXT,
        gapIds: ["gap-contract"],
        contextNeeds: ["client compatibility contract"],
        rationale: "Read the client contract before another implementation attempt."
      };
    }
  });

  await withWorkflow({ worker, advisor, seen }, async ({ makeWorkflow }) => {
    const first = await makeWorkflow().advance({ itemId: "BB-042-TASK", owner: "session-a" });
    assert.equal(first.stage, BackendQaWorkflowStage.BACKEND_COORDINATION_PENDING);
    assert.equal(first.item.status, BlackboardStatus.BLOCKED);
    assert.equal(first.coordination.action, BackendRunAction.REQUEST_CONTEXT);
    assert.deepEqual(first.coordination.gapIds, ["gap-contract"]);
    assert.deepEqual(first.coordination.contextNeeds, ["client compatibility contract"]);
    assert.equal(dispatches, 1);

    const fresh = makeWorkflow();
    const current = await fresh.current({ itemId: "BB-042-TASK" });
    assert.equal(current.stage, BackendQaWorkflowStage.BACKEND_COORDINATION_PENDING);
    assert.equal(current.coordination.completionDecision.id, first.backend.completion.decision.id);

    const unchanged = await fresh.advance({ itemId: "BB-042-TASK", owner: "session-b" });
    assert.equal(unchanged.stage, BackendQaWorkflowStage.BACKEND_COORDINATION_PENDING);
    assert.equal(dispatches, 1, "unresolved context request must not redispatch Backend");

    await assert.rejects(
      () => fresh.resume({ itemId: "BB-042-TASK" }),
      /resolveBackendCoordination/
    );

    const resolved = await fresh.resolveBackendCoordination({
      itemId: "BB-042-TASK",
      owner: "coordinator",
      rationale: "The application mapped the requested contract to a declared repository file.",
      additionalRequiredFiles: ["src/client-contract.md"]
    });
    assert.equal(resolved.stage, BackendQaWorkflowStage.BACKEND_PENDING);
    assert.equal(resolved.item.status, BlackboardStatus.REOPENED);
    assert.deepEqual(resolved.resolution.addedRequiredFiles, ["src/client-contract.md"]);
    assert.ok(resolved.item.checkpoint.spec.backendObjective.requiredFiles.includes("src/client-contract.md"));

    const afterResolution = await makeWorkflow().advance({ itemId: "BB-042-TASK", owner: "session-c" });
    assert.equal(afterResolution.stage, BackendQaWorkflowStage.QA_PENDING);
    assert.equal(dispatches, 2);
    assert.ok(seen.some((entry) => entry.path === "src/client-contract.md"));
  });
});

test("BB-042 blocked-checkpoint resolution is atomic and rejects stale checkpoint state", async () => {
  const worker = backendWorker(async () => result({
    gaps: [{ id: "gap-contract", summary: "Client compatibility contract is missing." }]
  }));
  const advisor = createBackendAdvisor({
    async assess() {
      return {
        action: BackendAdvisorAction.REQUEST_CONTEXT,
        gapIds: ["gap-contract"],
        contextNeeds: ["client compatibility contract"],
        rationale: "Read the client contract before another implementation attempt."
      };
    }
  });

  await withWorkflow({ worker, advisor }, async ({ makeOrchestrator, makeWorkflow }) => {
    const first = await makeWorkflow().advance({ itemId: "BB-042-TASK", owner: "session-a" });
    const orchestrator = makeOrchestrator();
    const stale = structuredClone(first.item.checkpoint);
    stale.attempt += 1;

    await assert.rejects(
      () => orchestrator.resolveBlockedCheckpoint({
        itemId: "BB-042-TASK",
        checkpointedBy: "coordinator",
        expectedCheckpoint: stale,
        checkpoint: { ...first.item.checkpoint, stage: BackendQaWorkflowStage.BACKEND_PENDING, coordination: null }
      }),
      /blocked checkpoint changed before resolution/
    );

    const preserved = await makeWorkflow().current({ itemId: "BB-042-TASK" });
    assert.equal(preserved.stage, BackendQaWorkflowStage.BACKEND_COORDINATION_PENDING);
    assert.equal(preserved.item.status, BlackboardStatus.BLOCKED);
    assert.deepEqual(preserved.item.checkpoint, first.item.checkpoint);
  });
});

test("BB-042 persists ESCALATE and requires explicit resolution before another Backend attempt", async () => {
  let dispatches = 0;
  const worker = backendWorker(async () => {
    dispatches += 1;
    return result({
      revision: `rev-${dispatches + 1}`,
      gaps: dispatches === 1 ? [{ id: "gap-policy", summary: "Policy owner decision required." }] : []
    });
  });
  const advisor = createBackendAdvisor({
    async assess() {
      return {
        action: BackendAdvisorAction.ESCALATE,
        gapIds: ["gap-policy"],
        rationale: "Application policy owner must decide whether this compatibility tradeoff is acceptable."
      };
    }
  });

  await withWorkflow({ worker, advisor }, async ({ makeWorkflow }) => {
    const first = await makeWorkflow().advance({ itemId: "BB-042-TASK", owner: "session-a" });
    assert.equal(first.stage, BackendQaWorkflowStage.BACKEND_COORDINATION_PENDING);
    assert.equal(first.coordination.action, BackendRunAction.ESCALATE);
    assert.match(first.item.blockers[0], /application resolution/);

    const fresh = makeWorkflow();
    await fresh.advance({ itemId: "BB-042-TASK", owner: "session-b" });
    assert.equal(dispatches, 1);

    const resolved = await fresh.resolveBackendCoordination({
      itemId: "BB-042-TASK",
      owner: "policy-owner",
      rationale: "Policy owner reviewed the tradeoff and authorized another bounded attempt."
    });
    assert.equal(resolved.stage, BackendQaWorkflowStage.BACKEND_PENDING);
    assert.equal(resolved.resolution.action, BackendRunAction.ESCALATE);
    assert.equal(resolved.resolution.resolvedBy, "policy-owner");

    const retried = await makeWorkflow().advance({ itemId: "BB-042-TASK", owner: "session-c" });
    assert.equal(retried.stage, BackendQaWorkflowStage.QA_PENDING);
    assert.equal(dispatches, 2);
  });
});

test("BB-042 keeps RETRY as eligible retry without fabricating a coordination requirement", async () => {
  let dispatches = 0;
  const worker = backendWorker(async () => {
    dispatches += 1;
    return result({
      revision: `rev-${dispatches + 1}`,
      gaps: dispatches === 1 ? [{ id: "gap-retry", summary: "Implementation can be corrected locally." }] : []
    });
  });
  const advisor = createBackendAdvisor({
    async assess() {
      return {
        action: BackendAdvisorAction.RETRY_IMPLEMENTATION,
        gapIds: ["gap-retry"],
        rationale: "Retry the bounded implementation with the existing context."
      };
    }
  });

  await withWorkflow({ worker, advisor }, async ({ makeWorkflow }) => {
    const first = await makeWorkflow().advance({ itemId: "BB-042-TASK", owner: "session-a" });
    assert.equal(first.stage, BackendQaWorkflowStage.BACKEND_PENDING);
    assert.equal(first.item.status, BlackboardStatus.REOPENED);
    assert.equal(first.backend.decision.action, BackendRunAction.RETRY);
    assert.equal(first.item.checkpoint.coordination ?? null, null);

    const second = await makeWorkflow().advance({ itemId: "BB-042-TASK", owner: "session-b" });
    assert.equal(second.stage, BackendQaWorkflowStage.QA_PENDING);
    assert.equal(dispatches, 2);
  });
});

test("BB-042 preserves deterministic CONTINUE when no Advisor is configured", async () => {
  let dispatches = 0;
  const worker = backendWorker(async () => {
    dispatches += 1;
    return result({ gaps: [{ id: "gap-unowned", summary: "No Advisor is configured for this gap." }] });
  });

  await withWorkflow({ worker }, async ({ makeWorkflow }) => {
    const first = await makeWorkflow().advance({ itemId: "BB-042-TASK", owner: "session-a" });
    assert.equal(first.stage, BackendQaWorkflowStage.BACKEND_PENDING);
    assert.equal(first.backend.decision.action, BackendRunAction.CONTINUE);
    assert.equal(first.item.status, BlackboardStatus.REOPENED);
    assert.equal(first.item.checkpoint.coordination ?? null, null);

    await makeWorkflow().advance({ itemId: "BB-042-TASK", owner: "session-b" });
    assert.equal(dispatches, 2);
  });
});

test("BB-042 ordinary accepted Backend completion still advances directly to QA_PENDING", async () => {
  let dispatches = 0;
  const worker = backendWorker(async () => {
    dispatches += 1;
    return result({ revision: "rev-2", gaps: [] });
  });

  await withWorkflow({ worker }, async ({ makeWorkflow }) => {
    const accepted = await makeWorkflow().advance({ itemId: "BB-042-TASK", owner: "session-a" });
    assert.equal(accepted.stage, BackendQaWorkflowStage.QA_PENDING);
    assert.equal(accepted.item.status, BlackboardStatus.REOPENED);
    assert.equal(accepted.item.checkpoint.coordination ?? null, null);
    assert.equal(dispatches, 1);
  });
});
