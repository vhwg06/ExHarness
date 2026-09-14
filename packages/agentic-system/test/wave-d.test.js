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

test("Wave D lets PM require review without making PM the reviewer", async () => {
  await withOrchestrator(async ({ orchestrator }) => {
    await orchestrator.seed([workItem()]);
    await orchestrator.claim({ itemId: "BB-100", owner: "worker-session-1" });
    await orchestrator.submit({
      itemId: "BB-100",
      owner: "worker-session-1",
      submission: { revision: "rev-2" }
    });

    const required = await orchestrator.requireReview({
      itemId: "BB-100",
      key: "SA_ARCHITECTURE_REVIEW",
      source: ReviewRequirementSource.PM,
      reason: "The submitted work crosses an application/Core authority boundary."
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

test("Wave D reopens the same work when review finds an unmet obligation", async () => {
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
    await orchestrator.beginReview({ itemId: "BB-100", key: "BACKEND_REVIEW", reviewer: "backend-reviewer-1" });

    const assessed = await orchestrator.recordAssessment({
      itemId: "BB-100",
      key: "BACKEND_REVIEW",
      reviewer: "backend-reviewer-1",
      verdict: ReviewVerdict.REJECTED,
      assessmentRef: "assessment://backend/reject-1",
      findings: ["Preserve accepted revision provenance across restart."]
    });

    assert.equal(assessed.result.status, BlackboardStatus.REOPENED);
    assert.deepEqual(assessed.result.remainingWork, ["Preserve accepted revision provenance across restart."]);
    assert.deepEqual(assessed.result.followUpRefs, []);
  });
});

test("Wave D follow-up reconciliation distinguishes current obligation, existing work and genuine new work", async () => {
  await withOrchestrator(async ({ orchestrator }) => {
    await orchestrator.seed([
      workItem(),
      workItem({ id: "BB-101", work: "Existing independent storage concern." })
    ]);

    const current = await orchestrator.reconcileFinding({
      itemId: "BB-100",
      finding: "Remove duplicated effect ownership.",
      disposition: FollowUpDisposition.CURRENT_WORK
    });
    assert.equal(current.result.status, BlackboardStatus.REOPENED);
    assert.deepEqual(current.result.remainingWork, ["Remove duplicated effect ownership."]);

    const linked = await orchestrator.reconcileFinding({
      itemId: "BB-100",
      finding: "Storage retention is already tracked.",
      disposition: FollowUpDisposition.EXISTING_WORK,
      existingItemId: "BB-101"
    });
    assert.deepEqual(linked.result.followUpRefs, ["BB-101"]);

    const created = await orchestrator.reconcileFinding({
      itemId: "BB-100",
      finding: "A separate release audit is required.",
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
      finding: "A separate release audit is required."
    });

    const board = await orchestrator.readBlackboard();
    assert.deepEqual(board.items.find((item) => item.id === "BB-100").followUpRefs.sort(), ["BB-101", "BB-102"]);
  });
});
