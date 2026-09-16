import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createApplicationOrchestrator } from "../src/application-orchestrator.js";
import { createJsonBlackboardStore } from "../src/blackboard-json-payload.js";
import {
  ResearchContinuationKind,
  ResearchEvidenceFreshness,
  ResearchEvidenceStatus,
  ResearchExperimentStatus,
  assessResearchEvidenceFreshness,
  createResearchContinuationController,
  defineResearchContinuationManifest,
  defineResearchEvidenceLedger,
  defineResearchExperimentState
} from "../src/research-continuation.js";
import {
  createSessionHandoffSurface
} from "../src/session-handoff.js";
import {
  BlackboardStatus
} from "../src/blackboard-orchestrator.js";

const PROJECT_ID = "bb027-project";
const ITEM_ID = "research-work";
const SOURCE_A = "source-a";
const SOURCE_B = "source-b";
const POLICY_A = "policy-a";
const POLICY_B = "policy-b";
const SOURCE_SCOPE = "packages/agentic-system/src/example.js";
const POLICY_SCOPE = "policy/research-acceptance";

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
    work: "Continue a bounded research investigation across fresh sessions.",
    status: BlackboardStatus.READY,
    dependsOn: [],
    remainingWork: [
      "resume E2",
      "reassess stale evidence",
      "submit proposed conclusion"
    ],
    blockers: [],
    artifactRefs: [],
    evidenceRefs: [],
    followUpRefs: [],
    reviewRequirements: [],
    reviews: [],
    findings: []
  };
}

function artifactReader(artifacts) {
  return {
    async readArtifact({ ref }) {
      assert.ok(artifacts.has(ref), `artifact unavailable: ${ref}`);
      return structuredClone(artifacts.get(ref));
    }
  };
}

function manifest(overrides = {}) {
  return {
    version: 1,
    kind: ResearchContinuationKind,
    researchId: "research-1",
    questionRef: "artifact:question",
    planRef: "artifact:plan",
    evidenceLedgerRef: "artifact:ledger-v1",
    experimentRefs: ["artifact:e1", "artifact:e2-v1"],
    activeExperimentId: "E2",
    sourceRevision: SOURCE_A,
    policyRevision: POLICY_A,
    nextAction: "resume E2",
    ...overrides
  };
}

function completedExperiment(overrides = {}) {
  return {
    id: "E1",
    status: ResearchExperimentStatus.COMPLETED,
    sourceRevision: SOURCE_A,
    policyRevision: POLICY_A,
    sourceScopes: [SOURCE_SCOPE],
    policyScopes: [POLICY_SCOPE],
    resumedFrom: null,
    resultRefs: ["artifact:e1-result"],
    evidenceRefs: ["EV1"],
    ...overrides
  };
}

function activeExperiment(overrides = {}) {
  return {
    id: "E2",
    status: ResearchExperimentStatus.IN_PROGRESS,
    sourceRevision: SOURCE_A,
    policyRevision: POLICY_A,
    sourceScopes: [SOURCE_SCOPE],
    policyScopes: [POLICY_SCOPE],
    resumedFrom: null,
    resultRefs: [],
    evidenceRefs: [],
    ...overrides
  };
}

function ledgerV1(overrides = {}) {
  return {
    kind: "EVIDENCE_LEDGER",
    revision: 1,
    supersedes: null,
    evidence: [
      {
        id: "EV1",
        status: ResearchEvidenceStatus.CONFIRMED,
        sourceRevision: SOURCE_A,
        policyRevision: POLICY_A,
        sourceScopes: [SOURCE_SCOPE],
        policyScopes: [POLICY_SCOPE],
        observationRef: "artifact:observation-ev1",
        summary: "E1 supports the initial hypothesis.",
        supports: ["H1"],
        contradicts: [],
        invalidatedBy: null
      }
    ],
    ...overrides
  };
}

function initialArtifacts() {
  return new Map([
    ["artifact:question", { kind: "RESEARCH_QUESTION", id: "Q1" }],
    ["artifact:plan", { kind: "RESEARCH_PLAN", hypotheses: ["H1", "H2"] }],
    ["artifact:e1", completedExperiment()],
    ["artifact:e2-v1", activeExperiment()],
    ["artifact:ledger-v1", ledgerV1()]
  ]);
}

