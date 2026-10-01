// S6 — BB-081 frozen reducer: PROMOTE_ASYNC | KEEP_SYNC_BASELINE | INCONCLUSIVE.
// Deterministic; Jev validates evidence but cannot rewrite the outcome.
// promote: complete 32-unit cohort + complete required D fault evidence + all gates.
// keepSync: complete/known evidence and any primary gate conclusively fails.
// inconclusive: missing unit, budget stop, unknown primary accounting,
//   verifier/task/profile/dependency drift, incomplete fault evidence or invalid binding.
import { BUDGET, REGISTERED_ARM_UNITS } from './ablation-contract.mjs';
import { dSafetySatisfied, requiredDCells } from './fault-matrix.mjs';
import { median } from './report.mjs';

export const DECISION_CONTRACT_VERSION = 1;
export const OUTCOMES = Object.freeze(['PROMOTE_ASYNC', 'KEEP_SYNC_BASELINE', 'INCONCLUSIVE']);

export const GATES = Object.freeze([
  'accepted-task rate D >= A',
  'D duplicate external effects=0 and all required D safety/recovery assertions pass',
  'median normalized provider cost D/A <=0.85',
  'median prompt-input tokens D/A <=0.90',
  'median model turns D/A <=1.00',
  'median elapsed D/A <=1.10'
]);

export const THRESHOLDS = Object.freeze({
  cost: 0.85,
  input: 0.9,
  turns: 1.0,
  elapsed: 1.1
});

function finiteRatios(values) {
  return values.filter((v) => typeof v === 'number' && Number.isFinite(v));
}

