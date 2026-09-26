import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile, chmod, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CALIBRATION_TASK_IDS, MINI_COMMIT, NODE_VERSION, PLAYWRIGHT_VERSION, PROTOCOL, fixtureIdentities, sha256 } from '../../scripts/delivery/baseline/contract.mjs';
import { CANARY_CAPS, assertCanaryForRegistration, auditCanary, countCanaryToolTurns, runCanary, validateCanaryArtifact, inspectCanaryNative, inspectCanaryOrdering } from '../../scripts/delivery/baseline/canary.mjs';
import { candidateDigest, canaryDigest } from '../../scripts/delivery/baseline/fixture/acceptance.mjs';
import { executeMiniAttempt } from '../../scripts/delivery/baseline/study.mjs';

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

function nativeResponse({ id, completionTokens, withTools = true, truncated = false }) {
  return {
    id, object: 'chat.completion', created: 1, model: 'nvidia/nemotron-3.5-lightning-30b-a3b',
    choices: [{
      index: 0,
      finish_reason: truncated ? 'length' : 'stop',
      message: withTools
        ? { role: 'assistant', content: '', tool_calls: [{ id, type: 'function', function: { name: 'bash', arguments: '{"command":"echo hi"}' } }] }
        : { role: 'assistant', content: 'text without tools' }
    }],
    usage: { prompt_tokens: 100, completion_tokens: completionTokens, total_tokens: 100 + completionTokens }
  };
}

function trajectoryWithNative({ turns = 2, native = 'ok' } = {}) {
  const messages = [
    { role: 'system', content: 'system', extra: {} },
    { role: 'user', content: 'task', extra: {} }
  ];
  for (let index = 0; index < turns; index += 1) {
    let response;
    if (native === 'ok') response = nativeResponse({ id: `call-${index}`, completionTokens: 30 + index });
    else if (native === 'missing' && index === 0) response = nativeResponse({ id: `call-${index}`, completionTokens: 50, withTools: false });
    else if (native === 'truncated' && index === 0) response = nativeResponse({ id: `call-${index}`, completionTokens: 4096, withTools: false, truncated: true });
    else response = nativeResponse({ id: `call-${index}`, completionTokens: 30 });
    messages.push({ role: 'assistant', content: `step ${index}`, extra: { actions: [{ tool_call_id: `call-${index}`, command: `echo ${index}` }], response } });
    messages.push({ role: 'tool', tool_call_id: `call-${index}`, content: `${index}`, extra: { raw_output: `${index}`, returncode: 0 } });
  }
  messages.push({ role: 'exit', content: 'done', extra: { exit_status: 'Submitted', submission: 'done' } });
  return { info: {}, messages };
}

function stubExecutor({ marker = 'exact', turns = 2, ledger = 'settled', exitStatus = 'Submitted', activeMs = 1000, native = null } = {}) {
  return async ({ candidateDir, attemptDir, output, executionId }) => {
    const nonceValue = (await readFile(join(candidateDir, 'nonce.txt'), 'utf8')).trim();
    const markerText = marker === 'exact' ? `CANARY-MARKER-${nonceValue}` : marker === 'wrong' ? 'WRONG' : null;
    if (markerText != null) await writeFile(join(candidateDir, 'marker.txt'), `${markerText}\n`);
    const body = native ? trajectoryWithNative({ turns, native }) : trajectory(turns);
    await writeFile(join(attemptDir, 'trajectory.json'), JSON.stringify(body));
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
    // Persist a durable driver-result file so audit cross-checks exit status
    // even for stubbed executors (production mini_driver writes this file).
    await writeFile(join(attemptDir, 'driver-result.json'), JSON.stringify({ schemaVersion: 1, exitStatus, submission: exitStatus === 'Submitted' ? 'done' : '', providerWaitSeconds: 0 }));
    return { driverResult: { exitStatus }, provider: { wireRequests: 1 }, timing: { activeMs, providerWaitMs: 0, provenance: 'measured' } };
  };
}

