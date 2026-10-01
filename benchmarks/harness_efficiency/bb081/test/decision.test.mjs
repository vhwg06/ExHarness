// DECISION acceptance: frozen reducer returns PROMOTE_ASYNC | KEEP_SYNC_BASELINE
// | INCONCLUSIVE; incomplete/unknown/drift yields INCONCLUSIVE, never inferred.
import test from 'node:test';
import assert from 'node:assert/strict';
import { decide, decisionContract } from '../accept.mjs';
import { buildPairedViews, buildRows } from '../report.mjs';
import { runFaultMatrix } from '../fault-matrix.mjs';

function synthRows({ dQuality = 8, aQuality = 6, costD = 0.015, costA = 0.02, inputD = 900, inputA = 1000, turnsD = 3, turnsA = 4, elapsedD = 9000, elapsedA = 10000, unknown = false } = {}) {
  const tasks = ['terminal-bench/git-leak-recovery', 'terminal-bench/pypi-server', 'terminal-bench/kv-store-grpc', 'terminal-bench/sanitize-git-repo'];
  const settled = [];
  let dAccepted = 0;
  let aAccepted = 0;
  for (const task of tasks) {
    const short = task.replace('terminal-bench/', '');
    for (let r = 0; r < 2; r += 1) {
      for (const arm of ['A', 'B', 'C', 'D']) {
        const isD = arm === 'D';
        const isA = arm === 'A';
        let quality = 'ACCEPTED';
        if (isD) quality = dAccepted < dQuality ? 'ACCEPTED' : 'REJECTED';
        if (isA) quality = aAccepted < aQuality ? 'ACCEPTED' : 'REJECTED';
        if (isD && dAccepted < dQuality) dAccepted += 0; // counted below via rows
        const usage = unknown && isD && r === 0
          ? { inputTokens: null, outputTokens: null, cachedTokens: null, cacheWriteTokens: null, providerCostUsd: null, normalizedCostUsd: null, status: 'UNKNOWN', observedFields: [] }
          : { inputTokens: isD ? inputD : isA ? inputA : 950, outputTokens: 250, cachedTokens: null, cacheWriteTokens: null, providerCostUsd: null, normalizedCostUsd: isD ? costD : isA ? costA : 0.018, status: 'PARTIAL', observedFields: ['inputTokens'] };
        settled.push({
          record: {
            unitId: `${short}--${arm}--r${r}`, attemptId: `a-${short}-${arm}-${r}`,
            producer: { kind: arm }, task: { id: task },
            quality: { verdict: quality, evaluatorIdentity: 'e', evidenceRef: 'v' },
            usage, timing: { elapsedMs: isD ? elapsedD : isA ? elapsedA : 9500 },
            termination: 'COMPLETED', providerStatus: 'NONE', infrastructureStatus: 'NONE', failureFingerprint: null
          },
          observation: { arm, repeatIndex: r, modelTurns: isD ? turnsD : isA ? turnsA : 4, toolCalls: 4, usefulOperationCount: 3, modelActiveMs: 3000, capabilityActiveMs: 4000, elapsedMs: isD ? elapsedD : isA ? elapsedA : 9500, recoveryOutcome: 'NOT_APPLICABLE', detachableCalls: arm === 'A' ? 0 : 2 }
        });
      }
    }
  }
  // Fix accepted counts deterministically: first N D/A units accepted.
  const rows = buildRows({ settled });
  // Override qualities to exact counts: D first dQuality accepted, A first aQuality accepted.
  let dSeen = 0;
  let aSeen = 0;
  const adjusted = rows.map((row) => {
    if (row.arm === 'D') {
      dSeen += 1;
      return Object.freeze({ ...row, quality: dSeen <= dQuality ? 'ACCEPTED' : 'REJECTED' });
    }
    if (row.arm === 'A') {
      aSeen += 1;
      return Object.freeze({ ...row, quality: aSeen <= aQuality ? 'ACCEPTED' : 'REJECTED' });
    }
    return row;
  });
  return Object.freeze(adjusted);
}

