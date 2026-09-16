import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  BlackboardStatus,
  UserIntentSource,
  WorkContinuationAction,
  WorkSelectionEvidenceState,
  WorkSelectionReason,
  WorkSelectionSignalSource,
  createApplicationOrchestrator,
  createBoundedProjectWorkSelector,
  createJsonBlackboardStore,
  createJsonWorkSelectionDecisionStore,
  createSessionHandoffSurface,
  decideProjectWorkContinuation
} from "../src/index.js";

function reviewTrustStub() {
  return {
    trustPolicyFor() { return {}; },
    verifySignature() { return false; },
    verifyEvaluatorAuthority() { return false; },
    verifyEvidenceAuthority() { return false; }
  };
}

const USER_INTENT = Object.freeze({
  id: "bb031-work-selection",
  source: UserIntentSource.USER,
  objective: "Select project work without weakening Blackboard authority.",
  bullets: ["Use explicit priorities and bounded scheduling evidence."],
  constraints: ["Selection is not claim or completion authority."]
});

const POLICY = Object.freeze({
  name: "bounded-project-selection",
  revision: "1",
  configurationRef: "config://bb031/reference-v1",
  selectionBudget: 5,
  maxDeferrals: 3,
  retryCeiling: 2,
  plateauWindow: 2
});

function workItem(id, overrides = {}) {
  return {
    id,
    work: `Work ${id}`,
    status: BlackboardStatus.READY,
    dependsOn: [],
    remainingWork: [],
    blockers: [],
    artifactRefs: [],
    evidenceRefs: [],
    followUpRefs: [],
    reviewRequirements: [],
    reviews: [],
    findings: [],
    ...overrides
  };
}

function signal(value, source, evidenceRef = null) {
  return { value, source, ...(evidenceRef == null ? {} : { evidenceRef }) };
}

function measurement(itemId, overrides = {}) {
  return {
    itemId,
    userPriority: "P2",
    mandatoryObligations: [],
    deferrals: 0,
    signals: {
      userImpact: signal(2, WorkSelectionSignalSource.ESTIMATED, `estimate://${itemId}/impact`),
      defectSeverity: signal(1, WorkSelectionSignalSource.OBSERVED, `evidence://${itemId}/severity`),
      dependencyUnblocks: signal(0, WorkSelectionSignalSource.OBSERVED, `board://${itemId}/dependents`),
      evidenceConfidence: signal(0.8, WorkSelectionSignalSource.ESTIMATED, `estimate://${itemId}/confidence`),
      cost: signal(1, WorkSelectionSignalSource.OBSERVED, `run://${itemId}/cost`)
    },
    ...overrides
  };
}

