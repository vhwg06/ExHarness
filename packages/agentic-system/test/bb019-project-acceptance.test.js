import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  ClaimStatus,
  createAttestationIssuer,
  createEvidenceArtifact,
  environmentRefFromValue,
  policyRefFromValue,
  subjectFromValue
} from "../../core-harness/src/index.js";
import {
  BackendEvidenceClaim,
  BackendQaWorkflowStage,
  BackendWorkStatus,
  BlackboardStatus,
  QaEvidenceClaim,
  QaWorkStatus,
  ReviewRequirementSource,
  ReviewVerdict,
  createApplicationOrchestrator,
  createBackendQaProjectAcceptanceController,
  createDurableBackendQaWorkflow,
  createJsonBlackboardStore,
  createJsonTrustArtifactStore,
  defineBackendObjective,
  defineQaObjective
} from "../src/index.js";

const ACCEPTANCE_POLICY = Object.freeze({
  name: "backend-qa-project-acceptance",
  requiredInputs: ["backend", "qa", "application-artifacts"],
  version: 1
});

const ACCEPTANCE_POLICY_REF = policyRefFromValue(
  "backend-qa-project-acceptance-policy",
  ACCEPTANCE_POLICY,
  { version: "1" }
);

const ROLE_ENV = environmentRefFromValue(
  { image: "role-verification@sha256:bb019-role" },
  { name: "bb019-role-verification" }
);

const REVIEW_ENV = environmentRefFromValue(
  { image: "project-review@sha256:bb019-review" },
  { name: "bb019-project-review" }
);

const ATTEST_ENV = environmentRefFromValue(
  { image: "project-attest@sha256:bb019-attest" },
  { name: "bb019-project-attestation" }
);

const GENERATED_AT = "2026-09-16T15:00:00.000Z";
const ITEM_ID = "BB-019-TEST";

function reviewTrust() {
  return {
    trustPolicyFor() {
      return {
        acceptedIssuers: ["project-attestor"],
        acceptedPolicyDigests: [ACCEPTANCE_POLICY_REF.digest],
        acceptedEnvironmentDigests: [ATTEST_ENV.digest],
        acceptedEvaluators: ["project-reviewer"],
        acceptedEvidenceProducers: ["project-verifier"],
        acceptedEvidenceEnvironmentDigests: [REVIEW_ENV.digest]
      };
    },
    verifySignature({ payloadDigest, signature }) {
      return signature?.value === `signed:${payloadDigest}`;
    },
    verifyEvaluatorAuthority({ evaluator, reviewer }) {
      return evaluator?.identity === reviewer && evaluator.roles.includes("reviewer");
    },
    verifyEvidenceAuthority({ producer, environment }) {
      return producer?.identity === "project-verifier" &&
        producer.roles.includes("verifier") &&
        environment?.digest === REVIEW_ENV.digest;
    }
  };
}

function workItem() {
  return {
    id: ITEM_ID,
    work: "Deliver Backend change through QA and trusted project acceptance.",
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
    id: "bb019-backend",
    task: "Implement the accepted Backend change.",
    repository: {
      ref: "repo://bb019",
      revision: "rev-1"
    },
    requiredFiles: ["src/server.js"],
    constraints: ["preserve existing behavior"]
  });
}