export function decide({
  rows = null,
  paired = null,
  aggregates = null,
  faultCells = null,
  bindingValid = true,
  drift = null,
  budgetStop = false,
  expectedUnits = REGISTERED_ARM_UNITS,
  detachableZeroD = false
} = {}) {
  const reasons = [];
  // INCONCLUSIVE: invalid binding or drift.
  if (bindingValid !== true) {
    reasons.push('invalid dependency/protocol binding');
    return result('INCONCLUSIVE', reasons, {});
  }
  if (drift) {
    reasons.push(`drift: ${drift}`);
    return result('INCONCLUSIVE', reasons, {});
  }
  // INCONCLUSIVE: incomplete cohort.
  if (!rows || rows.length !== expectedUnits) {
    reasons.push(`incomplete cohort: expected ${expectedUnits} registered units, found ${rows?.length ?? 0}`);
    return result('INCONCLUSIVE', reasons, {});
  }
  if (!paired || !Array.isArray(paired.primaryDA) || paired.primaryDA.length !== 8) {
    reasons.push(`incomplete D/A pairs: expected 8 matched task-repeat units, found ${paired?.primaryDA?.length ?? 0}`);
    return result('INCONCLUSIVE', reasons, {});
  }
  // INCONCLUSIVE: budget stop.
  if (budgetStop === true) {
    reasons.push('budget stop hit ($0.60/unit or $25 cohort ceiling)');
    return result('INCONCLUSIVE', reasons, {});
  }
  // INCONCLUSIVE: unknown primary accounting.
  const unknownPairs = paired.primaryDA.filter((p) => p.unknown === true);
  if (unknownPairs.length > 0) {
    reasons.push(`unknown primary accounting in ${unknownPairs.length}/8 D/A pairs; missing values stay UNKNOWN`);
    return result('INCONCLUSIVE', reasons, {});
  }
  // Usage rule: all eight D units zero detachable calls => INCONCLUSIVE.
  if (detachableZeroD === true) {
    reasons.push('all eight D units recorded zero detachable calls; async path never exercised');
    return result('INCONCLUSIVE', reasons, {});
  }
  // INCONCLUSIVE: incomplete required D fault evidence.
  if (!faultCells || !faultCells.length) {
    reasons.push('incomplete required D fault evidence');
    return result('INCONCLUSIVE', reasons, {});
  }
  const dCells = requiredDCells(faultCells);
  if (dCells.length === 0 || dCells.some((c) => c.applicable !== true)) {
    reasons.push('incomplete required D fault evidence');
    return result('INCONCLUSIVE', reasons, {});
  }

  // Gates over complete/known evidence.
  const gateResults = {};
  // QUALITY: D accepted-task rate >= A across all eight D/A units.
  const dAccepted = rows.filter((r) => r.arm === 'D' && r.quality === 'ACCEPTED').length;
  const aAccepted = rows.filter((r) => r.arm === 'A' && r.quality === 'ACCEPTED').length;
  gateResults.quality = dAccepted >= aAccepted;
  if (!gateResults.quality) reasons.push(`quality gate fails: D accepted ${dAccepted} < A accepted ${aAccepted}`);

  // SAFETY: zero duplicates + every D cell passes.
  gateResults.safety = dSafetySatisfied(faultCells);
  if (!gateResults.safety) reasons.push('safety gate fails: D duplicate effects or required D recovery assertions did not pass');

  // EFFICIENCY medians.
  const costR = finiteRatios(paired.primaryDA.map((p) => p.costRatio));
  const inputR = finiteRatios(paired.primaryDA.map((p) => p.inputRatio));
  const turnsR = finiteRatios(paired.primaryDA.map((p) => p.turnsRatio));
  const elapsedR = finiteRatios(paired.primaryDA.map((p) => p.elapsedRatio));
  if (!costR.length || !inputR.length || !turnsR.length || !elapsedR.length) {
    reasons.push('unknown primary accounting: empty paired ratios');
    return result('INCONCLUSIVE', reasons, gateResults);
  }
  const medians = {
    cost: median(costR),
    input: median(inputR),
    turns: median(turnsR),
    elapsed: median(elapsedR)
  };
  gateResults.cost = medians.cost != null && medians.cost <= THRESHOLDS.cost;
  gateResults.input = medians.input != null && medians.input <= THRESHOLDS.input;
  gateResults.turns = medians.turns != null && medians.turns <= THRESHOLDS.turns;
  gateResults.elapsed = medians.elapsed != null && medians.elapsed <= THRESHOLDS.elapsed;
  if (!gateResults.cost) reasons.push(`cost gate fails: median D/A ${medians.cost} > 0.85`);
  if (!gateResults.input) reasons.push(`input gate fails: median D/A ${medians.input} > 0.90`);
  if (!gateResults.turns) reasons.push(`turns gate fails: median D/A ${medians.turns} > 1.00`);
  if (!gateResults.elapsed) reasons.push(`elapsed gate fails: median D/A ${medians.elapsed} > 1.10`);

  const allPass = gateResults.quality && gateResults.safety && gateResults.cost && gateResults.input && gateResults.turns && gateResults.elapsed;
  if (allPass) {
    reasons.push('all primary gates pass over the complete 32-unit cohort with complete D fault evidence');
    return result('PROMOTE_ASYNC', reasons, gateResults, medians, { dAccepted, aAccepted });
  }
  return result('KEEP_SYNC_BASELINE', reasons, gateResults, medians, { dAccepted, aAccepted });
}

function result(decision, reasons, gates, medians = null, counts = null) {
  if (!OUTCOMES.includes(decision)) throw new Error(`unknown decision ${decision}`);
  return Object.freeze({
    decision,
    version: DECISION_CONTRACT_VERSION,
    gates: Object.freeze([...GATES]),
    gateResults: Object.freeze({ ...gates }),
    medians: medians ? Object.freeze({ ...medians }) : null,
    counts: counts ? Object.freeze({ ...counts }) : null,
    reasons: Object.freeze([...reasons]),
    authority: 'frozen deterministic reducer; Jev cannot override'
  });
}

export function decisionContract() {
  return Object.freeze({
    version: DECISION_CONTRACT_VERSION,
    outcomes: Object.freeze([...OUTCOMES]),
    primary: '8 matched D/A task-repeat units',
    gates: Object.freeze([...GATES]),
    promote: 'complete 32-unit live cohort + complete required D fault evidence + all gates pass',
    keepSync: 'complete/known evidence and any primary gate conclusively fails',
    inconclusive: 'missing unit, budget stop, unknown primary accounting, verifier/task/profile/dependency drift, incomplete required fault evidence or invalid binding',
    authority: 'frozen deterministic reducer; Jev cannot override'
  });
}

export { BUDGET };
