import assert from "node:assert/strict";

const policy = Object.freeze({
  name: "bounded-project-selection",
  revision: "1",
  selectionBudget: 5,
  maxDeferrals: 3,
  retryCeiling: 2,
  plateauWindow: 2,
  weights: Object.freeze({
    userImpact: 5,
    defectSeverity: 4,
    dependencyUnblocks: 6,
    evidenceConfidence: 2,
    userPriority: Object.freeze({ P1: 5, P2: 2, P3: 0 }),
    observedCost: -1,
    age: 1
  })
});

function signal(value, source) {
  assert.ok(["OBSERVED", "ESTIMATED"].includes(source));
  assert.ok(Number.isFinite(value));
  return Object.freeze({ value, source });
}

function task({
  id,
  boardOrder,
  userPriority,
  mandatory = false,
  userImpact,
  defectSeverity,
  dependencyUnblocks,
  evidenceConfidence,
  observedCost,
  deferrals = 0,
  realizedOutcome,
  realizedBlockedReduction
}) {
  return Object.freeze({
    id,
    boardOrder,
    userPriority,
    mandatory,
    signals: Object.freeze({
      userImpact,
      defectSeverity,
      dependencyUnblocks,
      evidenceConfidence,
      observedCost
    }),
    deferrals,
    realizedOutcome,
    realizedBlockedReduction
  });
}

function completeSignals(item) {
  const missing = Object.entries(item.signals)
    .filter(([, value]) => value == null)
    .map(([name]) => name);
  return Object.freeze({ complete: missing.length === 0, missing });
}

function score(item) {
  const completeness = completeSignals(item);
  if (!completeness.complete) return null;
  const w = policy.weights;
  return (
    item.signals.userImpact.value * w.userImpact +
    item.signals.defectSeverity.value * w.defectSeverity +
    item.signals.dependencyUnblocks.value * w.dependencyUnblocks +
    item.signals.evidenceConfidence.value * w.evidenceConfidence +
    w.userPriority[item.userPriority] +
    item.signals.observedCost.value * w.observedCost +
    Math.min(item.deferrals, policy.maxDeferrals) * w.age
  );
}

function chooseBounded(eligible, remainingBudget) {
  const affordable = eligible.filter((item) => item.signals.observedCost?.value <= remainingBudget);
  const mandatory = affordable.filter((item) => item.mandatory);
  if (mandatory.length > 0) {
    mandatory.sort((a, b) => b.signals.defectSeverity.value - a.signals.defectSeverity.value || a.boardOrder - b.boardOrder);
    return Object.freeze({ item: mandatory[0], reason: "MANDATORY_CORRECTNESS" });
  }

  const starved = affordable
    .filter((item) => item.deferrals >= policy.maxDeferrals && completeSignals(item).complete)
    .sort((a, b) => b.deferrals - a.deferrals || a.boardOrder - b.boardOrder);
  if (starved.length > 0) return Object.freeze({ item: starved[0], reason: "STARVATION_FENCE" });

  const ranked = affordable
    .map((item) => ({ item, score: score(item) }))
    .filter((entry) => entry.score != null)
    .sort((a, b) => b.score - a.score || a.item.boardOrder - b.item.boardOrder);
  if (ranked.length === 0) {
    return Object.freeze({ item: null, reason: "MISSING_MEASUREMENT" });
  }
  return Object.freeze({ item: ranked[0].item, reason: "BOUNDED_SCORE", score: ranked[0].score });
}

function runSelection(mode, tasks, budget = policy.selectionBudget) {
  const pending = [...tasks];
  const selected = [];
  let remainingBudget = budget;
  while (pending.length > 0) {
    let choice;
    if (mode === "FIFO") {
      const affordable = pending.filter((item) => item.signals.observedCost?.value <= remainingBudget);
      if (affordable.length === 0) break;
      choice = { item: affordable.sort((a, b) => a.boardOrder - b.boardOrder)[0], reason: "BOARD_ORDER" };
    } else {
      choice = chooseBounded(pending, remainingBudget);
      if (choice.item == null) break;
    }
    selected.push({ id: choice.item.id, reason: choice.reason, score: choice.score ?? null });
    remainingBudget -= choice.item.signals.observedCost.value;
    pending.splice(pending.findIndex((item) => item.id === choice.item.id), 1);
  }
  const ids = new Set(selected.map((entry) => entry.id));
  return Object.freeze({
    selected,
    spent: budget - remainingBudget,
    remainingBudget,
    observedOutcome: tasks.filter((item) => ids.has(item.id)).reduce((sum, item) => sum + item.realizedOutcome, 0),
    blockedWorkReduction: tasks.filter((item) => ids.has(item.id)).reduce((sum, item) => sum + item.realizedBlockedReduction, 0)
  });
}

