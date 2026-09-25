import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, copyFile, rm, open } from 'node:fs/promises';
import { dirname } from 'node:path';
import { join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyCandidate, candidateDigest } from './fixture/acceptance.mjs';
import { canonical, fixtureIdentities, validateProfile, sha256 } from './contract.mjs';
import { calculateStudyReport } from './report.mjs';
import { ResourceState, foldResourceJournal, readResourceJournal, writeAtomicJson, writeResourceSnapshot, resourceExitCode, nextEligibleAt, parseRetryAfter } from './resource-state.mjs';
import { createCoreArm } from './core-arm.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const fixture = join(root, 'fixture');
const protocolPath = join(root, 'value-protocol.json');
const fail = (message, code = 2) => { const error = new Error(`BASELINE_STUDY_INVALID: ${message}`); error.exitCode = code; throw error; };
const option = (args, name) => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
const nowIso = () => new Date().toISOString();
const plainJson = path => readFile(path, 'utf8').then(JSON.parse);
const jsonLines = async path => { try { return (await readFile(path, 'utf8')).split(/\r?\n/).filter(Boolean).map(JSON.parse); } catch (error) { if (error.code === 'ENOENT') return []; throw error; } };
const writeOnce = async (path, value) => {
  const body = JSON.stringify(value, null, 2) + '\n';
  try {
    const handle = await open(path, 'wx');
    try { await handle.writeFile(body); await handle.sync(); } finally { await handle.close(); }
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (await readFile(path, 'utf8') !== body) fail(`immutable file changed: ${path}`);
  }
};
const appendJsonl = async (path, value) => {
  await mkdir(dirname(path), { recursive: true });
  const handle = await open(path, 'a');
  try { await handle.writeFile(JSON.stringify(value) + '\n'); await handle.sync(); } finally { await handle.close(); }
};
const digestFile = async path => `sha256:${createHash('sha256').update(await readFile(path)).digest('hex')}`;
const git = (...args) => execFileSync('git', args, { cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

let protocolCache;
async function protocol() { return protocolCache ??= await plainJson(protocolPath); }

async function copyCandidate(destination) {
  await mkdir(destination, { recursive: true });
  for (const name of ['server.mjs', 'index.html', 'client.js', 'smoke.mjs']) await copyFile(join(fixture, name), join(destination, name));
  return candidateDigest(destination);
}

function ensureCandidate(profile) {
  if (git('rev-parse', 'HEAD') !== profile.candidateSha || git('rev-parse', 'HEAD^{tree}') !== profile.candidateTree)
    fail('profile candidate commit/tree differs from checkout', 3);
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

function cleanupContainers(attemptId) {
  try {
    const ids = execFileSync('docker', ['ps', '-aq', '--filter', `label=exharness-attempt=${attemptId}`], { encoding: 'utf8' }).trim().split(/\s+/).filter(Boolean);
    for (const id of ids) execFileSync('docker', ['rm', '-f', id], { stdio: 'ignore' });
  } catch { /* cleanup facts are recorded by the caller when Docker is unavailable */ }
}

async function providerFacts(ledgerPath) {
  const rows = await jsonLines(ledgerPath);
  const settled = rows.filter(row => row.kind === 'SETTLED');
  const unknown = rows.some(row => row.kind === 'UNKNOWN');
  return {
    wireRequests: rows.filter(row => row.kind === 'RESERVE').length,
    inputTokens: unknown ? null : settled.reduce((sum, row) => sum + Number(row.inputTokens ?? 0), 0),
    outputTokens: unknown ? null : settled.reduce((sum, row) => sum + Number(row.outputTokens ?? 0), 0),
    cachedTokens: unknown ? null : settled.every(row => row.cachedInputTokens != null) ? settled.reduce((sum, row) => sum + row.cachedInputTokens, 0) : null,
    apiUsd: unknown ? null : settled.reduce((sum, row) => sum + Number(row.costUsd ?? 0), 0),
    usageUnknown: unknown,
    rows: rows.map(row => ({ kind: row.kind, requestId: row.requestId, attemptId: row.attemptId ?? null, providerRequestId: row.providerRequestId ?? null, status: row.kind === 'SETTLED' ? 'SETTLED' : row.kind === 'NOT_ADMITTED' ? 'NOT_ADMITTED' : 'UNKNOWN', inputTokens: row.inputTokens ?? null, cachedInputTokens: row.cachedInputTokens ?? null, outputTokens: row.outputTokens ?? null, costUsd: row.costUsd ?? null, cacheEvidence: row.cacheEvidence ?? 'NOT_REPORTED', providerEvidenceHash: row.providerEvidenceHash ?? null, retryAfter: row.proof?.retryAfter ?? null, httpStatus: row.proof?.httpStatus ?? null }))
  };
}

export async function executeMiniAttempt({ profile, task, output, executionId, attemptId, candidateDir, attemptDir }) {
  const ledgerPath = join(output, 'executions', executionId, 'provider-ledger.jsonl');
  const config = {
    profile,
    taskId: task.taskId,
    attemptId,
    taskPrompt: task.prompt,
    candidateDir,
    ledgerPath,
    trajectoryPath: join(attemptDir, 'trajectory.json'),
    resultPath: join(attemptDir, 'driver-result.json')
  };
  await writeOnce(join(attemptDir, 'driver-config.json'), config);
  let child;
  const startedAt = Date.now();
  try {
    child = await runChild(profile.pythonExecutable, [join(root, 'mini_driver.py'), join(attemptDir, 'driver-config.json')], {
      cwd: root,
      timeoutMs: profile.budgets.maxWallSeconds * 1000,
      env: { ...process.env, MSWEA_MODEL_RETRY_STOP_AFTER_ATTEMPT: '1' }
    });
  } finally { cleanupContainers(attemptId); }
  const result = await plainJson(join(attemptDir, 'driver-result.json')).catch(() => ({ exitStatus: child?.timedOut ? 'TIMED_OUT' : 'FAILED', error: child?.stderr ?? '' }));
  const digest = await candidateDigest(candidateDir);
  return {
    attemptId,
    candidateDigest: digest,
    candidateRef: relative(output, candidateDir).replaceAll('\\', '/'),
    driverResult: { ...result, processCode: child?.code ?? null, timedOut: child?.timedOut ?? false, stderr: child?.stderr ?? '', stdout: child?.stdout ?? '' },
    provider: await providerFacts(ledgerPath),
    timing: { startedAt: new Date(startedAt).toISOString(), terminalAt: nowIso(), activeMs: Date.now() - startedAt, providerWaitMs: 0 }
  };
}

function studyPairs(value) {
  if (!Array.isArray(value.pairs) || value.pairs.length !== 6) fail('value protocol must contain six pairs');
  return value.pairs.map((pair, pairIndex) => ({ ...pair, orderIndex: pairIndex + 1 }));
}

export function validateStudyManifest(manifest, { protocol: value, profileHash = null, candidateSha = null, candidateTree = null } = {}) {
  if (manifest?.schemaVersion !== 1 || manifest.studyKind !== 'FIXTURE_VALUE_V1' || manifest.registrationKind !== 'STUDY' || manifest.studyId !== value.studyId)
    fail('study manifest identity/schema mismatch');
  const body = Object.fromEntries(Object.entries(manifest).filter(([key]) => key !== 'digest'));
  if (manifest.digest !== `sha256:${sha256(body)}` || manifest.protocolHash !== `sha256:${sha256(value)}` || manifest.valueProtocolHash !== `sha256:${sha256(value)}`)
    fail('study manifest hash/protocol binding mismatch');
  if (profileHash && manifest.profileHash !== profileHash) fail('study profile binding mismatch');
  if (candidateSha && manifest.candidateSha !== candidateSha) fail('study candidate binding mismatch');
  if (candidateTree && manifest.candidateTree !== candidateTree) fail('study candidate tree binding mismatch');
  const pairs = studyPairs(value);
  if (canonical(manifest.pairs) !== canonical(pairs) || !Array.isArray(manifest.tasks) || manifest.tasks.length !== 12)
    fail('study pair/task registration differs from frozen protocol');
  const ids = new Set();
  for (const task of manifest.tasks) {
    if (!task.executionId || ids.has(task.executionId) || !pairs.some(pair => pair.pairId === task.pairId && pair.taskId === task.taskId && pair.repeat === task.repeat && pair.order.includes(task.arm))) fail('invalid or duplicate study execution registration');
    ids.add(task.executionId);
  }
  const expectedTasks = pairs.flatMap(pair => pair.order.map((arm, index) => ({ executionId: `${pair.pairId}:${arm}`, pairId: pair.pairId, taskId: pair.taskId, repeat: pair.repeat, arm, orderIndex: index + 1 })));
  const actualTasks = manifest.tasks.map(({ executionId, pairId, taskId, repeat, arm, orderIndex }) => ({ executionId, pairId, taskId, repeat, arm, orderIndex }));
  if (canonical([...actualTasks].sort((left, right) => left.executionId.localeCompare(right.executionId))) !== canonical([...expectedTasks].sort((left, right) => left.executionId.localeCompare(right.executionId)))) fail('study execution order/identity differs from frozen protocol');
  return true;
}

export async function createStudyManifest({ profile, identities, protocol: value, at = nowIso() }) {
  const checked = validateProfile(profile, { ...identities, requireLive: false, requirePilot: false });
  const pairs = studyPairs(value);
  const tasks = [];
  for (const pair of pairs) for (const [index, arm] of pair.order.entries()) {
    const executionId = `${pair.pairId}:${arm}`;
    tasks.push({ executionId, pairId: pair.pairId, taskId: pair.taskId, repeat: pair.repeat, arm, orderIndex: index + 1, registeredStart: at, infrastructureUsd: null, evaluatorUsd: null, setupAllocationUsd: null });
  }
  const body = {
    schemaVersion: 1,
    studyKind: 'FIXTURE_VALUE_V1',
    studyId: value.studyId,
    registrationKind: 'STUDY',
    evidenceClass: 'LIVE_REGISTRATION',
    protocolHash: `sha256:${sha256(value)}`,
    valueProtocolRef: 'scripts/delivery/baseline/value-protocol.json',
    valueProtocolHash: `sha256:${sha256(value)}`,
    profileHash: checked.profileHash,
    armHash: checked.armHash,
    candidateSha: profile.candidateSha,
    candidateTree: profile.candidateTree,
    fixtureDigest: identities.fixtureDigest,
    acceptanceDigest: identities.acceptanceDigest,
    operatorId: profile.operatorId,
    reviewerId: profile.reviewerId,
    seed: value.seed,
    pairs,
    tasks,
    budgets: value.limits,
    registeredAt: at
  };
  return { ...body, digest: `sha256:${sha256(body)}` };
}

async function loadManifest(output) { return plainJson(join(output, 'manifest.json')); }
async function loadStudyTasks(output) { return (await loadManifest(output)).tasks; }

async function registerStudy({ profile, output }) {
  const identities = await fixtureIdentities();
  const value = await protocol();
  const checked = validateProfile(profile, { ...identities, requireLive: false, requirePilot: false });
  ensureCandidate(profile);
  const manifest = await createStudyManifest({ profile, identities, protocol: value });
  await mkdir(output, { recursive: true });
  const existing = await readFile(join(output, 'manifest.json'), 'utf8').then(JSON.parse).catch(() => null);
  if (existing && canonical(existing) !== canonical(manifest)) fail('study registration is immutable; changed input requires a new cohort');
  validateStudyManifest(manifest, { protocol: value, profileHash: checked.profileHash, candidateSha: profile.candidateSha, candidateTree: profile.candidateTree });
  if (!existing) await writeOnce(join(output, 'manifest.json'), manifest);
  const resource = new ResourceState({ journalPath: join(output, 'events.jsonl'), experimentId: manifest.studyId, profileHash: manifest.profileHash, candidateSha: manifest.candidateSha, candidateTree: manifest.candidateTree, protocolHash: manifest.protocolHash, limits: value.limits });
  for (const task of manifest.tasks) {
    const deadline = new Date(Date.parse(task.registeredStart) + value.limits.maxCohortWallSeconds * 1000).toISOString();
    await resource.registerExecution({ ...task, deadline });
  }
  await writeAtomicJson(join(output, 'registration.json'), { schemaVersion: 1, evidenceClass: 'LIVE_REGISTRATION', manifestRef: 'manifest.json', manifestHash: `sha256:${sha256(manifest)}`, resourceJournalRef: 'events.jsonl' });
  return { mode: 'register', studyId: manifest.studyId, executions: manifest.tasks.length, manifestHash: `sha256:${sha256(manifest)}` };
}

function verificationCounts(verification) {
  const checks = verification?.checks ?? [];
  return { checksPassed: checks.filter(item => item.pass).length, checksTotal: checks.length };
}

async function executeOne({ profile, registeredProfile = profile, output, task, resource, executor = executeMiniAttempt, verify = verifyCandidate, clock = () => new Date() }) {
  const executionDir = join(output, 'executions', task.executionId.replaceAll(':', '__'));
  await mkdir(executionDir, { recursive: true });
  const current = await resource.state();
  const execution = current.executions[task.executionId];
  if (execution?.status === 'COMPLETED' || execution?.status === 'TERMINAL') return null;
  const taskFixture = (await plainJson(join(fixture, 'tasks.json'))).tasks.find(item => item.id === task.taskId);
  if (!taskFixture) fail(`unknown fixture task: ${task.taskId}`);
  const attemptNumber = Math.min((execution?.attempts ?? 0) + 1, 2);
  const attemptId = `${task.executionId}:attempt-${attemptNumber}`;
  await resource.registerAttempt({ executionId: task.executionId, attemptId, attemptNumber });
  const attemptDir = join(executionDir, `attempt-${attemptNumber}`);
  const candidateDir = join(attemptDir, 'candidate');
  const resetDigest = await copyCandidate(candidateDir);
  const startedAt = clock();
  const startedDate = startedAt instanceof Date ? startedAt : new Date(startedAt);
  if (!Number.isFinite(startedDate.getTime())) fail('study clock returned an invalid timestamp');
  const dispatchRequestId = `${attemptId}:provider`;
  let dispatchReservation = null;
  try {
    const inputBound = resource.limits.maxInputTokensPerCall ?? 16384;
    const outputBound = resource.limits.maxOutputTokensPerCall ?? 4096;
    const inputPrice = Number(profile.model?.inputUsdPerMillion ?? 0);
    const cachedPrice = Number(profile.model?.cachedInputUsdPerMillion ?? inputPrice);
    const outputPrice = Number(profile.model?.outputUsdPerMillion ?? 0);
    const reservedCost = (inputBound * Math.max(inputPrice, cachedPrice) + outputBound * outputPrice) / 1_000_000;
    dispatchReservation = await resource.reserve({ executionId: task.executionId, attemptId, requestId: dispatchRequestId, inputTokens: inputBound, outputTokens: outputBound, costUsd: reservedCost });
    await resource.sendStarted({ executionId: task.executionId, attemptId, requestId: dispatchRequestId });
  } catch (error) {
    if (error.code === 'RESOURCE_WAIT') {
      const next = error.nextEligibleAt ? new Date(error.nextEligibleAt) : new Date(startedDate.getTime() + 1000);
      const waitMs = Math.max(1000, next.getTime() - startedDate.getTime());
      await resource.wait({ executionId: task.executionId, nextAt: next, waitMs, reason: error.message });
      error.studyReason = 'WAITING_PROVIDER';
    }
    throw error;
  }
  let common;
  let armResult;
  let verification;
  try {
    const runCommon = async () => executor({ profile, task: taskFixture, output, executionId: task.executionId, attemptId, candidateDir, attemptDir });
    if (task.arm === 'EXHARNESS') {
      const arm = createCoreArm({
        directory: executionDir,
        executionId: task.executionId,
        work: { taskId: task.taskId, pairId: task.pairId, repeat: task.repeat },
        seedCandidate: { id: task.executionId, version: resetDigest },
        executeAttempt: runCommon,
        verifyCandidate: async ({ candidateRef, taskId, fault }) => verify({ candidateDir: resolve(output, candidateRef), fault, browser: true }),
        clock: () => clock().toISOString()
      });
      armResult = await arm.run({ attemptId, taskId: task.taskId, fault: taskFixture.fault, verificationRef: `executions/${task.executionId.replaceAll(':', '__')}/attempt-${attemptNumber}/verification.json` });
      const executorResult = armResult.executor ?? {};
      const terminalClock = clock();
      const terminalDate = terminalClock instanceof Date ? terminalClock : new Date(terminalClock);
      const measuredTiming = executorResult.timing ?? { activeMs: Math.max(0, terminalDate.getTime() - startedDate.getTime()), startedAt: startedDate.toISOString(), terminalAt: terminalDate.toISOString(), providerWaitMs: 0 };
      common = { candidateDigest: armResult.candidateDigest, candidateRef: armResult.candidateRef, provider: executorResult.provider ?? { ...(await providerFacts(join(output, 'executions', task.executionId, 'provider-ledger.jsonl'))) }, timing: measuredTiming, driverResult: executorResult.driverResult ?? null };
      verification = armResult.verification?.details ?? { status: armResult.verification?.status === 'PASS' ? 'ACCEPTED' : armResult.verification?.status === 'FAIL' ? 'REJECTED' : 'INCONCLUSIVE', candidateDigest: armResult.candidateDigest, checks: [] };
    } else {
      common = await runCommon();
      verification = await verify({ candidateDir: resolve(output, common.candidateRef), fault: taskFixture.fault, browser: true });
    }
  } catch (error) {
    if (dispatchReservation) await resource.unknown({ executionId: task.executionId, attemptId, requestId: dispatchRequestId, reason: `executor-${error.name ?? 'error'}` }).catch(() => {});
    const reason = error.code === 'RESOURCE_WAIT' ? 'WAITING_PROVIDER' : error.code === 'RESOURCE_LIMIT_EXCEEDED' ? 'RESOURCE_EXHAUSTED' : 'INFRASTRUCTURE_FAILURE';
    await resource.terminal({ executionId: task.executionId, attemptId, reason });
    throw Object.assign(error, { studyReason: reason });
  }
  const verificationPath = join(attemptDir, 'verification.json');
  await writeAtomicJson(verificationPath, { ...verification, taskId: task.taskId, arm: task.arm, executionId: task.executionId, candidateDigest: common.candidateDigest, independent: true, evidenceClass: 'LIVE' });
  const checkCount = verificationCounts(verification);
  const resultHash = await digestFile(verificationPath);
  const providerRow = (common.provider.rows ?? []).filter(row => row.attemptId === attemptId).at(-1) ?? null;
  let providerUnresolved = false;
  if (providerRow?.status === 'SETTLED' && providerRow.providerRequestId && providerRow.providerEvidenceHash) {
    await resource.settled({ executionId: task.executionId, attemptId, requestId: dispatchRequestId, providerRequestId: providerRow.providerRequestId, responseHash: providerRow.providerEvidenceHash, usage: { inputTokens: providerRow.inputTokens, cachedInputTokens: providerRow.cachedInputTokens, outputTokens: providerRow.outputTokens, costUsd: providerRow.costUsd }, proof: { providerEvidenceHash: providerRow.providerEvidenceHash } });
  } else if (common.provider.wireRequests === 0 || providerRow?.status === 'NOT_ADMITTED') {
    await resource.notAdmitted({ executionId: task.executionId, attemptId, requestId: dispatchRequestId, proofRef: relative(output, verificationPath).replaceAll('\\', '/'), proofHash: resultHash, reason: 'NO_PROVIDER_WIRE_DISPATCH' });
  } else {
    await resource.unknown({ executionId: task.executionId, attemptId, requestId: dispatchRequestId, reason: 'provider-evidence-missing' });
    providerUnresolved = true;
  }
  if (providerRow?.status === 'NOT_ADMITTED') {
    const retryAfterSeconds = parseRetryAfter(common.driverResult?.retryAfter ?? providerRow.retryAfter ?? null, startedDate.getTime()) ?? 0;
    const next = new Date(nextEligibleAt({ now: startedDate, retryIndex: attemptNumber - 1, retryAfterSeconds, jitterSeconds: 0 }));
    await resource.wait({ executionId: task.executionId, nextAt: next, waitMs: Math.max(0, next.getTime() - startedDate.getTime()), reason: `provider admission wait after ${common.driverResult?.httpStatus ?? 'rejection'}` });
    const waitError = new Error('provider admission wait persisted');
    waitError.studyReason = 'WAITING_PROVIDER';
    throw waitError;
  }
  await resource.captureResult({ executionId: task.executionId, attemptId, resultHash, candidateDigest: common.candidateDigest, path: relative(output, verificationPath).replaceAll('\\', '/') });
  await resource.verified({ executionId: task.executionId, attemptId, verificationHash: resultHash, status: verification.status });
  if (task.arm === 'EXHARNESS') await resource.adopted({ executionId: task.executionId, attemptId, sessionId: task.executionId, eventHash: armResult?.core?.events?.at(-1)?.id ?? null });
  const accepted = verification.status === 'ACCEPTED' && !providerUnresolved;
  const terminalReason = providerUnresolved ? 'UNRESOLVED_PROVIDER' : accepted ? 'COMPLETED' : attemptNumber >= 2 ? 'ATTEMPT_LIMIT' : 'RETRYABLE_VERIFIER_REJECTION';
  await resource.terminal({ executionId: task.executionId, attemptId, reason: terminalReason, status: providerUnresolved || attemptNumber >= 2 ? 'TERMINAL' : accepted ? 'COMPLETED' : 'RETRYABLE' });
  const metrics = {
    schemaVersion: 1,
    evidenceClass: 'LIVE',
    executionId: task.executionId,
    pairId: task.pairId,
    taskId: task.taskId,
    repeat: task.repeat,
    arm: task.arm,
    profileHash: sha256(registeredProfile),
    promptHash: `sha256:${sha256(taskFixture.prompt)}`,
    resetDigest,
    candidateDigest: common.candidateDigest,
    attemptCount: attemptNumber,
    terminalReason,
    verificationStatus: verification.status,
    checksPassed: checkCount.checksPassed,
    checksTotal: checkCount.checksTotal,
    accepted,
    provider: common.provider,
    timing: common.timing,
    overheadUsd: null,
    humanIntervals: [],
    core: task.arm === 'EXHARNESS' ? armResult.core : null
  };
  await writeAtomicJson(join(executionDir, 'metrics.json'), metrics);
  await appendJsonl(join(output, 'attempts.jsonl'), { schemaVersion: 1, executionId: task.executionId, taskId: task.taskId, arm: task.arm, attemptId, attemptNumber, status: accepted ? 'ACCEPTED' : 'REJECTED', terminalTimestamp: common.timing.terminalAt, candidateDigest: common.candidateDigest, verification: { status: verification.status, candidateDigest: common.candidateDigest }, providerDispatched: common.provider.wireRequests > 0 });
  for (const row of common.provider.rows ?? []) await appendJsonl(join(output, 'usage.jsonl'), { schemaVersion: 1, executionId: task.executionId, taskId: task.taskId, arm: task.arm, attemptId, requestId: row.requestId, providerRequestId: row.providerRequestId, status: row.status === 'SETTLED' ? 'SETTLED' : 'UNKNOWN', inputTokens: row.inputTokens, cachedInputTokens: row.cachedInputTokens, cacheEvidence: row.cacheEvidence, outputTokens: row.outputTokens, costUsd: row.costUsd });
  return metrics;
}

async function collectMetrics(output, manifest) {
  const executions = [];
  for (const task of manifest.tasks) {
    const path = join(output, 'executions', task.executionId.replaceAll(':', '__'), 'metrics.json');
    const row = await plainJson(path).catch(() => null);
    if (row) executions.push(row);
  }
  return { schemaVersion: 1, studyId: manifest.studyId, executions };
}

export async function runStudy({ profile, output, executor = executeMiniAttempt, verify = verifyCandidate, clock = () => new Date() } = {}) {
  const identities = await fixtureIdentities();
  const value = await protocol();
  validateProfile(profile, { ...identities, requireLive: true, requirePilot: false });
  ensureCandidate(profile);
  const executionProfile = {
    ...profile,
    budgets: {
      ...profile.budgets,
      maxWallSeconds: value.limits.maxExecutionActiveSeconds,
      maxModelCalls: value.limits.maxModelCallsPerExecution,
      maxInputTokensPerCall: value.limits.maxInputTokensPerCall,
      maxOutputTokensPerCall: value.limits.maxOutputTokensPerCall,
      maxTotalTokens: value.limits.maxTotalTokensPerExecution,
      maxApiUsd: value.limits.maxApiUsdPerExecution,
      maxAttemptsPerTask: value.limits.maxAttemptsPerExecution,
      maxWireRequestsPerExecution: value.limits.maxWireRequestsPerExecution
    }
  };
  const manifest = await loadManifest(output);
  validateStudyManifest(manifest, { protocol: value, profileHash: sha256(profile), candidateSha: profile.candidateSha, candidateTree: profile.candidateTree });
  if (manifest.evidenceClass !== 'LIVE_REGISTRATION') fail('study registration is missing or not live-bound', 3);
  const resource = new ResourceState({ journalPath: join(output, 'events.jsonl'), experimentId: manifest.studyId, profileHash: manifest.profileHash, candidateSha: manifest.candidateSha, candidateTree: manifest.candidateTree, protocolHash: manifest.protocolHash, limits: value.limits, now: clock });
  const owner = await resource.acquireCohortLock();
  try {
    for (const task of manifest.tasks) {
    const state = await resource.state();
    const existing = state.executions[task.executionId];
    if (!existing) await resource.registerExecution({ ...task, deadline: new Date(Date.parse(task.registeredStart) + value.limits.maxCohortWallSeconds * 1000).toISOString() });
    if ((await resource.state()).executions[task.executionId]?.status === 'COMPLETED') continue;
    try {
      while (true) {
        const result = await executeOne({ profile: executionProfile, registeredProfile: profile, output, task, resource, executor, verify, clock });
        if (!result || result.accepted || (await resource.state()).executions[task.executionId]?.status === 'TERMINAL') break;
      }
    }
    catch (error) {
      if (error.studyReason === 'WAITING_PROVIDER' || error.studyReason === 'RESOURCE_EXHAUSTED') break;
      throw error;
    }
    }
    const metrics = await collectMetrics(output, manifest);
    await writeAtomicJson(join(output, 'metrics.json'), metrics);
    const observationAsOf = nowIso();
    const report = calculateStudyReport({ manifest, metrics, observationAsOf });
    await writeAtomicJson(join(output, 'report.json'), report);
    await writeAtomicJson(join(output, 'observation.json'), { schemaVersion: 1, asOf: observationAsOf, evidenceClass: 'LIVE' });
    const state = await resource.state();
    await writeAtomicJson(join(output, 'current.json'), { schemaVersion: 1, evidenceClass: 'LIVE_HANDOFF', studyId: manifest.studyId, profileHash: manifest.profileHash, candidateSha: manifest.candidateSha, candidateTree: manifest.candidateTree, resource: state, missingExecutions: manifest.tasks.map(task => task.executionId).filter(id => !metrics.executions.some(row => row.executionId === id)) });
    return { mode: 'live', studyId: manifest.studyId, measuredExecutions: metrics.executions.length, complete: report.complete, exitCode: report.complete ? 0 : 10 };
  } finally { await resource.releaseCohortLock(owner); }
}

export async function exportStudy(output) {
  const manifest = await loadManifest(output);
  const value = await protocol();
  validateStudyManifest(manifest, { protocol: value, candidateSha: manifest.candidateSha, candidateTree: manifest.candidateTree });
  const state = await foldResourceJournal(await readResourceJournal(join(output, 'events.jsonl')), { experimentId: manifest.studyId, profileHash: manifest.profileHash, candidateSha: manifest.candidateSha, candidateTree: manifest.candidateTree, protocolHash: manifest.protocolHash });
  const files = ['manifest.json', 'registration.json', 'events.jsonl', 'metrics.json', 'report.json', 'observation.json'];
  const executionFiles = (await readFile(join(output, 'metrics.json'), 'utf8').then(JSON.parse).catch(() => ({ executions: [] }))).executions ?? [];
  for (const row of executionFiles) files.push(join('executions', row.executionId.replaceAll(':', '__'), 'metrics.json'));
  const existing = [];
  for (const ref of files) { try { await readFile(join(output, ref)); existing.push(join(output, ref)); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
  const snapshot = await writeResourceSnapshot({ path: join(output, 'handoff.json'), state, journalPath: join(output, 'events.jsonl'), files: existing });
  return { mode: 'export', output: 'handoff.json', fileCount: snapshot.files.length, stateHash: `sha256:${sha256(snapshot.state)}` };
}

export async function auditStudy({ profile, output }) {
  const identities = await fixtureIdentities();
  validateProfile(profile, { ...identities, requireLive: false, requirePilot: false });
  const value = await protocol();
  const manifest = await loadManifest(output);
  if (manifest.studyKind !== 'FIXTURE_VALUE_V1' || manifest.evidenceClass !== 'LIVE_REGISTRATION' || manifest.valueProtocolHash !== `sha256:${sha256(value)}`)
    fail('study manifest is synthetic, stale or uses another protocol');
  if (manifest.candidateSha !== profile.candidateSha || manifest.candidateTree !== profile.candidateTree || manifest.profileHash !== sha256(profile)) fail('study/profile identity mismatch');
  const metrics = await plainJson(join(output, 'metrics.json'));
  const report = calculateStudyReport({ manifest, metrics, observationAsOf: (await plainJson(join(output, 'observation.json'))).asOf });
  const stored = await plainJson(join(output, 'report.json'));
  if (canonical(stored) !== canonical(report)) fail('study report is stale');
  const handoff = await plainJson(join(output, 'handoff.json')).catch(() => null);
  if (handoff && handoff.state?.candidateSha !== manifest.candidateSha) fail('handoff candidate identity mismatch');
  return { mode: 'audit', studyId: manifest.studyId, measuredExecutions: report.measuredExecutionCount, complete: report.complete, exitCode: report.complete ? 0 : 10, valueEvaluationRef: report.valueEvaluationRef, evidenceClass: report.evidenceClass };
}

export async function statusStudy(output) {
  const manifest = await loadManifest(output);
  const state = await foldResourceJournal(await readResourceJournal(join(output, 'events.jsonl')), { experimentId: manifest.studyId });
  return { mode: 'status', studyId: manifest.studyId, registeredExecutions: manifest.tasks.length, executions: Object.values(state.executions).map(item => ({ executionId: item.executionId, status: item.status, attempts: item.attempts, nextEligibleAt: item.nextEligibleAt, outstandingRequestIds: item.outstandingRequestIds })), outstandingRequests: Object.values(state.requests).filter(item => ['INTENT', 'IN_FLIGHT', 'UNKNOWN'].includes(item.status)).map(item => item.requestId) };
}

export async function main(args = process.argv.slice(2)) {
  const mode = option(args, '--mode') ?? 'status';
  const output = option(args, '--output');
  const profilePath = option(args, '--profile');
  if (!output) fail('--output is required');
  const out = resolve(output);
  if (mode === 'register') return registerStudy({ profile: await plainJson(resolve(profilePath)), output: out });
  if (mode === 'live' || mode === 'resume') return runStudy({ profile: await plainJson(resolve(profilePath)), output: out });
  if (mode === 'audit') return auditStudy({ profile: await plainJson(resolve(profilePath)), output: out });
  if (mode === 'export') return exportStudy(out);
  if (mode === 'status') return statusStudy(out);
  fail(`unknown mode: ${mode}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await main();
    console.log(JSON.stringify(result));
    if (Number.isInteger(result?.exitCode) && result.exitCode !== 0) process.exitCode = result.exitCode;
  }
  catch (error) { console.error(error.message); process.exitCode = error.exitCode ?? resourceExitCode(error.studyReason ?? 'INFRASTRUCTURE_FAILURE'); }
}
