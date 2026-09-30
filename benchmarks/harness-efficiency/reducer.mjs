// S4/S5 — Comparison reducer. Reads settled shared benchmark attempt records
// plus per-attempt economics observations and reduces them into paired
// distributions and medians. Rules: every registered attempt (including retries
// and non-accepted outcomes) stays in denominators; missing cost/token/cache
// stays null/UNKNOWN (never zero-filled); quality comes only from the
// kernel-normalized record, never from producer/provider termination; no
// best-of-k filtering and no opaque winner score.
import { ARMS, DEVELOPMENT_TASKS, REPEATS } from './constants.mjs';

export function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function distribution(values) {
  return Object.freeze({
    count: values.length,
    values: Object.freeze([...values].sort((a, b) => a - b)),
    median: median(values),
    min: values.length ? Math.min(...values) : null,
    max: values.length ? Math.max(...values) : null
  });
}

function nullableDistribution(values) {
  const known = values.filter((value) => typeof value === 'number');
  return Object.freeze({
    count: values.length,
    known: known.length,
    unknown: values.length - known.length,
    values: Object.freeze([...known].sort((a, b) => a - b)),
    median: median(known)
  });
}

// attemptView: { record, economics } where record is the settled kernel record
// and economics is the BB077_ECONOMICS_OBSERVATION_V1 for the same attempt.
export function reduceComparison({ attempts }) {
  if (!Array.isArray(attempts) || attempts.length === 0) {
    throw new Error('PRECONDITION: reduceComparison needs settled attempts');
  }
  const perTask = {};
  for (const task of DEVELOPMENT_TASKS) {
    const arms = {};
    for (const arm of ARMS) {
      const rows = attempts.filter(({ record }) => record.unitId.startsWith(`${task.id}--${arm}--`));
      if (!rows.length) {
        throw new Error(`PRECONDITION: no attempts for ${task.id}/${arm}; denominators must be complete`);
      }
      arms[arm] = summarizeArm(rows);
    }
    perTask[task.id] = Object.freeze({
      pairId: task.id,
      repeats: REPEATS,
      arms: Object.freeze(arms),
      paired: Object.freeze({
        modelTurnsDelta: distribution(rows_deltas(attempts, task.id, 'modelTurns')),
        toolCallsDelta: distribution(rows_deltas(attempts, task.id, 'toolCalls')),
        elapsedMsDelta: distribution(rows_deltas(attempts, task.id, 'elapsedMs'))
      })
    });
  }
  return Object.freeze({
    kind: 'BB077_COMPARISON_V1',
    perTask: Object.freeze(perTask),
    overall: summarizeOverall(attempts)
  });
}

// Guards the complete-denominator rule at the call site: the reducer input must
// cover exactly the settled ledger attempts (no accepted-only filtering, no
// best-of-k, no dropped retries). Throws when the input is a filtered subset.
export function assertDenominators({ ledger, attempts }) {
  const settled = ledger.attempts().filter((attempt) => attempt.status === 'SETTLED');
  const digests = new Set(attempts.map(({ record }) => record.recordDigest));
  if (attempts.length !== settled.length || settled.some((attempt) => !digests.has(attempt.record.recordDigest))) {
    throw new Error('PRECONDITION: reducer input must include every settled ledger attempt');
  }
  return true;
}

function rows_deltas(attempts, taskId, field) {
  const deltas = [];
  for (let repeat = 0; repeat < REPEATS; repeat += 1) {
    const direct = attempts.filter(({ record }) => record.unitId === `${taskId}--DIRECT_CODEACT--r${repeat}`);
    const core = attempts.filter(({ record }) => record.unitId === `${taskId}--CORE_SYNC--r${repeat}`);
    const directValues = direct.map(({ economics }) => economics[field]);
    const coreValues = core.map(({ economics }) => economics[field]);
    // Paired repeat delta uses medians within the repeat (retries included).
    deltas.push(median(coreValues) - median(directValues));
  }
  return deltas;
}

function summarizeArm(rows) {
  const qualities = rows.map(({ record }) => record.quality.verdict);
  const economics = rows.map(({ economics }) => economics);
  const usage = rows.map(({ record }) => record.usage);
  const knownCost = usage.map((entry) => entry.providerCostUsd);
  const knownInput = usage.map((entry) => entry.inputTokens);
  const knownOutput = usage.map((entry) => entry.outputTokens);
  return Object.freeze({
    attempts: rows.length,
    accepted: qualities.filter((verdict) => verdict === 'ACCEPTED').length,
    rejected: qualities.filter((verdict) => verdict === 'REJECTED').length,
    notEvaluated: qualities.filter((verdict) => verdict === 'NOT_EVALUATED').length,
    modelTurns: distribution(economics.map((entry) => entry.modelTurns)),
    toolCalls: distribution(economics.map(({ toolCalls }) => toolCalls)),
    elapsedMs: distribution(economics.map((entry) => entry.elapsedMs)),
    modelActiveMs: distribution(economics.map((entry) => entry.modelActiveMs)),
    capabilityActiveMs: distribution(economics.map((entry) => entry.capabilityActiveMs)),
    unattributedHarnessMs: distribution(economics.map((entry) => entry.unattributedHarnessMs)),
    providerCostUsd: nullableDistribution(knownCost),
    inputTokens: nullableDistribution(knownInput),
    outputTokens: nullableDistribution(knownOutput),
    cacheLabels: Object.freeze(countBy(economics.map((entry) => entry.cacheLabel))),
    noProgress: economics.filter((entry) => entry.noProgress).length,
    failureFingerprints: Object.freeze(countBy(rows.map(({ record }) => record.failureFingerprint ?? 'NONE')))
  });
}

function summarizeOverall(attempts) {
  const byArm = {};
  for (const arm of ARMS) {
    const rows = attempts.filter(({ record }) => record.unitId.includes(`--${arm}--`));
    byArm[arm] = summarizeArm(rows);
  }
  return Object.freeze({
    attempts: attempts.length,
    byArm: Object.freeze(byArm)
  });
}

function countBy(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}
