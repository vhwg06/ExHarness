import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  BlackboardStatus,
  PmSaCoordinationKind,
  createApplicationOrchestrator,
  createJsonBlackboardStore,
  createJsonPmSaCoordinationArtifactStore,
  createPmSaCoordinationController,
  createSessionHandoffSurface,
  definePmCoordinationProposal
} from "../src/index.js";

const PROJECT_ID = "bb021-replay-fencing";
const ITEM_ID = "delivery";

function reviewTrust() {
  return {
    trustPolicyFor() {
      return {};
    },
    verifySignature() {
      return true;
    },
    verifyEvaluatorAuthority() {
      return true;
    },
    verifyEvidenceAuthority() {
      return true;
    }
  };
}

function userIntent() {
  return {
    id: "deliver-change",
    source: "USER",
    objective: "Deliver the requested change.",
    bullets: ["implementation"],
    constraints: ["preserve declared intent"]
  };
}

function deliveryItem() {
  return {
    id: ITEM_ID,
    work: "Deliver the requested change.",
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

async function withProject(run) {
  const directory = await mkdtemp(join(tmpdir(), "exharness-bb021-replay-"));
  try {
    const orchestrator = createApplicationOrchestrator({
      store: createJsonBlackboardStore({ path: join(directory, "blackboard.json") }),
      reviewTrust: reviewTrust()
    });
    const artifactStore = createJsonPmSaCoordinationArtifactStore({
      path: join(directory, "coordination")
    });
    await createSessionHandoffSurface({ orchestrator, projectId: PROJECT_ID }).initialize({
      userIntent: userIntent(),
      items: [deliveryItem()]
    });
    const controller = createPmSaCoordinationController({
      orchestrator,
      projectId: PROJECT_ID,
      artifactStore
    });
    await run({ orchestrator, artifactStore, controller });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function migrationProposal(controller) {
  const context = await controller.preparePmContext({
    targetItemId: ITEM_ID,
    coordinationFacts: { migrationRequired: true }
  });
  return definePmCoordinationProposal({
    kind: PmSaCoordinationKind.PM_PROPOSAL,
    projectId: context.projectId,
    rootIntentId: context.intent.id,
    target: context.target,
    newWork: [{
      id: "migration",
      work: "Apply required migration.",
      remainingWork: []
    }],
    dependencyEdges: [{ itemId: ITEM_ID, dependencyId: "migration" }],
    blockers: [],
    reviewRequirements: [],
    progress: { completed: 0, total: 1 },
    intentPatch: null,
    architectureVerdict: null
  });
}

test("BB-021 does not treat a checkpoint-linked proposal ref as proof that proposal effects committed", async () => {
  await withProject(async ({ orchestrator, artifactStore, controller }) => {
    const proposal = await migrationProposal(controller);
    const proposalRef = await artifactStore.putPmProposal(proposal);

    const claim = await orchestrator.claim({ itemId: ITEM_ID, owner: "forged-marker-writer" });
    await orchestrator.checkpoint({
      itemId: ITEM_ID,
      owner: "forged-marker-writer",
      generation: claim.result.claimGeneration,
      checkpoint: { phase: "unrelated" },
      artifactRefs: [proposalRef],
      status: BlackboardStatus.REOPENED
    });

    await assert.rejects(
      () => controller.applyPmProposal(proposal),
      /PM\/SA coordination target not found in project handoff: migration/
    );

    const board = await orchestrator.readBlackboard();
    const target = board.items.find((item) => item.id === ITEM_ID);
    assert.equal(board.items.some((item) => item.id === "migration"), false);
    assert.equal(target.dependsOn.some((id) => id === "migration"), false);
  });
});

test("BB-021 ignores submission-only coordination refs for replay and fresh-session recovery", async () => {
  await withProject(async ({ orchestrator, artifactStore, controller }) => {
    const proposal = await migrationProposal(controller);
    const proposalRef = await artifactStore.putPmProposal(proposal);

    const claim = await orchestrator.claim({ itemId: ITEM_ID, owner: "submission-writer" });
    await orchestrator.submit({
      itemId: ITEM_ID,
      owner: "submission-writer",
      generation: claim.result.claimGeneration,
      submission: {
        revision: "rev-unrelated",
        artifactRefs: [proposalRef],
        evidenceRefs: []
      }
    });

    await assert.rejects(
      () => controller.applyPmProposal(proposal),
      /PM proposal target lifecycle state is stale/
    );

    const recovered = await controller.recoverCoordination();
    assert.deepEqual(recovered.artifacts, []);
  });
});
