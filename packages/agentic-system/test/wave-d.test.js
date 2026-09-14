import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  BlackboardStatus,
  FollowUpDisposition,
  ReviewRequirementSource,
  ReviewVerdict,
  createApplicationOrchestrator,
  createJsonBlackboardStore
} from "../src/index.js";

async function withOrchestrator(run) {
  const directory = await mkdtemp(join(tmpdir(), "exharness-blackboard-"));
  try {
    const path = join(directory, "blackboard.json");
    const store = createJsonBlackboardStore({ path });
    const orchestrator = createApplicationOrchestrator({ store });
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

test("Wave D prevents a worker submission from self-authorizing DONE", async () => {
  await withOrchestrator(async ({ orchestrator }) => {
    await orchestrator.seed([workItem()]);
    await orchestrator.claim({ itemId: "BB-100", owner: "worker-session-1" });

    const submitted = await orchestrator.submit({
      itemId: "BB-100",
      owner: "worker-session-1",
      submission: {
        revision: "rev-2",
        artifactRefs: ["workspace://rev-2/src/orchestrator.js"]
      },
      reviewRequests: [{
        key: "BACKEND_REVIEW",
        source: ReviewRequirementSource.WORKER,
        reason: "Implementation changed application workflow state."
      }]
    });

    assert.equal(submitted.result.status, BlackboardStatus.PENDING_REVIEW);
    assert.equal(submitted.result.owner, null);
    assert.equal(submitted.result.reviews.length, 0);
  });
});

test("Wave D derives DONE only after the required review accepts the immutable submission", async () => {
  await withOrchestrator(async ({ orchestrator }) => {
    await orchestrator.seed([workItem()]);
    await orchestrator.claim({ itemId: "BB-100", owner: "worker-session-1" });
    await orchestrator.submit({
      itemId: "BB-100",
      owner: "worker-session-1",
      submission: { revision: "rev-2" },
      reviewRequests: [{
        key: "BACKEND_REVIEW",
        source: ReviewRequirementSource.WORKER,
        reason: "Backend work requires vertical review."
      }]
    });

    await orchestrator.beginReview({
      itemId: "BB-100",
      key: "BACKEND_REVIEW",
      reviewer: "backend-reviewer-1"
    });

    const assessed = await orchestrator.recordAssessment({
      itemId: "BB-100",
      key: "BACKEND_REVIEW",
      reviewer: "backend-reviewer-1",
      verdict: ReviewVerdict.ACCEPTED,
      assessmentRef: "assessment://backend/1"
    });

    assert.equal(assessed.result.status, BlackboardStatus.DONE);
    assert.equal(assessed.result.reviews[0].assessmentRef, "assessment://backend/1");
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

    await orchestrator.beginReview({
      itemId: "BB-100",
      key: "SA_ARCHITECTURE_REVIEW",
      reviewer: "solution-architect-1"
    });
    const assessed = await orchestrator.recordAssessment({
      itemId: "BB-100",
      key: "SA_ARCHITECTURE_REVIEW",
      reviewer: "solution-architect-1",
      verdict: ReviewVerdict.ACCEPTED,
      assessmentRef: "assessment://sa/1"
    });

    assert.equal(assessed.result.status, BlackboardStatus.DONE);
  });
});

test("Wave D serializes concurrent claims so two sessions cannot own the same Board item", async () => {
  await withOrchestrator(async ({ path, orchestrator }) => {
    await orchestrator.seed([workItem()]);

    const other = createApplicationOrchestrator({
      store: createJsonBlackboardStore({ path })
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
    await orchestrator.claim({ itemId: "BB-100", owner: "worker-session-1" });
    await orchestrator.submit({
      itemId: "BB-100",
      owner: "worker-session-1",
      submission: { revision: "rev-2" },
      reviewRequests: [{
        key: "BACKEND_REVIEW",
        source: ReviewRequirementSource.WORKER,
        reason: "Review can happen in a later session."
      }]
    });

    const restarted = createApplicationOrchestrator({
      store: createJsonBlackboardStore({ path })
    });
    const restored = await restarted.readBlackboard();

    assert.equal(restored.items[0].status, BlackboardStatus.PENDING_REVIEW);
    assert.equal(restored.items[0].submission.revision, "rev-2");
    assert.equal(restored.items[0].reviewRequirements[0].key, "BACKEND_REVIEW");
  });
});

test("Wave D rejected review reopens the same work and accepted resubmission can close it", async () => {
  await withOrchestrator(async ({ orchestrator }) => {
    const finding = "Preserve accepted revision provenance across restart.";
    await orchestrator.seed([workItem()]);
    await orchestrator.claim({ itemId: "BB-100", owner: "worker-session-1" });
    await orchestrator.submit({
      itemId: "BB-100",
      owner: "worker-session-1",
      submission: { revision: "rev-2" },
      reviewRequests: [{
        key: "BACKEND_REVIEW",
        source: ReviewRequirementSource.WORKER,
        reason: "Backend work requires vertical review."
      }]
    });
    await orchestrator.beginReview({ itemId: "BB-100", key: "BACKEND_REVIEW", reviewer: "backend-reviewer-1" });

    const rejected = await orchestrator.recordAssessment({
      itemId: "BB-100",
      key: "BACKEND_REVIEW",
      reviewer: "backend-reviewer-1",
      verdict: ReviewVerdict.REJECTED,
      assessmentRef: "assessment://backend/reject-1",
      findings: [finding]
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

    await orchestrator.beginReview({ itemId: "BB-100", key: "BACKEND_REVIEW", reviewer: "backend-reviewer-2" });
    const accepted = await orchestrator.recordAssessment({
      itemId: "BB-100",
      key: "BACKEND_REVIEW",
      reviewer: "backend-reviewer-2",
      verdict: ReviewVerdict.ACCEPTED,
      assessmentRef: "assessment://backend/accept-2"
    });

    assert.equal(accepted.result.status, BlackboardStatus.DONE);
  });
});

test("Wave D accepted review reopens instead of deadlocking when unrelated current work remains", async () => {
  await withOrchestrator(async ({ orchestrator }) => {
    await orchestrator.seed([workItem({ remainingWork: ["Resolve release dependency."] })]);
    await orchestrator.claim({ itemId: "BB-100", owner: "worker-session-1" });
    await orchestrator.submit({
      itemId: "BB-100",
      owner: "worker-session-1",
      submission: { revision: "rev-2" },
      reviewRequests: [{
        key: "BACKEND_REVIEW",
        source: ReviewRequirementSource.WORKER,
        reason: "Backend work requires vertical review."
      }]
    });
    await orchestrator.beginReview({ itemId: "BB-100", key: "BACKEND_REVIEW", reviewer: "backend-reviewer-1" });

    const assessed = await orchestrator.recordAssessment({
      itemId: "BB-100",
      key: "BACKEND_REVIEW",
      reviewer: "backend-reviewer-1",
      verdict: ReviewVerdict.ACCEPTED,
      assessmentRef: "assessment://backend/1"
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
        sourceRef: "assessment://sa/42"
      },
      disposition: FollowUpDisposition.CURRENT_WORK
    });
    assert.equal(current.result.status, BlackboardStatus.REOPENED);
    assert.deepEqual(current.result.remainingWork, ["Remove duplicated effect ownership."]);
    assert.deepEqual(current.result.evidenceRefs, ["assessment://sa/42"]);

    const linked = await orchestrator.reconcileFinding({
      itemId: "BB-100",
      finding: {
        summary: "Storage retention is already tracked.",
        sourceRef: "assessment://pm/9"
      },
      disposition: FollowUpDisposition.EXISTING_WORK,
      existingItemId: "BB-101"
    });
    assert.deepEqual(linked.result.followUpRefs, ["BB-101"]);

    const created = await orchestrator.reconcileFinding({
      itemId: "BB-100",
      finding: {
        summary: "A separate release audit is required.",
        sourceRef: "assessment://pm/10"
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
      sourceRef: "assessment://pm/10"
    });

    const board = await orchestrator.readBlackboard();
    assert.deepEqual(board.items.find((item) => item.id === "BB-100").followUpRefs.sort(), ["BB-101", "BB-102"]);
  });
});
