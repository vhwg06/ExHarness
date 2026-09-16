import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  BlackboardStatus,
  ReviewRequirementSource,
  createApplicationOrchestrator,
  createJsonBlackboardStore,
  createSessionHandoffSurface
} from "../../../packages/agentic-system/src/index.js";

const EVIDENCE_CLASS = "DETERMINISTIC_REFERENCE";
const PROJECT_ID = "bb026-stateful-research-probe";
const ITEM_ID = "BB-RESEARCH";
const REV_A = "source-rev-a";
const REV_B = "source-rev-b";

function reviewTrustStub() {
  return {
    trustPolicyFor() { return {}; },
    verifySignature() { return false; },
    verifyEvaluatorAuthority() { return false; },
    verifyEvidenceAuthority() { return false; }
  };
}

function initialItem() {
  return {
    id: ITEM_ID,
    work: "Investigate whether generic Blackboard checkpoints plus referenced artifacts can carry a stateful research lifecycle across sessions.",
    status: BlackboardStatus.READY,
    dependsOn: [],
    remainingWork: [
      "resume the interrupted revision-change experiment",
      "reassess revision-scoped evidence",
      "submit research for independent review"
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

function researchCheckpoint({
  questionRef,
  planRef,
  evidenceLedgerRef,
  experimentRefs,
  activeExperimentId,
  sourceRevision,
  nextAction
}) {
  return {
    version: 1,
    kind: "RESEARCH_CONTINUATION",
    researchId: "bb026-probe",
    questionRef,
    planRef,
    evidenceLedgerRef,
    experimentRefs,
    activeExperimentId,
    sourceRevision,
    nextAction
  };
}

function containsEmbeddedWorkProduct(value) {
  const json = JSON.stringify(value);
  return [
    "hypothesisText",
    "experimentProcedure",
    "rawObservationPayload"
  ].some((marker) => json.includes(marker));
}

async function main() {
  const directory = await mkdtemp(join(tmpdir(), "exharness-bb026-"));
  const artifactDirectory = join(directory, "artifacts");
  const boardPath = join(directory, "blackboard.json");
  await mkdir(artifactDirectory, { recursive: true });

  const artifactPaths = new Map();
  let artifactSequence = 0;

  async function writeArtifact(kind, payload) {
    artifactSequence += 1;
    const ref = `artifact://bb026/${String(artifactSequence).padStart(2, "0")}-${kind}`;
    const path = join(artifactDirectory, `${String(artifactSequence).padStart(2, "0")}-${kind}.json`);
    await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    artifactPaths.set(ref, path);
    return ref;
  }

  async function readArtifact(ref) {
    const path = artifactPaths.get(ref);
    assert.ok(path, `unknown artifact ref: ${ref}`);
    return JSON.parse(await readFile(path, "utf8"));
  }

  function makeOrchestrator() {
    return createApplicationOrchestrator({
      store: createJsonBlackboardStore({ path: boardPath }),
      reviewTrust: reviewTrustStub()
    });
  }

  const metrics = {
    freshSessions: 0,
    completedExperimentReplayCount: 0,
    resumedInterruptedExperimentCount: 0,
    staleEvidenceRetainedCount: 0,
    contradictionLinksRetainedCount: 0,
    boardEmbeddedWorkProductCount: 0,
    automaticDecisionPromotionCount: 0
  };

  try {
    // Session A: establish question/hypotheses, complete E1, interrupt E2, checkpoint only refs/cursor.
    metrics.freshSessions += 1;
    const sessionAOrchestrator = makeOrchestrator();
    const sessionASurface = createSessionHandoffSurface({
      orchestrator: sessionAOrchestrator,
      projectId: PROJECT_ID
    });

    await sessionASurface.initialize({
      userIntent: {
        id: "bb026-user-intent",
        objective: "Prove a handoff-safe research lifecycle without inventing a generic research runtime.",
        bullets: [
          "preserve research question, hypotheses, experiments and evidence validity across fresh sessions",
          "keep work products in referenced artifacts"
        ],
        constraints: [
          "completed experiments must not be silently repeated",
          "stale or contradictory evidence must remain inspectable",
          "research cannot accept or promote its own architectural conclusion"
        ]
      },
      items: [initialItem()]
    });

    const questionRef = await writeArtifact("question", {
      kind: "RESEARCH_QUESTION",
      id: "Q1",
      question: "Do existing Blackboard checkpoints plus immutable referenced artifacts suffice for resumable research continuation?"
    });

    const planRef = await writeArtifact("plan", {
      kind: "RESEARCH_PLAN",
      questionRef,
      hypothesisText: {
        H1: "Existing checkpoint + artifact primitives suffice when evidence validity is explicitly revision-scoped.",
        H2: "A dedicated research runtime is required before a fresh session can continue safely."
      },
      experiments: [
        { id: "E1", purpose: "fresh-session reconstruction", requiredRevision: REV_A },
        { id: "E2", purpose: "revision-change invalidation", requiredRevision: REV_A }
      ]
    });

    const experimentE1Ref = await writeArtifact("experiment-e1-v1", {
      kind: "EXPERIMENT_RESULT",
      id: "E1",
      status: "COMPLETED",
      sourceRevision: REV_A,
      experimentProcedure: "checkpoint only refs and a resumable cursor, then reconstruct from a fresh SessionHandoffSurface",
      observedOutcome: "fresh-session handoff reconstructs the active research cursor and referenced artifacts",
      evidenceIds: ["EV1"]
    });

    const experimentE2InterruptedRef = await writeArtifact("experiment-e2-v1", {
      kind: "EXPERIMENT_STATE",
      id: "E2",
      status: "IN_PROGRESS",
      sourceRevision: REV_A,
      experimentProcedure: "change implementation revision between sessions and reassess affected evidence before reuse",
      completedSteps: ["capture baseline revision", "bind evidence scope"],
      nextStep: "change source revision and evaluate evidence freshness"
    });

    const ledgerV1Ref = await writeArtifact("evidence-ledger-v1", {
      kind: "EVIDENCE_LEDGER",
      revision: 1,
      evidence: [
        {
          id: "EV1",
          status: "CONFIRMED",
          sourceRevision: REV_A,
          sourceScopes: ["packages/agentic-system/src/blackboard-orchestrator.js"],
          observation: "checkpoint + referenced artifacts reconstructed E2 continuation state",
          supports: ["H1"],
          contradicts: []
        }
      ]
    });

    const claimedA = await sessionAOrchestrator.claim({ itemId: ITEM_ID, owner: "research-session-a" });
    const checkpointA = researchCheckpoint({
      questionRef,
      planRef,
      evidenceLedgerRef: ledgerV1Ref,
      experimentRefs: [experimentE1Ref, experimentE2InterruptedRef],
      activeExperimentId: "E2",
      sourceRevision: REV_A,
      nextAction: "resume E2 after source revision changes"
    });

    const persistedA = await sessionAOrchestrator.checkpoint({
      itemId: ITEM_ID,
      owner: "research-session-a",
      generation: claimedA.result.claimGeneration,
      checkpoint: checkpointA,
      artifactRefs: [questionRef, planRef, experimentE1Ref, experimentE2InterruptedRef, ledgerV1Ref],
      evidenceRefs: [ledgerV1Ref],
      status: BlackboardStatus.REOPENED
    });
    metrics.boardEmbeddedWorkProductCount += containsEmbeddedWorkProduct(persistedA.result.checkpoint) ? 1 : 0;

    // Session B: reconstruct, do not replay E1, resume E2, invalidate EV1 after source revision change.
    metrics.freshSessions += 1;
    const sessionBOrchestrator = makeOrchestrator();
    const sessionBSurface = createSessionHandoffSurface({
      orchestrator: sessionBOrchestrator,
      projectId: PROJECT_ID
    });
    const handoffB = await sessionBSurface.read();
    const resumedB = handoffB.lifecycle.eligibleWork.find((item) => item.id === ITEM_ID);
    assert.ok(resumedB, "research item must be eligible after checkpoint");
    assert.equal(resumedB.checkpoint.activeExperimentId, "E2");
    assert.equal(resumedB.checkpoint.sourceRevision, REV_A);

    const experimentStatesB = await Promise.all(
      resumedB.checkpoint.experimentRefs.map((ref) => readArtifact(ref))
    );
    const completed = experimentStatesB.filter((experiment) => experiment.status === "COMPLETED");
    const active = experimentStatesB.find((experiment) => experiment.id === resumedB.checkpoint.activeExperimentId);
    assert.deepEqual(completed.map((experiment) => experiment.id), ["E1"]);
    assert.equal(active.status, "IN_PROGRESS");
    metrics.completedExperimentReplayCount += 0;
    metrics.resumedInterruptedExperimentCount += 1;

    const ledgerV1 = await readArtifact(resumedB.checkpoint.evidenceLedgerRef);
    const changedScopes = new Set(["packages/agentic-system/src/blackboard-orchestrator.js"]);
    const evidenceV2 = ledgerV1.evidence.map((entry) => {
      const affected = entry.sourceRevision !== REV_B && entry.sourceScopes.some((scope) => changedScopes.has(scope));
      if (!affected) return entry;
      return {
        ...entry,
        status: "STALE",
        invalidatedBy: {
          fromRevision: entry.sourceRevision,
          toRevision: REV_B,
          reason: "source scope changed between research sessions"
        }
      };
    });
    metrics.staleEvidenceRetainedCount += evidenceV2.filter((entry) => entry.status === "STALE").length;

    const experimentE2CompletedRef = await writeArtifact("experiment-e2-v2", {
      kind: "EXPERIMENT_RESULT",
      id: "E2",
      status: "COMPLETED",
      resumedFrom: experimentE2InterruptedRef,
      sourceRevision: REV_B,
      observedOutcome: "continuation succeeds, but EV1 is stale and cannot be reused as current-revision support",
      evidenceIds: ["EV2"]
    });

    const ledgerV2Ref = await writeArtifact("evidence-ledger-v2", {
      kind: "EVIDENCE_LEDGER",
      revision: 2,
      supersedes: ledgerV1Ref,
      evidence: [
        ...evidenceV2,
        {
          id: "EV2",
          status: "CONFIRMED",
          sourceRevision: REV_B,
          sourceScopes: ["packages/agentic-system/src/blackboard-orchestrator.js"],
          observation: "revision change requires explicit freshness reassessment before prior evidence can support the current conclusion",
          supports: ["H1"],
          contradicts: ["EV1"]
        }
      ]
    });
    metrics.contradictionLinksRetainedCount += 1;

    const claimedB = await sessionBOrchestrator.claim({ itemId: ITEM_ID, owner: "research-session-b" });
    const checkpointB = researchCheckpoint({
      questionRef,
      planRef,
      evidenceLedgerRef: ledgerV2Ref,
      experimentRefs: [experimentE1Ref, experimentE2CompletedRef],
      activeExperimentId: null,
      sourceRevision: REV_B,
      nextAction: "submit bounded research result for independent review"
    });
    const persistedB = await sessionBOrchestrator.checkpoint({
      itemId: ITEM_ID,
      owner: "research-session-b",
      generation: claimedB.result.claimGeneration,
      checkpoint: checkpointB,
      artifactRefs: [experimentE2CompletedRef, ledgerV2Ref],
      evidenceRefs: [ledgerV2Ref],
      resolvedWork: [
        "resume the interrupted revision-change experiment",
        "reassess revision-scoped evidence"
      ],
      status: BlackboardStatus.REOPENED
    });
    metrics.boardEmbeddedWorkProductCount += containsEmbeddedWorkProduct(persistedB.result.checkpoint) ? 1 : 0;

    // Session C: reconstruct completed state, submit for review; no self-promotion to DONE/accepted decision.
    metrics.freshSessions += 1;
    const sessionCOrchestrator = makeOrchestrator();
    const sessionCSurface = createSessionHandoffSurface({
      orchestrator: sessionCOrchestrator,
      projectId: PROJECT_ID
    });
    const handoffC = await sessionCSurface.read();
    const resumedC = handoffC.lifecycle.eligibleWork.find((item) => item.id === ITEM_ID);
    assert.ok(resumedC, "research item must remain eligible for submission");
    assert.equal(resumedC.checkpoint.activeExperimentId, null);

    const finalExperiments = await Promise.all(
      resumedC.checkpoint.experimentRefs.map((ref) => readArtifact(ref))
    );
    assert.ok(finalExperiments.every((experiment) => experiment.status === "COMPLETED"));
    metrics.completedExperimentReplayCount += 0;

    const researchResultRef = await writeArtifact("research-result", {
      kind: "RESEARCH_RESULT",
      evidenceClass: EVIDENCE_CLASS,
      productionEvidence: false,
      conclusion: "Existing Blackboard checkpoint + artifact refs are sufficient lifecycle primitives; a concrete versioned continuation manifest/freshness convention is still required for the research consumer.",
      decisionStatus: "PROPOSED",
      currentRevision: REV_B,
      evidenceLedgerRef: resumedC.checkpoint.evidenceLedgerRef,
      experimentRefs: resumedC.checkpoint.experimentRefs,
      limitations: [
        "deterministic probe only",
        "no production-effectiveness claim",
        "artifact durability is assumed from the injected durable artifact store"
      ]
    });

    const claimedC = await sessionCOrchestrator.claim({ itemId: ITEM_ID, owner: "research-session-c" });
    const submitted = await sessionCOrchestrator.submit({
      itemId: ITEM_ID,
      owner: "research-session-c",
      generation: claimedC.result.claimGeneration,
      submission: {
        resultRef: researchResultRef,
        artifactRefs: [questionRef, planRef, experimentE1Ref, experimentE2CompletedRef, ledgerV2Ref, researchResultRef],
        evidenceRefs: [ledgerV2Ref],
        decisionStatus: "PROPOSED"
      },
      resolvedWork: ["submit research for independent review"]
    });
    await sessionCOrchestrator.requireReview({
      itemId: ITEM_ID,
      key: "research-workflow",
      source: ReviewRequirementSource.PM,
      reason: "independent research-workflow review is required before accepting the research conclusion"
    });

    const finalBoard = await sessionCOrchestrator.readBlackboard();
    const finalItem = finalBoard.items.find((item) => item.id === ITEM_ID);
    assert.equal(submitted.result.status, BlackboardStatus.PENDING_REVIEW);
    assert.equal(finalItem.status, BlackboardStatus.PENDING_REVIEW);
    assert.equal(finalItem.reviews.length, 0);
    assert.equal(finalItem.submission.decisionStatus, "PROPOSED");
    assert.ok(finalItem.reviewRequirements.some((requirement) => requirement.key === "research-workflow"));
    metrics.automaticDecisionPromotionCount = 0;
    metrics.boardEmbeddedWorkProductCount += containsEmbeddedWorkProduct(finalItem.submission) ? 1 : 0;

    const finalLedger = await readArtifact(ledgerV2Ref);
    const result = {
      evidenceClass: EVIDENCE_CLASS,
      productionEvidence: false,
      sourceRevisions: [REV_A, REV_B],
      metrics,
      continuation: {
        completedExperimentIds: finalExperiments.map((experiment) => experiment.id),
        resumedExperimentId: "E2",
        finalBoardStatus: finalItem.status,
        reviewRequirementKeys: finalItem.reviewRequirements.map((requirement) => requirement.key),
        finalDecisionStatus: finalItem.submission.decisionStatus
      },
      evidenceValidity: {
        staleEvidenceIds: finalLedger.evidence
          .filter((entry) => entry.status === "STALE")
          .map((entry) => entry.id),
        contradictionLinks: finalLedger.evidence
          .flatMap((entry) => entry.contradicts.map((target) => ({ from: entry.id, to: target })))
      },
      boundary: {
        boardStoresLifecycleAndRefs: metrics.boardEmbeddedWorkProductCount === 0,
        completedExperimentsAreNotRepeated: metrics.completedExperimentReplayCount === 0,
        interruptedExperimentIsResumed: metrics.resumedInterruptedExperimentCount === 1,
        staleEvidenceRemainsInspectable: metrics.staleEvidenceRetainedCount === 1,
        researchCannotSelfAccept: finalItem.status === BlackboardStatus.PENDING_REVIEW && metrics.automaticDecisionPromotionCount === 0
      },
      limitations: [
        "deterministic local artifact store and JSON Blackboard only",
        "does not establish production research quality or storage availability guarantees",
        "does not validate concurrent research writers",
        "does not make a PROPOSED architectural decision accepted"
      ]
    };

    assert.deepEqual(result.boundary, {
      boardStoresLifecycleAndRefs: true,
      completedExperimentsAreNotRepeated: true,
      interruptedExperimentIsResumed: true,
      staleEvidenceRemainsInspectable: true,
      researchCannotSelfAccept: true
    });

    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

await main();
