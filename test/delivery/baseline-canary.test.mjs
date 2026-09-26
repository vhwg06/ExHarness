import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CALIBRATION_TASK_IDS, MINI_COMMIT, NODE_VERSION, PLAYWRIGHT_VERSION, PROTOCOL, fixtureIdentities, sha256 } from '../../scripts/delivery/baseline/contract.mjs';
import { CANARY_CAPS, assertCanaryForRegistration, auditCanary, countCanaryToolTurns, runCanary, validateCanaryArtifact } from '../../scripts/delivery/baseline/canary.mjs';

const IMAGE_DIGEST = `sha256:${'d'.repeat(64)}`;

async function testProfile() {
  const identities = await fixtureIdentities();
  const value = JSON.parse(await readFile('scripts/delivery/baseline/core-value-protocol.json', 'utf8'));
  const template = JSON.parse(await readFile(resolve('scripts/delivery/baseline/profile.json'), 'utf8'));
  const armHash = sha256({ model: template.model, nodeVersion: NODE_VERSION, miniCommit: MINI_COMMIT,
    agentImageDigest: IMAGE_DIGEST, budgets: PROTOCOL.budgets });
  return { ...template, template: false, experimentId: 'canary-test', operatorId: 'operator', reviewerId: 'reviewer',
    protocolHash: `sha256:${sha256(value)}`, candidateSha: 'a'.repeat(40), candidateTree: 'b'.repeat(40),
    ...identities, nodeVersion: NODE_VERSION, playwrightVersion: PLAYWRIGHT_VERSION,
    pythonExecutable: 'C:/python312/python.exe', pythonVersion: '3.12.13',
    nodeImageDigest: IMAGE_DIGEST, browserDigest: IMAGE_DIGEST, pythonLockDigest: IMAGE_DIGEST,
    agentImageDigest: IMAGE_DIGEST, agentImage: `fixture@${IMAGE_DIGEST}`,
    budgets: structuredClone(PROTOCOL.budgets), calibrationTaskIds: [...CALIBRATION_TASK_IDS],
    contexts: [], armProfileHashes: { DIRECT: armHash, EXHARNESS: armHash } };
}

function trajectory(turns) {
  const messages = [
    { role: 'system', content: 'system', extra: {} },
    { role: 'user', content: 'task', extra: {} }
  ];
  for (let index = 0; index < turns; index += 1) {
    messages.push({ role: 'assistant', content: `step ${index}`, extra: { actions: [{ tool_call_id: `call-${index}`, command: `echo ${index}` }] } });
    messages.push({ role: 'tool', tool_call_id: `call-${index}`, content: `${index}`, extra: { raw_output: `${index}`, returncode: 0 } });
  }
  messages.push({ role: 'exit', content: 'done', extra: { exit_status: 'Submitted', submission: 'done' } });
  return { info: {}, messages };
}

