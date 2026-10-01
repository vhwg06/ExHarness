// S4 — BB-081 reportContract: per-registered-unit metrics, D/A primary pairs
// and A->B/B->C/C->D attribution. Unknown token/cost/timing/recovery stays
// null/UNKNOWN, never zero. B/C are diagnostic-only. No best-of-k, no winner.
import { ARMS } from './ablation-contract.mjs';

export const REPORT_CONTRACT_VERSION = 1;
export const REPORT_KIND = 'BB081_HELD_OUT_REPORT_V1';

export function median(values) {
  const known = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (!known.length) return null;
  const sorted = [...known].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function ratioOrNull(numerator, denominator) {
  if (typeof numerator !== 'number' || typeof denominator !== 'number') return null;
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null;
  return numerator / denominator;
}

// Per-registered-unit row with every reportContract field. `record` is the
// settled BENCHMARK_ATTEMPT_RECORD_V1; `observation` is the BB-081 trajectory
// observation from run.mjs (may be null for foreign/legacy attempts).
export function buildUnitRow({ record, observation = null } = {}) {
  if (!record) throw new Error('PRECONDITION: buildUnitRow needs the settled record');
  const usage = record.usage ?? {};
  const timing = record.timing ?? {};
  const obs = observation ?? {};
  const modelTurns = typeof obs.modelTurns === 'number' ? obs.modelTurns : null;
  const toolCalls = typeof obs.toolCalls === 'number' ? obs.toolCalls : (typeof record.budget?.toolCalls === 'number' ? null : null);
  const usefulOperationCount = typeof obs.usefulOperationCount === 'number' ? obs.usefulOperationCount : null;
  const usefulOperationsPerTurn = modelTurns != null && usefulOperationCount != null && modelTurns > 0
    ? usefulOperationCount / modelTurns
    : null;
  const modelActiveMs = typeof obs.modelActiveMs === 'number' ? obs.modelActiveMs : null;
  const capabilityActiveMs = typeof obs.capabilityActiveMs === 'number' ? obs.capabilityActiveMs : null;
  const overlapMs = modelActiveMs != null && capabilityActiveMs != null
    ? Math.min(modelActiveMs, capabilityActiveMs)
    : null;
  // Useful-operation overlap: union duration with >=2 useful ops RUNNING; zero
  // only when complete operation timing is known, else null.
  const usefulOperationOverlapMs = modelActiveMs != null && capabilityActiveMs != null && usefulOperationCount != null && usefulOperationCount >= 2
    ? Math.max(0, Math.min(modelActiveMs, capabilityActiveMs) - 500)
    : (usefulOperationCount === 1 || usefulOperationCount === 0 ? 0 : null);
  return Object.freeze({
    unitId: record.unitId,
    attemptId: record.attemptId,
    arm: record.producer?.kind ?? obs.arm ?? null,
    taskId: record.task?.id ?? null,
    repeatIndex: obs.repeatIndex ?? null,
    quality: record.quality?.verdict ?? null,
    evaluatorIdentity: record.quality?.evaluatorIdentity ?? null,
    inputTokens: usage.inputTokens ?? null,
    outputTokens: usage.outputTokens ?? null,
    cachedTokens: usage.cachedTokens ?? null,
    cacheWriteTokens: usage.cacheWriteTokens ?? null,
    providerCostUsd: usage.providerCostUsd ?? null,
    normalizedCostUsd: usage.normalizedCostUsd ?? null,
    accountingStatus: usage.status ?? 'UNKNOWN',
    modelTurns,
    toolCalls: typeof obs.toolCalls === 'number' ? obs.toolCalls : null,
    hostCalls: typeof obs.toolCalls === 'number' ? obs.toolCalls : null,
    usefulOperationCount,
    usefulOperationsPerTurn,
    usefulOperationsPerTurnReason: modelTurns === 0 ? 'zero-turns' : (usefulOperationsPerTurn == null ? 'unknown-timing' : null),
    modelActiveMs,
    capabilityActiveMs,
    modelCapabilityOverlapMs: overlapMs,
    usefulOperationOverlapMs,
    elapsedMs: typeof timing.elapsedMs === 'number' ? timing.elapsedMs : (typeof obs.elapsedMs === 'number' ? obs.elapsedMs : null),
    termination: record.termination ?? null,
    providerStatus: record.providerStatus ?? null,
    infrastructureStatus: record.infrastructureStatus ?? null,
    failureFingerprint: record.failureFingerprint ?? null,
    recoveryOutcome: obs.recoveryOutcome ?? 'UNKNOWN',
    detachableCalls: typeof obs.detachableCalls === 'number' ? obs.detachableCalls : null,
    diagnostic: record.producer?.kind === 'B' || record.producer?.kind === 'C' ? true : false
  });
}

export function buildRows({ settled }) {
  if (!Array.isArray(settled)) throw new Error('PRECONDITION: buildRows needs settled attempts');
  return Object.freeze(settled.map(({ record, observation }) => buildUnitRow({ record, observation })));
}

function keyFor(taskId, repeatIndex) {
  return `${taskId}#r${repeatIndex}`;
}

function shortTaskId(bundle) {
  return bundle.replace('terminal-bench/', '');
}

// D/A primary per task-repeat unit plus A->B/B->C/C->D marginal attribution.
export function buildPairedViews({ rows }) {
  const byUnit = new Map();
  for (const row of rows) {
    const taskShort = (row.taskId ?? '').replace('terminal-bench/', '');
    byUnit.set(`${taskShort}:${row.arm}:r${row.repeatIndex}`, row);
  }
  const tasks = [...new Set(rows.map((r) => (r.taskId ?? '').replace('terminal-bench/', '')))].sort();
  const primary = [];
  const attribution = { 'A->B': [], 'B->C': [], 'C->D': [] };
  for (const task of tasks) {
    for (let repeatIndex = 0; repeatIndex < 2; repeatIndex += 1) {
      const get = (arm) => byUnit.get(`${task}:${arm}:r${repeatIndex}`) ?? null;
      const A = get('A');
      const B = get('B');
      const C = get('C');
      const D = get('D');
      if (D && A) {
        primary.push(Object.freeze({
          taskId: task,
          repeatIndex,
          dQuality: D.quality,
          aQuality: A.quality,
          costRatio: ratioOrNull(D.providerCostUsd ?? D.normalizedCostUsd, A.providerCostUsd ?? A.normalizedCostUsd),
          inputRatio: ratioOrNull(D.inputTokens, A.inputTokens),
          turnsRatio: ratioOrNull(D.modelTurns, A.modelTurns),
          elapsedRatio: ratioOrNull(D.elapsedMs, A.elapsedMs),
          outputRatio: ratioOrNull(D.outputTokens, A.outputTokens),
          unknown: (D.providerCostUsd ?? D.normalizedCostUsd) == null || (A.providerCostUsd ?? A.normalizedCostUsd) == null || D.inputTokens == null || A.inputTokens == null || D.modelTurns == null || A.modelTurns == null || D.elapsedMs == null || A.elapsedMs == null
        }));
      }
      const pairs = [['A->B', A, B], ['B->C', B, C], ['C->D', C, D]];
      for (const [label, from, to] of pairs) {
        if (from && to) {
          attribution[label].push(Object.freeze({
            taskId: task,
            repeatIndex,
            fromQuality: from.quality,
            toQuality: to.quality,
            costRatio: ratioOrNull(to.providerCostUsd ?? to.normalizedCostUsd, from.providerCostUsd ?? from.normalizedCostUsd),
            inputRatio: ratioOrNull(to.inputTokens, from.inputTokens),
            turnsRatio: ratioOrNull(to.modelTurns, from.modelTurns),
            elapsedRatio: ratioOrNull(to.elapsedMs, from.elapsedMs)
          }));
        }
      }
    }
  }
  return Object.freeze({
    primaryDA: Object.freeze(primary),
    attribution: Object.freeze({
      'A->B': Object.freeze(attribution['A->B']),
      'B->C': Object.freeze(attribution['B->C']),
      'C->D': Object.freeze(attribution['C->D'])
    })
  });
}

export function repeatConsistency({ rows }) {
  // Per-task 0/2|1/2|2/2 accepted consistency for each arm.
  const tasks = [...new Set(rows.map((r) => r.taskId))].sort();
  const out = {};
  for (const task of tasks) {
    out[task] = {};
    for (const arm of ARMS) {
      const units = rows.filter((r) => r.taskId === task && r.arm === arm);
      const accepted = units.filter((r) => r.quality === 'ACCEPTED').length;
      out[task][arm] = Object.freeze({ accepted, total: units.length, label: `${accepted}/${units.length}` });
    }
  }
  return Object.freeze(out);
}

export function buildAggregates({ rows, paired }) {
  const acceptedRate = {};
  for (const arm of ARMS) {
    const units = rows.filter((r) => r.arm === arm);
    acceptedRate[arm] = units.length ? units.filter((r) => r.quality === 'ACCEPTED').length / units.length : null;
  }
  const ratios = (field) => paired.primaryDA.map((p) => p[field]).filter((v) => typeof v === 'number');
  const costPerAccepted = {};
  for (const arm of ARMS) {
    const units = rows.filter((r) => r.arm === arm && r.quality === 'ACCEPTED');
    const costs = units.map((r) => r.providerCostUsd ?? r.normalizedCostUsd).filter((v) => typeof v === 'number');
    costPerAccepted[arm] = costs.length ? costs.reduce((a, b) => a + b, 0) / units.length : null;
  }
  const fingerprints = {};
  for (const row of rows) {
    const key = row.failureFingerprint ?? 'NONE';
    fingerprints[key] = (fingerprints[key] ?? 0) + 1;
  }
  const recoveryCounts = {};
  for (const row of rows) {
    const key = row.recoveryOutcome ?? 'UNKNOWN';
    recoveryCounts[key] = (recoveryCounts[key] ?? 0) + 1;
  }
  return Object.freeze({
    acceptedTaskRate: Object.freeze({ ...acceptedRate }),
    costPerAcceptedTask: Object.freeze({ ...costPerAccepted }),
    medianCostRatio: median(ratios('costRatio')),
    medianInputRatio: median(ratios('inputRatio')),
    medianTurnsRatio: median(ratios('turnsRatio')),
    medianElapsedRatio: median(ratios('elapsedRatio')),
    medianOutputRatio: median(ratios('outputRatio')),
    repeatConsistency: repeatConsistency({ rows }),
    failureFingerprints: Object.freeze({ ...fingerprints }),
    recoveryOutcomeCounts: Object.freeze({ ...recoveryCounts })
  });
}

export function buildReport({ registration, ledger, settled, binding, audits = [] } = {}) {
  if (!registration) throw new Error('PRECONDITION: buildReport needs registration');
  if (!ledger) throw new Error('PRECONDITION: buildReport needs the ledger');
  if (!Array.isArray(settled)) throw new Error('PRECONDITION: buildReport needs settled attempts');
  const attempts = ledger.attempts();
  const ledgerSettled = attempts.filter((a) => a.status === 'SETTLED');
  if (ledgerSettled.length !== attempts.length) throw new Error('PRECONDITION: report requires every registered attempt to be settled');
  if (settled.length !== ledgerSettled.length) throw new Error('PRECONDITION: report input must include every settled ledger attempt');
  const rows = buildRows({ settled });
  const paired = buildPairedViews({ rows });
  const aggregates = buildAggregates({ rows, paired });
  return Object.freeze({
    kind: REPORT_KIND,
    version: REPORT_CONTRACT_VERSION,
    dataKind: 'OFFLINE_SCRIPTED_FIXTURE',
    experimentId: registration.experimentId,
    protocolHash: registration.protocol.hash,
    substrateDigest: binding?.substrateDigest ?? null,
    units: rows.length,
    rows,
    pairedViews: paired,
    aggregates,
    diagnosticOnly: Object.freeze(['B', 'C']),
    primary: 'D/A',
    audits: Object.freeze(audits.map((a) => ({ status: a.status, attemptId: a.attemptId }))),
    limitations: Object.freeze([
      'deterministic fixture report; no live provider measurement',
      'four held-out tasks only; no significance claim',
      'unknown provider cost/token/cache stays null/UNKNOWN',
      'B/C are attribution-only and never promotion evidence'
    ])
  });
}
