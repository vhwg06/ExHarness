// ECONOMICS: comparison metrics derive only from shared benchmark
// attempt/evidence/accounting records as a multidimensional vector without an
// opaque winner score. Missing data stays null/UNKNOWN.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runBaseline, scratchDir } from './helpers.mjs';

let tmp;
test.before(() => { tmp = scratchDir('economics'); assert.ok(fs.statSync(tmp).isDirectory()); });

test('economics observations derive from shared records with monotonic intervals', async () => {
  const { settled } = await runBaseline({ withRetry: false });
  assert.equal(settled.length, 36);
  for (const item of settled) {
    const economics = item.economics;
    assert.equal(economics.kind, 'BB077_ECONOMICS_OBSERVATION_V1');
    // Timeout attempts fault before the first recorded model call; every
    // other attempt really executed turns and calls.
    if (item.record.providerStatus === 'PROVIDER_TIMEOUT') {
      assert.equal(economics.modelTurns, 0);
    } else {
      assert.ok(economics.modelTurns > 0);
      assert.ok(economics.toolCalls > 0);
      assert.match(economics.stablePrefixHash, /^sha256:[0-9a-f]{64}$/);
    }
    assert.equal(economics.modelTurns, economics.modelIntervals.length);
    assert.equal(economics.toolCalls, economics.callIntervals.length);
    assert.ok(economics.modelIntervals.every((value) => value >= 0));
    assert.ok(economics.callIntervals.every((value) => value >= 0));
    assert.ok(economics.stablePrefixBytes >= 0);
    assert.ok(['CONFIRMED', 'MISS', 'ELIGIBLE', 'UNKNOWN'].includes(economics.cacheLabel));
  }
  void tmp;
});

test('missing provider data stays UNKNOWN and is never zero-filled', async () => {
  const { cacheLabel } = await import('../economics.mjs');
  assert.equal(await cacheLabel({ stablePrefixRepeats: false, providerCachedTokens: null, usageKnown: false }), 'UNKNOWN');
  const { settled } = await runBaseline({ withRetry: false });
  const unknown = settled.filter((item) => item.record.usage.status === 'UNKNOWN');
  assert.ok(unknown.length > 0);
  for (const item of unknown) {
    assert.equal(item.economics.cacheLabel === 'CONFIRMED', false, 'UNKNOWN usage can never be CONFIRMED');
    assert.equal(item.record.usage.providerCostUsd, null);
  }
});

test('repeated prefix without provider evidence is ELIGIBLE, never CONFIRMED', async () => {
  const { cacheLabel } = await import('../economics.mjs');
  assert.equal(await cacheLabel({ stablePrefixRepeats: true, providerCachedTokens: null, usageKnown: false }), 'ELIGIBLE');
  assert.equal(await cacheLabel({ stablePrefixRepeats: true, providerCachedTokens: 120, usageKnown: true }), 'CONFIRMED');
  assert.equal(await cacheLabel({ stablePrefixRepeats: true, providerCachedTokens: 0, usageKnown: true }), 'MISS');
  assert.equal(await cacheLabel({ stablePrefixRepeats: false, providerCachedTokens: null, usageKnown: false }), 'UNKNOWN');
});

test('report carries the multidimensional vector with no winner score', async () => {
  const { registration, ledger, comparison, binding } = await runBaseline({ withRetry: true });
  const { buildReport, assertNoWinnerScore } = await import('../report.mjs');
  const report = await buildReport({ registration, ledger, comparison, binding, audits: [] });
  assert.equal(report.kind, 'BB077_SYNC_BASELINE_REPORT_V1');
  assert.equal(report.dataKind, 'OFFLINE_SCRIPTED_FIXTURE');
  assert.equal(report.liveBaseline, 'NOT_EXECUTED');
  assert.equal(report.attempts, 37);
  assert.deepEqual(report.arms, ['DIRECT_CODEACT', 'CORE_SYNC']);
  assert.ok(!('winner' in report) && !('score' in report));
  assert.equal(await assertNoWinnerScore(report), true);
  assert.throws(() => assertNoWinnerScore({ ...report, winner: 'CORE_SYNC' }), /winner score/);
  assert.throws(() => assertNoWinnerScore({ ...report, score: 0.9 }), /winner score/);
});
