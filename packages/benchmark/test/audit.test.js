import test from 'node:test';
import assert from 'node:assert/strict';
import { AttemptLedger, auditAttempt } from '@exharness/benchmark';
import { setup, materializeAttempt, outcomeInput, usageObservation, EVALUATOR, sha, T0, T1 } from './fixtures.js';

function settled(options = {}) {
  const { registration, units } = setup();
  const ledger = new AttemptLedger({ registration });
  units.forEach(unit => ledger.registerUnit(unit));
  const attemptId = options.attemptId ?? 'A-1';
  ledger.beginAttempt({ unitId: 'UNIT-A', attemptId, startedAt: T0 });
  const materialized = materializeAttempt({ unit: units[0], attemptId, ...options });
  const { record } = ledger.settleAttempt(materialized.record, { settledAt: T1 });
  return { registration, unit: units[0], record, manifest: materialized.manifest, store: materialized.store, ledger };
}

const codes = audit => audit.findings.map(f => f.code);

test('audit reopens evidence and recomputes candidate, evaluator, outcome, accounting and record identity', async () => {
  const s = settled({ usage: usageObservation({ inputTokens: 10, outputTokens: 2 }) });
  const audit = await auditAttempt({ ...s, ledgerEvents: s.ledger.events() });
  assert.equal(audit.kind, 'BENCHMARK_AUDIT_V1');
  assert.deepEqual(audit.findings, []);
  assert.equal(audit.status, 'PASS');
  assert.equal(audit.recomputed.recordDigest, s.record.recordDigest);
  assert.equal(audit.recomputed.accountingDigest, s.record.usage.accountingDigest);
  assert.equal(audit.recomputed.candidateDigest, s.record.candidate.artifactDigest);
  assert.equal(audit.recomputed.evaluatorIdentity, EVALUATOR);
  const again = await auditAttempt({ ...s, ledgerEvents: s.ledger.events() });
  assert.equal(again.auditDigest, audit.auditDigest);
});

test('a tampered artifact, result or verifier file fails audit', async () => {
  for (const ref of ['artifacts/out/result.txt', 'raw/result.json', 'verifier/reward.txt']) {
    const s = settled();
    s.store.files.get(ref).bytes = Buffer.from('tampered\n');
    const audit = await auditAttempt(s);
    assert.equal(audit.status, 'FAIL', ref);
    assert.ok(codes(audit).includes('TAMPERED'), ref);
  }
});

test('missing verifier or result evidence fails audit', async () => {
  for (const ref of ['verifier/reward.txt', 'raw/result.json', 'artifacts/manifest.json']) {
    const s = settled();
    s.store.files.delete(ref);
    const audit = await auditAttempt(s);
    assert.equal(audit.status, 'FAIL', ref);
    assert.ok(codes(audit).includes('MISSING_EVIDENCE'), ref);
  }
});

test('a stored record that disagrees with materialized evidence fails audit', async () => {
  const s = settled();
  const forged = { ...JSON.parse(JSON.stringify(s.record)), quality: { verdict: 'REJECTED', evaluatorIdentity: EVALUATOR, evidenceRef: 'verifier/reward.txt' } };
  assert.ok(codes(await auditAttempt({ ...s, record: forged })).includes('TAMPERED'));
});

test('zero-filled unknown usage fails audit even when the record is resealed consistently', async () => {
  const { registration, units } = setup();
  const ledger = new AttemptLedger({ registration });
  units.forEach(unit => ledger.registerUnit(unit));
  ledger.beginAttempt({ unitId: 'UNIT-A', attemptId: 'A-1', startedAt: T0 });
  const honest = materializeAttempt({ unit: units[0], attemptId: 'A-1', usage: usageObservation({}) });
  const zeroFilled = materializeAttempt({ unit: units[0], attemptId: 'A-1', usage: usageObservation({ inputTokens: 0, outputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0, providerCostUsd: 0, normalizedCostUsd: 0 }) });
  const { record } = ledger.settleAttempt({ ...zeroFilled.record, evidence: { ...zeroFilled.record.evidence, manifestDigest: honest.manifest.manifestDigest } }, { settledAt: T1 });
  const audit = await auditAttempt({ registration, unit: units[0], record, manifest: honest.manifest, store: honest.store });
  assert.equal(audit.status, 'FAIL');
  assert.ok(codes(audit).includes('ACCOUNTING_MISMATCH'));
});

test('fixed-factor drift, evaluator swap and reused reset identity fail audit', async () => {
  const s = settled();
  const otherUnit = { ...JSON.parse(JSON.stringify(s.unit)), unitDigest: sha('x') };
  assert.equal((await auditAttempt({ ...s, unit: otherUnit })).status, 'FAIL');
  const swapped = settled({ outcome: outcomeInput({ evaluator: { verdict: 'PASS', identity: 'self-report', evidenceRef: 'verifier/reward.txt' } }) });
  assert.ok(codes(await auditAttempt(swapped)).includes('EVALUATOR_IDENTITY'));
  const registry = new Set();
  assert.equal((await auditAttempt({ ...s, resetRegistry: registry })).status, 'PASS');
  const reused = settled();
  assert.ok(codes(await auditAttempt({ ...reused, resetRegistry: registry })).includes('RESET_REUSED'));
});

test('ledger binding is checked when events are supplied', async () => {
  const s = settled();
  const events = s.ledger.events().filter(event => event.type === 'STARTED');
  assert.ok(codes(await auditAttempt({ ...s, ledgerEvents: events })).includes('LEDGER_MISMATCH'));
});
