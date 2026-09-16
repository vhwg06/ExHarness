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
  FollowUpDisposition,
  ReviewRequirementSource,
  ReviewVerdict,
  createApplicationOrchestrator,
  createJsonBlackboardStore
} from "../src/index.js";

const REVIEW_POLICY = policyRefFromValue("blackboard-review-policy", {
  required: ["review.acceptance"],
  version: 1
}, { version: "1" });

const VERIFY_ENV = environmentRefFromValue(
  { image: "review-verify@sha256:1" },
  { name: "review-verification" }
);

const ATTEST_ENV = environmentRefFromValue(
  { image: "review-attest@sha256:2" },
  { name: "review-attestation" }
);

function reviewTrust() {
  return {
    trustPolicyFor() {
      return {
        acceptedIssuers: ["review-attestor"],
        acceptedPolicyDigests: [REVIEW_POLICY.digest]
      };
    },
    verifySignature({ payloadDigest, signature }) {
      return signature?.value === `signed:${payloadDigest}`;
    },
    verifyEvaluatorAuthority({ evaluator, reviewer }) {
      return evaluator?.identity === reviewer && evaluator.roles.includes("reviewer");
    },
    verifyEvidenceAuthority({ producer, environment }) {
      return producer?.identity === "ci-verifier" &&
        producer.roles.includes("verifier") &&
        environment?.digest === VERIFY_ENV.digest;
    }
  };
}

async function reviewBundle({
  subject,
  reviewer,
  verdict = ReviewVerdict.ACCEPTED,
  blockingReasons = [],
  findings = [],
  evaluatorIdentity = reviewer,
  evidenceProducer = "ci-verifier",
  signingMode = "valid",
  policy = REVIEW_POLICY
}) {
  const evidence = [createEvidenceArtifact({
    subject,
    kind: "BLACKBOARD_REVIEW",
    producer: { identity: evidenceProducer, roles: ["verifier"] },
    environment: VERIFY_ENV,
    generatedAt: "2026-09-14T10:30:00.000Z",
    metadata: { review: true },
    content: { checked: true }
  })];

  const decision = createDecisionArtifact({
    subject,
    boundary: TrustBoundary.ACCEPTANCE,
    policy,
    evaluator: { identity: evaluatorIdentity, roles: ["reviewer"] },
    evidence,
    claims: [{
      name: "review.acceptance",
      status: verdict === ReviewVerdict.ACCEPTED ? ClaimStatus.SATISFIED : ClaimStatus.UNSATISFIED
    }],
    unresolved: blockingReasons.map((summary) => ({ type: "REVIEW_BLOCKER", summary })),
    verdict,
    generatedAt: "2026-09-14T10:31:00.000Z",
    metadata: { findings }
  });

  const issuer = createAttestationIssuer({
    identity: "review-attestor",
    roles: ["attestor"],
    async sign({ payloadDigest }) {
      return {
        algorithm: "test",
        value: signingMode === "valid" ? `signed:${payloadDigest}` : `forged:${payloadDigest}`
      };
    }
  });

  const attestation = await issuer.issue({
    decision,
    environment: ATTEST_ENV,
    issuedAt: "2026-09-14T10:32:00.000Z"
  });

  return { evidence, decision, attestation };
}