function qaObjective() {
  return defineQaObjective({
    id: "bb019-qa",
    task: "Verify the accepted Backend change.",
    requiredArtifactPaths: ["src/server.js"],
    acceptanceCriteria: ["behavior is verified"]
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

function applicationArtifactReader(control = { fail: false }) {
  return {
    async readArtifact({ ref }) {
      if (control.fail) throw new Error(`application artifact unavailable: ${ref}`);
      return {
        content: `artifact:${ref}\n`,
        sourceRef: `application-artifact:${ref}`
      };
    }
  };
}

function roleEvidence({ role, revision, claim }) {
  return createEvidenceArtifact({
    subject: subjectFromValue(
      { role, revision, claim },
      {
        type: `${role}-verification-target`,
        producer: { identity: `${role}-worker`, roles: ["producer"] }
      }
    ),
    kind: "ROLE_VERIFICATION",
    producer: { identity: `${role}-verifier`, roles: ["verifier"] },
    environment: ROLE_ENV,
    content: { revision, claim, passed: true },
    generatedAt: GENERATED_AT,
    metadata: {
      claim,
      verificationStatus: "PASS"
    }
  });
}

function backendWorker(state) {
  return {
    async execute() {
      state.revision += 1;
      const revision = `rev-${state.revision}`;
      return {
        status: BackendWorkStatus.APPLIED,
        summary: `Backend applied at ${revision}.`,
        revision,
        artifacts: [{
          ref: `workspace://${revision}/src/server.js`,
          path: "src/server.js"
        }],
        evidence: [
          BackendEvidenceClaim.MUTATION,
          BackendEvidenceClaim.TYPECHECK,
          BackendEvidenceClaim.TESTS
        ].map((claim) => roleEvidence({ role: "backend", revision, claim })),
        gaps: [],
        blockers: []
      };
    }
  };
}

function qaWorker() {
  return {
    async execute(order) {
      const revision = order.upstream.revision;
      return {
        status: QaWorkStatus.VERIFIED,
        summary: `QA verified ${revision}.`,
        verifiedRevision: revision,
        inspectedArtifacts: order.requiredArtifacts,
        evidence: [
          QaEvidenceClaim.BEHAVIOR,
          QaEvidenceClaim.REGRESSION
        ].map((claim) => roleEvidence({ role: "qa", revision, claim })),
        issues: [],
        blockers: []
      };
    }
  };
}

function projectVerifier(control = { failOnce: false }) {
  return {
    async verify({ subject, submission }) {
      if (control.failOnce) {
        control.failOnce = false;
        throw new Error("project verifier interrupted");
      }
      return [createEvidenceArtifact({
        subject,
        kind: "BACKEND_QA_PROJECT_ACCEPTANCE",
        producer: { identity: "project-verifier", roles: ["verifier"] },
        environment: REVIEW_ENV,
        content: {
          acceptedRevision: submission.acceptedRevision,
          checked: true
        },
        generatedAt: GENERATED_AT,
        metadata: { projectAcceptance: true }
      })];
    }
  };
}

function projectEvaluator(control = { verdict: ReviewVerdict.ACCEPTED, blocker: null }) {
  return {
    async evaluate() {
      const accepted = control.verdict === ReviewVerdict.ACCEPTED;
      const blocker = control.blocker ?? "Project acceptance requirement failed.";
      return {
        verdict: control.verdict,
        claims: [{
          name: "project.acceptance",
          status: accepted ? ClaimStatus.SATISFIED : ClaimStatus.UNSATISFIED
        }],
        unresolved: accepted
          ? []
          : [{ type: "PROJECT_ACCEPTANCE_BLOCKER", summary: blocker }],
        findings: []
      };
    }
  };
}

function attestationIssuer() {
  return createAttestationIssuer({
    identity: "project-attestor",
    roles: ["attestor"],
    async sign({ payloadDigest }) {
      return {
        algorithm: "test",
        value: `signed:${payloadDigest}`
      };
    }
  });
}

function projectAcceptance({
  orchestrator,
  trustArtifactStore,
  artifactReader,
  evaluatorControl = { verdict: ReviewVerdict.ACCEPTED, blocker: null },
  verifierControl = { failOnce: false }
}) {
  return createBackendQaProjectAcceptanceController({
    orchestrator,
    trustArtifactStore,
    artifactReader,
    requirement: {
      source: ReviewRequirementSource.PM,
      reason: "Project completion requires trusted Backend/QA acceptance.",
      authorizedBy: {
        identity: "project-pm",
        version: "1"
      }
    },
    reviewer: {
      identity: "project-reviewer",
      version: "1"
    },
    verifier: projectVerifier(verifierControl),
    evaluator: projectEvaluator(evaluatorControl),
    attestationIssuer: attestationIssuer(),
    acceptancePolicy: ACCEPTANCE_POLICY,
    attestationEnvironment: ATTEST_ENV,
    now: () => GENERATED_AT
  });
}

function workflow({
  orchestrator,
  trustArtifactStore,
  artifactReader,
  backendState,
  evaluatorControl,
  verifierControl
}) {
  const acceptance = projectAcceptance({
    orchestrator,
    trustArtifactStore,
    artifactReader,
    evaluatorControl,
    verifierControl
  });
  return createDurableBackendQaWorkflow({
    orchestrator,
    repositoryReader: repositoryReader(),
    artifactReader,
    backendWorker: backendWorker(backendState),
    qaWorker: qaWorker(),
    projectAcceptance: acceptance
  });
}

async function withProject(run) {
  const directory = await mkdtemp(join(tmpdir(), "exharness-bb019-"));
  try {
    const boardPath = join(directory, "blackboard.json");
    const trustPath = join(directory, "trust-artifacts");
    const makeOrchestrator = () => createApplicationOrchestrator({
      store: createJsonBlackboardStore({ path: boardPath }),
      reviewTrust: reviewTrust()
    });
    const makeTrustStore = () => createJsonTrustArtifactStore({ path: trustPath });
    const orchestrator = makeOrchestrator();
    await orchestrator.seed([workItem()]);
    await run({
      directory,
      boardPath,
      trustPath,
      orchestrator,
      makeOrchestrator,
      makeTrustStore
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function runToProjectReview({
  orchestrator,
  trustArtifactStore,
  artifactReader,
  backendState,
  evaluatorControl,
  verifierControl
}) {
  const first = workflow({
    orchestrator,
    trustArtifactStore,
    artifactReader,
    backendState,
    evaluatorControl,
    verifierControl
  });
  await first.initialize({
    itemId: ITEM_ID,
    owner: "backend-session",
    backendObjective: backendObjective(),
    qaObjective: qaObjective()
  });
  const backend = await first.advance({ itemId: ITEM_ID, owner: "backend-session" });
  assert.equal(backend.stage, BackendQaWorkflowStage.QA_PENDING);

  const qa = await first.advance({ itemId: ITEM_ID, owner: "qa-session" });
  assert.equal(qa.stage, BackendQaWorkflowStage.AWAITING_REVIEW);
  assert.equal(qa.item.status, BlackboardStatus.PENDING_REVIEW);
  assert.equal(qa.item.reviewRequirements.length, 1);
  assert.equal(qa.item.reviewRequirements[0].source, ReviewRequirementSource.PM);
  return qa;
}

test("BB-019 reaches DONE only after trusted project acceptance survives fresh-session reconstruction", async () => {
  await withProject(async ({ orchestrator, makeOrchestrator, makeTrustStore }) => {
    const backendState = { revision: 1 };
    const artifacts = applicationArtifactReader();
    const qa = await runToProjectReview({
      orchestrator,
      trustArtifactStore: makeTrustStore(),
      artifactReader: artifacts,
      backendState
    });

    const stored = makeTrustStore();
    assert.equal(
      (await stored.readDecision(qa.item.submission.backendAcceptanceDecision)).id,
      qa.item.submission.backendAcceptanceDecision.id
    );
    assert.equal(
      (await stored.readDecision(qa.item.submission.qaAcceptanceDecision)).id,
      qa.item.submission.qaAcceptanceDecision.id
    );

    const freshOrchestrator = makeOrchestrator();
    const fresh = workflow({
      orchestrator: freshOrchestrator,
      trustArtifactStore: makeTrustStore(),
      artifactReader: artifacts,
      backendState
    });
    const reviewed = await fresh.review({ itemId: ITEM_ID });

    assert.equal(reviewed.item.status, BlackboardStatus.DONE);
    assert.equal(reviewed.item.reviews.length, 1);
    assert.equal(reviewed.item.reviews[0].verdict, ReviewVerdict.ACCEPTED);
    assert.equal(reviewed.item.owner, null);
    assert.equal((await fresh.current({ itemId: ITEM_ID })).stage, BackendQaWorkflowStage.AWAITING_REVIEW);
  });
});

test("BB-019 fails closed before review dispatch when a declared application artifact is unavailable", async () => {
  await withProject(async ({ orchestrator, makeOrchestrator, makeTrustStore }) => {
    const backendState = { revision: 1 };
    const control = { fail: false };
    const artifacts = applicationArtifactReader(control);
    await runToProjectReview({
      orchestrator,
      trustArtifactStore: makeTrustStore(),
      artifactReader: artifacts,
      backendState
    });

    control.fail = true;
    const freshOrchestrator = makeOrchestrator();
    const fresh = workflow({
      orchestrator: freshOrchestrator,
      trustArtifactStore: makeTrustStore(),
      artifactReader: artifacts,
      backendState
    });

    await assert.rejects(
      () => fresh.review({ itemId: ITEM_ID }),
      /application artifact unavailable/
    );
    const item = (await freshOrchestrator.readBlackboard()).items.find((candidate) => candidate.id === ITEM_ID);
    assert.equal(item.status, BlackboardStatus.PENDING_REVIEW);
    assert.equal(item.activeReview, null);
    assert.equal(item.reviews.length, 0);
  });
});

test("BB-019 trusted rejection reopens the same item and resumes Backend remediation before a later acceptance", async () => {
  await withProject(async ({ orchestrator, makeOrchestrator, makeTrustStore }) => {
    const backendState = { revision: 1 };
    const artifacts = applicationArtifactReader();
    const evaluatorControl = {
      verdict: ReviewVerdict.REJECTED,
      blocker: "Project acceptance found an unresolved contract mismatch."
    };
    await runToProjectReview({
      orchestrator,
      trustArtifactStore: makeTrustStore(),
      artifactReader: artifacts,
      backendState,
      evaluatorControl
    });

    let freshOrchestrator = makeOrchestrator();
    let fresh = workflow({
      orchestrator: freshOrchestrator,
      trustArtifactStore: makeTrustStore(),
      artifactReader: artifacts,
      backendState,
      evaluatorControl
    });
    const rejected = await fresh.review({ itemId: ITEM_ID });
    assert.equal(rejected.item.status, BlackboardStatus.REOPENED);
    assert.equal(rejected.stage, BackendQaWorkflowStage.BACKEND_REMEDIATION_PENDING);
    assert.deepEqual(rejected.item.remainingWork, [evaluatorControl.blocker]);

    freshOrchestrator = makeOrchestrator();
    fresh = workflow({
      orchestrator: freshOrchestrator,
      trustArtifactStore: makeTrustStore(),
      artifactReader: artifacts,
      backendState,
      evaluatorControl
    });
    assert.equal((await fresh.current({ itemId: ITEM_ID })).stage, BackendQaWorkflowStage.BACKEND_REMEDIATION_PENDING);

    const remediated = await fresh.advance({ itemId: ITEM_ID, owner: "remediation-session" });
    assert.equal(remediated.stage, BackendQaWorkflowStage.QA_PENDING);
    assert.equal(remediated.item.checkpoint.acceptedBackend.handoff.revision, "rev-3");
    assert.deepEqual(remediated.item.remainingWork, ["Run QA verification against the accepted Backend revision."]);

    const resubmitted = await fresh.advance({ itemId: ITEM_ID, owner: "qa-resubmit-session" });
    assert.equal(resubmitted.item.status, BlackboardStatus.PENDING_REVIEW);
    assert.equal(resubmitted.item.submission.acceptedRevision, "rev-3");

    evaluatorControl.verdict = ReviewVerdict.ACCEPTED;
    evaluatorControl.blocker = null;
    freshOrchestrator = makeOrchestrator();
    fresh = workflow({
      orchestrator: freshOrchestrator,
      trustArtifactStore: makeTrustStore(),
      artifactReader: artifacts,
      backendState,
      evaluatorControl
    });
    const accepted = await fresh.review({ itemId: ITEM_ID });
    assert.equal(accepted.item.status, BlackboardStatus.DONE);
  });
});

test("BB-019 review interruption remains REVIEWING and a fresh session recovers with a new fenced review generation", async () => {
  await withProject(async ({ orchestrator, makeOrchestrator, makeTrustStore }) => {
    const backendState = { revision: 1 };
    const artifacts = applicationArtifactReader();
    const verifierControl = { failOnce: false };
    await runToProjectReview({
      orchestrator,
      trustArtifactStore: makeTrustStore(),
      artifactReader: artifacts,
      backendState,
      verifierControl
    });

    verifierControl.failOnce = true;
    let freshOrchestrator = makeOrchestrator();
    let fresh = workflow({
      orchestrator: freshOrchestrator,
      trustArtifactStore: makeTrustStore(),
      artifactReader: artifacts,
      backendState,
      verifierControl
    });
    await assert.rejects(() => fresh.review({ itemId: ITEM_ID }), /project verifier interrupted/);

    let item = (await freshOrchestrator.readBlackboard()).items.find((candidate) => candidate.id === ITEM_ID);
    assert.equal(item.status, BlackboardStatus.REVIEWING);
    assert.equal(item.reviewGeneration, 1);
    assert.equal(item.activeReview.generation, 1);

    freshOrchestrator = makeOrchestrator();
    fresh = workflow({
      orchestrator: freshOrchestrator,
      trustArtifactStore: makeTrustStore(),
      artifactReader: artifacts,
      backendState,
      verifierControl
    });
    const recovered = await fresh.recoverReview({
      itemId: ITEM_ID,
      reason: "Reviewer session terminated before assessment publication."
    });
    assert.equal(recovered.item.status, BlackboardStatus.DONE);
    assert.equal(recovered.review.generation, 2);

    item = (await freshOrchestrator.readBlackboard()).items.find((candidate) => candidate.id === ITEM_ID);
    assert.equal(item.reviewGeneration, 2);
    assert.equal(item.activeReview, null);
  });
});

test("BB-019 trust persistence failure cannot publish a decision ref into Blackboard", async () => {
  await withProject(async ({ orchestrator, makeTrustStore }) => {
    const backendState = { revision: 1 };
    const artifacts = applicationArtifactReader();
    const baseStore = makeTrustStore();
    const failingStore = {
      putEvidence: (artifact) => baseStore.putEvidence(artifact),
      async putDecision() {
        throw new Error("trust decision persistence failed");
      },
      putAttestation: (artifact) => baseStore.putAttestation(artifact),
      readEvidence: (ref) => baseStore.readEvidence(ref),
      readDecision: (ref) => baseStore.readDecision(ref),
      readAttestation: (ref) => baseStore.readAttestation(ref)
    };
    const acceptance = projectAcceptance({
      orchestrator,
      trustArtifactStore: failingStore,
      artifactReader: artifacts
    });
    const durable = createDurableBackendQaWorkflow({
      orchestrator,
      repositoryReader: repositoryReader(),
      artifactReader: artifacts,
      backendWorker: backendWorker(backendState),
      qaWorker: qaWorker(),
      projectAcceptance: acceptance
    });

    await durable.initialize({
      itemId: ITEM_ID,
      owner: "backend-session",
      backendObjective: backendObjective(),
      qaObjective: qaObjective()
    });
    await assert.rejects(
      () => durable.advance({ itemId: ITEM_ID, owner: "backend-session" }),
      /trust decision persistence failed/
    );

    const item = (await orchestrator.readBlackboard()).items.find((candidate) => candidate.id === ITEM_ID);
    assert.equal(item.status, BlackboardStatus.CLAIMED);
    assert.deepEqual(item.evidenceRefs, []);
    assert.equal(item.checkpoint.stage, BackendQaWorkflowStage.BACKEND_PENDING);
  });
});
