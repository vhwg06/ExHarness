// ATTRIBUTION acceptance: every registered unit reports the full metric
// vector; D/A primary; A->B/B->C/C->D diagnostic; UNKNOWN stays null.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAggregates, buildPairedViews, buildReport, buildRows, buildUnitRow, median } from '../report.mjs';

function fakeRecord({ unitId, attemptId, arm, taskId, quality = 'ACCEPTED', usage = null, elapsedMs = 10000, fingerprint = null }) {
  return {
    unitId, attemptId,
    producer: { kind: arm },
    task: { id: taskId },
    quality: { verdict: quality, evaluatorIdentity: 'harbor-task-verifier@0.23.0', evidenceRef: 'verifier/reward.txt' },
    usage: usage ?? { inputTokens: 1200, outputTokens: 250, cachedTokens: null, cacheWriteTokens: null, providerCostUsd: null, normalizedCostUsd: 0.02, status: 'PARTIAL', observedFields: ['inputTokens', 'outputTokens'] },
    timing: { elapsedMs },
    termination: 'COMPLETED',
    providerStatus: 'NONE',
    infrastructureStatus: 'NONE',
    failureFingerprint: fingerprint
  };
}

function fakeObs({ arm, repeatIndex = 0, modelTurns = 4, toolCalls = 4, useful = 3 }) {
  return { arm, repeatIndex, modelTurns, toolCalls, usefulOperationCount: useful, modelActiveMs: modelTurns * 900, capabilityActiveMs: toolCalls * 1400, elapsedMs: 10000, recoveryOutcome: 'NOT_APPLICABLE', detachableCalls: arm === 'A' ? 0 : toolCalls };
}

test('per-unit rows carry every reportContract field with unknownRule', () => {
  const row = buildUnitRow({
    record: fakeRecord({ unitId: 'u', attemptId: 'a', arm: 'D', taskId: 'terminal-bench/pypi-server' }),
    observation: fakeObs({ arm: 'D' })
  });
  for (const field of ['quality', 'inputTokens', 'outputTokens', 'providerCostUsd', 'modelTurns', 'toolCalls', 'usefulOperationCount', 'usefulOperationsPerTurn', 'modelActiveMs', 'capabilityActiveMs', 'modelCapabilityOverlapMs', 'elapsedMs', 'failureFingerprint', 'recoveryOutcome']) {
    assert.ok(field in row, field);
  }
  assert.equal(row.usefulOperationsPerTurn, 0.75);
  assert.equal(row.diagnostic, false);
  assert.equal(buildUnitRow({
    record: fakeRecord({ unitId: 'u', attemptId: 'a', arm: 'B', taskId: 't' }),
    observation: fakeObs({ arm: 'B' })
  }).diagnostic, true);
  // Unknown stays null/UNKNOWN, never zero.
  const unknown = buildUnitRow({
    record: fakeRecord({ unitId: 'u', attemptId: 'a', arm: 'A', taskId: 't', usage: { inputTokens: null, outputTokens: null, cachedTokens: null, cacheWriteTokens: null, providerCostUsd: null, normalizedCostUsd: null, status: 'UNKNOWN', observedFields: [] } }),
    observation: null
  });
  assert.equal(unknown.inputTokens, null);
  assert.equal(unknown.providerCostUsd, null);
  assert.equal(unknown.accountingStatus, 'UNKNOWN');
  assert.notEqual(unknown.inputTokens, 0);
});

test('D/A primary pairs and A->B/B->C/C->D attribution with medians', () => {
  const tasks = ['terminal-bench/git-leak-recovery', 'terminal-bench/pypi-server'];
  const settled = [];
  for (const task of tasks) {
    const short = task.replace('terminal-bench/', '');
    for (const arm of ['A', 'B', 'C', 'D']) {
      for (let r = 0; r < 2; r += 1) {
        settled.push({
          record: fakeRecord({ unitId: `${short}--${arm}--r${r}`, attemptId: `a${arm}${r}`, arm, taskId: task, usage: { inputTokens: arm === 'D' ? 900 : 1000, outputTokens: 250, cachedTokens: null, cacheWriteTokens: null, providerCostUsd: null, normalizedCostUsd: arm === 'D' ? 0.015 : 0.02, status: 'PARTIAL', observedFields: ['inputTokens'] }, elapsedMs: arm === 'D' ? 9000 : 10000 }),
          observation: fakeObs({ arm, repeatIndex: r, modelTurns: arm === 'D' ? 3 : 4 })
        });
      }
    }
  }
  const rows = buildRows({ settled });
  assert.equal(rows.length, 16);
  const paired = buildPairedViews({ rows });
  assert.equal(paired.primaryDA.length, 4);
  assert.equal(paired.attribution['A->B'].length, 4);
  assert.equal(paired.attribution['C->D'].length, 4);
  const agg = buildAggregates({ rows, paired });
  assert.ok(Math.abs(agg.medianInputRatio - 0.9) < 1e-9);
  assert.ok(Math.abs(agg.medianTurnsRatio - 0.75) < 1e-9);
  assert.deepEqual(Object.keys(agg.repeatConsistency).length, 2);
});

test('median helper and complete-denominator report guard', async () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(median([]), null);
  const { loadKernel, loadSubstrateManifest, runHeldOutCohort } = await import('../run.mjs');
  const kernel = await loadKernel();
  const { manifest, raw } = await loadSubstrateManifest();
  const out = await runHeldOutCohort({ kernel, manifest, rawManifest: raw });
  const report = buildReport({ registration: out.registration, ledger: out.ledger, settled: out.settled, binding: out.binding });
  assert.equal(report.units, 32);
  assert.equal(report.rows.length, 32);
  assert.equal(report.pairedViews.primaryDA.length, 8);
  assert.deepEqual(report.diagnosticOnly, ['B', 'C']);
  assert.equal(report.primary, 'D/A');
  // Dropping a retry/unit breaks denominators.
  assert.throws(() => buildReport({ registration: out.registration, ledger: out.ledger, settled: out.settled.slice(1), binding: out.binding }), /every settled ledger attempt/);
});