function stubExecutor({ marker = 'exact', turns = 2, ledger = 'settled', exitStatus = 'Submitted', activeMs = 1000 } = {}) {
  return async ({ candidateDir, attemptDir, output, executionId }) => {
    const nonceValue = (await readFile(join(candidateDir, 'nonce.txt'), 'utf8')).trim();
    const markerText = marker === 'exact' ? `CANARY-MARKER-${nonceValue}` : marker === 'wrong' ? 'WRONG' : null;
    if (markerText != null) await writeFile(join(candidateDir, 'marker.txt'), `${markerText}\n`);
    await writeFile(join(attemptDir, 'trajectory.json'), JSON.stringify(trajectory(turns)));
    const ledgerDir = join(output, 'executions', executionId);
    await mkdir(ledgerDir, { recursive: true });
    const evidence = { inputTokens: 120, outputTokens: 30, costUsd: 0 };
    const rows = [{ schemaVersion: 1, kind: 'RESERVE', requestId: 'canary-req-1', taskId: 'CANARY-AUX', attemptId: `${executionId}:attempt-1`, timestamp: '2026-09-26T00:00:00.000Z', inputTokensReserved: 16384, outputTokensReserved: 4096, costUsdReserved: 0 }];
    if (ledger === 'settled' || ledger === 'over-cap') {
      const bytes = Buffer.from(JSON.stringify({ id: 'chatcmpl-canary' }) + '\n');
      const ref = `executions/${executionId}/provider-responses/canary-req-1.json`;
      await mkdir(join(output, ref.split('/').slice(0, -1).join('/')), { recursive: true });
      await writeFile(join(output, ref), bytes);
      const hash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
      const settledTokens = ledger === 'over-cap' ? { inputTokens: 40000, outputTokens: 20000 } : evidence;
      rows.push({ schemaVersion: 1, kind: 'SETTLED', requestId: 'canary-req-1', providerRequestId: 'chatcmpl-canary',
        taskId: 'CANARY-AUX', attemptId: `${executionId}:attempt-1`, timestamp: '2026-09-26T00:00:01.000Z',
        ...settledTokens, providerEvidenceRef: ref, providerEvidenceHash: hash });
    } else if (ledger === 'unknown') {
      rows.push({ schemaVersion: 1, kind: 'UNKNOWN', requestId: 'canary-req-1', taskId: 'CANARY-AUX',
        attemptId: `${executionId}:attempt-1`, timestamp: '2026-09-26T00:00:01.000Z', reason: 'provider timeout' });
    }
    await writeFile(join(ledgerDir, 'provider-ledger.jsonl'), rows.map(row => JSON.stringify(row)).join('\n') + '\n');
    return { driverResult: { exitStatus }, provider: { wireRequests: 1 }, timing: { activeMs, providerWaitMs: 0 } };
  };
}

test('canary tool-turn counting requires interleaved tool results', () => {
  assert.deepEqual(countCanaryToolTurns(trajectory(2)), { toolTurns: 2, toolResults: 2, interleaved: true });
  assert.deepEqual(countCanaryToolTurns(trajectory(1)), { toolTurns: 1, toolResults: 1, interleaved: false });
  assert.deepEqual(countCanaryToolTurns({ messages: [] }), { toolTurns: 0, toolResults: 0, interleaved: false });
  const noResult = { messages: [{ role: 'assistant', content: 'x', extra: { actions: [{ tool_call_id: 'a' }] } },
    { role: 'assistant', content: 'y', extra: { actions: [{ tool_call_id: 'b' }] } }] };
  assert.deepEqual(countCanaryToolTurns(noResult), { toolTurns: 2, toolResults: 0, interleaved: false });
});

test('canary run records a passing gate with bound evidence', async t => {
  const output = await mkdtemp(join(tmpdir(), 'baseline-canary-'));
  t.after(() => rm(output, { recursive: true, force: true }));
  process.env.NVIDIA_API_KEY ??= 'canary-test-credential';
  const profile = await testProfile();
  const result = await runCanary({ profile, output, executor: stubExecutor() });
  assert.equal(result.status, 'PASS');
  assert.equal(result.exitCode, 0);
  const artifact = JSON.parse(await readFile(join(output, 'canary', 'canary.json'), 'utf8'));
  assert.equal(artifact.evidenceClass, 'LIVE_CANARY');
  assert.equal(artifact.status, 'PASS');
  assert.equal(artifact.profileHash, sha256(profile));
  assert.equal(artifact.toolTurns, 2);
  assert.equal(artifact.toolTurnsInterleaved, true);
  assert.equal(artifact.wireRequests, 1);
  assert.deepEqual(artifact.caps, { ...CANARY_CAPS });
  assert.match(artifact.digest, /^sha256:[a-f0-9]{64}$/);
  const marker = await readFile(join(output, 'canary', 'attempt-1', 'candidate', 'marker.txt'), 'utf8');
  assert.equal(marker.trim(), artifact.marker);
  assert.equal((await auditCanary({ output, profile })).status, 'PASS');
  assert.equal(validateCanaryArtifact({ artifact, profile }), true);
  assert.equal((await assertCanaryForRegistration({ output, profile })).status, 'PASS');
  const rerun = await runCanary({ profile, output, executor: stubExecutor({ marker: 'wrong' }) });
  assert.equal(rerun.cached, true);
  assert.equal(rerun.status, 'PASS');
});