function decideFor(rows, { faultCells = runFaultMatrix(), ...opts } = {}) {
  const paired = buildPairedViews({ rows });
  return decide({ rows, paired, faultCells, ...opts });
}

test('decision contract freezes three outcomes with six gates', () => {
  const contract = decisionContract();
  assert.deepEqual([...contract.outcomes], ['PROMOTE_ASYNC', 'KEEP_SYNC_BASELINE', 'INCONCLUSIVE']);
  assert.equal(contract.gates.length, 6);
  assert.equal(contract.authority, 'frozen deterministic reducer; Jev cannot override');
});

test('PROMOTE_ASYNC requires all gates over complete known evidence', () => {
  const rows = synthRows({ dQuality: 8, aQuality: 6, costD: 0.015, costA: 0.02 });
  const out = decideFor(rows);
  assert.equal(out.decision, 'PROMOTE_ASYNC');
  assert.equal(out.gateResults.quality, true);
  assert.equal(out.gateResults.safety, true);
  assert.ok(out.medians.cost <= 0.85);
});

test('quality regression yields KEEP_SYNC_BASELINE, never promotion', () => {
  const rows = synthRows({ dQuality: 5, aQuality: 7 });
  const out = decideFor(rows);
  assert.equal(out.decision, 'KEEP_SYNC_BASELINE');
  assert.equal(out.gateResults.quality, false);
});

test('every efficiency gate failure yields KEEP_SYNC_BASELINE', () => {
  const cases = [
    [{ costD: 0.02, costA: 0.02 }, 'cost'],
    [{ inputD: 1000, inputA: 1000 }, 'input'],
    [{ turnsD: 5, turnsA: 4 }, 'turns'],
    [{ elapsedD: 12000, elapsedA: 10000 }, 'elapsed']
  ];
  for (const [override, gate] of cases) {
    const rows = synthRows({ dQuality: 8, aQuality: 6, ...override });
    const out = decideFor(rows);
    assert.equal(out.decision, 'KEEP_SYNC_BASELINE', gate);
    assert.equal(out.gateResults[gate], false);
  }
});

test('safety violations yield KEEP_SYNC_BASELINE', () => {
  const rows = synthRows({});
  const badFaults = runFaultMatrix({ mutateCell: ({ scenario, arm }) => (scenario === 'DUPLICATE_WAKE' && arm === 'D' ? { duplicateEffects: 1 } : null) });
  const out = decideFor(rows, { faultCells: badFaults });
  assert.equal(out.decision, 'KEEP_SYNC_BASELINE');
  assert.equal(out.gateResults.safety, false);
});

test('missing/unknown/drift/budget/incomplete evidence yields INCONCLUSIVE', () => {
  const full = synthRows({});
  // Missing unit.
  assert.equal(decideFor(full.slice(1)).decision, 'INCONCLUSIVE');
  // Unknown primary accounting.
  const unknown = synthRows({ unknown: true });
  assert.equal(decideFor(unknown).decision, 'INCONCLUSIVE');
  // Budget stop.
  assert.equal(decideFor(full, { budgetStop: true }).decision, 'INCONCLUSIVE');
  // Drift.
  assert.equal(decideFor(full, { drift: 'task digest changed' }).decision, 'INCONCLUSIVE');
  // Invalid binding.
  assert.equal(decideFor(full, { bindingValid: false }).decision, 'INCONCLUSIVE');
  // Incomplete fault evidence.
  assert.equal(decideFor(full, { faultCells: [] }).decision, 'INCONCLUSIVE');
  // Zero detachable D calls.
  const zeroDetach = full.map((r) => (r.arm === 'D' ? Object.freeze({ ...r, detachableCalls: 0 }) : r));
  assert.equal(decideFor(zeroDetach, { detachableZeroD: true }).decision, 'INCONCLUSIVE');
  // Incomplete pairs.
  const short = full.filter((r) => !(r.arm === 'D' && r.repeatIndex === 1));
  assert.equal(decide({ rows: full, paired: buildPairedViews({ rows: short }), faultCells: runFaultMatrix() }).decision, 'INCONCLUSIVE');
});
