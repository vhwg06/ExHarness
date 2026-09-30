// Fresh-process audit: a new Node process reopens a materialized experiment and recomputes every
// candidate / evaluator / outcome / accounting identity. Tampered, missing or mismatched evidence fails.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { persistLedger } from '../attempt-runner.mjs';
import { RUN_CLI, fakeSubstrate, materialize, registeredExperiment, runFakeAttempt, tempDir } from './helpers.mjs';

function freshAudit(root) {
  const child = spawnSync(process.execPath, [RUN_CLI, '--mode', 'audit', '--input', root], { encoding: 'utf8' });
  const summary = JSON.parse(child.stdout);
  if (process.env.AUDIT_DEBUG) process.stderr.write(`AUDIT ${root}: ${JSON.stringify(summary.error ?? summary.findings?.map(f => f.code + ':' + (f.detail ?? '').slice(0, 80)))}\n`);
  return { exitCode: child.status, summary };
}

// One experiment: an accepted attempt, a rate-limited attempt, and a retry that preserves it.
async function buildExperiment() {
  const outputRoot = await tempDir('bench-audit-');
  const experiment = await registeredExperiment({ experimentId: 'AUDIT-REOPEN', unitIds: ['U-PASS', 'U-RETRY'] });
  const root = join(outputRoot, 'AUDIT-REOPEN');
  await materialize(root, experiment);
  await runFakeAttempt({ experiment, substrate: fakeSubstrate(outputRoot, { mode: 'usage' }), experimentRoot: root, unitIndex: 0, attemptId: 'PASS-A1' });
  await runFakeAttempt({ experiment, substrate: fakeSubstrate(outputRoot, { mode: 'rate-limit' }), experimentRoot: root, unitIndex: 1, attemptId: 'RETRY-A1' });
  await runFakeAttempt({ experiment, substrate: fakeSubstrate(outputRoot, { mode: 'pass' }), experimentRoot: root, unitIndex: 1, attemptId: 'RETRY-A2', retryOfAttemptId: 'RETRY-A1' });
  return { outputRoot, root, experiment };
}

let built;
const fixture = async () => { built ??= await buildExperiment(); return built; };
async function copyOf(name) {
  const { outputRoot, root } = await fixture();
  const target = join(outputRoot, name);
  await cp(root, target, { recursive: true, filter: path => !/[\\/]trials([\\/]|$)/.test(path) });
  return target;
}
const evidence = (root, unit, attempt, ...ref) => join(root, unit, attempt, 'evidence', ...ref);
const codes = summary => summary.findings.map(item => item.code);

test('a fresh process reopens the untouched experiment and every attempt audits PASS', async () => {
  const { root, experiment } = await fixture();
  const { exitCode, summary } = freshAudit(root);
  assert.equal(exitCode, 0, JSON.stringify(summary.findings));
  assert.equal(summary.status, 'PASS');
  assert.equal(summary.attempts, 3);
  assert.equal(summary.registrationDigest, experiment.registration.registrationDigest);
  const record = JSON.parse(await readFile(join(root, 'U-RETRY', 'RETRY-A2', 'record.json'), 'utf8'));
  assert.equal(record.retryOfAttemptId, 'RETRY-A1');
  const original = JSON.parse(await readFile(join(root, 'U-RETRY', 'RETRY-A1', 'record.json'), 'utf8'));
  assert.equal(original.quality.verdict, 'NOT_EVALUATED', 'the failed original attempt is preserved beside its retry');
  assert.equal(original.providerStatus, 'RATE_LIMITED');
  const second = freshAudit(root);
  assert.deepEqual(second.summary.audits.map(a => a.auditDigest), summary.audits.map(a => a.auditDigest), 'audit is deterministic');
});

test('a tampered artifact after settlement fails audit', async () => {
  const root = await copyOf('tamper-artifact');
  await writeFile(evidence(root, 'U-PASS', 'PASS-A1', 'artifacts', 'app', 'out', 'result.txt'), 'forged\n');
  const { exitCode, summary } = freshAudit(root);
  assert.notEqual(exitCode, 0);
  assert.equal(summary.status, 'FAIL');
  assert.ok(summary.findings.some(item => item.attempt === 'PASS-A1' && item.code === 'TAMPERED'), JSON.stringify(summary.findings));
});