function stoppingDecision({ mandatory, retryCount, recentOutcomeDeltas, remainingBudget, nextCost, evidenceState }) {
  if (["STALE", "CONTRADICTORY"].includes(evidenceState)) {
    return mandatory ? "ESCALATE" : "STOP";
  }
  if (mandatory && nextCost > remainingBudget) return "ESCALATE";
  if (retryCount >= policy.retryCeiling) return mandatory ? "ESCALATE" : "STOP";
  const recent = recentOutcomeDeltas.slice(-policy.plateauWindow);
  if (recent.length === policy.plateauWindow && recent.every((delta) => delta <= 0)) {
    return mandatory ? "ESCALATE" : "STOP";
  }
  return "CONTINUE";
}

const workload = [
  task({
    id: "DOC-CLEANUP",
    boardOrder: 0,
    userPriority: "P2",
    userImpact: signal(1, "ESTIMATED"),
    defectSeverity: signal(1, "OBSERVED"),
    dependencyUnblocks: signal(0, "OBSERVED"),
    evidenceConfidence: signal(1, "OBSERVED"),
    observedCost: signal(1, "OBSERVED"),
    realizedOutcome: 1,
    realizedBlockedReduction: 0
  }),
  task({
    id: "LOW-VALUE-REFACTOR",
    boardOrder: 1,
    userPriority: "P2",
    userImpact: signal(2, "ESTIMATED"),
    defectSeverity: signal(1, "OBSERVED"),
    dependencyUnblocks: signal(0, "OBSERVED"),
    evidenceConfidence: signal(1, "OBSERVED"),
    observedCost: signal(1, "OBSERVED"),
    realizedOutcome: 2,
    realizedBlockedReduction: 0
  }),
  task({
    id: "CORRECTNESS-FENCE",
    boardOrder: 2,
    userPriority: "P1",
    mandatory: true,
    userImpact: signal(5, "ESTIMATED"),
    defectSeverity: signal(5, "OBSERVED"),
    dependencyUnblocks: signal(2, "OBSERVED"),
    evidenceConfidence: signal(1, "OBSERVED"),
    observedCost: signal(3, "OBSERVED"),
    realizedOutcome: 8,
    realizedBlockedReduction: 2
  }),
  task({
    id: "REVIEW-PIPELINE",
    boardOrder: 3,
    userPriority: "P1",
    userImpact: signal(4, "ESTIMATED"),
    defectSeverity: signal(3, "OBSERVED"),
    dependencyUnblocks: signal(1, "OBSERVED"),
    evidenceConfidence: signal(0.8, "ESTIMATED"),
    observedCost: signal(2, "OBSERVED"),
    realizedOutcome: 5,
    realizedBlockedReduction: 1
  })
];

const fifo = runSelection("FIFO", workload);
const bounded = runSelection("BOUNDED", workload);

assert.deepEqual(fifo.selected.map((entry) => entry.id), ["DOC-CLEANUP", "LOW-VALUE-REFACTOR", "CORRECTNESS-FENCE"]);
assert.deepEqual(bounded.selected.map((entry) => entry.id), ["CORRECTNESS-FENCE", "REVIEW-PIPELINE"]);
assert.ok(bounded.observedOutcome > fifo.observedOutcome);
assert.ok(bounded.blockedWorkReduction > fifo.blockedWorkReduction);