test('canary audit detects tampered marker, trajectory and ledger', async t => {
  const output = await mkdtemp(join(tmpdir(), 'baseline-canary-tamper-'));
  t.after(() => rm(output, { recursive: true, force: true }));
  process.env.NVIDIA_API_KEY ??= 'canary-test-credential';
  const profile = await testProfile();
  await runCanary({ profile, output, executor: stubExecutor() });
  await writeFile(join(output, 'canary', 'attempt-1', 'candidate', 'marker.txt'), 'TAMPERED\n');
  await assert.rejects(() => auditCanary({ output, profile }), /marker/);
  const artifact = JSON.parse(await readFile(join(output, 'canary', 'canary.json'), 'utf8'));
  await writeFile(join(output, 'canary', 'attempt-1', 'candidate', 'marker.txt'), `${artifact.marker}\n`);
  await writeFile(join(output, 'canary', 'attempt-1', 'trajectory.json'), JSON.stringify(trajectory(1)));
  await assert.rejects(() => auditCanary({ output, profile }), /turn/);
  await writeFile(join(output, 'canary', 'attempt-1', 'trajectory.json'), JSON.stringify(trajectory(2)));
  const ledgerPath = join(output, 'executions', 'CANARY:AUX', 'provider-ledger.jsonl');
  const rows = (await readFile(ledgerPath, 'utf8')).trim().split('\n').map(JSON.parse);
  rows[1].outputTokens = 31;
  await writeFile(ledgerPath, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
  await assert.rejects(() => auditCanary({ output, profile }), /ledger/);
});

test('canary UNKNOWN usage is unresolved and blocks registration', async t => {
  const output = await mkdtemp(join(tmpdir(), 'baseline-canary-unknown-'));
  t.after(() => rm(output, { recursive: true, force: true }));
  process.env.NVIDIA_API_KEY ??= 'canary-test-credential';
  const profile = await testProfile();
  const result = await runCanary({ profile, output, executor: stubExecutor({ ledger: 'unknown' }) });
  assert.equal(result.status, 'UNRESOLVED');
  assert.equal(result.exitCode, 1);
  assert.equal((await auditCanary({ output, profile })).status, 'UNRESOLVED');
  const artifact = JSON.parse(await readFile(join(output, 'canary', 'canary.json'), 'utf8'));
  assert.throws(() => validateCanaryArtifact({ artifact, profile }), /passing canary/);
  await assert.rejects(() => assertCanaryForRegistration({ output, profile }), /passing canary/);
});

test('canary wrong marker, single turn and cap breach fail closed', async t => {
  for (const [label, options] of [
    ['wrong-marker', { marker: 'wrong' }],
    ['single-turn', { turns: 1 }],
    ['over-cap', { ledger: 'over-cap' }]
  ]) {
    const output = await mkdtemp(join(tmpdir(), `baseline-canary-${label}-`));
    try {
      process.env.NVIDIA_API_KEY ??= 'canary-test-credential';
      const profile = await testProfile();
      const result = await runCanary({ profile, output, executor: stubExecutor(options) });
      assert.equal(result.status, 'FAIL', label);
      const artifact = JSON.parse(await readFile(join(output, 'canary', 'canary.json'), 'utf8'));
      assert.throws(() => validateCanaryArtifact({ artifact, profile }), /passing canary|interleaved tool turns|runtime-readiness caps/, label);
    } finally { await rm(output, { recursive: true, force: true }); }
  }
});

test('missing canary blocks cohort registration', async t => {
  const output = await mkdtemp(join(tmpdir(), 'baseline-canary-missing-'));
  try {
    const profile = await testProfile();
    await assert.rejects(() => assertCanaryForRegistration({ output, profile }), /passing runtime-readiness canary/);
    await assert.rejects(() => auditCanary({ output, profile }), /missing/);
  } finally { await rm(output, { recursive: true, force: true }); }
});