async function writeFakeDriver(scriptPath, scenario) {
  const code = `#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
const configPath = process.argv[3];
const scenario = process.env.FAKE_CANARY_SCENARIO || '${scenario}';
const config = JSON.parse(await readFile(configPath, 'utf8'));
const candidateDir = config.candidateDir;
const attemptDir = dirname(config.trajectoryPath);
const output = config.evidenceRoot;
const executionId = config.attemptId.split(':attempt-')[0];
const nonce = (await readFile(join(candidateDir, 'nonce.txt'), 'utf8')).trim();
const marker = 'CANARY-MARKER-' + nonce;
await writeFile(join(candidateDir, 'marker.txt'), marker + '\\n');
const withTools = (id, tokens) => ({ id, object: 'chat.completion', created: 1, model: 'test', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '', tool_calls: [{ id, type: 'function', function: { name: 'bash', arguments: ' torso' } }] } }], usage: { prompt_tokens: 50, completion_tokens: tokens, total_tokens: 50 + tokens } });
const messages = [{ role: 'system', content: 's', extra: {} }, { role: 'user', content: 't', extra: {} }];
for (const [i, tokens] of [[0, 30], [1, 40]].entries()) {
  const response = withTools('call-' + i, tokens);
  messages.push({ role: 'assistant', content: 'step', extra: { actions: [{ tool_call_id: 'call-' + i, command: 'echo ' + i }], response } });
  messages.push({ role: 'tool', tool_call_id: 'call-' + i, content: '' + i, extra: { raw_output: '' + i, returncode: 0 } });
}
messages.push({ role: 'exit', content: 'done', extra: { exit_status: scenario === 'limits' ? 'LimitsExceeded' : 'Submitted', submission: scenario === 'limits' ? '' : 'done' } });
await writeFile(config.trajectoryPath, JSON.stringify({ info: {}, messages }));
const ledgerDir = join(output, 'executions', executionId);
await mkdir(ledgerDir, { recursive: true });
await mkdir(join(output, 'executions', executionId, 'provider-responses'), { recursive: true });
const bytes = Buffer.from(JSON.stringify({ id: 'fake-evidence' }) + '\\n');
const ref = 'executions/' + executionId + '/provider-responses/fake-req-1.json';
await writeFile(join(output, ref), bytes);
const hash = 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const rows = [
  { schemaVersion: 1, kind: 'RESERVE', requestId: 'fake-req-1', taskId: 'CANARY-AUX', attemptId: config.attemptId, timestamp: new Date().toISOString(), inputTokensReserved: 16384, outputTokensReserved: 4096, costUsdReserved: 0 },
  { schemaVersion: 1, kind: 'SETTLED', requestId: 'fake-req-1', providerRequestId: 'fake-evidence', taskId: 'CANARY-AUX', attemptId: config.attemptId, timestamp: new Date().toISOString(), inputTokens: 120, outputTokens: 70, costUsd: 0, providerEvidenceRef: ref, providerEvidenceHash: hash }
];
await writeFile(join(ledgerDir, 'provider-ledger.jsonl'), rows.map(r => JSON.stringify(r)).join('\\n') + '\\n');
const exitStatus = scenario === 'limits' ? 'LimitsExceeded' : 'Submitted';
await writeFile(config.resultPath, JSON.stringify({ schemaVersion: 1, exitStatus, submission: scenario === 'limits' ? '' : 'done', providerWaitSeconds: 0 }));
process.exit(exitStatus === 'Submitted' ? 0 : 1);
`;
  await writeFile(scriptPath, code);
  await chmod(scriptPath, 0o755);
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

test('real executor with canary-only workspace succeeds without strict fixture files', async t => {
  const output = await mkdtemp(join(tmpdir(), 'baseline-canary-real-'));
  t.after(() => rm(output, { recursive: true, force: true }));
  process.env.NVIDIA_API_KEY ??= 'canary-test-credential';
  const profile = await testProfile();
  const driverPath = join(output, 'fake-driver.mjs');
  await writeFakeDriver(driverPath, 'submitted');
  const canaryProfile = { ...profile, pythonExecutable: driverPath };
  const attemptDir = join(output, 'probe-attempt');
  const candidateDir = join(attemptDir, 'candidate');
  await mkdir(candidateDir, { recursive: true });
  await writeFile(join(candidateDir, 'nonce.txt'), 'abc123\n');
  await mkdir(join(output, 'executions', 'CANARY:AUX'), { recursive: true });
  const attempt = await executeMiniAttempt({ profile: canaryProfile, task: { taskId: 'CANARY-AUX', prompt: 'probe' },
    output, executionId: 'CANARY:AUX', attemptId: 'CANARY:AUX:attempt-1', candidateDir, attemptDir,
    resourceContext: { journalPath: join(output, 'events.jsonl') }, workspaceKind: 'canary' });
  // Strict fixture digest cannot cover this workspace (ENOENT or unexpected);
  // canary digest must succeed. This is the production bug: the old code called
  // the strict digest here and threw ENOENT, losing the driver result.
  await assert.rejects(() => candidateDigest(candidateDir), /invalid candidate file|unexpected|ENOENT|no such file/);
  assert.ok(attempt.candidateDigest);
  assert.equal(attempt.candidateDigestError, null);
  assert.equal(attempt.driverResult.exitStatus, 'Submitted');
  assert.ok(Number.isFinite(attempt.timing.activeMs));
  const marker = await readFile(join(candidateDir, 'marker.txt'), 'utf8');
  assert.match(marker.trim(), /^CANARY-MARKER-/);
  const recomputed = await canaryDigest(candidateDir);
  assert.equal(attempt.candidateDigest, recomputed);
});

test('runCanary with real executor preserves Submitted and passes audit', async t => {
  const output = await mkdtemp(join(tmpdir(), 'baseline-canary-real-pass-'));
  t.after(() => rm(output, { recursive: true, force: true }));
  process.env.NVIDIA_API_KEY ??= 'canary-test-credential';
  const profile = await testProfile();
  const driverPath = join(output, 'fake-driver.mjs');
  await writeFakeDriver(driverPath, 'submitted');
  const realProfile = { ...profile, pythonExecutable: driverPath };
  const result = await runCanary({ profile: realProfile, output, executor: async args => executeMiniAttempt({ ...args, workspaceKind: 'canary' }) });
  assert.equal(result.status, 'PASS');
  const artifact = JSON.parse(await readFile(join(output, 'canary', 'canary.json'), 'utf8'));
  assert.equal(artifact.driverExitStatus, 'Submitted');
  assert.equal(artifact.exitStatus, 'Submitted');
  assert.equal(artifact.submissionObserved, true);
  assert.equal(artifact.markerVerified, true);
  assert.equal(artifact.usageSettled, true);
  assert.equal(artifact.captureError, null);
  assert.ok(Number.isFinite(artifact.activeMs));
  assert.ok(artifact.canaryDigest);
  assert.equal(artifact.failureReason, null);
  assert.equal((await auditCanary({ output, profile: realProfile })).status, 'PASS');
});

test('LimitsExceeded is preserved as driver evidence and stays FAIL per current gate', async t => {
  const output = await mkdtemp(join(tmpdir(), 'baseline-canary-limits-'));
  t.after(() => rm(output, { recursive: true, force: true }));
  process.env.NVIDIA_API_KEY ??= 'canary-test-credential';
  const profile = await testProfile();
  const result = await runCanary({ profile, output, executor: stubExecutor({ exitStatus: 'LimitsExceeded' }) });
  assert.equal(result.status, 'FAIL');
  const artifact = JSON.parse(await readFile(join(output, 'canary', 'canary.json'), 'utf8'));
  assert.equal(artifact.driverExitStatus, 'LimitsExceeded');
  assert.equal(artifact.exitStatus, 'LimitsExceeded');
  assert.equal(artifact.submissionObserved, false);
  assert.equal(artifact.markerVerified, true);
  assert.ok(artifact.failureReasons.includes('MISSING_SUBMISSION'));
  assert.ok(Number.isFinite(artifact.activeMs));
  // Audit must reproduce the same FAIL, not rewrite it as model FAILED.
  assert.equal((await auditCanary({ output, profile })).status, 'FAIL');
  const filed = JSON.parse(await readFile(join(output, 'canary', 'attempt-1', 'driver-result.json'), 'utf8'));
  assert.equal(filed.exitStatus, 'LimitsExceeded');
});

test('digest capture error preserves driver evidence and timing', async t => {
  const output = await mkdtemp(join(tmpdir(), 'baseline-canary-capture-'));
  t.after(() => rm(output, { recursive: true, force: true }));
  process.env.NVIDIA_API_KEY ??= 'canary-test-credential';
  const profile = await testProfile();
  const throwing = async ({ candidateDir, attemptDir, output: out, executionId }) => {
    const inner = stubExecutor({ exitStatus: 'Submitted' });
    const attempt = await inner({ candidateDir, attemptDir, output: out, executionId });
    await writeFile(join(candidateDir, 'extra.txt'), 'unexpected\n');
    return { ...attempt, candidateDigestError: 'canary workspace contains unexpected file: extra.txt' };
  };
  // Simulate runCanary capture path: workspace has extra file so canaryDigest fails,
  // but driver evidence (Submitted) and timing must survive.
  const result = await runCanary({ profile, output, executor: async args => {
    const attempt = await throwing(args);
    return attempt;
  } });
  // runCanary recomputes canaryDigest independently and records captureError;
  // driver Submitted is preserved even though workspace digest fails.
  const artifact = JSON.parse(await readFile(join(output, 'canary', 'canary.json'), 'utf8'));
  assert.equal(artifact.driverExitStatus, 'Submitted');
  assert.ok(artifact.captureError);
  assert.ok(Number.isFinite(artifact.activeMs));
  assert.equal(artifact.status, 'FAIL');
  assert.ok(artifact.failureReasons.includes('CAPTURE_ERROR'));
});

test('tampered exit status or timing with recomputed digest is detected', async t => {
  const output = await mkdtemp(join(tmpdir(), 'baseline-canary-tamper-exit-'));
  t.after(() => rm(output, { recursive: true, force: true }));
  process.env.NVIDIA_API_KEY ??= 'canary-test-credential';
  const profile = await testProfile();
  await runCanary({ profile, output, executor: stubExecutor({ exitStatus: 'Submitted' }) });
  const path = join(output, 'canary', 'canary.json');
  const artifact = JSON.parse(await readFile(path, 'utf8'));
  // Tamper exit status and recompute digest: audit must compare to driver file.
  const tamperedExit = { ...artifact, driverExitStatus: 'FAILED', exitStatus: 'FAILED', digest: undefined };
  delete tamperedExit.digest;
  tamperedExit.digest = `sha256:${sha256(Object.fromEntries(Object.entries(tamperedExit).filter(([k]) => k !== 'digest')))}`;
  await writeFile(path, JSON.stringify(tamperedExit, null, 2));
  await assert.rejects(() => auditCanary({ output, profile }), /driver exit status differs/);
  await writeFile(path, JSON.stringify(artifact, null, 2));
  // Tamper timing and recompute digest: audit must compare to journal.
  const tamperedTime = { ...artifact, activeMs: (artifact.activeMs ?? 1000) + 5000, digest: undefined };
  delete tamperedTime.digest;
  tamperedTime.digest = `sha256:${sha256(Object.fromEntries(Object.entries(tamperedTime).filter(([k]) => k !== 'digest')))}`;
  await writeFile(path, JSON.stringify(tamperedTime, null, 2));
  await assert.rejects(() => auditCanary({ output, profile }), /timing differs|failure reason/);
});

test('missing native tool call, truncation, UNKNOWN and submission have distinct reasons', async t => {
  process.env.NVIDIA_API_KEY ??= 'canary-test-credential';
  assert.equal(inspectCanaryNative(trajectoryWithNative({ native: 'missing' })).missingNativeToolCall, true);
  assert.equal(inspectCanaryNative(trajectoryWithNative({ native: 'truncated' })).truncatedResponse, true);
  assert.equal(inspectCanaryNative(trajectoryWithNative({ native: 'ok' })).missingNativeToolCall, false);
  for (const [label, options, reason] of [
    ['no-native', { native: 'missing' }, 'NO_NATIVE_TOOL_CALL'],
    ['truncated', { native: 'truncated' }, 'OUTPUT_TRUNCATED'],
    ['unknown', { ledger: 'unknown' }, 'UNKNOWN_USAGE'],
    ['no-submit', { exitStatus: 'LimitsExceeded' }, 'MISSING_SUBMISSION']
  ]) {
    const output = await mkdtemp(join(tmpdir(), `baseline-canary-reason-${label}-`));
    try {
      const profile = await testProfile();
      const result = await runCanary({ profile, output, executor: stubExecutor(options) });
      const artifact = JSON.parse(await readFile(join(output, 'canary', 'canary.json'), 'utf8'));
      if (label === 'unknown') {
        assert.equal(result.status, 'UNRESOLVED');
        assert.equal(artifact.failureReason, reason);
      } else {
        assert.equal(result.status, 'FAIL', label);
        assert.ok(artifact.failureReasons.includes(reason), `${label}: ${artifact.failureReasons}`);
      }
    } finally { await rm(output, { recursive: true, force: true }); }
  }
});

test('strict request-tracker verifier is not loosened by canary digest', async t => {
  const root = await mkdtemp(join(tmpdir(), 'baseline-canary-strict-'));
  try {
    const canaryOnly = join(root, 'canary-only');
    await mkdir(canaryOnly, { recursive: true });
    await writeFile(join(canaryOnly, 'nonce.txt'), 'x\n');
    await writeFile(join(canaryOnly, 'marker.txt'), 'CANARY-MARKER-x\n');
    await assert.rejects(() => candidateDigest(canaryOnly), /invalid candidate file|unexpected|ENOENT|no such file/);
    assert.ok(await canaryDigest(canaryOnly));
    const { copyFile } = await import('node:fs/promises');
    const fixtureOnly = join(root, 'fixture-only');
    await mkdir(fixtureOnly, { recursive: true });
    for (const name of ['server.mjs', 'index.html', 'client.js', 'smoke.mjs']) {
      await copyFile(resolve('scripts/delivery/baseline/fixture', name), join(fixtureOnly, name));
    }
    assert.ok(await candidateDigest(fixtureOnly));
    await assert.rejects(() => canaryDigest(resolve('scripts/delivery/baseline/fixture')), /unexpected file/);
    // Symlink rejection for canary workspace.
    const linkDir = join(root, 'link');
    await mkdir(linkDir, { recursive: true });
    await writeFile(join(root, 'real-nonce.txt'), 'y\n');
    const { symlink } = await import('node:fs/promises');
    try {
      await symlink(join(root, 'real-nonce.txt'), join(linkDir, 'nonce.txt'));
      await assert.rejects(() => canaryDigest(linkDir), /invalid canary file/);
    } catch (error) {
      if (!String(error?.message ?? '').includes('invalid canary file')) throw error;
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
