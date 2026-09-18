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
  ArtifactManifestErrorCode,
  BackendEvidenceClaim,
  BackendQaWorkflowStage,
  BackendWorkStatus,
  BlackboardStatus,
  QaEvidenceClaim,
  QaWorkStatus,
  captureAcceptedBackendArtifactManifest,
  createApplicationOrchestrator,
  createBackendWorker,
  createDurableBackendQaWorkflow,
  createJsonArtifactManifestStore,
  createJsonBlackboardStore,
  createManifestArtifactReader,
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
    id: "bb044-backend",
    task: "Produce one accepted Backend revision for manifest-publication research.",
    repository: { ref: "repo://bb044", revision: "rev-1" },
    requiredFiles: ["src/server.js", "test/server.test.js"],
    constraints: []
  });
}

function qaObjective() {
  return defineQaObjective({
    id: "bb044-qa",
    task: "Verify the exact accepted Backend bytes.",
    requiredArtifactPaths: ["src/server.js", "test/server.test.js"],
    acceptanceCriteria: ["QA must consume bytes protected by the producer manifest."]
  });
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

function producedContent(ref) {
  return `resolved artifact: ${ref}\n`;
}

function underlyingArtifactReader() {
  return {
    async readArtifact({ ref }) {
      return {
        content: producedContent(ref),
        sourceRef: `producer-store:${ref}`
      };
    }
  };
}

function workspace() {
  return {
    async act({ candidate }) {
      return {
        mutated: true,
        candidate: { id: candidate.id, version: "rev-2" },
        result: {
          artifacts: [
            { ref: "workspace://rev-2/src/server.js", path: "src/server.js" },
            { ref: "workspace://rev-2/test/server.test.js", path: "test/server.test.js" }
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

function backendWorker() {
  return createBackendWorker({
    workspace: workspace(),
    verifiers: [
      verifier("backend-typecheck", BackendEvidenceClaim.TYPECHECK),
      verifier("backend-tests", BackendEvidenceClaim.TESTS)
    ],
    strategy: {
      async run({ invoke }) {
        const action = await invoke(AVOCapability.ACT, { kind: "APPLY_BACKEND_CHANGE" });
        await invoke(verificationCapabilityName("backend-typecheck"));
        await invoke(verificationCapabilityName("backend-tests"));
        const evaluation = await invoke(AVOCapability.EVALUATE);
        assert.equal(evaluation.verdict, EvaluationVerdict.PASS);
        await invoke(AVOCapability.PROMOTE);
        return {
          status: BackendWorkStatus.APPLIED,
          summary: "Applied fixture Backend change.",
          revision: action.candidate.version,
          artifacts: action.result.artifacts,
          gaps: [],
          blockers: []
        };
      }
    }
  });
}

function qaWorker() {
  return createQaWorker({
    verifiers: [
      verifier("qa-behavior", QaEvidenceClaim.BEHAVIOR),
      verifier("qa-regression", QaEvidenceClaim.REGRESSION)
    ],
    strategy: {
      async run({ input, invoke }) {
        assert.equal(input.work.context.upstream.revision, "rev-2");
        await invoke(verificationCapabilityName("qa-behavior"));
        await invoke(verificationCapabilityName("qa-regression"));
        const evaluation = await invoke(AVOCapability.EVALUATE);
        assert.equal(evaluation.verdict, EvaluationVerdict.PASS);
        return {
          status: QaWorkStatus.VERIFIED,
          summary: "QA fixture accepted exact bytes.",
          verifiedRevision: "rev-2",
          inspectedArtifacts: input.work.context.artifacts.map(({ ref, path }) => ({ ref, path })),
          evidence: [],
          issues: [],
          blockers: []
        };
      }
    }
  });
}

function workItem() {
  return {
    id: "BB-044-FIXTURE",
    work: "Research manifest publication ordering.",
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
  id: "bb044-manifest-publication",
  objective: "Keep QA behind a durable producer-side artifact manifest.",
  bullets: ["Do not infer manifest durability from QA-side reads."],
  constraints: ["Do not replay Backend effects merely to recreate manifest state."]
});

async function fixture(run) {
  const directory = await mkdtemp(join(tmpdir(), "exharness-bb044-"));
  try {
    const boardPath = join(directory, "blackboard.json");
    const manifestPath = join(directory, "manifests");
    const makeOrchestrator = () => createApplicationOrchestrator({
      store: createJsonBlackboardStore({ path: boardPath }),
      reviewTrust: reviewTrustStub()
    });
    const orchestrator = makeOrchestrator();
    await createSessionHandoffSurface({ orchestrator }).initialize({
      userIntent: USER_INTENT,
      items: [workItem()]
    });
    await run({ manifestPath, makeOrchestrator, orchestrator });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function makeWorkflow({ orchestrator, manifestPath }) {
  const manifestStore = createJsonArtifactManifestStore({ path: manifestPath });
  return {
    manifestStore,
    workflow: createDurableBackendQaWorkflow({
      orchestrator,
      repositoryReader: repositoryReader(),
      artifactReader: createManifestArtifactReader({
        reader: underlyingArtifactReader(),
        manifestStore
      }),
      backendWorker: backendWorker(),
      qaWorker: qaWorker()
    })
  };
}

test("BB-044 reproduces QA_PENDING visibility before any producer manifest exists", async () => {
  await fixture(async ({ manifestPath, orchestrator }) => {
    const { workflow, manifestStore } = makeWorkflow({ orchestrator, manifestPath });

    await workflow.initialize({
      itemId: "BB-044-FIXTURE",
      owner: "session-a",
      backendObjective: backendObjective(),
      qaObjective: qaObjective()
    });
    const backend = await workflow.advance({ itemId: "BB-044-FIXTURE", owner: "session-a" });

    assert.equal(backend.stage, BackendQaWorkflowStage.QA_PENDING);
    assert.equal(backend.item.status, BlackboardStatus.REOPENED);
    assert.equal(backend.item.checkpoint.stage, BackendQaWorkflowStage.QA_PENDING);
    assert.equal("manifestRef" in backend.item.checkpoint.acceptedBackend, false);

    const candidates = await manifestStore.findCandidates({
      ref: backend.handoff.artifacts[0].ref,
      path: backend.handoff.artifacts[0].path
    });
    assert.deepEqual(candidates, []);
  });
});

test("BB-044 fresh QA blocks on missing manifest only after QA_PENDING was already durable", async () => {
  await fixture(async ({ manifestPath, orchestrator, makeOrchestrator }) => {
    const first = makeWorkflow({ orchestrator, manifestPath }).workflow;
    await first.initialize({
      itemId: "BB-044-FIXTURE",
      owner: "session-a",
      backendObjective: backendObjective(),
      qaObjective: qaObjective()
    });
    await first.advance({ itemId: "BB-044-FIXTURE", owner: "session-a" });

    const freshOrchestrator = makeOrchestrator();
    const fresh = makeWorkflow({ orchestrator: freshOrchestrator, manifestPath }).workflow;
    const blocked = await fresh.advance({ itemId: "BB-044-FIXTURE", owner: "session-b" });

    assert.equal(blocked.stage, BackendQaWorkflowStage.BLOCKED);
    assert.equal(blocked.item.status, BlackboardStatus.BLOCKED);
    assert.equal(blocked.item.checkpoint.stage, BackendQaWorkflowStage.QA_PENDING);
    assert.match(blocked.item.blockers[0], /artifact manifest missing/);
  });
});

test("BB-044 producer publication can unblock QA, but current workflow cannot prove it happened before QA_PENDING", async () => {
  await fixture(async ({ manifestPath, orchestrator, makeOrchestrator }) => {
    const { workflow } = makeWorkflow({ orchestrator, manifestPath });
    await workflow.initialize({
      itemId: "BB-044-FIXTURE",
      owner: "session-a",
      backendObjective: backendObjective(),
      qaObjective: qaObjective()
    });
    const backend = await workflow.advance({ itemId: "BB-044-FIXTURE", owner: "session-a" });

    const manifest = captureAcceptedBackendArtifactManifest({
      backendRun: backend.backend,
      producedArtifacts: backend.handoff.artifacts.map((artifact) => ({
        ...artifact,
        storedRevision: backend.handoff.revision,
        content: producedContent(artifact.ref)
      })),
      retention: {
        policyRevision: "bb044-retention@1",
        pinnedBy: ["BB-044-FIXTURE:QA_PENDING"]
      }
    });
    const manifestRef = await createJsonArtifactManifestStore({ path: manifestPath }).putManifest(manifest);
    assert.match(manifestRef, /^artifact-manifest:\/\/sha256:/);

    const freshOrchestrator = makeOrchestrator();
    const fresh = makeWorkflow({ orchestrator: freshOrchestrator, manifestPath }).workflow;
    const qa = await fresh.advance({ itemId: "BB-044-FIXTURE", owner: "session-b" });

    assert.equal(qa.stage, BackendQaWorkflowStage.AWAITING_REVIEW);
    assert.equal(qa.item.status, BlackboardStatus.PENDING_REVIEW);
    assert.equal("manifestRef" in backend.item.checkpoint.acceptedBackend, false);
  });
});