async function withOrchestrator(run) {
  const directory = await mkdtemp(join(tmpdir(), "exharness-blackboard-"));
  try {
    const path = join(directory, "blackboard.json");
    const store = createJsonBlackboardStore({ path });
    const orchestrator = createApplicationOrchestrator({ store, reviewTrust: reviewTrust() });
    await run({ path, store, orchestrator });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function workItem(overrides = {}) {
  return {
    id: "BB-100",
    work: "Implement the durable review lifecycle.",
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

async function claimGeneration(orchestrator, {
  itemId = "BB-100",
  owner = "worker-session-1"
} = {}) {
  const claimed = await orchestrator.claim({ itemId, owner });
  return claimed.result.claimGeneration;
}

async function submitForBackendReview(orchestrator, {
  owner = "worker-session-1",
  revision = "rev-2",
  resolvedWork = []
} = {}) {
  const generation = await claimGeneration(orchestrator, { owner });
  return orchestrator.submit({
    itemId: "BB-100",
    owner,
    generation,
    submission: { revision },
    resolvedWork,
    reviewRequests: [{
      key: "BACKEND_REVIEW",
      source: ReviewRequirementSource.WORKER,
      reason: "Backend work requires vertical review."
    }]
  });
}

async function beginBackendReview(orchestrator, reviewer = "backend-reviewer-1") {
  return orchestrator.beginReview({
    itemId: "BB-100",
    key: "BACKEND_REVIEW",
    reviewer
  });
}

test("Wave D prevents a worker submission from self-authorizing DONE", async () => {
  await withOrchestrator(async ({ orchestrator }) => {
    await orchestrator.seed([workItem()]);
    const submitted = await submitForBackendReview(orchestrator);

    assert.equal(submitted.result.status, BlackboardStatus.PENDING_REVIEW);
    assert.equal(submitted.result.owner, null);
    assert.equal(submitted.result.submittedBy, "worker-session-1");
    assert.equal(submitted.result.reviews.length, 0);
  });
});

test("Wave D derives DONE only from a trusted assessment bound to the exact review target", async () => {
  await withOrchestrator(async ({ orchestrator }) => {
    await orchestrator.seed([workItem()]);
    await submitForBackendReview(orchestrator);
    const review = await beginBackendReview(orchestrator);
    const bundle = await reviewBundle({
      subject: review.result.subject,
      reviewer: "backend-reviewer-1"
    });

    const assessed = await orchestrator.recordAssessment({
      itemId: "BB-100",
      key: "BACKEND_REVIEW",
      bundle
    });

    assert.equal(assessed.result.status, BlackboardStatus.DONE);
    assert.equal(assessed.result.reviews[0].decisionRef, bundle.decision.id);
    assert.equal(assessed.result.reviews[0].attestationRef, bundle.attestation.id);
    assert.deepEqual(assessed.result.evidenceRefs, [bundle.decision.id, bundle.attestation.id]);
  });
});

test("Wave D rejects fabricated, stale or unauthorized review authority", async () => {
  await withOrchestrator(async ({ orchestrator }) => {
    await orchestrator.seed([workItem()]);
    await submitForBackendReview(orchestrator);
    const review = await beginBackendReview(orchestrator);

    const forged = await reviewBundle({
      subject: review.result.subject,
      reviewer: "backend-reviewer-1",
      signingMode: "forged"
    });
    await assert.rejects(
      () => orchestrator.recordAssessment({ itemId: "BB-100", key: "BACKEND_REVIEW", bundle: forged }),
      /review trust rejected: INVALID_SIGNATURE/
    );

    const boardAfterForged = await orchestrator.readBlackboard();
    assert.equal(boardAfterForged.items[0].status, BlackboardStatus.REVIEWING);
    assert.equal(boardAfterForged.items[0].reviews.length, 0);

    const staleSubject = {
      ...review.result.subject,
      digest: "sha256:stale-review-target"
    };
    const stale = await reviewBundle({
      subject: staleSubject,
      reviewer: "backend-reviewer-1"
    });
    await assert.rejects(
      () => orchestrator.recordAssessment({ itemId: "BB-100", key: "BACKEND_REVIEW", bundle: stale }),
      /review evidence subject does not match active review target/
    );

    const unauthorized = await reviewBundle({
      subject: review.result.subject,
      reviewer: "backend-reviewer-1",
      evaluatorIdentity: "rogue-reviewer"
    });
    await assert.rejects(
      () => orchestrator.recordAssessment({ itemId: "BB-100", key: "BACKEND_REVIEW", bundle: unauthorized }),
      /review decision evaluator does not match scheduled reviewer/
    );
  });
});

test("Wave D keeps Worker review request and PM review requirement as separate authority paths", async () => {
  await withOrchestrator(async ({ orchestrator }) => {
    await orchestrator.seed([workItem()]);
    const generation = await claimGeneration(orchestrator);
    await orchestrator.submit({
      itemId: "BB-100",
      owner: "worker-session-1",
      generation,
      submission: { revision: "rev-2" }
    });

    await assert.rejects(
      () => orchestrator.requireReview({
        itemId: "BB-100",
        key: "BACKEND_REVIEW",
        source: ReviewRequirementSource.WORKER,
        reason: "Worker must use submit.reviewRequests instead."
      }),
      /requireReview must be PM-sourced/
    );

    const required = await orchestrator.requireReview({
      itemId: "BB-100",
      key: "SA_ARCHITECTURE_REVIEW",
      source: ReviewRequirementSource.PM,
      reason: "The submitted work crosses an application/Core authority boundary."
    });

    assert.equal(required.result.reviewRequirements[0].source, ReviewRequirementSource.PM);
    assert.equal(required.result.status, BlackboardStatus.PENDING_REVIEW);

    const review = await orchestrator.beginReview({
      itemId: "BB-100",
      key: "SA_ARCHITECTURE_REVIEW",
      reviewer: "solution-architect-1"
    });
    const bundle = await reviewBundle({
      subject: review.result.subject,
      reviewer: "solution-architect-1"
    });
    const assessed = await orchestrator.recordAssessment({
      itemId: "BB-100",
      key: "SA_ARCHITECTURE_REVIEW",
      bundle
    });

    assert.equal(assessed.result.status, BlackboardStatus.DONE);
  });
});

test("Wave D serializes concurrent claims so two sessions cannot own the same Board item", async () => {
  await withOrchestrator(async ({ path, orchestrator }) => {
    await orchestrator.seed([workItem()]);

    const other = createApplicationOrchestrator({
      store: createJsonBlackboardStore({ path }),
      reviewTrust: reviewTrust()
    });

    const attempts = await Promise.allSettled([
      orchestrator.claim({ itemId: "BB-100", owner: "worker-session-1" }),
      other.claim({ itemId: "BB-100", owner: "worker-session-2" })
    ]);

    assert.equal(attempts.filter((attempt) => attempt.status === "fulfilled").length, 1);
    assert.equal(attempts.filter((attempt) => attempt.status === "rejected").length, 1);

    const restored = await orchestrator.readBlackboard();
    assert.equal(restored.items[0].status, BlackboardStatus.CLAIMED);
    assert.equal(restored.items[0].claimGeneration, 1);
    assert.ok(["worker-session-1", "worker-session-2"].includes(restored.items[0].owner));
  });
});

test("Wave D persists PENDING_REVIEW across orchestrator restart", async () => {
  await withOrchestrator(async ({ path, orchestrator }) => {
    await orchestrator.seed([workItem()]);
    await submitForBackendReview(orchestrator);

    const restarted = createApplicationOrchestrator({
      store: createJsonBlackboardStore({ path }),
      reviewTrust: reviewTrust()
    });
    const restored = await restarted.readBlackboard();

    assert.equal(restored.items[0].status, BlackboardStatus.PENDING_REVIEW);
    assert.equal(restored.items[0].submission.revision, "rev-2");
    assert.equal(restored.items[0].submittedBy, "worker-session-1");
    assert.equal(restored.items[0].claimGeneration, 1);
    assert.equal(restored.items[0].reviewRequirements[0].key, "BACKEND_REVIEW");
  });
});

test("Wave D rejected review reopens the same work from trusted unresolved blockers and accepted resubmission can close it", async () => {
  await withOrchestrator(async ({ orchestrator }) => {
    const blocker = "Preserve accepted revision provenance across restart.";
    await orchestrator.seed([workItem()]);
    await submitForBackendReview(orchestrator);
    const firstReview = await beginBackendReview(orchestrator, "backend-reviewer-1");
    const rejectedBundle = await reviewBundle({
      subject: firstReview.result.subject,
      reviewer: "backend-reviewer-1",
      verdict: ReviewVerdict.REJECTED,
      blockingReasons: [blocker]
    });

    const rejected = await orchestrator.recordAssessment({
      itemId: "BB-100",
      key: "BACKEND_REVIEW",
      bundle: rejectedBundle
    });

    assert.equal(rejected.result.status, BlackboardStatus.REOPENED);
    assert.deepEqual(rejected.result.remainingWork, [blocker]);
    assert.deepEqual(rejected.result.findings, []);

    const generation = await claimGeneration(orchestrator, { owner: "worker-session-2" });
    const resubmitted = await orchestrator.submit({
      itemId: "BB-100",
      owner: "worker-session-2",
      generation,
      submission: { revision: "rev-3" },
      resolvedWork: [blocker]
    });
    assert.equal(resubmitted.result.status, BlackboardStatus.PENDING_REVIEW);
    assert.deepEqual(resubmitted.result.remainingWork, []);

    const secondReview = await beginBackendReview(orchestrator, "backend-reviewer-2");
    const acceptedBundle = await reviewBundle({
      subject: secondReview.result.subject,
      reviewer: "backend-reviewer-2"
    });
    const accepted = await orchestrator.recordAssessment({
      itemId: "BB-100",
      key: "BACKEND_REVIEW",
      bundle: acceptedBundle
    });

    assert.equal(accepted.result.status, BlackboardStatus.DONE);
  });
});

test("Wave D accepted review reopens instead of deadlocking when unrelated current work remains", async () => {
  await withOrchestrator(async ({ orchestrator }) => {
    await orchestrator.seed([workItem({ remainingWork: ["Resolve release dependency."] })]);
    await submitForBackendReview(orchestrator);
    const review = await beginBackendReview(orchestrator);
    const bundle = await reviewBundle({
      subject: review.result.subject,
      reviewer: "backend-reviewer-1"
    });

    const assessed = await orchestrator.recordAssessment({
      itemId: "BB-100",
      key: "BACKEND_REVIEW",
      bundle
    });

    assert.equal(assessed.result.status, BlackboardStatus.REOPENED);
    assert.deepEqual(assessed.result.remainingWork, ["Resolve release dependency."]);
  });
});

test("Wave D follow-up generation reconciles only findings grounded by a trusted review assessment", async () => {
  await withOrchestrator(async ({ orchestrator }) => {
    await orchestrator.seed([
      workItem(),
      workItem({ id: "BB-101", work: "Existing independent storage concern." })
    ]);
    await submitForBackendReview(orchestrator);
    const review = await beginBackendReview(orchestrator);
    const bundle = await reviewBundle({
      subject: review.result.subject,
      reviewer: "backend-reviewer-1",
      findings: [
        "Remove duplicated effect ownership.",
        "Storage retention is already tracked.",
        "A separate release audit is required.",
        "Interesting future cache optimization without concrete pressure."
      ]
    });

    const assessed = await orchestrator.recordAssessment({
      itemId: "BB-100",
      key: "BACKEND_REVIEW",
      bundle
    });
    assert.equal(assessed.result.status, BlackboardStatus.PENDING_RECONCILIATION);
    assert.equal(assessed.result.findings.length, 4);
    assert.ok(assessed.result.findings.every((finding) => finding.sourceRef === bundle.attestation.id));

    const [currentFinding, existingFinding, newFinding, nonActionableFinding] = assessed.result.findings;

    const current = await orchestrator.reconcileFinding({
      itemId: "BB-100",
      findingId: currentFinding.id,
      disposition: FollowUpDisposition.CURRENT_WORK
    });
    assert.equal(current.result.status, BlackboardStatus.PENDING_RECONCILIATION);
    assert.deepEqual(current.result.remainingWork, ["Remove duplicated effect ownership."]);

    const linked = await orchestrator.reconcileFinding({
      itemId: "BB-100",
      findingId: existingFinding.id,
      disposition: FollowUpDisposition.EXISTING_WORK,
      existingItemId: "BB-101"
    });
    assert.deepEqual(linked.result.followUpRefs, ["BB-101"]);

    const created = await orchestrator.reconcileFinding({
      itemId: "BB-100",
      findingId: newFinding.id,
      disposition: FollowUpDisposition.NEW_WORK,
      newItem: {
        id: "BB-102",
        work: "Define the release audit boundary.",
        dependsOn: ["BB-100"]
      }
    });
    assert.equal(created.result.id, "BB-102");
    assert.deepEqual(created.result.origin, {
      parentItemId: "BB-100",
      findingId: newFinding.id,
      finding: "A separate release audit is required.",
      sourceRef: bundle.attestation.id
    });

    await orchestrator.reconcileFinding({
      itemId: "BB-100",
      findingId: nonActionableFinding.id,
      disposition: FollowUpDisposition.NON_ACTIONABLE
    });

    const board = await orchestrator.readBlackboard();
    const parent = board.items.find((item) => item.id === "BB-100");
    assert.equal(parent.status, BlackboardStatus.REOPENED);
    assert.deepEqual(parent.followUpRefs.sort(), ["BB-101", "BB-102"]);
    assert.deepEqual(parent.remainingWork, ["Remove duplicated effect ownership."]);
    assert.deepEqual(parent.findings.map((finding) => finding.disposition), [
      FollowUpDisposition.CURRENT_WORK,
      FollowUpDisposition.EXISTING_WORK,
      FollowUpDisposition.NEW_WORK,
      FollowUpDisposition.NON_ACTIONABLE
    ]);
  });
});

test("Wave D claim recovery fences a stale executor even when takeover reuses the same owner identity", async () => {
  await withOrchestrator(async ({ orchestrator }) => {
    await orchestrator.seed([workItem()]);
    const first = await orchestrator.claim({ itemId: "BB-100", owner: "worker-session-1" });
    assert.equal(first.result.claimGeneration, 1);

    const recovered = await orchestrator.recoverClaim({
      itemId: "BB-100",
      owner: "worker-session-1",
      reason: "The original process disappeared before persisting a result."
    });
    assert.equal(recovered.result.claimGeneration, 2);

    await assert.rejects(
      () => orchestrator.checkpoint({
        itemId: "BB-100",
        owner: "worker-session-1",
        generation: 1,
        checkpoint: { kind: "STALE_ATTEMPT" }
      }),
      /claim generation is stale/
    );

    const persisted = await orchestrator.checkpoint({
      itemId: "BB-100",
      owner: "worker-session-1",
      generation: 2,
      checkpoint: { kind: "RECOVERED_ATTEMPT" }
    });
    assert.equal(persisted.result.status, BlackboardStatus.REOPENED);
    assert.equal(persisted.result.claimGeneration, 2);
  });
});

test("Wave D review recovery changes the exact review subject and rejects the abandoned generation", async () => {
  await withOrchestrator(async ({ orchestrator }) => {
    await orchestrator.seed([workItem()]);
    await submitForBackendReview(orchestrator);

    const first = await beginBackendReview(orchestrator, "backend-reviewer-1");
    assert.equal(first.result.generation, 1);
    const abandonedBundle = await reviewBundle({
      subject: first.result.subject,
      reviewer: "backend-reviewer-1"
    });

    const recovered = await orchestrator.recoverReview({
      itemId: "BB-100",
      key: "BACKEND_REVIEW",
      reviewer: "backend-reviewer-1",
      reason: "The original review dispatch was interrupted."
    });
    assert.equal(recovered.result.generation, 2);
    assert.notEqual(recovered.result.subject.digest, first.result.subject.digest);

    await assert.rejects(
      () => orchestrator.recordAssessment({
        itemId: "BB-100",
        key: "BACKEND_REVIEW",
        bundle: abandonedBundle
      }),
      /review evidence subject does not match active review target/
    );

    const currentBundle = await reviewBundle({
      subject: recovered.result.subject,
      reviewer: "backend-reviewer-1"
    });
    const assessed = await orchestrator.recordAssessment({
      itemId: "BB-100",
      key: "BACKEND_REVIEW",
      bundle: currentBundle
    });
    assert.equal(assessed.result.status, BlackboardStatus.DONE);
  });
});
