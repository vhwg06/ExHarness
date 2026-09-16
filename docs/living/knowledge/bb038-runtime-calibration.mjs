import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApplicationOrchestrator as createBaseOrchestrator } from "../../../packages/agentic-system/src/blackboard-orchestrator.js";
import {
  BlackboardStatus,
  FollowUpDisposition,
  ReviewRequirementSource,
  ReviewVerdict,
  createApplicationOrchestrator,
  createJsonBlackboardStore
} from "../../../packages/agentic-system/src/index.js";

// Calibrate the recorded BB-024 replay against the current real mutation API.
// The base orchestrator is the known pre-guard policy; the public composition
// adds the terminal-cancellation guard. Both use the same durable store API.
const fixture = {
  id: "BB-100",
  work: "Reconcile a Backend review finding.",
  status: BlackboardStatus.PENDING_RECONCILIATION,
  dependsOn: [],
  remainingWork: [],
  blockers: [],
  artifactRefs: ["artifact:submitted"],
  evidenceRefs: ["decision:accepted"],
  followUpRefs: [],
  submission: { revision: "rev-1" },
  submittedBy: "backend-worker",
  reviewRequirements: [{
    key: "BACKEND_REVIEW",
    source: ReviewRequirementSource.WORKER,
    reason: "Submission requires review."
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
    summary: "Late finding after cancellation.",
    sourceRef: "attestation:accepted",
    reviewKey: "BACKEND_REVIEW",
    disposition: null,
    targetItemId: null
  }]
};
const reviewTrust = {
  trustPolicyFor() { return {}; },
  verifySignature() { return false; },
  verifyEvaluatorAuthority() { return false; },
  verifyEvidenceAuthority() { return false; }
};

async function run(createOrchestrator, { cancel }) {
  const directory = await mkdtemp(join(tmpdir(), "exharness-bb038-calibration-"));
  try {
    const path = join(directory, "blackboard.json");
    const makeOrchestrator = () => createOrchestrator({
      store: createJsonBlackboardStore({ path }),
      reviewTrust
    });
    const orchestrator = makeOrchestrator();
    await orchestrator.seed([fixture]);
    if (cancel) await orchestrator.supersede({ itemId: fixture.id, reason: "User cancelled." });
    let rejected = false;
    try {
      await orchestrator.reconcileFinding({
        itemId: fixture.id,
        findingId: "finding:late",
        disposition: FollowUpDisposition.CURRENT_WORK
      });
    } catch (error) {
      assert.match(error.message, /SUPERSEDED.*cannot be mutated/);
      rejected = true;
    }
    // A new instance verifies that the observation came from durable state.
    const snapshot = await makeOrchestrator().readBlackboard();
    const item = snapshot.items.find((candidate) => candidate.id === fixture.id);
    return { status: item.status, rejected, disposition: item.findings[0].disposition };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const baseline = await run(createBaseOrchestrator, { cancel: true });
const candidate = await run(createApplicationOrchestrator, { cancel: true });
const control = await run(createApplicationOrchestrator, { cancel: false });

assert.deepEqual(baseline, {
  status: BlackboardStatus.REOPENED,
  rejected: false,
  disposition: FollowUpDisposition.CURRENT_WORK
});
assert.deepEqual(candidate, {
  status: BlackboardStatus.SUPERSEDED,
  rejected: true,
  disposition: null
});
assert.deepEqual(control, {
  status: BlackboardStatus.REOPENED,
  rejected: false,
  disposition: FollowUpDisposition.CURRENT_WORK
});

const replayArtifact = JSON.parse(await readFile(
  new URL("../../../artifacts/bb038-workflow-replay-eval.json", import.meta.url),
  "utf8"
));
const replayCancellation = replayArtifact.comparison.find((item) => item.scenarioId === "cancellation-late-reconciliation");
assert.equal(replayCancellation.baselineFinalStatus, baseline.status);
assert.equal(replayCancellation.candidateFinalStatus, candidate.status);

process.stdout.write(`bb038-runtime-calibration:${JSON.stringify({ baseline, candidate, control })}\n`);
