import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { open, readFile, writeFile, mkdir, mkdtemp, copyFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CALIBRATION_TASK_IDS, MINI_COMMIT, NODE_VERSION, PLAYWRIGHT_VERSION, PROTOCOL_HASH, canonical, fixtureIdentities, registrationManifest, sha256, validateProfile } from './contract.mjs';
import { candidateDigest, verifyCandidate } from './fixture/acceptance.mjs';
import { reportDirectory } from './report.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const fixture = join(root, 'fixture');
const fail = (message, code = 2) => { const error = new Error(`BASELINE_RUN_INVALID: ${message}`); error.exitCode = code; throw error; };
const option = (args, name) => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
const now = () => new Date().toISOString();
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const plainJson = path => readFile(path, 'utf8').then(JSON.parse);
async function jsonIfExists(path) { try { return await plainJson(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
async function jsonLinesIfExists(path) { try { return (await readFile(path, 'utf8')).split(/\r?\n/).filter(Boolean).map(JSON.parse); } catch (error) { if (error.code === 'ENOENT') return []; throw error; } }
const digestFile = async path => `sha256:${createHash('sha256').update(await readFile(path)).digest('hex')}`;

async function writeOnce(path, value) {
  const body = JSON.stringify(value, null, 2) + '\n';
  try {
    const file = await open(path, 'wx');
    try { await file.writeFile(body); await file.sync(); } finally { await file.close(); }
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (await readFile(path, 'utf8') !== body) fail(`immutable registration changed: ${path}`);
  }
}
async function writeAtomic(path, value) {
  const temp = `${path}.${process.pid}.tmp`;
  const file = await open(temp, 'w');
  try { await file.writeFile(JSON.stringify(value, null, 2) + '\n'); await file.sync(); }
  finally { await file.close(); }
  const { rename } = await import('node:fs/promises');
  await rename(temp, path);
}
async function append(path, value) {
  const file = await open(path, 'a');
  try { await file.writeFile(JSON.stringify(value) + '\n'); await file.sync(); } finally { await file.close(); }
}
async function copyCandidate(destination) {
  await mkdir(destination, { recursive: true });
  for (const name of ['server.mjs', 'index.html', 'client.js']) await copyFile(join(fixture, name), join(destination, name));
  return candidateDigest(destination);
}
function ensureGitCandidate(profile) {
  if (git('rev-parse', 'HEAD') !== profile.candidateSha || git('rev-parse', 'HEAD^{tree}') !== profile.candidateTree)
    fail('profile candidate commit/tree differs from checkout');
}
async function preflight(profile, identities, { credential = false } = {}) {
  const registration = validateProfile(profile, { ...identities, requireLive: credential, requirePilot: false });
  ensureGitCandidate(profile);
  if (process.version.slice(1) !== NODE_VERSION) fail(`Node ${NODE_VERSION} required for LIVE; found ${process.version}`, 3);
  const packageJson = await plainJson(join(root, 'package.json'));
  if (packageJson.dependencies?.playwright !== PLAYWRIGHT_VERSION) fail('Playwright package is not pinned', 3);
  if (await digestFile(join(root, 'requirements.lock')) !== profile.pythonLockDigest) fail('Python dependency lock mismatch', 3);
  try {
    const script = "import json,sys,importlib.metadata as m; d=json.loads(m.distribution('mini-swe-agent').read_text('direct_url.json')); print(json.dumps({'version':'.'.join(map(str,sys.version_info[:3])),'commit':d['vcs_info']['commit_id']}))";
    const installed = JSON.parse(execFileSync(profile.pythonExecutable, ['-c', script], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
    if (installed.version !== profile.pythonVersion || installed.commit !== MINI_COMMIT) fail('installed Python/mini-SWE-agent identity mismatch', 3);
  } catch (error) { if (error.exitCode) throw error; fail('pinned Python runtime is unavailable', 3); }
  if (!(await readFile(join(root, 'Dockerfile'), 'utf8')).includes(`@${profile.nodeImageDigest}`)) fail('Node base image digest mismatch', 3);
  const { chromium } = await import('playwright');
  if (await digestFile(chromium.executablePath()) !== profile.browserDigest) fail('Chromium executable digest mismatch', 3);
  try {
    const image = JSON.parse(execFileSync('docker', ['image', 'inspect', profile.agentImageDigest], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
    if (!image?.[0]?.RepoDigests?.some(value => value.endsWith(`@${profile.agentImageDigest}`))) fail('agent image digest mismatch', 3);
  } catch (error) { if (error.exitCode) throw error; fail('pinned Docker image is unavailable', 3); }
  return registration;
}

async function runChild(command, args, { cwd, timeoutMs, env }) {
  const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let stdout = '', stderr = '', timedOut = false;
  child.stdout.on('data', chunk => { stdout = (stdout + chunk.toString()).slice(-65536); });
  child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-65536); });
  const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
  let code;
  try { code = await new Promise((resolveCode, reject) => { child.once('exit', resolveCode); child.once('error', reject); }); }
  finally { clearTimeout(timer); }
  return { code, timedOut, stdout, stderr };
}
function ownedContainers(attemptId) {
  try { return execFileSync('docker', ['ps', '-aq', '--filter', `label=exharness-attempt=${attemptId}`], { encoding: 'utf8' }).trim().split(/\s+/).filter(Boolean); }
  catch { return []; }
}
function cleanupContainers(attemptId) {
  for (const id of ownedContainers(attemptId))
    execFileSync('docker', ['rm', '-f', id], { stdio: 'ignore' });
}
async function ledgerUsage(path, taskId) {
  const rows = (await readFile(path, 'utf8')).split(/\r?\n/).filter(Boolean).map(JSON.parse);
  const reservations = new Map(), final = new Map();
  for (const row of rows) {
    if (row.kind === 'RESERVE') {
      if (reservations.has(row.requestId)) fail('duplicate provider reservation');
      reservations.set(row.requestId, row);
    } else if (['SETTLED', 'UNKNOWN'].includes(row.kind)) {
      if (!reservations.has(row.requestId) || final.has(row.requestId)) fail('invalid provider settlement');
      final.set(row.requestId, row);
    } else fail('unknown provider ledger event');
  }
  return [...reservations.keys()].map(id => {
    const outcome = final.get(id);
    return { schemaVersion: 1, taskId, attemptId: reservations.get(id).attemptId, requestId: id, providerRequestId: outcome?.providerRequestId ?? null,
      status: outcome?.kind === 'SETTLED' ? 'SETTLED' : 'UNKNOWN', inputTokens: outcome?.inputTokens ?? null,
      cachedInputTokens: outcome?.cachedInputTokens ?? null,
      outputTokens: outcome?.outputTokens ?? null, costUsd: outcome?.costUsd ?? null };
  });
}

async function live(profile, identities, output) {
  await preflight(profile, identities, { credential: true });
  await mkdir(output, { recursive: true });
  const registration = registrationManifest(profile, identities, { calibration: true });
  const proposedBody = {
    ...Object.fromEntries(Object.entries(registration).filter(([key]) => key !== 'digest')),
    evidenceClass: 'LIVE',
    tasks: CALIBRATION_TASK_IDS.map(taskId => ({ taskId, arm: 'DIRECT', registeredStart: now(),
      infrastructureUsd: null, evaluatorUsd: null, setupAllocationUsd: null }))
  };
  const priorManifest = await jsonIfExists(join(output, 'manifest.json'));
  const manifest = priorManifest ?? { ...proposedBody, digest: `sha256:${sha256(proposedBody)}` };
  const manifestBody = Object.fromEntries(Object.entries(manifest).filter(([key]) => key !== 'digest'));
  if (manifest.digest !== `sha256:${sha256(manifestBody)}` || manifest.profileHash !== registration.profileHash ||
      manifest.candidateSha !== profile.candidateSha || canonical(manifest.calibrationTaskIds) !== canonical(CALIBRATION_TASK_IDS))
    fail('existing registration is stale or edited');
  if (!priorManifest) await writeOnce(join(output, 'manifest.json'), manifest);
  const taskList = (await plainJson(join(fixture, 'tasks.json'))).tasks;
  const frozenVerifierDigest = await digestFile(join(fixture, 'acceptance.mjs'));
  const negativeDir = join(output, 'negative-candidate');
  const negativeDigest = await copyCandidate(negativeDir);
  const negative = await verifyCandidate({ candidateDir: negativeDir, fault: 'NORM-01', browser: true });
  if (negative.status !== 'REJECTED') fail('seeded producer-success negative was not rejected', 4);
  const producerDouble = await runChild(process.execPath, ['-e', 'process.exit(0)'], { cwd: negativeDir, timeoutMs: 3000, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot } });
  if (producerDouble.code !== 0 || producerDouble.timedOut) fail('deterministic producer exit double failed', 4);
  await writeOnce(join(output, 'negative-verification.json'), { evidenceClass: 'DETERMINISTIC_NEGATIVE_CONTROL',
    producerKind: 'EXIT_ZERO_DOUBLE', producerCommand: 'node -e process.exit(0)', producerExitCode: producerDouble.code,
    candidateDigest: negativeDigest, verifierDigest: frozenVerifierDigest, ...negative });
  for (const taskId of CALIBRATION_TASK_IDS) {
    const task = taskList.find(item => item.id === taskId);
    if (!task) fail(`missing calibration task ${taskId}`);
    const taskOutput = join(output, taskId);
    await mkdir(taskOutput, { recursive: true });
    const events = (await jsonLinesIfExists(join(output, 'attempt-events.jsonl'))).filter(item => item.taskId === taskId);
    const completed = (await jsonLinesIfExists(join(output, 'attempts.jsonl'))).filter(item => item.taskId === taskId);
    const registered = events.filter(item => item.kind === 'REGISTERED');
    for (const prior of registered.filter(item => !completed.some(done => done.attemptId === item.attemptId))) {
      const priorUsage = await ledgerUsage(join(taskOutput, 'provider-ledger.jsonl'), taskId).catch(error => {
        if (error.code === 'ENOENT') return [];
        throw error;
      });
      const interrupted = { schemaVersion: 1, experimentId: profile.experimentId, taskId, arm: 'DIRECT', attemptId: prior.attemptId,
        attemptNumber: prior.attemptNumber, status: 'TIMED_OUT', terminalTimestamp: now(), candidateDigest: null,
        verification: { status: 'INCONCLUSIVE', candidateDigest: null }, producerExitStatus: 'INTERRUPTED',
        providerDispatched: priorUsage.some(row => row.attemptId === prior.attemptId) };
      await append(join(output, 'attempts.jsonl'), interrupted);
      await append(join(output, 'attempt-events.jsonl'), { schemaVersion: 1, kind: 'RECOVERED_UNKNOWN', experimentId: profile.experimentId,
        taskId, arm: 'DIRECT', attemptId: prior.attemptId, sequence: 2, timestamp: interrupted.terminalTimestamp });
      completed.push(interrupted);
    }
    if (completed.some(item => item.status !== 'TIMED_OUT' || item.producerExitStatus !== 'INTERRUPTED')) continue;
    const attemptNumber = registered.length + 1;
    if (attemptNumber > profile.budgets.maxAttemptsPerTask) continue;
    const attemptOutput = join(taskOutput, `attempt-${attemptNumber}`);
    const candidateDir = join(attemptOutput, 'candidate');
    const resetDigest = await copyCandidate(candidateDir);
    const attemptId = `${profile.experimentId}-${taskId}-${attemptNumber}`;
    await append(join(output, 'attempt-events.jsonl'), { schemaVersion: 1, kind: 'REGISTERED', experimentId: profile.experimentId, taskId, arm: 'DIRECT', attemptId, attemptNumber, sequence: 1, timestamp: now(), resetDigest });
    const config = { profile, taskId, attemptId, taskPrompt: task.prompt, candidateDir, ledgerPath: join(taskOutput, 'provider-ledger.jsonl'),
      trajectoryPath: join(attemptOutput, 'trajectory.json'), resultPath: join(attemptOutput, 'driver-result.json') };
    await writeOnce(join(attemptOutput, 'driver-config.json'), config);
    let child;
    try {
      const python = profile.pythonExecutable;
      if (!python) fail('pinned Python executable required', 3);
      child = await runChild(python, [join(root, 'mini_driver.py'), join(attemptOutput, 'driver-config.json')], {
        cwd: root, timeoutMs: profile.budgets.maxWallSeconds * 1000,
        env: { ...process.env, MSWEA_MODEL_RETRY_STOP_AFTER_ATTEMPT: '1' }
      });
    } finally { cleanupContainers(attemptId); }
    const driverResult = await plainJson(join(attemptOutput, 'driver-result.json')).catch(() => ({ exitStatus: child?.timedOut ? 'TIMED_OUT' : 'FAILED' }));
    const candidateHash = await candidateDigest(candidateDir);
    const verification = await verifyCandidate({ candidateDir, fault: task.fault, browser: true, screenshotPath: join(attemptOutput, 'screenshot.png') });
    const verifierAfter = await digestFile(join(fixture, 'acceptance.mjs'));
    if (verifierAfter !== frozenVerifierDigest) fail('trusted acceptance suite changed during LIVE');
    await writeOnce(join(attemptOutput, 'candidate.json'), { schemaVersion: 1, taskId, attemptId, baseDigest: resetDigest, candidateDigest: candidateHash, sourceCommit: profile.candidateSha });
    await writeOnce(join(attemptOutput, 'verification.json'), { ...verification, verifierDigest: frozenVerifierDigest, independent: true, taskId, attemptId });
    const rawUsage = await ledgerUsage(join(taskOutput, 'provider-ledger.jsonl'), taskId).catch(error => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    const recordedUsage = new Set((await jsonLinesIfExists(join(output, 'usage.jsonl'))).map(row => row.requestId));
    for (const row of rawUsage) if (!recordedUsage.has(row.requestId)) await append(join(output, 'usage.jsonl'), row);
    const status = child.timedOut ? 'TIMED_OUT' : child.code === 0 ? (verification.status === 'ACCEPTED' ? 'ACCEPTED' : verification.status === 'REJECTED' ? 'REJECTED' : 'INCONCLUSIVE') : 'FAILED';
    const attempt = { schemaVersion: 1, experimentId: profile.experimentId, taskId, arm: 'DIRECT', attemptId, attemptNumber,
      status, terminalTimestamp: now(), candidateDigest: candidateHash, verification: { status: verification.status, candidateDigest: verification.candidateDigest },
      producerExitStatus: driverResult.exitStatus, providerDispatched: rawUsage.some(row => row.attemptId === attemptId) };
    await append(join(output, 'attempts.jsonl'), attempt);
    await append(join(output, 'attempt-events.jsonl'), { schemaVersion: 1, kind: 'TERMINAL', experimentId: profile.experimentId, taskId, arm: 'DIRECT', attemptId, sequence: 2, timestamp: attempt.terminalTimestamp, status });
  }
  await writeAtomic(join(output, 'observation.json'), { asOf: now(), evidenceClass: 'LIVE' });
  const report = await reportDirectory(output);
  await writeAtomic(join(output, 'report.json'), report);
  return { mode: 'live', tasks: report.tasks.length, valueVerdict: report.valueVerdict };
}

async function auditLive(profile, identities, output) {
  validateProfile(profile, { ...identities, requirePilot: false });
  ensureGitCandidate(profile);
  const manifest = await plainJson(join(output, 'manifest.json'));
  const body = Object.fromEntries(Object.entries(manifest).filter(([key]) => key !== 'digest'));
  if (manifest.evidenceClass !== 'LIVE' || manifest.registrationKind !== 'CALIBRATION' || manifest.digest !== `sha256:${sha256(body)}` || manifest.candidateSha !== profile.candidateSha ||
      manifest.candidateTree !== profile.candidateTree || manifest.profileHash !== sha256(profile) ||
      canonical(manifest.tasks.map(task => task.taskId)) !== canonical(CALIBRATION_TASK_IDS)) fail('stale or synthetic live manifest');
  const negative = await plainJson(join(output, 'negative-verification.json'));
  const frozenVerifierDigest = await digestFile(join(fixture, 'acceptance.mjs'));
  if (negative.status !== 'REJECTED' || negative.evidenceClass !== 'DETERMINISTIC_NEGATIVE_CONTROL' ||
      negative.producerKind !== 'EXIT_ZERO_DOUBLE' || negative.producerExitCode !== 0 ||
      negative.verifierDigest !== frozenVerifierDigest) fail('independent seeded rejection missing');
  const negativeRecheck = await verifyCandidate({ candidateDir: join(output, 'negative-candidate'), fault: 'NORM-01', browser: true });
  if (negativeRecheck.status !== 'REJECTED' || negativeRecheck.candidateDigest !== negative.candidateDigest) fail('seeded defect is not reproducibly rejected');
  const attempts = (await readFile(join(output, 'attempts.jsonl'), 'utf8')).split(/\r?\n/).filter(Boolean).map(JSON.parse);
  const usage = (await readFile(join(output, 'usage.jsonl'), 'utf8')).split(/\r?\n/).filter(Boolean).map(JSON.parse);
  const providerExport = (await readFile(join(output, 'provider-export.jsonl'), 'utf8')).split(/\r?\n/).filter(Boolean).map(JSON.parse);
  if (attempts.length < 3 || !CALIBRATION_TASK_IDS.every(id => attempts.some(item => item.taskId === id)) ||
      !CALIBRATION_TASK_IDS.every(id => usage.some(item => item.taskId === id && item.providerRequestId))) fail('three independently reset provider runs missing');
  const exported = new Map();
  for (const record of providerExport) {
    if (record.evidenceClass !== 'PROVIDER_EXPORT' || record.exportedBy !== profile.operatorId ||
        record.retrievalMethod !== 'OPENAI_CHAT_COMPLETIONS_GET' ||
        record.sourceRef !== `${profile.model.apiBaseUrl}/chat/completions/${encodeURIComponent(record.providerRequestId)}` || !record.providerRequestId ||
        !record.rawRecordRef?.startsWith('provider-records/') || record.rawRecordRef.includes('..') || record.rawRecordRef.includes('\\') ||
        !record.retrievedAt || exported.has(record.providerRequestId)) fail('invalid independent provider export');
    if (await digestFile(join(output, record.rawRecordRef)) !== record.rawRecordHash) fail('provider raw record digest mismatch');
    const raw = await plainJson(join(output, record.rawRecordRef));
    if (raw.id !== record.providerRequestId || raw.model !== profile.model.snapshot || raw.service_tier !== 'default' ||
        raw.usage?.prompt_tokens !== record.inputTokens || raw.usage?.completion_tokens !== record.outputTokens ||
        (raw.usage?.prompt_tokens_details?.cached_tokens ?? 0) !== record.cachedInputTokens)
      fail('provider export/raw mismatch');
    exported.set(record.providerRequestId, record);
  }
  for (const request of usage.filter(item => item.status === 'SETTLED')) {
    const independent = exported.get(request.providerRequestId);
    if (!independent || independent.inputTokens !== request.inputTokens || independent.cachedInputTokens !== request.cachedInputTokens ||
        independent.outputTokens !== request.outputTokens ||
        independent.costUsd !== request.costUsd) fail('provider usage lacks matching independent export');
  }
  for (const taskId of CALIBRATION_TASK_IDS) {
    const taskAttempts = attempts.filter(item => item.taskId === taskId).sort((a, b) => a.attemptNumber - b.attemptNumber);
    const latest = taskAttempts.at(-1);
    const attemptOutput = join(output, taskId, `attempt-${latest.attemptNumber}`);
    const candidate = await plainJson(join(attemptOutput, 'candidate.json'));
    const verification = await plainJson(join(attemptOutput, 'verification.json'));
    if (candidate.sourceCommit !== profile.candidateSha || candidate.baseDigest !== negative.candidateDigest ||
        verification.independent !== true || verification.candidateDigest !== candidate.candidateDigest ||
        verification.verifierDigest !== frozenVerifierDigest) fail('candidate/verifier identity mismatch');
    const recheck = await verifyCandidate({ candidateDir: join(attemptOutput, 'candidate'), fault: taskId, browser: true });
    if (recheck.status !== verification.status || recheck.candidateDigest !== candidate.candidateDigest) fail('independent verification is not reproducible');
    const ledger = await ledgerUsage(join(output, taskId, 'provider-ledger.jsonl'), taskId);
    if (canonical(ledger) !== canonical(usage.filter(item => item.taskId === taskId))) fail('provider ledger/usage mismatch');
  }
  const report = await reportDirectory(output);
  if (canonical(report) !== canonical(await plainJson(join(output, 'report.json')))) fail('report is stale');
  return { mode: 'audit-live', tasks: attempts.length, valueVerdict: report.valueVerdict,
    evidenceClass: 'LIVE', providerExportActor: profile.operatorId, reviewerAction: 'NOT_CLAIMED' };
}

async function deterministic(output) {
  await mkdir(output, { recursive: true });
  const candidateDir = join(output, 'candidate');
  await copyCandidate(candidateDir);
  const positive = await verifyCandidate({ candidateDir, fault: 'NONE', browser: true });
  const negative = await verifyCandidate({ candidateDir, fault: 'NORM-01', browser: false });
  const result = { schemaVersion: 1, evidenceClass: 'DETERMINISTIC', productionEvidence: false, positive, negative };
  await writeOnce(join(output, 'deterministic.json'), result);
  return { mode: 'deterministic', positive: positive.status, negative: negative.status };
}

export async function main(args = process.argv.slice(2)) {
  const mode = option(args, '--mode'), output = option(args, '--output'), profilePath = option(args, '--profile');
  const registration = option(args, '--registration') ?? 'pilot';
  if (!['validate', 'deterministic', 'live', 'audit-live'].includes(mode)) fail('unknown mode');
  if (!['pilot', 'calibration'].includes(registration)) fail('unknown registration kind');
  if ((mode !== 'validate' && !output) || (mode !== 'deterministic' && !profilePath)) fail('profile/output required');
  const identities = await fixtureIdentities();
  const profile = profilePath ? await plainJson(resolve(profilePath)) : null;
  if (mode === 'validate') return { mode, registration, ...validateProfile(profile, { ...identities, requirePilot: registration === 'pilot' }) };
  if (mode === 'deterministic') return deterministic(resolve(output));
  if (mode === 'live') return live(profile, identities, resolve(output));
  return auditLive(profile, identities, resolve(output));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await main())); }
  catch (error) { console.error(error.message); process.exitCode = error.exitCode ?? 4; }
}
