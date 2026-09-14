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
    unresolved: verdict === ReviewVerdict.ACCEPTED
      ? []
      : findings.map((finding) => ({ type: "REVIEW_FINDING", finding })),
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
    ...overrides
  };
}

async function submitForBackendReview(orchestrator, {
  owner = "worker-session-1",
  revision = "rev-2",
  resolvedWork = []
} = {}) {
  await orchestrator.claim({ itemId: "BB-100", owner });
  return orchestrator.submit({
    itemId: "BB-100",
    owner,
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
      /review trust rejected: STALE_SUBJECT/
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
    await orchestrator.claim({ itemId: "BB-100", owner: "worker-session-1" });
    await orchestrator.submit({
      itemId: "BB-100",
      owner: "worker-session-1",
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
      reason: "The submitted work crosses an application\/Core authority boundary."
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
    assert.equal(restored.items[0].reviewRequirements[0].key, "BACKEND_REVIEW");
  });
});

test("Wave D rejected review reopens the same work and accepted resubmission can close it", async () => {
  await withOrchestrator(async ({ orchestrator }) => {
    const finding = "Preserve accepted revision provenance across restart.";
    await orchestrator.seed([workItem()]);
    await submitForBackendReview(orchestrator);
    const firstReview = await beginBackendReview(orchestrator, "backend-reviewer-1");
    const rejectedBundle = await reviewBundle({
      subject: firstReview.result.subject,
      reviewer: "backend-reviewer-1",
      verdict: ReviewVerdict.REJECTED,
      findings: [finding]
    });

    const rejected = await orchestrator.recordAssessment({
      itemId: "BB-100",
      key: "BACKEND_REVIEW",
      bundle: rejectedBundle
    });

    assert.equal(rejected.result.status, BlackboardStatus.REOPENED);
    assert.deepEqual(rejected.result.remainingWork, [finding]);
    assert.deepEqual(rejected.result.followUpRefs, []);

    await orchestrator.claim({ itemId: "BB-100", owner: "worker-session-2" });
    const resubmitted = await orchestrator.submit({
      itemId: "BB-100",
      owner: "worker-session-2",
      submission: { revision: "rev-3" },
      resolvedWork: [finding]
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

test("Wave D follow-up reconciliation requires provenance and distinguishes current, existing and new work", async () => {
  await withOrchestrator(async ({ orchestrator }) => {
    await orchestrator.seed([
      workItem(),
      workItem({ id: "BB-101", work: "Existing independent storage concern." })
    ]);

    await assert.rejects(
      () => orchestrator.reconcileFinding({
        itemId: "BB-100",
        finding: { summary: "Ungrounded finding." },
        disposition: FollowUpDisposition.CURRENT_WORK
      }),
      /finding.sourceRef must be a non-empty string/
    );

    const current = await orchestrator.reconcileFinding({
      itemId: "BB-100",
      finding: {
        summary: "Remove duplicated effect ownership.",
        sourceRef: "attestation://sa/42"
      },
      disposition: FollowUpDisposition.CURRENT_WORK
    });
    assert.equal(current.result.status, BlackboardStatus.REOPENED);
    assert.deepEqual(current.result.remainingWork, ["Remove duplicated effect ownership."]);
    assert.deepEqual(current.result.evidenceRefs, ["attestation://sa/42"]);

    const linked = await orchestrator.reconcileFinding({
      itemId: "BB-100",
      finding: {
        summary: "Storage retention is already tracked.",
        sourceRef: "attestation://pm/9"
      },
      disposition: FollowUpDisposition.EXISTING_WORK,
      existingItemId: "BB-101"
    });
    assert.deepEqual(linked.result.followUpRefs, ["BB-101"]);

    const created = await orchestrator.reconcileFinding({
      itemId: "BB-100",
      finding: {
        summary: "A separate release audit is required.",
        sourceRef: "attestation://pm/10"
      },
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
      finding: "A separate release audit is required.",
      sourceRef: "attestation://pm/10"
    });

    const board = await orchestrator.readBlackboard();
    assert.deepEqual(board.items.find((item) => item.id === "BB-100").followUpRefs.sort(), ["BB-101", "BB-102"]);
  });
});
