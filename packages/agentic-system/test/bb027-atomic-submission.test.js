import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { BlackboardStatus } from "../src/blackboard-orchestrator.js";
import { createJsonBlackboardStore } from "../src/blackboard-json-payload.js";
import { createApplicationOrchestrator } from "../src/persisted-payload-application-orchestrator.js";
import {
  ResearchContinuationKind,
  ResearchEvidenceStatus,
  ResearchExperimentStatus,
  createResearchContinuationController
} from "../src/research-continuation.js";
import { createSessionHandoffSurface } from "../src/session-handoff.js";

const PROJECT_ID = "bb027-atomic-project";
const ITEM_ID = "research-work";
const SOURCE_REVISION = "source-a";

function reviewTrustStub() {
  return {
    trustPolicyFor() { return {}; },
    verifySignature() { return false; },
    verifyEvaluatorAuthority() { return false; },
    verifyEvidenceAuthority() { return false; }
  };
}

function researchItem() {
  return {
    id: ITEM_ID,
    work: "Submit a completed bounded research result.",
    status: BlackboardStatus.READY,
    dependsOn: [],
    remainingWork: ["submit proposed conclusion"],
    blockers: [],
    artifactRefs: [],
    evidenceRefs: [],
    followUpRefs: [],
    reviewRequirements: [],
    reviews: [],
    findings: []
  };
}

function manifest() {
  return {
    version: 1,
    kind: ResearchContinuationKind,
    researchId: "research-atomic",
    questionRef: "artifact:question",
    planRef: "artifact:plan",
    evidenceLedgerRef: "artifact:ledger",
    experimentRefs: ["artifact:e1"],
    activeExperimentId: null,
    sourceRevision: SOURCE_REVISION,
    policyRevision: null,
    nextAction: "submit proposed conclusion"
  };
}

function artifacts() {
  return new Map([
    ["artifact:question", { kind: "RESEARCH_QUESTION", id: "Q1" }],
    ["artifact:plan", { kind: "RESEARCH_PLAN", hypotheses: ["H1"] }],
    ["artifact:e1", {
      id: "E1",
      status: ResearchExperimentStatus.COMPLETED,
      sourceRevision: SOURCE_REVISION,
      policyRevision: null,
      sourceScopes: [],
      policyScopes: [],
      resumedFrom: null,
      resultRefs: ["artifact:e1-result"],
      evidenceRefs: ["EV1"]
    }],
    ["artifact:ledger", {
      kind: "EVIDENCE_LEDGER",
      revision: 1,
      supersedes: null,
      evidence: [{
        id: "EV1",
        status: ResearchEvidenceStatus.CONFIRMED,
        sourceRevision: SOURCE_REVISION,
        policyRevision: null,
        sourceScopes: [],
        policyScopes: [],
        observationRef: "artifact:observation",
        summary: "Completed experiment supports the bounded conclusion.",
        supports: ["H1"],
        contradicts: [],
        invalidatedBy: null
      }]
    }],
    ["artifact:result", { kind: "RESEARCH_RESULT", decisionStatus: "PROPOSED" }]
  ]);
}

test("BB-027 commits proposal and PM review obligation in one Blackboard transaction", async () => {
  const directory = await mkdtemp(join(tmpdir(), "exharness-bb027-atomic-"));
  const boardPath = join(directory, "blackboard.json");
  const durableStore = createJsonBlackboardStore({ path: boardPath });
  let mutationCount = 0;
  const observedStore = Object.freeze({
    load() {
      return durableStore.load();
    },
    transact(mutator) {
      mutationCount += 1;
      return durableStore.transact(mutator);
    }
  });
  const values = artifacts();

  function makeOrchestrator() {
    return createApplicationOrchestrator({
      store: observedStore,
      reviewTrust: reviewTrustStub()
    });
  }

  try {
    let orchestrator = makeOrchestrator();
    const surface = createSessionHandoffSurface({ orchestrator, projectId: PROJECT_ID });
    await surface.initialize({
      userIntent: {
        id: "bb027-atomic-intent",
        objective: "Research submission and its independent review obligation must be atomic.",
        bullets: ["no orphan PENDING_REVIEW state"],
        constraints: ["PM review authority remains explicit"]
      },
      items: [researchItem()]
    });

    let claim = await orchestrator.claim({ itemId: ITEM_ID, owner: "session-a" });
    await orchestrator.checkpoint({
      itemId: ITEM_ID,
      owner: "session-a",
      generation: claim.result.claimGeneration,
      checkpoint: manifest(),
      artifactRefs: ["artifact:question", "artifact:plan", "artifact:e1", "artifact:ledger"],
      evidenceRefs: ["artifact:ledger"],
      status: BlackboardStatus.REOPENED
    });

    orchestrator = makeOrchestrator();
    claim = await orchestrator.claim({ itemId: ITEM_ID, owner: "session-b" });
    const controller = createResearchContinuationController({
      orchestrator,
      projectId: PROJECT_ID,
      artifactReader: {
        async readArtifact({ ref }) {
          assert.ok(values.has(ref), `artifact unavailable: ${ref}`);
          return structuredClone(values.get(ref));
        }
      }
    });

    mutationCount = 0;
    const submitted = await controller.submitProposal({
      itemId: ITEM_ID,
      owner: "session-b",
      generation: claim.result.claimGeneration,
      resultRef: "artifact:result",
      currentRevision: { sourceRevision: SOURCE_REVISION, policyRevision: null },
      resolvedWork: ["submit proposed conclusion"],
      reviewReason: "independent research-workflow review required"
    });

    assert.equal(mutationCount, 1, "proposal + required review must use one durable mutation");
    assert.equal(submitted.item.status, BlackboardStatus.PENDING_REVIEW);
    assert.equal(submitted.item.submission.decisionStatus, "PROPOSED");
    assert.deepEqual(submitted.item.reviewRequirements, [{
      key: "research-workflow",
      source: "PM",
      reason: "independent research-workflow review required"
    }]);

    const reloaded = await makeOrchestrator().readBlackboard();
    const persisted = reloaded.items.find((item) => item.id === ITEM_ID);
    assert.equal(persisted.status, BlackboardStatus.PENDING_REVIEW);
    assert.equal(persisted.submission.decisionStatus, "PROPOSED");
    assert.equal(persisted.reviewRequirements.length, 1);
    assert.equal(persisted.reviewRequirements[0].key, "research-workflow");
    assert.equal(persisted.reviewRequirements[0].source, "PM");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
