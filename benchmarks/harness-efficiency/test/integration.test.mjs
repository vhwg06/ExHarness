// KERNEL_CONSUMER / COMPLETE_ATTEMPTS integration: every arm execution is
// registered through the kernel and settled in the shared AttemptLedger;
// retries append, missing usage stays null, and verifier quality stays
// orthogonal to producer/provider termination.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { memoryStore, runBaseline, scratchDir } from './helpers.mjs';

let tmp;
test.before(() => { tmp = scratchDir('integration'); assert.ok(fs.statSync(tmp).isDirectory()); });

test('every arm execution registers through the kernel and settles in the shared ledger', async () => {
  const { kernel, registration, units, ledger, settled } = await runBaseline({ withRetry: false });
  assert.equal(units.length, 36);
  assert.equal(settled.length, 36);
  const attempts = ledger.attempts();
  assert.equal(attempts.length, 36);
  assert.ok(attempts.every((attempt) => attempt.status === 'SETTLED'));
  const events = ledger.events();
  assert.equal(events.filter((event) => event.type === 'STARTED').length, 36);
  assert.equal(events.filter((event) => event.type === 'SETTLED').length, 36);
  const replayed = kernel.AttemptLedger.replay({
    registration,
    units,
    events,
    records: settled.map((item) => item.record)
  });
  assert.deepEqual(
    replayed.attempts().map((attempt) => attempt.record.recordDigest).sort(),
    attempts.map((attempt) => attempt.record.recordDigest).sort()
  );
  void tmp;
});

test('a retry success preserves the failed shared-ledger attempt', async () => {
  const { ledger } = await runBaseline({ withRetry: true });
  const first = ledger.attempt('fix-git--DIRECT_CODEACT--r0--attempt-1');
  const retry = ledger.attempt('fix-git--DIRECT_CODEACT--r0--attempt-2');
  assert.equal(first.status, 'SETTLED');
  assert.equal(retry.status, 'SETTLED');
  assert.equal(retry.retryOfAttemptId, first.attemptId);
  assert.ok(first.record, 'the failed attempt record remains');
  assert.equal(ledger.attempts().length, 37);
  let resettle = false;
  try {
    ledger.settleAttempt({ ...first.record }, { settledAt: '2026-10-01T00:00:00.000Z' });
  } catch {
    resettle = true;
  }
  assert.equal(resettle, true, 'settled attempts are append-only and cannot be overwritten');
});

test('missing provider usage stays null and UNKNOWN, never zero or KNOWN', async () => {
  const { settled } = await runBaseline({ withRetry: false });
  const unknown = settled.filter((item) => item.record.usage.status === 'UNKNOWN');
  assert.ok(unknown.length > 0, 'fixture cohort must include UNKNOWN accounting');
  for (const item of unknown) {
    assert.equal(item.record.usage.inputTokens, null);
    assert.equal(item.record.usage.outputTokens, null);
    assert.equal(item.record.usage.providerCostUsd, null);
    assert.deepEqual(item.record.usage.observedFields, []);
  }
  const partial = settled.filter((item) => item.record.usage.status === 'PARTIAL');
  assert.ok(partial.length > 0, 'fixture cohort must include PARTIAL accounting');
});

test('verifier quality stays orthogonal to producer and provider termination', async () => {
  const { settled } = await runBaseline({ withRetry: false });
  const rejected = settled.filter((item) => item.record.quality.verdict === 'REJECTED');
  assert.ok(rejected.length > 0);
  for (const item of rejected) {
    assert.equal(item.record.termination, 'COMPLETED', 'producer SUCCESS plus verifier FAIL stays REJECTED/COMPLETED');
  }
  const notEvaluated = settled.filter((item) => item.record.quality.verdict === 'NOT_EVALUATED');
  assert.ok(notEvaluated.length > 0);
  for (const item of notEvaluated) {
    assert.equal(item.record.providerStatus, 'PROVIDER_TIMEOUT');
    assert.notEqual(item.record.quality.verdict, 'REJECTED', 'provider timeout without an artifact is never a quality rejection');
  }
  const accepted = settled.filter((item) => item.record.quality.verdict === 'ACCEPTED');
  assert.ok(accepted.length > 0);
});

test('kernel audit passes for every settled attempt on reopened evidence', async () => {
  const { kernel, registration, ledger, settled, stores } = await runBaseline({ withRetry: true });
  const resetRegistry = new Set();
  let passed = 0;
  for (const item of settled) {
    const audit = await kernel.auditAttempt({
      registration,
      unit: item.unit,
      record: item.record,
      manifest: item.manifest,
      store: memoryStore(stores.get(item.record.attemptId)),
      ledgerEvents: ledger.events(),
      resetRegistry
    });
    assert.equal(audit.status, 'PASS', item.record.attemptId);
    passed += 1;
  }
  assert.equal(passed, settled.length);
});
