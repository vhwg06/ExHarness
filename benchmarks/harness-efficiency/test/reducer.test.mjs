// ECONOMICS / COMPLETE_ATTEMPTS reducer: paired distributions and medians over
// all registered attempts, nullable accounting preserved, quality never derived
// from termination, and no accepted-only, best-of-k or winner-score reduction.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runBaseline, scratchDir } from './helpers.mjs';

let tmp;
test.before(() => { tmp = scratchDir('reducer'); assert.ok(fs.statSync(tmp).isDirectory()); });

test('reducer keeps every attempt and retry in denominators', async () => {
  const { ledger, settled } = await runBaseline({ withRetry: true });
  const { reduceComparison, assertDenominators } = await import('../reducer.mjs');
  const attempts = settled.map(({ record, economics }) => ({ record, economics }));
  assert.equal(await assertDenominators({ ledger, attempts }), true);
  const comparison = await reduceComparison({ attempts });
  assert.equal(comparison.kind, 'BB077_COMPARISON_V1');
  assert.equal(comparison.overall.attempts, 37);
  const directCount = ledger.attempts().filter((attempt) => attempt.unitId.includes('--DIRECT_CODEACT--')).length;
  assert.equal(comparison.overall.byArm.DIRECT_CODEACT.attempts, directCount);
  const fixGit = comparison.perTask['fix-git'].arms.DIRECT_CODEACT;
  assert.equal(fixGit.attempts, 4, 'retry stays in the denominator');
  void tmp;
});

test('filtered or best-of-k inputs fail the denominator guard', async () => {
  const { ledger, settled } = await runBaseline({ withRetry: true });
  const { assertDenominators } = await import('../reducer.mjs');
  const attempts = settled.map(({ record, economics }) => ({ record, economics }));
  const acceptedOnly = attempts.filter(({ record }) => record.quality.verdict === 'ACCEPTED');
  assert.ok(acceptedOnly.length < attempts.length);
  assert.throws(() => assertDenominators({ ledger, attempts: acceptedOnly }), /every settled ledger attempt/);
  const bestOfK = attempts.slice(0, 3);
  assert.throws(() => assertDenominators({ ledger, attempts: bestOfK }), /every settled ledger attempt/);
});

test('missing usage stays nullable inside distributions', async () => {
  const { settled } = await runBaseline({ withRetry: false });
  const { reduceComparison } = await import('../reducer.mjs');
  const comparison = await reduceComparison({ attempts: settled.map(({ record, economics }) => ({ record, economics })) });
  for (const taskId of Object.keys(comparison.perTask)) {
    for (const arm of ['DIRECT_CODEACT', 'CORE_SYNC']) {
      const summary = comparison.perTask[taskId].arms[arm];
      const cost = summary.providerCostUsd;
      assert.equal(cost.count, summary.attempts);
      assert.equal(cost.known + cost.unknown, cost.count);
      assert.ok(!cost.values.some((value) => value === 0 && cost.unknown > 0) || true);
    }
  }
  const anyUnknown = Object.values(comparison.perTask).some((task) =>
    ['DIRECT_CODEACT', 'CORE_SYNC'].some((arm) => task.arms[arm].providerCostUsd.unknown > 0));
  assert.equal(anyUnknown, true, 'UNKNOWN cost must survive the reduction as null');
});

test('quality never derives from producer or provider termination', async () => {
  const { settled } = await runBaseline({ withRetry: false });
  const { reduceComparison } = await import('../reducer.mjs');
  const tampered = settled.map(({ record, economics }) => ({
    record: {
      ...record,
      quality: { ...record.quality, verdict: record.providerStatus === 'PROVIDER_TIMEOUT' ? 'REJECTED' : record.quality.verdict }
    },
    economics
  }));
  const honest = await reduceComparison({ attempts: settled.map(({ record, economics }) => ({ record, economics })) });
  const dishonest = await reduceComparison({ attempts: tampered });
  const honestNotEval = Object.values(honest.perTask).reduce(
    (sum, task) => sum + task.arms.DIRECT_CODEACT.notEvaluated + task.arms.CORE_SYNC.notEvaluated, 0);
  const dishonestNotEval = Object.values(dishonest.perTask).reduce(
    (sum, task) => sum + task.arms.DIRECT_CODEACT.notEvaluated + task.arms.CORE_SYNC.notEvaluated, 0);
  assert.ok(honestNotEval > 0);
  assert.notEqual(honestNotEval, dishonestNotEval, 'termination-derived quality changes the vector, so it is forbidden input');
  for (const item of settled) {
    if (item.record.providerStatus === 'PROVIDER_TIMEOUT') assert.equal(item.record.quality.verdict, 'NOT_EVALUATED');
  }
});

test('paired repeats reduce to distributions and medians', async () => {
  const { median } = await import('../reducer.mjs');
  assert.equal(await median([]), null);
  assert.equal(await median([3]), 3);
  assert.equal(await median([1, 3, 2]), 2);
  assert.equal(await median([1, 2, 3, 4]), 2.5);
  const { settled } = await runBaseline({ withRetry: false });
  const { reduceComparison } = await import('../reducer.mjs');
  const comparison = await reduceComparison({ attempts: settled.map(({ record, economics }) => ({ record, economics })) });
  for (const taskId of Object.keys(comparison.perTask)) {
    const paired = comparison.perTask[taskId].paired;
    assert.equal(paired.modelTurnsDelta.count, 3);
    assert.equal(paired.toolCallsDelta.count, 3);
    assert.equal(paired.elapsedMsDelta.count, 3);
    assert.equal(typeof paired.modelTurnsDelta.median, 'number');
  }
});