const starvationFixture = [
  task({
    id: "AGED-P2",
    boardOrder: 4,
    userPriority: "P2",
    userImpact: signal(2, "ESTIMATED"),
    defectSeverity: signal(1, "OBSERVED"),
    dependencyUnblocks: signal(0, "OBSERVED"),
    evidenceConfidence: signal(0.9, "ESTIMATED"),
    observedCost: signal(1, "OBSERVED"),
    deferrals: 3,
    realizedOutcome: 2,
    realizedBlockedReduction: 0
  }),
  task({
    id: "NEW-HIGH-SCORE",
    boardOrder: 5,
    userPriority: "P1",
    userImpact: signal(5, "ESTIMATED"),
    defectSeverity: signal(3, "OBSERVED"),
    dependencyUnblocks: signal(1, "OBSERVED"),
    evidenceConfidence: signal(1, "OBSERVED"),
    observedCost: signal(1, "OBSERVED"),
    deferrals: 0,
    realizedOutcome: 6,
    realizedBlockedReduction: 1
  })
];
const starvationChoice = chooseBounded(starvationFixture, 1);
assert.equal(starvationChoice.item.id, "AGED-P2");
assert.equal(starvationChoice.reason, "STARVATION_FENCE");

const missingFixture = [
  task({
    id: "UNKNOWN-COST",
    boardOrder: 6,
    userPriority: "P1",
    userImpact: signal(5, "ESTIMATED"),
    defectSeverity: signal(2, "OBSERVED"),
    dependencyUnblocks: signal(0, "OBSERVED"),
    evidenceConfidence: signal(0.7, "ESTIMATED"),
    observedCost: null,
    realizedOutcome: 0,
    realizedBlockedReduction: 0
  })
];
assert.equal(chooseBounded(missingFixture, 5).reason, "MISSING_MEASUREMENT");

const stopping = Object.freeze({
  optionalPlateau: stoppingDecision({
    mandatory: false,
    retryCount: 1,
    recentOutcomeDeltas: [0, 0],
    remainingBudget: 5,
    nextCost: 1,
    evidenceState: "FRESH"
  }),
  mandatoryPlateau: stoppingDecision({
    mandatory: true,
    retryCount: 1,
    recentOutcomeDeltas: [0, 0],
    remainingBudget: 5,
    nextCost: 1,
    evidenceState: "FRESH"
  }),
  mandatoryBudgetExhausted: stoppingDecision({
    mandatory: true,
    retryCount: 0,
    recentOutcomeDeltas: [1],
    remainingBudget: 1,
    nextCost: 3,
    evidenceState: "FRESH"
  }),
  optionalStaleEvidence: stoppingDecision({
    mandatory: false,
    retryCount: 0,
    recentOutcomeDeltas: [1],
    remainingBudget: 5,
    nextCost: 1,
    evidenceState: "STALE"
  })
});
assert.deepEqual(stopping, {
  optionalPlateau: "STOP",
  mandatoryPlateau: "ESCALATE",
  mandatoryBudgetExhausted: "ESCALATE",
  optionalStaleEvidence: "STOP"
});

const report = Object.freeze({
  evidenceClass: "DETERMINISTIC_REFERENCE",
  productionEvidence: false,
  policy: {
    name: policy.name,
    revision: policy.revision,
    selectionBudget: policy.selectionBudget,
    maxDeferrals: policy.maxDeferrals,
    retryCeiling: policy.retryCeiling,
    plateauWindow: policy.plateauWindow
  },
  baseline: fifo,
  candidate: bounded,
  deltas: {
    observedOutcome: bounded.observedOutcome - fifo.observedOutcome,
    blockedWorkReduction: bounded.blockedWorkReduction - fifo.blockedWorkReduction,
    spent: bounded.spent - fifo.spent
  },
  starvation: {
    selected: starvationChoice.item.id,
    reason: starvationChoice.reason
  },
  missingMeasurement: {
    action: chooseBounded(missingFixture, 5).reason,
    inventedValue: false
  },
  stopping,
  limits: [
    "fixture values do not establish production prioritization benefit",
    "ranking estimates are not correctness evidence",
    "mandatory correctness and user constraints remain hard gates",
    "selection does not mutate Blackboard lifecycle or Core promotion authority"
  ]
});

console.log(JSON.stringify(report, null, 2));