test('a tampered verifier result or raw Harbor result fails audit', async () => {
  for (const ref of [['verifier', 'reward.txt'], ['raw', 'result.json']]) {
    const root = await copyOf(`tamper-${ref.join('-')}`);
    await writeFile(evidence(root, 'U-PASS', 'PASS-A1', ...ref), '0\n');
    const { summary } = freshAudit(root);
    assert.equal(summary.status, 'FAIL', ref.join('/'));
    assert.ok(codes(summary).includes('TAMPERED'), ref.join('/'));
  }
});

test('a missing verifier output or missing raw result fails audit', async () => {
  for (const ref of [['verifier', 'reward.txt'], ['raw', 'result.json'], ['normalization.json']]) {
    const root = await copyOf(`missing-${ref.join('-')}`);
    await rm(evidence(root, 'U-PASS', 'PASS-A1', ...ref));
    const { summary } = freshAudit(root);
    assert.equal(summary.status, 'FAIL', ref.join('/'));
    assert.ok(codes(summary).includes('MISSING_EVIDENCE'), ref.join('/'));
  }
});

test('zero-filling unknown usage in a settled record fails audit', async () => {
  const root = await copyOf('zero-fill');
  const path = join(root, 'U-RETRY', 'RETRY-A1', 'record.json');
  const record = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(record.usage.status, 'UNKNOWN');
  record.usage = { ...record.usage, inputTokens: 0, outputTokens: 0, status: 'PARTIAL', observedFields: ['inputTokens', 'outputTokens'] };
  await writeFile(path, JSON.stringify(record, null, 2));
  const { summary } = freshAudit(root);
  assert.equal(summary.status, 'FAIL');
  assert.ok(codes(summary).includes('IDENTITY_DRIFT'), JSON.stringify(codes(summary)));
});

test('a rewritten outcome (NOT_EVALUATED forged to REJECTED) fails audit', async () => {
  const root = await copyOf('forged-outcome');
  const path = join(root, 'U-RETRY', 'RETRY-A1', 'record.json');
  const record = JSON.parse(await readFile(path, 'utf8'));
  record.quality.verdict = 'REJECTED';
  await writeFile(path, JSON.stringify(record, null, 2));
  const { summary } = freshAudit(root);
  assert.equal(summary.status, 'FAIL');
  assert.ok(codes(summary).includes('TAMPERED'));
});

test('a removed attempt (retry erasing the failed original) fails audit', async () => {
  const root = await copyOf('erased-original');
  await rm(join(root, 'U-RETRY', 'RETRY-A1'), { recursive: true });
  const { summary } = freshAudit(root);
  assert.equal(summary.status, 'FAIL');
  assert.ok(codes(summary).some(code => ['UNREPRESENTED_ATTEMPT', 'LEDGER_REPLAY'].includes(code)), JSON.stringify(codes(summary)));
});

test('a STARTED attempt that never settled is reported, not silently dropped', async () => {
  const { outputRoot } = await fixture();
  const experiment = await registeredExperiment({ experimentId: 'AUDIT-UNSETTLED', unitIds: ['U1'] });
  const root = join(outputRoot, 'AUDIT-UNSETTLED');
  await materialize(root, experiment);
  experiment.ledger.beginAttempt({ unitId: 'U1', attemptId: 'A1', retryOfAttemptId: null, startedAt: '2026-01-01T00:00:00.000Z' });
  await persistLedger(root, experiment.ledger);
  const { summary } = freshAudit(root);
  assert.equal(summary.status, 'FAIL');
  assert.ok(codes(summary).includes('UNREPRESENTED_ATTEMPT'));
});

test('a changed registration (fixed factor edited after STARTED) fails audit', async () => {
  const root = await copyOf('edited-registration');
  const path = join(root, 'registration.json');
  const registration = JSON.parse(await readFile(path, 'utf8'));
  registration.environmentIdentity = 'docker-image:changed';
  await writeFile(path, JSON.stringify(registration, null, 2));
  const { summary } = freshAudit(root);
  assert.equal(summary.status, 'FAIL');
  assert.ok(codes(summary).includes('IDENTITY_DRIFT'));
});
