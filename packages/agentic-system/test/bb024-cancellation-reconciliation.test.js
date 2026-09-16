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

function reviewTrust() {
  return {
    trustPolicyFor() { return {}; },
    verifySignature() { return true; },
    verifyEvaluatorAuthority() { return true; },
    verifyEvidenceAuthority() { return true; }
  };
}

async function withOrchestrator(run) {
  const directory = await mkdtemp(join(tmpdir(), "exharness-bb024-"));
  try {
    const path = join(directory, "blackboard.json");
    const orchestrator = createApplicationOrchestrator({
      store: createJsonBlackboardStore({ path }),
      reviewTrust: reviewTrust()
    });
    await run(orchestrator);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function pendingReconciliationItem() {
  return {
    id: "BB-100",
    work: "Reconcile accepted review findings.",
    status: BlackboardStatus.PENDING_RECONCILIATION,
    dependsOn: [],
    remainingWork: [],
    blockers: [],
    artifactRefs: ["artifact:submission"],
    evidenceRefs: ["decision:accepted", "attestation:accepted"],
    followUpRefs: [],
    submission: { revision: "rev-1" },
    submittedBy: "backend-worker",
    reviewRequirements: [{
      key: "BACKEND_REVIEW",
      source: ReviewRequirementSource.WORKER,
      reason: "Backend submission requires review."
    }],
    reviews: [{
      key: "BACKEND_REVIEW",
      reviewer: "backend-reviewer",
      verdict: ReviewVerdict.ACCEPTED,
      decisionRef: "decision:accepted",
      attestationRef: "attestation:accepted",
      findingRefs: ["finding:late"]
    }],
    findings: [{
      id: "finding:late",
      summary: "Late finding must not revive cancelled work.",
      sourceRef: "attestation:accepted",
      reviewKey: "BACKEND_REVIEW",
      disposition: null,
      targetItemId: null
    }]
  };
}

test("BB-024 keeps SUPERSEDED terminal when delayed finding reconciliation arrives", async () => {
  await withOrchestrator(async (orchestrator) => {
    await orchestrator.seed([
      pendingReconciliationItem(),
      {
        id: "BB-101",
        work: "Existing independent work.",
        status: BlackboardStatus.READY,
        dependsOn: []
      }
    ]);

    await orchestrator.supersede({ itemId: "BB-100", reason: "User cancelled the work." });

    const cancelled = await orchestrator.readBlackboard();
    const expectedCancelledItem = cancelled.items.find((item) => item.id === "BB-100");
    assert.equal(expectedCancelledItem.status, BlackboardStatus.SUPERSEDED);
    assert.deepEqual(expectedCancelledItem.blockers, ["User cancelled the work."]);

    const attempts = [
      { disposition: FollowUpDisposition.NON_ACTIONABLE },
      { disposition: FollowUpDisposition.CURRENT_WORK },
      { disposition: FollowUpDisposition.EXISTING_WORK, existingItemId: "BB-101" },
      {
        disposition: FollowUpDisposition.NEW_WORK,
        newItem: {
          id: "BB-102",
          work: "Child work that must not be created after cancellation.",
          dependsOn: ["BB-100"]
        }
      }
    ];

    for (const attempt of attempts) {
      await assert.rejects(
        () => orchestrator.reconcileFinding({
          itemId: "BB-100",
          findingId: "finding:late",
          ...attempt
        }),
        /Blackboard item BB-100 is SUPERSEDED and cannot be mutated/
      );

      const after = await orchestrator.readBlackboard();
      assert.deepEqual(after.items.find((item) => item.id === "BB-100"), expectedCancelledItem);
      assert.equal(after.items.some((item) => item.id === "BB-102"), false);
    }
  });
});
