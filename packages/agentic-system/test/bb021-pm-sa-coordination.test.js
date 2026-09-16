import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  ClaimStatus,
  TrustBoundary,
  createAttestationIssuer,
  createDecisionArtifact,
  createEvidenceArtifact,
  environmentRefFromValue,
  policyRefFromValue
} from "../../core-harness/src/index.js";
import {
  BlackboardStatus,
  PmSaCoordinationKind,
  ReviewRequirementSource,
  ReviewVerdict,
  createApplicationOrchestrator,
  createJsonBlackboardStore,
  createJsonPmSaCoordinationArtifactStore,
  createPmSaCoordinationController,
  createSessionHandoffSurface,
  definePmCoordinationProposal,
  defineSaArchitectureAssessment
} from "../src/index.js";

const PROJECT_ID = "bb021-project";
const ITEM_ID = "delivery";
const REVIEW_KEY = "architecture";
const GENERATED_AT = "2026-09-16T16:00:00.000Z";

const REVIEW_POLICY = policyRefFromValue("bb021-architecture-review-policy", {
  required: ["architecture.acceptance"],
  version: 1
}, { version: "1" });

const VERIFY_ENV = environmentRefFromValue(
  { image: "architecture-verify@sha256:bb021" },
  { name: "bb021-architecture-verification" }
);

const ATTEST_ENV = environmentRefFromValue(
  { image: "architecture-attest@sha256:bb021" },
  { name: "bb021-architecture-attestation" }
);

function reviewTrust() {
  return {
    trustPolicyFor() {
      return {
        acceptedIssuers: ["architecture-attestor"],
        acceptedPolicyDigests: [REVIEW_POLICY.digest],
        acceptedEnvironmentDigests: [ATTEST_ENV.digest],
        acceptedEvaluators: ["architecture-reviewer"],
        acceptedEvidenceProducers: ["architecture-verifier"],
        acceptedEvidenceEnvironmentDigests: [VERIFY_ENV.digest]
      };
    },
    verifySignature({ payloadDigest, signature }) {
      return signature?.value === `signed:${payloadDigest}`;
    },
    verifyEvaluatorAuthority({ evaluator, reviewer }) {
      return evaluator?.identity === reviewer && evaluator.roles.includes("reviewer");
    },
    verifyEvidenceAuthority({ producer, environment }) {
      return producer?.identity === "architecture-verifier" &&
        producer.roles.includes("verifier") &&
        environment?.digest === VERIFY_ENV.digest;
    }
  };
}

async function architectureReviewBundle({ subject, reviewer = "architecture-reviewer" }) {
  const evidence = [createEvidenceArtifact({
    subject,
    kind: "ARCHITECTURE_REVIEW",
    producer: { identity: "architecture-verifier", roles: ["verifier"] },
    environment: VERIFY_ENV,
    content: { checked: true },
    generatedAt: GENERATED_AT,
    metadata: { architectureReview: true }
  })];
  const decision = createDecisionArtifact({
    subject,
    boundary: TrustBoundary.ACCEPTANCE,
    policy: REVIEW_POLICY,
    evaluator: { identity: reviewer, roles: ["reviewer"] },
    evidence,
    claims: [{ name: "architecture.acceptance", status: ClaimStatus.SATISFIED }],
    unresolved: [],
    verdict: ReviewVerdict.ACCEPTED,
    generatedAt: GENERATED_AT,
    metadata: { findings: [] }
  });
  const issuer = createAttestationIssuer({
    identity: "architecture-attestor",
    roles: ["attestor"],
    async sign({ payloadDigest }) {
      return { algorithm: "test", value: `signed:${payloadDigest}` };
    }
  });
  const attestation = await issuer.issue({
    decision,
    environment: ATTEST_ENV,
    issuedAt: GENERATED_AT
  });
  return { evidence, decision, attestation };
}

function userIntent() {
  return {
    id: "deliver-backend-change",
    source: "USER",
    objective: "Deliver a Backend change through QA while preserving declared user constraints.",
    bullets: ["Backend implementation", "QA verification"],
    constraints: [
      "preserve public contract compatibility",
      "architecture judgment must not own project coordination"
    ]
  };
}