async function withProject(items, run) {
  const directory = await mkdtemp(join(tmpdir(), "exharness-bb031-"));
  try {
    const boardPath = join(directory, "blackboard.json");
    const decisionsPath = join(directory, "work-selection");
    const orchestrator = createApplicationOrchestrator({
      store: createJsonBlackboardStore({ path: boardPath }),
      reviewTrust: reviewTrustStub()
    });
    const handoff = createSessionHandoffSurface({ orchestrator, projectId: "project-bb031" });
    await handoff.initialize({ userIntent: USER_INTENT, items });
    const decisionStore = createJsonWorkSelectionDecisionStore({ path: decisionsPath });
    const selector = createBoundedProjectWorkSelector({ handoffSurface: handoff, decisionStore, policy: POLICY });
    await run({ directory, boardPath, decisionsPath, orchestrator, handoff, decisionStore, selector });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("selector ranks only current eligible work and persists provenance without mutating Blackboard", async () => {
  await withProject([
    workItem("LOW"),
    workItem("MANDATORY", { reviewRequirements: [{ key: "independent-review", source: "PM", reason: "Required after submission." }] }),
    workItem("BLOCKED", { status: BlackboardStatus.BLOCKED, blockers: ["external prerequisite"] }),
    workItem("REVIEWING", { status: BlackboardStatus.PENDING_REVIEW })
  ], async ({ orchestrator, decisionStore, selector }) => {
    const before = await orchestrator.readBlackboard();
    const proposed = await selector.propose({
      measurements: [
        measurement("LOW"),
        measurement("MANDATORY", {
          userPriority: "P1",
          mandatoryObligations: ["correctness regression"],
          signals: {
            userImpact: signal(5, WorkSelectionSignalSource.ESTIMATED),
            defectSeverity: signal(5, WorkSelectionSignalSource.OBSERVED),
            dependencyUnblocks: signal(2, WorkSelectionSignalSource.OBSERVED),
            evidenceConfidence: signal(1, WorkSelectionSignalSource.OBSERVED),
            cost: signal(3, WorkSelectionSignalSource.OBSERVED)
          }
        }),
        measurement("BLOCKED", { userPriority: "P1" }),
        measurement("REVIEWING", { userPriority: "P1" })
      ]
    });

    assert.equal(proposed.decision.selectedItemId, "MANDATORY");
    assert.equal(proposed.decision.reason, WorkSelectionReason.MANDATORY_CORRECTNESS);
    assert.deepEqual(proposed.decision.excluded.filter((entry) => entry.reason === "NOT_ELIGIBLE").map((entry) => entry.itemId).sort(), ["BLOCKED", "REVIEWING"]);
    assert.equal(proposed.decision.measurements.find((entry) => entry.itemId === "MANDATORY").signals.userImpact.source, WorkSelectionSignalSource.ESTIMATED);
    assert.equal(proposed.decision.measurements.find((entry) => entry.itemId === "MANDATORY").reviewRequirements[0].key, "independent-review");
    assert.equal(proposed.decision.authority.selectionMutatesBlackboard, false);
    assert.equal(proposed.decision.authority.selectionIsCorrectnessEvidence, false);
    assert.equal(proposed.decision.authority.claimRequiresFreshOrchestratorCheck, true);
    assert.equal(proposed.decision.comparison.baselinePolicy.revision, "1");
    assert.equal(proposed.decision.comparison.candidatePolicy.revision, POLICY.revision);
    assert.deepEqual(await orchestrator.readBlackboard(), before);
    assert.deepEqual(await decisionStore.read(proposed.decisionRef), proposed.decision);
  });
});

test("missing measurements remain explicit and are never coerced into a score", async () => {
  await withProject([workItem("UNKNOWN")], async ({ selector }) => {
    const proposed = await selector.propose({ measurements: [{
      itemId: "UNKNOWN",
      userPriority: "P1",
      signals: {
        userImpact: signal(5, WorkSelectionSignalSource.ESTIMATED),
        defectSeverity: signal(2, WorkSelectionSignalSource.OBSERVED),
        dependencyUnblocks: signal(0, WorkSelectionSignalSource.OBSERVED),
        evidenceConfidence: signal(0.7, WorkSelectionSignalSource.ESTIMATED),
        cost: null
      }
    }] });
    assert.equal(proposed.decision.selectedItemId, null);
    assert.equal(proposed.decision.reason, WorkSelectionReason.MISSING_MEASUREMENT);
    assert.equal(proposed.decision.scoreComponents, null);
    assert.deepEqual(proposed.decision.measurements[0].missingSignals, ["cost"]);
    assert.equal(proposed.decision.stopOrEscalation.action, WorkContinuationAction.STOP);
  });
});

test("mandatory missing measurement or budget conflict escalates instead of selecting cheaper optional work", async () => {
  await withProject([workItem("MANDATORY"), workItem("OPTIONAL")], async ({ selector }) => {
    const missing = await selector.propose({ measurements: [
      measurement("MANDATORY", {
        mandatoryObligations: ["correctness fence"],
        signals: {
          userImpact: signal(5, WorkSelectionSignalSource.ESTIMATED),
          defectSeverity: signal(5, WorkSelectionSignalSource.OBSERVED),
          dependencyUnblocks: signal(2, WorkSelectionSignalSource.OBSERVED),
          evidenceConfidence: signal(1, WorkSelectionSignalSource.OBSERVED),
          cost: null
        }
      }),
      measurement("OPTIONAL")
    ] });
    assert.equal(missing.decision.selectedItemId, null);
    assert.equal(missing.decision.stopOrEscalation.action, WorkContinuationAction.ESCALATE);
    assert.equal(missing.decision.stopOrEscalation.itemId, "MANDATORY");

    const budget = await selector.propose({ budget: { limit: 2, observedSpent: 0 }, measurements: [
      measurement("MANDATORY", {
        mandatoryObligations: ["correctness fence"],
        signals: {
          userImpact: signal(5, WorkSelectionSignalSource.ESTIMATED),
          defectSeverity: signal(5, WorkSelectionSignalSource.OBSERVED),
          dependencyUnblocks: signal(2, WorkSelectionSignalSource.OBSERVED),
          evidenceConfidence: signal(1, WorkSelectionSignalSource.OBSERVED),
          cost: signal(3, WorkSelectionSignalSource.OBSERVED)
        }
      }),
      measurement("OPTIONAL")
    ] });
    assert.equal(budget.decision.selectedItemId, null);
    assert.equal(budget.decision.reason, WorkSelectionReason.MANDATORY_BUDGET_CONFLICT);
    assert.equal(budget.decision.stopOrEscalation.action, WorkContinuationAction.ESCALATE);
  });
});

test("starvation fence precedes ordinary scoring among non-mandatory eligible work", async () => {
  await withProject([workItem("AGED-P2"), workItem("NEW-HIGH")], async ({ selector }) => {
    const proposed = await selector.propose({ budget: { limit: 1, observedSpent: 0 }, measurements: [
      measurement("AGED-P2", { deferrals: 3 }),
      measurement("NEW-HIGH", {
        userPriority: "P1",
        signals: {
          userImpact: signal(5, WorkSelectionSignalSource.ESTIMATED),
          defectSeverity: signal(3, WorkSelectionSignalSource.OBSERVED),
          dependencyUnblocks: signal(1, WorkSelectionSignalSource.OBSERVED),
          evidenceConfidence: signal(1, WorkSelectionSignalSource.OBSERVED),
          cost: signal(1, WorkSelectionSignalSource.OBSERVED)
        }
      })
    ] });
    assert.equal(proposed.decision.selectedItemId, "AGED-P2");
    assert.equal(proposed.decision.reason, WorkSelectionReason.STARVATION_FENCE);
  });
});

test("continuation policy preserves optional stop versus mandatory escalation", () => {
  assert.equal(decideProjectWorkContinuation(POLICY, { mandatory: false, retryCount: 1, recentOutcomeDeltas: [0, 0], remainingBudget: 5, nextCost: 1, evidenceState: WorkSelectionEvidenceState.FRESH }), WorkContinuationAction.STOP);
  assert.equal(decideProjectWorkContinuation(POLICY, { mandatory: true, retryCount: 1, recentOutcomeDeltas: [0, 0], remainingBudget: 5, nextCost: 1, evidenceState: WorkSelectionEvidenceState.FRESH }), WorkContinuationAction.ESCALATE);
  assert.equal(decideProjectWorkContinuation(POLICY, { mandatory: true, retryCount: 0, recentOutcomeDeltas: [1], remainingBudget: 1, nextCost: 3, evidenceState: WorkSelectionEvidenceState.FRESH }), WorkContinuationAction.ESCALATE);
  assert.equal(decideProjectWorkContinuation(POLICY, { mandatory: false, retryCount: 0, recentOutcomeDeltas: [1], remainingBudget: 5, nextCost: 1, evidenceState: WorkSelectionEvidenceState.STALE }), WorkContinuationAction.STOP);
});

test("freshness validation fails closed after Board changes and ordinary claim still re-checks eligibility", async () => {
  await withProject([workItem("A"), workItem("B")], async ({ orchestrator, selector }) => {
    const proposed = await selector.propose({ measurements: [
      measurement("A", { userPriority: "P1", signals: {
        userImpact: signal(5, WorkSelectionSignalSource.ESTIMATED),
        defectSeverity: signal(3, WorkSelectionSignalSource.OBSERVED),
        dependencyUnblocks: signal(1, WorkSelectionSignalSource.OBSERVED),
        evidenceConfidence: signal(1, WorkSelectionSignalSource.OBSERVED),
        cost: signal(1, WorkSelectionSignalSource.OBSERVED)
      } }),
      measurement("B")
    ] });
    assert.equal(proposed.decision.selectedItemId, "A");
    const firstClaim = await orchestrator.claim({ itemId: "A", owner: "other-session" });
    assert.equal(firstClaim.result.item.status, BlackboardStatus.CLAIMED);
    await assert.rejects(() => selector.assertFresh(proposed.decisionRef), /work selection decision is stale/);
    await assert.rejects(() => orchestrator.claim({ itemId: "A", owner: "selected-session" }), /cannot be claimed from CLAIMED/);
  });
});

test("decision artifacts survive a fresh decision-store instance", async () => {
  await withProject([workItem("A")], async ({ decisionsPath, selector }) => {
    const proposed = await selector.propose({ measurements: [measurement("A")] });
    const freshStore = createJsonWorkSelectionDecisionStore({ path: decisionsPath });
    const resumed = await freshStore.read(proposed.decisionRef);
    assert.equal(resumed.selectedItemId, "A");
    assert.equal(resumed.policy.configurationRef, POLICY.configurationRef);
    assert.equal(resumed.inputSnapshot.eligibleItemIds[0], "A");
  });
});

test("actual selector replays the bounded reference comparison at equal budget without production claims", async () => {
  const directory = await mkdtemp(join(tmpdir(), "exharness-bb031-replay-"));
  try {
    const decisionStore = createJsonWorkSelectionDecisionStore({ path: join(directory, "decisions") });
    const tasks = [
      { item: workItem("DOC-CLEANUP"), measurement: measurement("DOC-CLEANUP", { signals: { userImpact: signal(1, WorkSelectionSignalSource.ESTIMATED), defectSeverity: signal(1, WorkSelectionSignalSource.OBSERVED), dependencyUnblocks: signal(0, WorkSelectionSignalSource.OBSERVED), evidenceConfidence: signal(1, WorkSelectionSignalSource.OBSERVED), cost: signal(1, WorkSelectionSignalSource.OBSERVED) } }), outcome: 1, blockedReduction: 0 },
      { item: workItem("LOW-VALUE-REFACTOR"), measurement: measurement("LOW-VALUE-REFACTOR", { signals: { userImpact: signal(2, WorkSelectionSignalSource.ESTIMATED), defectSeverity: signal(1, WorkSelectionSignalSource.OBSERVED), dependencyUnblocks: signal(0, WorkSelectionSignalSource.OBSERVED), evidenceConfidence: signal(1, WorkSelectionSignalSource.OBSERVED), cost: signal(1, WorkSelectionSignalSource.OBSERVED) } }), outcome: 2, blockedReduction: 0 },
      { item: workItem("CORRECTNESS-FENCE"), measurement: measurement("CORRECTNESS-FENCE", { userPriority: "P1", mandatoryObligations: ["correctness fence"], signals: { userImpact: signal(5, WorkSelectionSignalSource.ESTIMATED), defectSeverity: signal(5, WorkSelectionSignalSource.OBSERVED), dependencyUnblocks: signal(2, WorkSelectionSignalSource.OBSERVED), evidenceConfidence: signal(1, WorkSelectionSignalSource.OBSERVED), cost: signal(3, WorkSelectionSignalSource.OBSERVED) } }), outcome: 8, blockedReduction: 2 },
      { item: workItem("REVIEW-PIPELINE"), measurement: measurement("REVIEW-PIPELINE", { userPriority: "P1", signals: { userImpact: signal(4, WorkSelectionSignalSource.ESTIMATED), defectSeverity: signal(3, WorkSelectionSignalSource.OBSERVED), dependencyUnblocks: signal(1, WorkSelectionSignalSource.OBSERVED), evidenceConfidence: signal(0.8, WorkSelectionSignalSource.ESTIMATED), cost: signal(2, WorkSelectionSignalSource.OBSERVED) } }), outcome: 5, blockedReduction: 1 }
    ];
    const summarize = (ids) => ({
      observedOutcome: tasks.filter((task) => ids.includes(task.item.id)).reduce((sum, task) => sum + task.outcome, 0),
      blockedWorkReduction: tasks.filter((task) => ids.includes(task.item.id)).reduce((sum, task) => sum + task.blockedReduction, 0)
    });
    let baselineBudget = 5;
    const baselineSelected = [];
    for (const task of tasks) {
      const cost = task.measurement.signals.cost.value;
      if (cost > baselineBudget) continue;
      baselineSelected.push(task.item.id);
      baselineBudget -= cost;
    }

    let candidateBudget = 5;
    let pending = [...tasks];
    const candidateSelected = [];
    const surface = { async read() {
      const eligibleWork = pending.map((task) => ({ ...task.item, owner: null, claimGeneration: 0, reviewGeneration: 0, activeReview: null, checkpoint: null, checkpointedBy: null, submission: null, submittedBy: null, origin: { rootIntentId: USER_INTENT.id, rootItemId: "INTENT:bb031-work-selection" } }));
      return { version: 1, projectId: "project-bb031-replay", intent: USER_INTENT, rootItemId: "INTENT:bb031-work-selection", workGraph: eligibleWork, lifecycle: { eligibleWork, claimedWork: [], pendingReview: [], reviewing: [], pendingReconciliation: [], blocked: [], done: [], superseded: [] }, references: { artifacts: [], evidence: [] } };
    } };
    const selector = createBoundedProjectWorkSelector({ handoffSurface: surface, decisionStore, policy: POLICY });
    while (pending.length > 0 && candidateBudget > 0) {
      const proposed = await selector.propose({ budget: { limit: 5, observedSpent: 5 - candidateBudget }, measurements: pending.map((task) => task.measurement) });
      if (proposed.decision.selectedItemId == null) break;
      const selected = pending.find((task) => task.item.id === proposed.decision.selectedItemId);
      candidateSelected.push(selected.item.id);
      candidateBudget -= selected.measurement.signals.cost.value;
      pending = pending.filter((task) => task !== selected);
    }
    assert.deepEqual(baselineSelected, ["DOC-CLEANUP", "LOW-VALUE-REFACTOR", "CORRECTNESS-FENCE"]);
    assert.deepEqual(candidateSelected, ["CORRECTNESS-FENCE", "REVIEW-PIPELINE"]);
    assert.deepEqual(summarize(baselineSelected), { observedOutcome: 11, blockedWorkReduction: 2 });
    assert.deepEqual(summarize(candidateSelected), { observedOutcome: 13, blockedWorkReduction: 3 });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