async function withProject(run) {
  const directory = await mkdtemp(join(tmpdir(), "exharness-bb027-"));
  const boardPath = join(directory, "blackboard.json");
  const artifacts = initialArtifacts();

  function makeOrchestrator() {
    return createApplicationOrchestrator({
      store: createJsonBlackboardStore({ path: boardPath }),
      reviewTrust: reviewTrustStub()
    });
  }

  function makeController() {
    return createResearchContinuationController({
      orchestrator: makeOrchestrator(),
      projectId: PROJECT_ID,
      artifactReader: artifactReader(artifacts)
    });
  }

  try {
    const orchestrator = makeOrchestrator();
    const surface = createSessionHandoffSurface({
      orchestrator,
      projectId: PROJECT_ID
    });
    await surface.initialize({
      userIntent: {
        id: "bb027-user-intent",
        objective: "Continue research without hidden session state or self-acceptance.",
        bullets: ["resume interrupted experiments", "reassess revision-scoped evidence"],
        constraints: ["Board carries lifecycle + refs only", "research result remains proposed until independent review"]
      },
      items: [researchItem()]
    });

    const claim = await orchestrator.claim({ itemId: ITEM_ID, owner: "session-a" });
    await orchestrator.checkpoint({
      itemId: ITEM_ID,
      owner: "session-a",
      generation: claim.result.claimGeneration,
      checkpoint: manifest(),
      artifactRefs: [
        "artifact:question",
        "artifact:plan",
        "artifact:e1",
        "artifact:e2-v1",
        "artifact:ledger-v1"
      ],
      evidenceRefs: ["artifact:ledger-v1"],
      status: BlackboardStatus.REOPENED
    });

    await run({ artifacts, makeOrchestrator, makeController });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("BB-027 validates manifest, experiment and evidence-ledger authority-bearing state", () => {
  assert.throws(
    () => defineResearchContinuationManifest(manifest({ version: 2 })),
    /version must be 1/
  );
  assert.throws(
    () => defineResearchContinuationManifest(manifest({ experimentRefs: ["artifact:e1", "artifact:e1"] })),
    /must not contain duplicates/
  );
  assert.throws(
    () => defineResearchExperimentState(completedExperiment({ resultRefs: [], evidenceRefs: [] })),
    /completed research experiment requires resultRefs or evidenceRefs/
  );
  assert.throws(
    () => defineResearchEvidenceLedger(ledgerV1({
      evidence: [{
        ...ledgerV1().evidence[0],
        status: ResearchEvidenceStatus.STALE,
        invalidatedBy: null
      }]
    })),
    /STALE requires invalidatedBy provenance/
  );
  assert.throws(
    () => defineResearchEvidenceLedger(ledgerV1({
      evidence: [{
        ...ledgerV1().evidence[0],
        contradicts: ["EV-MISSING"]
      }]
    })),
    /contradicts unknown evidence/
  );
});

test("BB-027 scope-aware freshness does not invalidate evidence for unrelated revision changes", () => {
  const matching = assessResearchEvidenceFreshness({
    evidenceLedger: ledgerV1(),
    currentRevision: { sourceRevision: SOURCE_B, policyRevision: POLICY_B },
    changedSourceScopes: [SOURCE_SCOPE],
    changedPolicyScopes: [POLICY_SCOPE]
  });
  assert.equal(matching[0].freshness, ResearchEvidenceFreshness.REASSESS_REQUIRED);
  assert.equal(matching[0].reasons.length, 2);

  const unrelated = assessResearchEvidenceFreshness({
    evidenceLedger: ledgerV1(),
    currentRevision: { sourceRevision: SOURCE_B, policyRevision: POLICY_B },
    changedSourceScopes: ["packages/unrelated.js"],
    changedPolicyScopes: ["policy/unrelated"]
  });
  assert.equal(unrelated[0].freshness, ResearchEvidenceFreshness.CURRENT);
  assert.deepEqual(unrelated[0].reasons, []);
});

test("BB-027 fresh-session resume skips completed E1 and exposes exactly interrupted E2", async () => {
  await withProject(async ({ makeController }) => {
    const controller = makeController();
    const continuation = await controller.resume({
      itemId: ITEM_ID,
      currentRevision: { sourceRevision: SOURCE_A, policyRevision: POLICY_A }
    });

    assert.deepEqual(continuation.completedExperimentIds, ["E1"]);
    assert.equal(continuation.resumeExperiment.id, "E2");
    assert.equal(continuation.resumeExperiment.status, ResearchExperimentStatus.IN_PROGRESS);
    assert.deepEqual(continuation.reassessmentEvidenceIds, []);
    assert.equal(continuation.revisionChanged, false);
  });
});

test("BB-027 fails closed when checkpoint cursor does not match incomplete experiment state", async () => {
  await withProject(async ({ artifacts, makeController }) => {
    artifacts.set("artifact:e2-v1", activeExperiment({ id: "E3" }));
    await assert.rejects(
      () => makeController().resume({
        itemId: ITEM_ID,
        currentRevision: { sourceRevision: SOURCE_A, policyRevision: POLICY_A }
      }),
      /activeExperimentId does not match incomplete experiment E3/
    );
  });
});

test("BB-027 persists revised continuation and a later fresh session retains stale and contradictory evidence", async () => {
  await withProject(async ({ artifacts, makeOrchestrator, makeController }) => {
    const before = await makeController().resume({
      itemId: ITEM_ID,
      currentRevision: { sourceRevision: SOURCE_B, policyRevision: POLICY_A },
      changedSourceScopes: [SOURCE_SCOPE]
    });
    assert.deepEqual(before.reassessmentEvidenceIds, ["EV1"]);

    artifacts.set("artifact:e2-v2", completedExperiment({
      id: "E2",
      sourceRevision: SOURCE_B,
      resumedFrom: "artifact:e2-v1",
      resultRefs: ["artifact:e2-result"],
      evidenceRefs: ["EV2"]
    }));
    artifacts.set("artifact:ledger-v2", {
      kind: "EVIDENCE_LEDGER",
      revision: 2,
      supersedes: "artifact:ledger-v1",
      evidence: [
        {
          ...ledgerV1().evidence[0],
          status: ResearchEvidenceStatus.STALE,
          invalidatedBy: {
            fromRevision: SOURCE_A,
            toRevision: SOURCE_B,
            reason: "declared source scope changed"
          }
        },
        {
          id: "EV2",
          status: ResearchEvidenceStatus.CONFIRMED,
          sourceRevision: SOURCE_B,
          policyRevision: POLICY_A,
          sourceScopes: [SOURCE_SCOPE],
          policyScopes: [POLICY_SCOPE],
          observationRef: "artifact:observation-ev2",
          summary: "E2 establishes current-revision evidence.",
          supports: ["H1"],
          contradicts: ["EV1"],
          invalidatedBy: null
        }
      ]
    });

    const orchestrator = makeOrchestrator();
    const claim = await orchestrator.claim({ itemId: ITEM_ID, owner: "session-b" });
    const controller = createResearchContinuationController({
      orchestrator,
      projectId: PROJECT_ID,
      artifactReader: artifactReader(artifacts)
    });
    await controller.persistContinuation({
      itemId: ITEM_ID,
      owner: "session-b",
      generation: claim.result.claimGeneration,
      manifest: manifest({
        evidenceLedgerRef: "artifact:ledger-v2",
        experimentRefs: ["artifact:e1", "artifact:e2-v2"],
        activeExperimentId: null,
        sourceRevision: SOURCE_B,
        nextAction: "submit proposed conclusion"
      }),
      artifactRefs: [
        "artifact:question",
        "artifact:plan",
        "artifact:e1",
        "artifact:e2-v2",
        "artifact:ledger-v2"
      ],
      evidenceRefs: ["artifact:ledger-v2"],
      resolvedWork: ["resume E2", "reassess stale evidence"]
    });

    const fresh = await makeController().resume({
      itemId: ITEM_ID,
      currentRevision: { sourceRevision: SOURCE_B, policyRevision: POLICY_A }
    });
    assert.deepEqual(fresh.completedExperimentIds.sort(), ["E1", "E2"]);
    assert.equal(fresh.resumeExperiment, null);
    assert.equal(
      fresh.evidenceFreshness.find((entry) => entry.id === "EV1").freshness,
      ResearchEvidenceFreshness.NON_CURRENT
    );
    assert.equal(
      fresh.evidenceFreshness.find((entry) => entry.id === "EV2").freshness,
      ResearchEvidenceFreshness.CURRENT
    );
    assert.deepEqual(
      fresh.evidenceLedger.evidence.find((entry) => entry.id === "EV2").contradicts,
      ["EV1"]
    );
  });
});

test("BB-027 proposal submission remains PENDING_REVIEW and cannot self-promote acceptance", async () => {
  await withProject(async ({ artifacts, makeOrchestrator }) => {
    artifacts.set("artifact:e2-v2", completedExperiment({
      id: "E2",
      sourceRevision: SOURCE_A,
      resumedFrom: "artifact:e2-v1",
      resultRefs: ["artifact:e2-result"],
      evidenceRefs: ["EV2"]
    }));
    artifacts.set("artifact:ledger-v2", {
      kind: "EVIDENCE_LEDGER",
      revision: 2,
      supersedes: "artifact:ledger-v1",
      evidence: [
        ledgerV1().evidence[0],
        {
          id: "EV2",
          status: ResearchEvidenceStatus.CONFIRMED,
          sourceRevision: SOURCE_A,
          policyRevision: POLICY_A,
          sourceScopes: [SOURCE_SCOPE],
          policyScopes: [POLICY_SCOPE],
          observationRef: "artifact:observation-ev2",
          summary: "E2 is complete.",
          supports: ["H1"],
          contradicts: [],
          invalidatedBy: null
        }
      ]
    });
    artifacts.set("artifact:result", { kind: "RESEARCH_RESULT", decisionStatus: "PROPOSED" });

    let orchestrator = makeOrchestrator();
    let controller = createResearchContinuationController({
      orchestrator,
      projectId: PROJECT_ID,
      artifactReader: artifactReader(artifacts)
    });
    let claim = await orchestrator.claim({ itemId: ITEM_ID, owner: "session-b" });
    await controller.persistContinuation({
      itemId: ITEM_ID,
      owner: "session-b",
      generation: claim.result.claimGeneration,
      manifest: manifest({
        evidenceLedgerRef: "artifact:ledger-v2",
        experimentRefs: ["artifact:e1", "artifact:e2-v2"],
        activeExperimentId: null,
        nextAction: "submit proposed conclusion"
      }),
      artifactRefs: [
        "artifact:question",
        "artifact:plan",
        "artifact:e1",
        "artifact:e2-v2",
        "artifact:ledger-v2"
      ],
      evidenceRefs: ["artifact:ledger-v2"],
      resolvedWork: ["resume E2", "reassess stale evidence"]
    });

    orchestrator = makeOrchestrator();
    controller = createResearchContinuationController({
      orchestrator,
      projectId: PROJECT_ID,
      artifactReader: artifactReader(artifacts)
    });
    claim = await orchestrator.claim({ itemId: ITEM_ID, owner: "session-c" });
    const result = await controller.submitProposal({
      itemId: ITEM_ID,
      owner: "session-c",
      generation: claim.result.claimGeneration,
      resultRef: "artifact:result",
      currentRevision: { sourceRevision: SOURCE_A, policyRevision: POLICY_A },
      resolvedWork: ["submit proposed conclusion"],
      reviewReason: "independent research-workflow review required"
    });

    assert.equal(result.item.status, BlackboardStatus.PENDING_REVIEW);
    assert.equal(result.item.submission.decisionStatus, "PROPOSED");
    assert.equal(result.item.reviews.length, 0);
    assert.deepEqual(result.item.reviewRequirements.map((requirement) => requirement.key), ["research-workflow"]);
    assert.ok(result.item.submission.artifactRefs.includes("artifact:result"));
    assert.ok(result.item.submission.artifactRefs.includes("artifact:ledger-v2"));
  });
});

test("BB-027 blocks proposal submission while an experiment or freshness reassessment remains unresolved", async () => {
  await withProject(async ({ makeOrchestrator, makeController }) => {
    let orchestrator = makeOrchestrator();
    let claim = await orchestrator.claim({ itemId: ITEM_ID, owner: "session-submit-active" });
    let controller = createResearchContinuationController({
      orchestrator,
      projectId: PROJECT_ID,
      artifactReader: artifactReader(initialArtifacts())
    });
    await assert.rejects(
      () => controller.submitProposal({
        itemId: ITEM_ID,
        owner: "session-submit-active",
        generation: claim.result.claimGeneration,
        resultRef: "artifact:result",
        currentRevision: { sourceRevision: SOURCE_A, policyRevision: POLICY_A },
        reviewReason: "review required"
      }),
      /cannot submit while an experiment remains active/
    );

    // The failed helper call has not mutated the claim; recover it into a fresh generation
    // to prove stale-evidence submission also fails closed independently.
    await orchestrator.checkpoint({
      itemId: ITEM_ID,
      owner: "session-submit-active",
      generation: claim.result.claimGeneration,
      checkpoint: manifest({ activeExperimentId: null, experimentRefs: ["artifact:e1"] }),
      artifactRefs: ["artifact:question", "artifact:plan", "artifact:e1", "artifact:ledger-v1"],
      evidenceRefs: ["artifact:ledger-v1"],
      status: BlackboardStatus.REOPENED
    });

    orchestrator = makeOrchestrator();
    claim = await orchestrator.claim({ itemId: ITEM_ID, owner: "session-submit-stale" });
    controller = createResearchContinuationController({
      orchestrator,
      projectId: PROJECT_ID,
      artifactReader: artifactReader(initialArtifacts())
    });
    await assert.rejects(
      () => controller.submitProposal({
        itemId: ITEM_ID,
        owner: "session-submit-stale",
        generation: claim.result.claimGeneration,
        resultRef: "artifact:result",
        currentRevision: { sourceRevision: SOURCE_B, policyRevision: POLICY_A },
        changedSourceScopes: [SOURCE_SCOPE],
        reviewReason: "review required"
      }),
      /evidence awaiting freshness reassessment: EV1/
    );
  });
});
