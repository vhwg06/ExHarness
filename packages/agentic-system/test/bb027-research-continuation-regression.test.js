import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  ResearchContinuationKind,
  ResearchEvidenceFreshness,
  ResearchEvidenceStatus,
  ResearchExperimentStatus,
  assessResearchEvidenceFreshness,
  createResearchContinuationController
} from "@exharness/agentic-system/research-continuation";
import { createApplicationOrchestrator } from "../src/application-orchestrator.js";
import { createJsonBlackboardStore } from "../src/blackboard-json-payload.js";
import { BlackboardStatus } from "../src/blackboard-orchestrator.js";
import { createSessionHandoffSurface } from "../src/session-handoff.js";

const PROJECT_ID = "bb027-regression-project";
const ITEM_ID = "research-work";
const SOURCE_A = "source-a";
const SOURCE_B = "source-b";
const SOURCE_SCOPE = "packages/agentic-system/src/example.js";

function reviewTrustStub() {
  return {
    trustPolicyFor() { return {}; },
    verifySignature() { return false; },
    verifyEvaluatorAuthority() { return false; },
    verifyEvidenceAuthority() { return false; }
  };
}

function item() {
  return {
    id: ITEM_ID,
    work: "Continue bounded research.",
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
    researchId: "research-1",
    questionRef: "artifact:question",
    planRef: "artifact:plan",
    evidenceLedgerRef: "artifact:ledger",
    experimentRefs: ["artifact:e1"],
    activeExperimentId: null,
    sourceRevision: SOURCE_A,
    policyRevision: null,
    nextAction: "submit proposed conclusion"
  };
}

function ledger() {
  return {
    kind: "EVIDENCE_LEDGER",
    revision: 1,
    supersedes: null,
    evidence: [{
      id: "EV1",
      status: ResearchEvidenceStatus.CONFIRMED,
      sourceRevision: SOURCE_A,
      policyRevision: null,
      sourceScopes: [SOURCE_SCOPE],
      policyScopes: [],
      observationRef: "artifact:observation",
      summary: "Current source supports H1.",
      supports: ["H1"],
      contradicts: [],
      invalidatedBy: null
    }]
  };
}

function experiment() {
  return {
    id: "E1",
    status: ResearchExperimentStatus.COMPLETED,
    sourceRevision: SOURCE_A,
    policyRevision: null,
    sourceScopes: [SOURCE_SCOPE],
    policyScopes: [],
    resumedFrom: null,
    resultRefs: ["artifact:e1-result"],
    evidenceRefs: ["EV1"]
  };
}

function artifacts() {
  return new Map([
    ["artifact:question", { kind: "RESEARCH_QUESTION", id: "Q1" }],
    ["artifact:plan", { kind: "RESEARCH_PLAN", hypotheses: ["H1"] }],
    ["artifact:ledger", ledger()],
    ["artifact:e1", experiment()],
    ["artifact:result", { kind: "RESEARCH_RESULT", decisionStatus: "PROPOSED" }]
  ]);
}

function reader(values) {
  return {
    async readArtifact({ ref }) {
      assert.ok(values.has(ref), `artifact unavailable: ${ref}`);
      return structuredClone(values.get(ref));
    }
  };
}

async function withProject({ artifactRefs }, run) {
  const directory = await mkdtemp(join(tmpdir(), "exharness-bb027-regression-"));
  const boardPath = join(directory, "blackboard.json");
  const values = artifacts();

  function makeOrchestrator() {
    return createApplicationOrchestrator({
      store: createJsonBlackboardStore({ path: boardPath }),
      reviewTrust: reviewTrustStub()
    });
  }

  try {
    const orchestrator = makeOrchestrator();
    const surface = createSessionHandoffSurface({ orchestrator, projectId: PROJECT_ID });
    await surface.initialize({
      userIntent: {
        id: "bb027-regression-intent",
        objective: "Keep research continuation explicit and review-gated.",
        bullets: ["resume from refs"],
        constraints: ["no hidden work product state"]
      },
      items: [item()]
    });

    const claim = await orchestrator.claim({ itemId: ITEM_ID, owner: "session-a" });
    await orchestrator.checkpoint({
      itemId: ITEM_ID,
      owner: "session-a",
      generation: claim.result.claimGeneration,
      checkpoint: manifest(),
      artifactRefs,
      evidenceRefs: ["artifact:ledger"],
      status: BlackboardStatus.REOPENED
    });

    await run({ values, makeOrchestrator });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function controller(orchestrator, values) {
  return createResearchContinuationController({
    orchestrator,
    projectId: PROJECT_ID,
    artifactReader: reader(values)
  });
}

test("BB-027 exposes the research continuation consumer through the package subpath", () => {
  assert.equal(typeof createResearchContinuationController, "function");
  assert.equal(typeof assessResearchEvidenceFreshness, "function");
  assert.equal(ResearchContinuationKind, "RESEARCH_CONTINUATION");
});

test("BB-027 resume rejects manifest refs hidden from the Blackboard reference projection", async () => {
  await withProject({
    artifactRefs: ["artifact:question", "artifact:e1", "artifact:ledger"]
  }, async ({ values, makeOrchestrator }) => {
    await assert.rejects(
      () => controller(makeOrchestrator(), values).resume({
        itemId: ITEM_ID,
        currentRevision: { sourceRevision: SOURCE_A, policyRevision: null }
      }),
      /Blackboard artifact references for research-work must include manifest ref artifact:plan/
    );
  });
});

test("BB-027 revision mismatch requires an explicit changed-scope comparison before evidence can remain current", () => {
  const omitted = assessResearchEvidenceFreshness({
    evidenceLedger: ledger(),
    currentRevision: { sourceRevision: SOURCE_B, policyRevision: null }
  });
  assert.equal(omitted[0].freshness, ResearchEvidenceFreshness.REASSESS_REQUIRED);
  assert.match(omitted[0].reasons[0], /without an explicit changed-scope comparison/);

  const explicitNoRelevantChange = assessResearchEvidenceFreshness({
    evidenceLedger: ledger(),
    currentRevision: { sourceRevision: SOURCE_B, policyRevision: null },
    changedSourceScopes: []
  });
  assert.equal(explicitNoRelevantChange[0].freshness, ResearchEvidenceFreshness.CURRENT);
});

test("BB-027 proposal rejects a stale manifest revision even after explicit scope comparison says evidence remains current", async () => {
  await withProject({
    artifactRefs: ["artifact:question", "artifact:plan", "artifact:e1", "artifact:ledger"]
  }, async ({ values, makeOrchestrator }) => {
    const orchestrator = makeOrchestrator();
    const claim = await orchestrator.claim({ itemId: ITEM_ID, owner: "session-b" });

    await assert.rejects(
      () => controller(orchestrator, values).submitProposal({
        itemId: ITEM_ID,
        owner: "session-b",
        generation: claim.result.claimGeneration,
        resultRef: "artifact:result",
        currentRevision: { sourceRevision: SOURCE_B, policyRevision: null },
        changedSourceScopes: [],
        resolvedWork: ["submit proposed conclusion"],
        reviewReason: "independent research review required"
      }),
      /must persist the current source\/policy revision before submission/
    );
  });
});