function workItem({ id, work, evidenceRefs = [], ...overrides }) {
  return {
    id,
    work,
    status: BlackboardStatus.READY,
    dependsOn: [],
    remainingWork: [],
    blockers: [],
    artifactRefs: [],
    evidenceRefs,
    followUpRefs: [],
    reviewRequirements: [],
    reviews: [],
    findings: [],
    ...overrides
  };
}

function deliveryItem(overrides = {}) {
  return workItem({
    id: ITEM_ID,
    work: "Deliver the requested Backend change through QA.",
    artifactRefs: ["artifact:delivery-spec"],
    evidenceRefs: ["evidence:public-contract-diff"],
    ...overrides
  });
}

function recoveryItem() {
  return workItem({
    id: "artifact-recovery",
    work: "Restore the unavailable application artifact source."
  });
}

function secondaryArchitectureItem() {
  return workItem({
    id: "secondary-architecture",
    work: "Assess a separate architecture boundary.",
    evidenceRefs: ["evidence:secondary-architecture"]
  });
}

async function withProject(run, { items = [deliveryItem()] } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "exharness-bb021-"));
  try {
    const boardPath = join(directory, "blackboard.json");
    const coordinationPath = join(directory, "coordination");
    const makeOrchestrator = () => createApplicationOrchestrator({
      store: createJsonBlackboardStore({ path: boardPath }),
      reviewTrust: reviewTrust()
    });
    const makeArtifactStore = () => createJsonPmSaCoordinationArtifactStore({ path: coordinationPath });
    const orchestrator = makeOrchestrator();
    const surface = createSessionHandoffSurface({ orchestrator, projectId: PROJECT_ID });
    await surface.initialize({ userIntent: userIntent(), items });
    await run({ orchestrator, makeOrchestrator, makeArtifactStore, boardPath, coordinationPath });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function assessmentFromContext(context, overrides = {}) {
  return defineSaArchitectureAssessment({
    kind: PmSaCoordinationKind.SA_ASSESSMENT,
    projectId: context.projectId,
    rootIntentId: context.intent.id,
    targetItemId: context.target.id,
    targetWork: context.target.work,
    evidenceRefs: context.evidenceRefs,
    requiresArchitectureReview: true,
    finding: "Public architecture boundary changed; independent architecture review remains required.",
    ...overrides
  });
}

function proposalFromContext(context, overrides = {}) {
  return definePmCoordinationProposal({
    kind: PmSaCoordinationKind.PM_PROPOSAL,
    projectId: context.projectId,
    rootIntentId: context.intent.id,
    target: context.target,
    newWork: [],
    dependencyEdges: [],
    blockers: [],
    reviewRequirements: [],
    progress: { completed: 0, total: 0 },
    intentPatch: null,
    architectureVerdict: null,
    ...overrides
  });
}

test("BB-021 carries an evidence-bound SA assessment into PM-required review and reaches DONE across fresh sessions", async () => {
  await withProject(async ({ orchestrator, makeOrchestrator, makeArtifactStore }) => {
    const controller = createPmSaCoordinationController({
      orchestrator,
      projectId: PROJECT_ID,
      artifactStore: makeArtifactStore()
    });
    const saContext = await controller.prepareSaContext({
      targetItemId: ITEM_ID,
      architectureFacts: { publicBoundaryChanged: true },
      evidenceRefs: ["evidence:public-contract-diff"]
    });
    const persistedAssessment = await controller.persistSaAssessment(assessmentFromContext(saContext));
    const pmContext = await controller.preparePmContext({
      targetItemId: ITEM_ID,
      coordinationFacts: { architectureBoundaryChanged: true },
      saAssessmentRef: persistedAssessment.ref
    });

    assert.equal(pmContext.saAssessment.artifactRef, persistedAssessment.ref);
    assert.equal("evidenceRefs" in pmContext.saAssessment, false, "PM receives bounded SA summary/ref, not SA evidence payload context");

    const proposal = proposalFromContext(pmContext, {
      reviewRequirements: [{
        targetItemId: ITEM_ID,
        key: REVIEW_KEY,
        source: ReviewRequirementSource.PM,
        reasonRef: persistedAssessment.ref
      }],
      progress: { completed: 0, total: 1 }
    });
    const applied = await controller.applyPmProposal(proposal);
    assert.equal(applied.applied, true);
    assert.equal(applied.replayed, false);
    assert.equal(applied.item.reviewRequirements[0].reason, persistedAssessment.ref);

    let freshOrchestrator = makeOrchestrator();
    let freshController = createPmSaCoordinationController({
      orchestrator: freshOrchestrator,
      projectId: PROJECT_ID,
      artifactStore: makeArtifactStore()
    });
    const recovered = await freshController.recoverCoordination();
    assert.equal(recovered.artifacts.length, 2);
    assert.ok(recovered.artifacts.some((artifact) => artifact.kind === PmSaCoordinationKind.SA_ASSESSMENT));
    assert.ok(recovered.artifacts.some((artifact) => artifact.kind === PmSaCoordinationKind.PM_PROPOSAL));

    const claimed = await freshOrchestrator.claim({ itemId: ITEM_ID, owner: "backend-session" });
    await freshOrchestrator.submit({
      itemId: ITEM_ID,
      owner: "backend-session",
      generation: claimed.result.claimGeneration,
      submission: { revision: "rev-2", artifactRefs: ["artifact:delivery-output"], evidenceRefs: [] }
    });

    freshOrchestrator = makeOrchestrator();
    freshController = createPmSaCoordinationController({
      orchestrator: freshOrchestrator,
      projectId: PROJECT_ID,
      artifactStore: makeArtifactStore()
    });
    const activeReview = await freshController.dispatchArchitectureReview({
      itemId: ITEM_ID,
      key: REVIEW_KEY,
      reviewer: "architecture-reviewer"
    });
    const bundle = await architectureReviewBundle({ subject: activeReview.result.subject });
    const assessed = await freshOrchestrator.recordAssessment({
      itemId: ITEM_ID,
      key: REVIEW_KEY,
      bundle
    });

    assert.equal(assessed.result.status, BlackboardStatus.DONE);
    assert.equal(assessed.result.reviews[0].verdict, ReviewVerdict.ACCEPTED);
  });
});

test("BB-021 applies migration prerequisite work atomically and retries the same proposal through its canonical proposal ref", async () => {
  await withProject(async ({ orchestrator, makeOrchestrator, makeArtifactStore }) => {
    const controller = createPmSaCoordinationController({
      orchestrator,
      projectId: PROJECT_ID,
      artifactStore: makeArtifactStore()
    });
    const pmContext = await controller.preparePmContext({
      targetItemId: ITEM_ID,
      coordinationFacts: { schemaMigrationRequired: true }
    });
    const proposal = proposalFromContext(pmContext, {
      newWork: [{
        id: "migration",
        work: "Apply the required schema migration.",
        remainingWork: ["Apply migration", "Verify compatibility"]
      }],
      dependencyEdges: [{ itemId: ITEM_ID, dependencyId: "migration" }],
      progress: { completed: 0, total: 3 }
    });

    const first = await controller.applyPmProposal(proposal);
    const second = await controller.applyPmProposal(proposal);
    assert.equal(first.replayed, false);
    assert.equal(second.replayed, true);
    assert.equal(first.proposalRef, second.proposalRef);

    const fresh = createSessionHandoffSurface({ orchestrator: makeOrchestrator(), projectId: PROJECT_ID });
    const handoff = await fresh.read();
    assert.deepEqual(handoff.lifecycle.eligibleWork.map((item) => item.id), ["migration"]);
    assert.deepEqual(handoff.workGraph.find((item) => item.id === ITEM_ID).dependsOn.sort(), [handoff.rootItemId, "migration"].sort());
    assert.equal(handoff.workGraph.filter((item) => item.id === "migration").length, 1);
    assert.ok(handoff.references.artifacts.some((entry) => entry.itemId === ITEM_ID && entry.ref === first.proposalRef));
  });
});

test("BB-021 atomically links blocker and architecture review, then replays the exact proposal after status changes", async () => {
  await withProject(async ({ orchestrator, makeArtifactStore }) => {
    const controller = createPmSaCoordinationController({
      orchestrator,
      projectId: PROJECT_ID,
      artifactStore: makeArtifactStore()
    });
    const saContext = await controller.prepareSaContext({
      targetItemId: ITEM_ID,
      architectureFacts: { publicBoundaryChanged: true },
      evidenceRefs: ["evidence:public-contract-diff"]
    });
    const assessment = await controller.persistSaAssessment(assessmentFromContext(saContext));
    const pmContext = await controller.preparePmContext({
      targetItemId: ITEM_ID,
      coordinationFacts: { artifactUnavailable: true, architectureBoundaryChanged: true },
      relevantItemIds: [ITEM_ID, "artifact-recovery"],
      saAssessmentRef: assessment.ref
    });
    const proposal = proposalFromContext(pmContext, {
      blockers: [{
        targetItemId: ITEM_ID,
        reason: "Required artifact is unavailable.",
        existingWorkRef: "artifact-recovery"
      }],
      reviewRequirements: [{
        targetItemId: ITEM_ID,
        key: REVIEW_KEY,
        source: ReviewRequirementSource.PM,
        reasonRef: assessment.ref
      }],
      progress: { completed: 0, total: 2 }
    });

    const first = await controller.applyPmProposal(proposal);
    assert.equal(first.replayed, false);
    assert.equal(first.item.status, BlackboardStatus.BLOCKED);
    assert.deepEqual(first.item.blockers, ["Required artifact is unavailable."]);
    assert.equal(first.item.reviewRequirements[0].reason, assessment.ref);

    const second = await controller.applyPmProposal(proposal);
    assert.equal(second.replayed, true);
    assert.equal(second.proposalRef, first.proposalRef);
    assert.equal(second.item.status, BlackboardStatus.BLOCKED);
    assert.equal(second.item.reviewRequirements.length, 1);
  }, { items: [deliveryItem(), recoveryItem()] });
});

test("BB-021 links an existing recovery item and blocks the affected work instead of inventing replacement work", async () => {
  await withProject(async ({ orchestrator, makeOrchestrator, makeArtifactStore }) => {
    const controller = createPmSaCoordinationController({
      orchestrator,
      projectId: PROJECT_ID,
      artifactStore: makeArtifactStore()
    });
    const pmContext = await controller.preparePmContext({
      targetItemId: ITEM_ID,
      coordinationFacts: { artifactUnavailable: true, recoveryWorkRef: "artifact-recovery" },
      relevantItemIds: [ITEM_ID, "artifact-recovery"]
    });
    const proposal = proposalFromContext(pmContext, {
      blockers: [{
        targetItemId: ITEM_ID,
        reason: "Required artifact is unavailable.",
        existingWorkRef: "artifact-recovery"
      }],
      progress: { completed: 0, total: 1 }
    });

    const applied = await controller.applyPmProposal(proposal);
    assert.equal(applied.item.status, BlackboardStatus.BLOCKED);
    assert.deepEqual(applied.item.blockers, ["Required artifact is unavailable."]);

    const handoff = await createSessionHandoffSurface({ orchestrator: makeOrchestrator(), projectId: PROJECT_ID }).read();
    const delivery = handoff.workGraph.find((item) => item.id === ITEM_ID);
    assert.ok(delivery.dependsOn.includes("artifact-recovery"));
    assert.deepEqual(handoff.lifecycle.blocked.map((item) => item.id), [ITEM_ID]);
    assert.equal(handoff.workGraph.filter((item) => item.id.startsWith("replacement")).length, 0);
  }, { items: [deliveryItem(), recoveryItem()] });
});

test("BB-021 rejects an SA assessment from different work when building PM context", async () => {
  await withProject(async ({ orchestrator, makeArtifactStore }) => {
    const controller = createPmSaCoordinationController({
      orchestrator,
      projectId: PROJECT_ID,
      artifactStore: makeArtifactStore()
    });
    const secondaryContext = await controller.prepareSaContext({
      targetItemId: "secondary-architecture",
      architectureFacts: { boundary: "secondary" },
      evidenceRefs: ["evidence:secondary-architecture"]
    });
    const assessment = await controller.persistSaAssessment(assessmentFromContext(secondaryContext));

    await assert.rejects(
      () => controller.preparePmContext({
        targetItemId: ITEM_ID,
        coordinationFacts: {},
        saAssessmentRef: assessment.ref
      }),
      /targets different work/
    );
  }, { items: [deliveryItem(), secondaryArchitectureItem()] });
});

test("BB-021 fails closed on authority violations, stale state and stale evidence, while an empty proposal falls back without mutation", async () => {
  assert.throws(() => definePmCoordinationProposal({
    kind: PmSaCoordinationKind.PM_PROPOSAL,
    projectId: PROJECT_ID,
    rootIntentId: "intent",
    target: { itemId: ITEM_ID, status: BlackboardStatus.READY, claimGeneration: 0, reviewGeneration: 0 },
    intentPatch: { objective: "invented objective" }
  }), /cannot rewrite user intent/);

  assert.throws(() => definePmCoordinationProposal({
    kind: PmSaCoordinationKind.PM_PROPOSAL,
    projectId: PROJECT_ID,
    rootIntentId: "intent",
    target: { itemId: ITEM_ID, status: BlackboardStatus.READY, claimGeneration: 0, reviewGeneration: 0 },
    architectureVerdict: "ACCEPTED"
  }), /architecture verdict authority/);

  assert.throws(() => definePmCoordinationProposal({
    kind: PmSaCoordinationKind.PM_PROPOSAL,
    projectId: PROJECT_ID,
    rootIntentId: "intent",
    target: { itemId: ITEM_ID, status: BlackboardStatus.READY, claimGeneration: 0, reviewGeneration: 0 },
    reviewRequirements: [
      { targetItemId: ITEM_ID, key: REVIEW_KEY, source: ReviewRequirementSource.PM, reasonRef: "coordination:a" },
      { targetItemId: ITEM_ID, key: REVIEW_KEY, source: ReviewRequirementSource.PM, reasonRef: "coordination:b" }
    ]
  }), /duplicate review requirement architecture/);

  assert.throws(() => defineSaArchitectureAssessment({
    kind: PmSaCoordinationKind.SA_ASSESSMENT,
    projectId: PROJECT_ID,
    rootIntentId: "intent",
    targetItemId: ITEM_ID,
    targetWork: "work",
    evidenceRefs: ["evidence:x"],
    requiresArchitectureReview: true,
    finding: "finding",
    dependsOn: ["backend"]
  }), /cannot carry dependsOn authority/);

  await withProject(async ({ orchestrator, makeArtifactStore }) => {
    const controller = createPmSaCoordinationController({
      orchestrator,
      projectId: PROJECT_ID,
      artifactStore: makeArtifactStore()
    });
    await assert.rejects(
      () => controller.prepareSaContext({
        targetItemId: ITEM_ID,
        architectureFacts: { publicBoundaryChanged: true },
        evidenceRefs: ["evidence:not-current"]
      }),
      /evidence is not current/
    );

    const pmContext = await controller.preparePmContext({
      targetItemId: ITEM_ID,
      coordinationFacts: {}
    });
    const empty = await controller.applyPmProposal(proposalFromContext(pmContext));
    assert.equal(empty.applied, false);
    assert.equal(empty.fallback, true);
    assert.equal(empty.replayed, false);
    assert.equal(empty.proposalRef, null);

    const staleProposal = proposalFromContext(pmContext, {
      newWork: [{ id: "migration", work: "Migration", remainingWork: [] }],
      dependencyEdges: [{ itemId: ITEM_ID, dependencyId: "migration" }],
      progress: { completed: 0, total: 1 }
    });
    await orchestrator.claim({ itemId: ITEM_ID, owner: "other-session" });
    await assert.rejects(
      () => controller.applyPmProposal(staleProposal),
      /target lifecycle state is stale/
    );
  });
});
