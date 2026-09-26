import { spawn, execFileSync } from 'node:child_process';
import { createHash, createPrivateKey, createPublicKey } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { readFile, mkdir, copyFile, cp, open, readdir, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyCandidate, candidateDigest } from './fixture/acceptance.mjs';
import { canonical, fixtureIdentities, validateProfile, sha256 } from './contract.mjs';
import { calculateStudyReport } from './report.mjs';
import { ResourceState, foldResourceJournal, portableResourceState, readResourceJournal, writeAtomicJson, writeResourceSnapshot, resourceExitCode } from './resource-state.mjs';
import { auditCoreTrace, createCoreArm } from './core-arm.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const fixture = join(root, 'fixture');
const protocolPaths = Object.freeze({
  FIXTURE_VALUE_V1: join(root, 'value-protocol.json'),
  CORE_VALUE_V2: join(root, 'core-value-protocol.json')
});
const fail = (message, code = 2) => { const error = new Error(`BASELINE_STUDY_INVALID: ${message}`); error.exitCode = code; throw error; };
const option = (args, name) => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
const nowIso = () => new Date().toISOString();
const plainJson = path => readFile(path, 'utf8').then(JSON.parse);
const keyFingerprint = publicKey => `sha256:${createHash('sha256').update(publicKey.export({ type: 'spki', format: 'der' })).digest('hex')}`;
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
const appendJsonlOnce = async (path, key, value) => {
  const rows = await jsonLines(path);
  const prior = rows.find(row => row[key] === value[key]);
  if (prior) {
    if (canonical(prior) !== canonical(value)) fail(`append-only evidence changed for ${key}=${value[key]}`);
    return;
  }
  await appendJsonl(path, value);
};
const digestFile = async path => `sha256:${createHash('sha256').update(await readFile(path)).digest('hex')}`;
async function taskProviderLedgerPath(output, executionId) {
  const ledgerPath = join(output, 'executions', executionId, 'provider-ledger.jsonl');
  try { await stat(ledgerPath); return ledgerPath; }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return join(output, 'executions', executionId.replaceAll(':', '__'), 'provider-ledger.jsonl');
  }
}
const git = (...args) => execFileSync('git', args, { cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const protocolCache = new Map();
export async function loadValueProtocol(protocolId = 'FIXTURE_VALUE_V1') {
  const path = protocolPaths[protocolId];
  if (!path) fail(`unknown value protocol: ${protocolId}`);
  if (!protocolCache.has(protocolId)) protocolCache.set(protocolId, await plainJson(path));
  return protocolCache.get(protocolId);
}
const protocolIdFor = ({ profile = null, manifest = null } = {}) =>
  profile?.protocolId ?? manifest?.protocolId ?? (manifest?.studyKind === 'CORE_VALUE_V2' ? 'CORE_VALUE_V2' : 'FIXTURE_VALUE_V1');
const protocolFor = ({ profile = null, manifest = null } = {}) => loadValueProtocol(protocolIdFor({ profile, manifest }));

async function copyCandidate(destination) {
  await mkdir(destination, { recursive: true });
  for (const name of ['server.mjs', 'index.html', 'client.js', 'smoke.mjs']) await copyFile(join(fixture, name), join(destination, name));
  return candidateDigest(destination);
}

export async function prepareAttemptCandidate({ executionDir, attemptNumber, candidateDir }) {
  const seedDir = join(executionDir, 'seed-candidate');
  try { await readFile(join(seedDir, 'server.mjs')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await copyCandidate(seedDir);
  }
  const resetDigest = await candidateDigest(seedDir);
  try {
    await candidateDigest(candidateDir);
    return resetDigest;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (attemptNumber === 1) await cp(seedDir, candidateDir, { recursive: true, errorOnExist: true, force: false });
  else {
    const priorCandidate = join(executionDir, `attempt-${attemptNumber - 1}`, 'candidate');
    await cp(priorCandidate, candidateDir, { recursive: true, errorOnExist: true, force: false });
  }
  return resetDigest;
}

function ensureCandidate(profile) {
  if (git('rev-parse', 'HEAD') !== profile.candidateSha || git('rev-parse', 'HEAD^{tree}') !== profile.candidateTree)
    fail('profile candidate commit/tree differs from checkout', 3);
}

async function trustedJevPublic(output) {
  const publicPath = process.env.EXHARNESS_JEV_TRUSTED_PUBLIC_KEY;
  if (!publicPath) fail('registered Jev trusted public key is required', 3);
  const publicFile = resolve(publicPath);
  const publicKey = createPublicKey(await readFile(publicFile));
  if (publicKey.asymmetricKeyType !== 'ed25519') fail('trusted Jev public key must be Ed25519', 3);
  return { publicKey, fingerprint: keyFingerprint(publicKey) };
}

async function trustedJevMaterial(output) {
  const privatePath = process.env.EXHARNESS_JEV_SIGNING_KEY;
  if (!privatePath || !process.env.TYPESAFE_API_KEY) fail('trusted Jev credential and controller signing key are required before dispatch', 3);
  const privateFile = resolve(privatePath);
  const outputPath = resolve(output);
  const privateRelative = relative(outputPath, privateFile);
  if (privateRelative && !privateRelative.startsWith('..')) fail('Jev signing key must be outside study output', 3);
  const [privateBytes, privateInfo, trusted] = await Promise.all([readFile(privateFile), stat(privateFile), trustedJevPublic(output)]);
  if ((privateInfo.mode & 0o077) !== 0) fail('Jev signing key permissions must be owner-only', 3);
  const privateKey = createPrivateKey(privateBytes);
  const derived = createPublicKey(privateKey);
  if (privateKey.asymmetricKeyType !== 'ed25519' ||
      !derived.export({ type: 'spki', format: 'der' }).equals(trusted.publicKey.export({ type: 'spki', format: 'der' })))
    fail('Jev signing key and independently configured trusted public key do not match as Ed25519', 3);
  return trusted;
}

async function assertRegisteredJevTrust({ output, manifest, requireController = true }) {
  const material = requireController ? await trustedJevMaterial(output) : await trustedJevPublic(output);
  if (!manifest.jevTrustedPublicKeyFingerprint || manifest.jevTrustedPublicKeyFingerprint !== material.fingerprint)
    fail('registered Jev public-key fingerprint differs from the trusted controller configuration', 3);
  return material;
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
  const events = await jsonLines(ledgerPath);
  const requests = new Map();
  for (const event of events) {
    if (event.kind === 'RESERVE') requests.set(event.requestId, { ...event, status: 'UNKNOWN' });
    else if (requests.has(event.requestId)) requests.set(event.requestId, { ...requests.get(event.requestId), ...event, status: event.kind });
  }
  const rows = [...requests.values()];
  const settled = rows.filter(row => row.status === 'SETTLED');
  const unknown = rows.some(row => row.status === 'UNKNOWN');
  return {
    wireRequests: rows.length,
    modelCalls: settled.length,
    inputTokens: unknown ? null : settled.reduce((sum, row) => sum + Number(row.inputTokens ?? 0), 0),
    outputTokens: unknown ? null : settled.reduce((sum, row) => sum + Number(row.outputTokens ?? 0), 0),
    knownInputTokens: settled.reduce((sum, row) => sum + Number(row.inputTokens ?? 0), 0),
    knownOutputTokens: settled.reduce((sum, row) => sum + Number(row.outputTokens ?? 0), 0),
    cachedTokens: unknown ? null : settled.every(row => row.cachedInputTokens != null) ? settled.reduce((sum, row) => sum + row.cachedInputTokens, 0) : null,
    apiUsd: unknown ? null : settled.reduce((sum, row) => sum + Number(row.costUsd ?? 0), 0),
    usageUnknown: unknown,
    rows: rows.map(row => ({ kind: row.status, requestId: row.requestId, attemptId: row.attemptId ?? null, providerRequestId: row.providerRequestId ?? null, status: row.status, reason: row.reason ?? null, inputTokens: row.inputTokens ?? null, cachedInputTokens: row.cachedInputTokens ?? null, outputTokens: row.outputTokens ?? null, costUsd: row.costUsd ?? null, cacheEvidence: row.cacheEvidence ?? 'NOT_REPORTED', providerEvidenceHash: row.providerEvidenceHash ?? row.hash ?? row.proof?.hash ?? row.evidence?.hash ?? null, providerEvidenceRef: row.providerEvidenceRef ?? row.ref ?? row.proof?.ref ?? null, retryAfter: row.retryAfter ?? row.proof?.retryAfter ?? null, httpStatus: row.httpStatus ?? row.proof?.httpStatus ?? null }))
  };
}

export async function verifyProviderEvidenceRef({ output, providerRow, events }) {
  const evidenceRef = providerRow.providerEvidenceRef;
  const evidenceHash = providerRow.providerEvidenceHash;
  if (!evidenceRef || !evidenceHash) return true;
  const crashIntent = /^events\.jsonl#([A-Za-z0-9-]+)$/.exec(evidenceRef);
  if (crashIntent) {
    const event = events.find(item => item.eventId === crashIntent[1] && item.eventHash === evidenceHash);
    if (providerRow.status !== 'NOT_ADMITTED' || providerRow.reason !== 'CRASH_BEFORE_SEND_STARTED' ||
        !event || event.kind !== 'REQUEST_INTENT' || event.requestId !== providerRow.requestId ||
        events.some(item => item.kind === 'SEND_STARTED' && item.requestId === providerRow.requestId))
      fail(`pre-send provider proof is not bound to an unsent request intent: ${providerRow.requestId}`);
    return true;
  }
  const evidencePath = resolve(output, evidenceRef);
  if (relative(resolve(output), evidencePath).startsWith('..') || await digestFile(evidencePath) !== evidenceHash)
    fail(`provider response evidence hash mismatch: ${providerRow.requestId}`);
  return true;
}

export async function recoverProviderJournal({ output, resource }) {
  const events = await resource.events();
  let state = await resource.state();
  for (const row of Object.values(state.requests)) {
    if (!['INTENT', 'IN_FLIGHT', 'UNKNOWN'].includes(row.status)) continue;
    const intent = events.find(event => event.kind === 'REQUEST_INTENT' && event.requestId === row.requestId);
    const unknownEvent = events.findLast(event => event.kind === 'UNKNOWN' && event.requestId === row.requestId);
    const ledgerPath = await taskProviderLedgerPath(output, row.executionId);
    const ledger = await jsonLines(ledgerPath);
    const reserve = ledger.find(event => event.kind === 'RESERVE' && event.requestId === row.requestId);
    const outcome = ledger.find(event => event.kind !== 'RESERVE' && event.requestId === row.requestId);
    if (row.status === 'INTENT') {
      if (events.some(event => event.kind === 'SEND_STARTED' && event.requestId === row.requestId)) fail('resource journal intent conflicts with SEND_STARTED history', 4);
      if (outcome && !(outcome.kind === 'NOT_ADMITTED' && outcome.reason === 'CRASH_BEFORE_SEND_STARTED')) fail('provider ledger has an outcome for a request never marked SEND_STARTED', 4);
      if (!intent) fail('resource request intent event is missing', 4);
      const execution = state.executions[row.executionId];
      if (!reserve) await appendJsonl(ledgerPath, { schemaVersion: 1, kind: 'RESERVE', requestId: row.requestId,
        taskId: execution?.taskId ?? row.executionId.replaceAll(':', '-'), attemptId: row.attemptId, timestamp: intent.at,
        inputTokensReserved: row.inputTokensReserved, outputTokensReserved: row.outputTokensReserved,
        costUsdReserved: row.costUsdReserved });
      const recoveredReserve = reserve ?? { taskId: execution?.taskId ?? row.executionId.replaceAll(':', '-'), attemptId: row.attemptId };
      if (!outcome) await appendJsonl(ledgerPath, { schemaVersion: 1, kind: 'NOT_ADMITTED', requestId: row.requestId,
        taskId: recoveredReserve.taskId, attemptId: recoveredReserve.attemptId, timestamp: nowIso(), reason: 'CRASH_BEFORE_SEND_STARTED',
        proof: { ref: `events.jsonl#${intent.eventId}`, hash: intent.eventHash } });
      await resource.notAdmitted({ executionId: row.executionId, attemptId: row.attemptId, requestId: row.requestId,
        proofRef: `events.jsonl#${intent.eventId}`, proofHash: intent.eventHash, reason: 'CRASH_BEFORE_SEND_STARTED' });
      state = await resource.state();
      continue;
    }
    if (row.status === 'IN_FLIGHT' && !events.some(event => event.kind === 'SEND_STARTED' && event.requestId === row.requestId)) fail('in-flight request has no durable SEND_STARTED event', 4);
    if (!reserve) {
      const execution = state.executions[row.executionId];
      await appendJsonl(ledgerPath, { schemaVersion: 1, kind: 'RESERVE', requestId: row.requestId,
        taskId: execution?.taskId ?? row.executionId.replaceAll(':', '-'), attemptId: row.attemptId,
        timestamp: row.sendStartedAt ?? nowIso(), inputTokensReserved: row.inputTokensReserved,
        outputTokensReserved: row.outputTokensReserved, costUsdReserved: row.costUsdReserved });
      await appendJsonl(ledgerPath, { schemaVersion: 1, kind: 'UNKNOWN', requestId: row.requestId,
        taskId: execution?.taskId ?? row.executionId.replaceAll(':', '-'), attemptId: row.attemptId,
        timestamp: nowIso(), reason: 'crash after SEND_STARTED without provider ledger reservation' });
      await resource.unknown({ executionId: row.executionId, attemptId: row.attemptId, requestId: row.requestId,
        reason: 'crash after SEND_STARTED without provider ledger reservation' });
      state = await resource.state();
      continue;
    }
    if (outcome?.kind === 'SETTLED') {
      const evidenceRef = outcome.providerEvidenceRef;
      const evidenceHash = outcome.providerEvidenceHash;
      let evidenceValid = false;
      if (evidenceRef && evidenceHash) {
        const evidencePath = resolve(output, evidenceRef);
        const pathFromRoot = relative(resolve(output), evidencePath);
        if (!pathFromRoot.startsWith('..') && await digestFile(evidencePath).catch(() => null) === evidenceHash) evidenceValid = true;
      }
      if (!evidenceValid || !Number.isInteger(outcome.inputTokens) || !Number.isInteger(outcome.outputTokens) || !Number.isFinite(outcome.costUsd)) {
        if (row.status !== 'UNKNOWN') await resource.unknown({ executionId: row.executionId, attemptId: row.attemptId, requestId: row.requestId,
          reason: 'provider settlement lacks valid stored response evidence', proof: { providerEvidenceRef: evidenceRef ?? null, providerEvidenceHash: evidenceHash ?? null } });
        state = await resource.state();
        continue;
      }
      const usage = { inputTokens: outcome.inputTokens, cachedInputTokens: outcome.cachedInputTokens ?? null,
        outputTokens: outcome.outputTokens, costUsd: outcome.costUsd };
      if (row.status === 'UNKNOWN') {
        if (!unknownEvent) fail('unknown request has no UNKNOWN event for reconciliation', 4);
        await resource.reconcile({ executionId: row.executionId, attemptId: row.attemptId, requestId: row.requestId,
          settled: true, originalEventHash: unknownEvent.eventHash, providerRequestId: outcome.providerRequestId,
          responseHash: evidenceHash, usage });
      } else {
        await resource.settled({ executionId: row.executionId, attemptId: row.attemptId, requestId: row.requestId,
          providerRequestId: outcome.providerRequestId, responseHash: evidenceHash, usage,
          proof: { providerEvidenceRef: evidenceRef } });
      }
      state = await resource.state();
      continue;
    }
    if (outcome?.kind === 'NOT_ADMITTED') {
      const proofRef = outcome.proof?.ref;
      const proofHash = outcome.proof?.hash;
      const proofPath = proofRef ? resolve(output, proofRef) : null;
      const pathFromRoot = proofPath ? relative(resolve(output), proofPath) : '';
      const proofValid = Boolean(proofPath && !pathFromRoot.startsWith('..') && proofHash &&
        await digestFile(proofPath).catch(() => null) === proofHash);
      if (!proofValid) {
        if (row.status !== 'UNKNOWN') await resource.unknown({ executionId: row.executionId, attemptId: row.attemptId, requestId: row.requestId,
          reason: 'non-admission ledger lacks its stored proof' });
        state = await resource.state();
        continue;
      }
      if (row.status === 'UNKNOWN') {
        if (!unknownEvent) fail('unknown request has no UNKNOWN event for reconciliation', 4);
        await resource.reconcile({ executionId: row.executionId, attemptId: row.attemptId, requestId: row.requestId,
          settled: false, originalEventHash: unknownEvent.eventHash, proofHash });
      } else {
        await resource.notAdmitted({ executionId: row.executionId, attemptId: row.attemptId, requestId: row.requestId,
          proofRef, proofHash, reason: outcome.reason ?? 'PROVIDER_NOT_ADMITTED' });
      }
      state = await resource.state();
      continue;
    }
    if (outcome?.kind === 'UNKNOWN' && row.status !== 'UNKNOWN') {
      await resource.unknown({ executionId: row.executionId, attemptId: row.attemptId, requestId: row.requestId,
        reason: outcome.reason ?? 'provider completion is unresolved', proof: { ref: outcome.ref ?? null, hash: outcome.hash ?? null } });
    } else if (!outcome && row.status !== 'UNKNOWN') {
      await appendJsonl(ledgerPath, { schemaVersion: 1, kind: 'UNKNOWN', requestId: row.requestId,
        taskId: reserve.taskId, attemptId: reserve.attemptId, timestamp: nowIso(),
        reason: 'crash after SEND_STARTED without a settled provider response' });
      await resource.unknown({ executionId: row.executionId, attemptId: row.attemptId, requestId: row.requestId,
        reason: 'crash after SEND_STARTED without a settled provider response' });
    } else if (!outcome && row.status === 'UNKNOWN') {
      await appendJsonl(ledgerPath, { schemaVersion: 1, kind: 'UNKNOWN', requestId: row.requestId,
        taskId: reserve.taskId, attemptId: reserve.attemptId, timestamp: nowIso(),
        reason: row.reason ?? 'provider completion is unresolved' });
    }
    state = await resource.state();
  }
  const unresolved = Object.values(state.requests).filter(row => row.status === 'UNKNOWN');
  for (const row of unresolved) {
    const deadline = state.executions[row.executionId]?.deadline;
    if (deadline && Date.parse(deadline) <= Date.now()) {
      await resource.stopCohort('UNRESOLVED_PROVIDER', `deadline expired for ${row.requestId}`);
      break;
    }
  }
  return resource.state();
}

function inspectProbeToolCall(response, expectedCommand) {
  const calls = response?.choices?.[0]?.message?.tool_calls;
  if (!Array.isArray(calls) || calls.length !== 1) return null;
  const fn = calls[0]?.function;
  if (fn?.name !== 'bash') return null;
  let args;
  try { args = JSON.parse(fn.arguments); } catch { return null; }
  if (args?.command !== expectedCommand) return null;
  return { toolCallId: calls[0].id ?? null, toolName: 'bash', command: expectedCommand };
}

async function recoverProbeResult({ output, probeId, executionId, expectedCommand, expectedModelId, resource }) {
  const state = await resource.state();
  const request = Object.values(state.requests).find(row => row.executionId === executionId);
  if (!request) return null;
  if (request.status === 'UNKNOWN' || request.status === 'INTENT' || request.status === 'IN_FLIGHT') return null;
  if (request.status === 'NOT_ADMITTED') return { schemaVersion: 1, probeId, status: 'FAILED', resourceCode: 'RESOURCE_WAIT',
    providerAdmission: 'NOT_ADMITTED', nextEligibleAt: state.executions[executionId]?.nextEligibleAt ?? state.routeNextEligibleAt,
    requestId: request.requestId, evidenceClass: 'LIVE_PROVIDER_PROBE' };
  if (request.status !== 'SETTLED' || !request.proof?.providerEvidenceRef) return null;
  const evidencePath = resolve(output, request.proof.providerEvidenceRef);
  const pathFromRoot = relative(resolve(output), evidencePath);
  if (pathFromRoot.startsWith('..') || await digestFile(evidencePath).catch(() => null) !== request.responseHash) return null;
  const evidence = await plainJson(evidencePath);
  const response = evidence.response;
  const toolCall = inspectProbeToolCall(response, expectedCommand);
  const usage = response?.usage;
  const validUsage = Number.isInteger(usage?.prompt_tokens) && Number.isInteger(usage?.completion_tokens) &&
    usage.prompt_tokens === request.usage?.inputTokens && usage.completion_tokens === request.usage?.outputTokens;
  return { schemaVersion: 1, probeId, requestId: request.requestId,
    status: response?.model === expectedModelId && toolCall && validUsage ? 'PASS' : 'FAILED',
    providerModelId: response?.model ?? null, providerRequestId: response?.id ?? request.providerRequestId,
    usage: { inputTokens: request.usage?.inputTokens ?? null, outputTokens: request.usage?.outputTokens ?? null,
      cachedInputTokens: request.usage?.cachedInputTokens ?? null }, toolCall,
    providerEvidenceRef: request.proof.providerEvidenceRef, providerEvidenceHash: request.responseHash,
    evidenceClass: 'LIVE_PROVIDER_PROBE' };
}

async function recoverProbeSuffix({ output, executionId, resultPath, resource }) {
  const state = await resource.state();
  const execution = state.executions[executionId];
  if (!execution || !['RESULT_CAPTURED', 'VERIFIED'].includes(execution.status)) return null;
  const attempt = execution.attemptHistory.at(-1);
  if (!attempt?.capturedResult) fail(`captured probe ${executionId} has no result identity`, 4);
  const path = resolve(output, attempt.capturedResult.path);
  const pathFromRoot = relative(resolve(output), path);
  if (pathFromRoot.startsWith('..') || await digestFile(path).catch(() => null) !== attempt.capturedResult.resultHash)
    fail(`captured probe evidence changed: ${attempt.capturedResult.path}`, 4);
  const result = await plainJson(path);
  const accepted = result.status === 'PASS';
  const verificationHash = attempt.capturedResult.resultHash;
  await resource.verified({ executionId, attemptId: attempt.attemptId, verificationHash, status: accepted ? 'ACCEPTED' : 'REJECTED' });
  await resource.terminal({ executionId, attemptId: attempt.attemptId, reason: accepted ? 'COMPLETED' : 'PROBE_PREREQUISITE_MISSING',
    status: accepted ? 'COMPLETED' : 'TERMINAL', activeMs: Number(result.activeMs ?? 0), terminalAt: result.terminalAt });
  return result;
}

async function finalizeProbeResult({ output, probeId, executionId, resultPath, expectedCommand, expectedModelId, result, resource, maxOutputTokens = 128 }) {
  const state = await resource.state();
  const execution = state.executions[executionId];
  const attempt = execution?.attemptHistory.at(-1);
  const request = Object.values(state.requests).find(row => row.executionId === executionId);
  if (request && ['UNKNOWN', 'INTENT', 'IN_FLIGHT'].includes(request.status))
    return { result, accepted: false, unresolvedProvider: true };
  const normalized = { ...result, schemaVersion: 1, probeId,
    activeMs: Number.isFinite(result?.activeMs) ? result.activeMs : 0,
    terminalAt: result?.terminalAt ?? nowIso() };
  const prior = await plainJson(resultPath).catch(() => null);
  if (!prior) await writeOnce(resultPath, normalized);
  else if (prior.requestId !== normalized.requestId || prior.status !== normalized.status || prior.providerEvidenceHash !== normalized.providerEvidenceHash)
    fail(`probe result changed on recovery: ${probeId}`, 4);
  const stored = prior ?? normalized;
  const requestMatches = request?.status === 'SETTLED' && request.responseHash === stored.providerEvidenceHash &&
    request.proof?.providerEvidenceRef === stored.providerEvidenceRef &&
    request.usage?.inputTokens === stored.usage?.inputTokens && request.usage?.outputTokens === stored.usage?.outputTokens;
  const accepted = stored.status === 'PASS' && stored.providerModelId === expectedModelId &&
    stored.toolCall?.command === expectedCommand && Number.isInteger(stored.usage?.outputTokens) &&
    stored.usage.outputTokens <= maxOutputTokens && Boolean(stored.providerEvidenceHash && stored.providerEvidenceRef) && requestMatches;
  const verificationStatus = accepted ? 'ACCEPTED' : request?.status === 'UNKNOWN' ? 'INCONCLUSIVE' : 'REJECTED';
  const resultHash = await digestFile(resultPath);
  if (attempt && !attempt.resultCaptured) await resource.captureResult({ executionId, attemptId: attempt.attemptId,
    resultHash, candidateDigest: `sha256:${sha256(stored)}`, path: relative(output, resultPath).replaceAll('\\', '/') });
  if (attempt && !attempt.verified) await resource.verified({ executionId, attemptId: attempt.attemptId, verificationHash: resultHash, status: verificationStatus });
  if (attempt && !attempt.terminalAt) await resource.terminal({ executionId, attemptId: attempt.attemptId,
    reason: accepted ? 'COMPLETED' : stored.resourceCode === 'RESOURCE_LIMIT_EXCEEDED' ? 'RESOURCE_EXHAUSTED' : 'PROBE_PREREQUISITE_MISSING',
    status: accepted ? 'COMPLETED' : 'TERMINAL', activeMs: stored.activeMs, terminalAt: stored.terminalAt });
  return { result: stored, accepted, unresolvedProvider: false, resourceExhausted: stored.resourceCode === 'RESOURCE_LIMIT_EXCEEDED' };
}

export function buildProviderProbeConfig({ profile, probeId, probeCommand, attemptId, ledgerPath, evidenceRoot,
  resourceContext, resourceBridgePath, nodeExecutable, resultPath }) {
  if (!profile || !probeId || !probeCommand || !attemptId || !ledgerPath || !evidenceRoot || !resourceContext ||
      !resourceBridgePath || !nodeExecutable || !resultPath) fail('provider probe configuration is incomplete');
  return { profile, probeId, probeCommand, attemptId, ledgerPath, evidenceRoot, resourceContext,
    resourceBridgePath, nodeExecutable, resultPath };
}

export function providerProbeDriverTimeoutMs(requestTimeoutSeconds, maxExecutionActiveSeconds) {
  if (!Number.isFinite(requestTimeoutSeconds) || requestTimeoutSeconds < 1 ||
      !Number.isFinite(maxExecutionActiveSeconds) || maxExecutionActiveSeconds < requestTimeoutSeconds + 1)
    fail('provider probe timeout is outside the registered active-time ceiling');
  return Math.min(maxExecutionActiveSeconds * 1000, requestTimeoutSeconds * 1000 + 10_000);
}

export async function runProviderProbes({ profile, output, manifest, resource, clock, value = null }) {
  value ??= await protocolFor({ profile, manifest });
  const successful = [];
  const failures = [];
  const requiredProbeCount = value.qualification?.requiredSuccessfulProbes ?? value.limits.maxProbeRequests;
  const maxProbeAttempts = value.qualification?.maxWireAttempts ?? value.limits.maxProbeRequests;
  const writeProbeManifest = async ({ selectedProfileId = profile.qualificationProfileId ?? null } = {}) => {
    await writeAtomicJson(join(output, 'setup', 'probes.json'), { schemaVersion: 1, evidenceClass: 'LIVE_PROVIDER_PROBES',
      modelId: profile.model.providerModelId, required: requiredProbeCount,
      attempted: successful.length + failures.length, outputTokenLimit: value.limits.maxProbeOutputTokens,
      selectedProfileId, qualificationHash: profile.qualificationHash ?? null, failures,
      probes: successful.map(item => ({ probeId: item.probeId, profileId: item.profileId ?? selectedProfileId, requestId: item.requestId, providerRequestId: item.providerRequestId,
        inputTokens: item.usage?.inputTokens ?? null, outputTokens: item.usage?.outputTokens ?? null, costUsd: item.costUsd ?? null, providerEvidenceRef: item.providerEvidenceRef,
        providerEvidenceHash: item.providerEvidenceHash, toolCall: item.toolCall })) });
  };
  for (let index = 1; index <= maxProbeAttempts; index += 1) {
    if (successful.length >= requiredProbeCount) break;
    const probeId = profile.qualificationProfileId ? `${profile.qualificationProfileId}-PROBE-${index}` : `PROBE-${index}`;
    const executionId = `SETUP:${probeId}`;
    const probeDir = join(output, 'setup', probeId.toLowerCase());
    const resultPath = join(probeDir, 'result.json');
    const expectedCommand = `printf 'EXHARNESS_PROBE_${index}'`;
    const deadline = new Date(Date.parse(manifest.registeredAt) + value.limits.maxCohortWallSeconds * 1000).toISOString();
    await resource.registerExecution({ executionId, pairId: 'SETUP', taskId: probeId, arm: 'SETUP', repeat: index, deadline, providerModelId: profile.model.providerModelId });
    const priorSuffix = await recoverProbeSuffix({ output, executionId, resultPath, resource });
    let priorResult = priorSuffix ?? await plainJson(resultPath).catch(() => null);
    if (!priorResult) priorResult = await recoverProbeResult({ output, probeId, executionId, expectedCommand,
      expectedModelId: profile.model.providerModelId, resource });
    if (priorResult) {
      const attempt = (await resource.state()).executions[executionId]?.attemptHistory.at(-1);
      const finished = await finalizeProbeResult({ output, probeId, executionId, resultPath, expectedCommand,
        expectedModelId: profile.model.providerModelId, result: { ...priorResult, attemptId: attempt?.attemptId }, resource,
        maxOutputTokens: value.limits.maxProbeOutputTokens });
      if (finished.unresolvedProvider) { failures.push({ probeId, profileId: profile.qualificationProfileId ?? null, result: finished.result }); await writeProbeManifest(); return { ready: false, unresolvedProvider: true }; }
      if (!finished.accepted) { failures.push({ probeId, profileId: profile.qualificationProfileId ?? null, result: finished.result }); await writeProbeManifest(); return { ready: false, prerequisiteMissing: true, resourceExhausted: finished.resourceExhausted }; }
      successful.push(finished.result);
      continue;
    }
    const state = await resource.state();
    if (Object.values(state.requests).some(row => ['INTENT', 'IN_FLIGHT', 'UNKNOWN'].includes(row.status))) {
      failures.push({ probeId, reason: 'UNRESOLVED_PROVIDER' });
      await writeProbeManifest();
      return { ready: false, unresolvedProvider: true };
    }
    const setupRequests = Object.values(state.requests).filter(row => row.executionId.startsWith('SETUP:'));
    if (setupRequests.length >= maxProbeAttempts) return { ready: false, prerequisiteMissing: true };
    const inputPrice = Math.max(profile.model.inputUsdPerMillion, profile.model.cachedInputUsdPerMillion ?? profile.model.inputUsdPerMillion);
    const reserveUsd = (value.limits.maxInputTokensPerCall * inputPrice + value.limits.maxProbeOutputTokens * profile.model.outputUsdPerMillion) / 1_000_000;
    const committedProbeUsd = setupRequests.reduce((sum, row) => sum + (row.status === 'SETTLED' ? Number(row.usage?.costUsd ?? 0) :
      ['INTENT', 'IN_FLIGHT', 'UNKNOWN'].includes(row.status) ? Number(row.costUsdReserved ?? 0) : 0), 0);
    if (committedProbeUsd + reserveUsd > value.limits.maxProbeUsd) {
      await resource.stopCohort('RESOURCE_EXHAUSTED', 'registered two-probe cost ceiling would be exceeded');
      return { ready: false, resourceExhausted: true };
    }
    try { await requireProviderEligibility({ resource, executionId, clock }); }
    catch (error) {
      if (error.studyReason === 'WAITING_PROVIDER' || error.studyReason === 'RESOURCE_EXHAUSTED') {
        failures.push({ probeId, reason: error.studyReason }); await writeProbeManifest();
        return { ready: false, resourceExhausted: error.studyReason === 'RESOURCE_EXHAUSTED' };
      }
      throw error;
    }
    const attemptId = `${executionId}:attempt-1`;
    await resource.registerAttempt({ executionId, attemptId, attemptNumber: 1 });
    await resource.startAttempt({ executionId, attemptId });
    await mkdir(probeDir, { recursive: true });
    const probeProfile = { ...profile, budgets: { ...profile.budgets,
      maxModelCalls: 1, maxWireRequestsPerExecution: 1,
      maxInputTokensPerCall: value.limits.maxInputTokensPerCall,
      maxOutputTokensPerCall: value.limits.maxProbeOutputTokens,
      maxTotalTokens: value.limits.maxInputTokensPerCall + value.limits.maxProbeOutputTokens,
      maxApiUsd: value.limits.maxProbeUsd, maxProviderWaitSeconds: value.limits.maxProviderWaitSeconds,
      maxWallSeconds: value.limits.maxToolCommandSeconds } };
    const bridgeLimits = { ...resource.limits, maxWireRequestsPerExecution: 1, maxAttemptsPerExecution: 1,
      maxInputTokensPerCall: value.limits.maxInputTokensPerCall, maxOutputTokensPerCall: value.limits.maxProbeOutputTokens,
      maxTotalTokensPerExecution: value.limits.maxInputTokensPerCall + value.limits.maxProbeOutputTokens,
      maxApiUsdPerExecution: value.limits.maxProbeUsd };
    const resourceContext = { journalPath: resource.journalPath, experimentId: resource.experimentId,
      ...resource.identity, limits: bridgeLimits, executionId, seed: value.seed };
    const ledgerPath = join(probeDir, 'provider-ledger.jsonl');
    const configPath = join(probeDir, 'probe-config.json');
    const childResultPath = join(probeDir, 'driver-result.json');
    await writeOnce(configPath, buildProviderProbeConfig({ profile: probeProfile, probeId, probeCommand: expectedCommand,
      attemptId, ledgerPath, evidenceRoot: output, resourceContext,
      resourceBridgePath: join(root, 'resource-bridge.mjs'), nodeExecutable: process.execPath, resultPath: childResultPath }));
    const startedAt = performance.now();
    const wallStart = clock();
    const child = await runChild(profile.pythonExecutable, [join(root, 'probe_driver.py'), configPath],
      { cwd: root, timeoutMs: providerProbeDriverTimeoutMs(profile.model.requestTimeoutSeconds,
        value.limits.maxExecutionActiveSeconds), env: process.env });
    await recoverProviderJournal({ output, resource });
    let result = await plainJson(childResultPath).catch(() => null);
    const postRunState = await resource.state();
    const requestAfterRun = Object.values(postRunState.requests).find(row => row.executionId === executionId);
    if (requestAfterRun && ['INTENT', 'IN_FLIGHT', 'UNKNOWN'].includes(requestAfterRun.status)) {
      failures.push({ probeId, profileId: profile.qualificationProfileId ?? null, reason: 'UNRESOLVED_PROVIDER' });
      await writeProbeManifest();
      return { ready: false, unresolvedProvider: true };
    }
    if (!result) result = await recoverProbeResult({ output, probeId, executionId, expectedCommand,
      expectedModelId: profile.model.providerModelId, resource });
    const terminalClock = clock();
    const terminalDate = terminalClock instanceof Date ? terminalClock : new Date(terminalClock);
    result = { ...(result ?? {}), schemaVersion: 1, probeId, attemptId,
      status: result?.status ?? 'FAILED', errorType: result?.errorType ?? (child.timedOut ? 'ProbeTimeout' : child.code === 0 ? null : 'ProbeDriverFailure'),
      activeMs: Math.max(0, performance.now() - startedAt), startedAt: (wallStart instanceof Date ? wallStart : new Date(wallStart)).toISOString(),
      terminalAt: terminalDate.toISOString(), stdoutHash: `sha256:${sha256(child.stdout)}`, stderrHash: `sha256:${sha256(child.stderr)}` };
    const finished = await finalizeProbeResult({ output, probeId, executionId, resultPath, expectedCommand,
      expectedModelId: profile.model.providerModelId, result, resource, maxOutputTokens: value.limits.maxProbeOutputTokens });
    if (finished.unresolvedProvider) { failures.push({ probeId, profileId: profile.qualificationProfileId ?? null, result: finished.result }); await writeProbeManifest(); return { ready: false, unresolvedProvider: true }; }
    if (!finished.accepted) { failures.push({ probeId, profileId: profile.qualificationProfileId ?? null, result: finished.result }); await writeProbeManifest(); return { ready: false, prerequisiteMissing: true, resourceExhausted: finished.resourceExhausted }; }
    successful.push(finished.result);
  }
  await writeProbeManifest();
  return { ready: successful.length >= requiredProbeCount, prerequisiteMissing: false,
    selectedProfileId: profile.qualificationProfileId ?? null, selectedModel: profile.model, failures };
}

export async function executeMiniAttempt({ profile, task, output, executionId, attemptId, candidateDir, attemptDir, resourceContext }) {
  const ledgerPath = join(output, 'executions', executionId, 'provider-ledger.jsonl');
  const config = {
    profile,
    taskId: task.taskId ?? task.id,
    attemptId,
    taskPrompt: task.prompt,
    candidateDir,
    ledgerPath,
    evidenceRoot: output,
    resourceContext,
    resourceBridgePath: join(root, 'resource-bridge.mjs'),
    nodeExecutable: process.execPath,
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
  const providerWaitMs = Math.max(0, Number(result.providerWaitSeconds ?? 0) * 1000);
  return {
    attemptId,
    candidateDigest: digest,
    candidateRef: relative(output, candidateDir).replaceAll('\\', '/'),
    driverResult: { ...result, processCode: child?.code ?? null, timedOut: child?.timedOut ?? false, stderr: child?.stderr ?? '', stdout: child?.stdout ?? '' },
    provider: await providerFacts(ledgerPath),
    timing: { startedAt: new Date(startedAt).toISOString(), terminalAt: nowIso(), activeMs: Math.max(0, Date.now() - startedAt - providerWaitMs), providerWaitMs }
  };
}

function studyPairs(value) {
  if (!Array.isArray(value.pairs) || value.pairs.length !== 6) fail('value protocol must contain six pairs');
  return value.pairs.map((pair, pairIndex) => ({ ...pair, orderIndex: pairIndex + 1 }));
}

export function validateStudyManifest(manifest, { protocol: value, profileHash = null, candidateSha = null, candidateTree = null } = {}) {
  const expectedKind = value.protocolId ?? 'FIXTURE_VALUE_V1';
  if (manifest?.schemaVersion !== 1 || manifest.studyKind !== expectedKind || (manifest.protocolId ?? 'FIXTURE_VALUE_V1') !== expectedKind || manifest.registrationKind !== 'STUDY' || manifest.studyId !== value.studyId)
    fail('study manifest identity/schema mismatch');
  const body = Object.fromEntries(Object.entries(manifest).filter(([key]) => key !== 'digest'));
  if (manifest.digest !== `sha256:${sha256(body)}` || manifest.protocolHash !== `sha256:${sha256(value)}` || manifest.valueProtocolHash !== `sha256:${sha256(value)}`)
    fail('study manifest hash/protocol binding mismatch');
  if (manifest.evidenceClass === 'LIVE_REGISTRATION' && !/^sha256:[a-f0-9]{64}$/.test(manifest.jevTrustedPublicKeyFingerprint ?? ''))
    fail('live registration lacks a trusted Jev public-key fingerprint');
  if (profileHash && manifest.profileHash !== profileHash) fail('study profile binding mismatch');
  if (candidateSha && manifest.candidateSha !== candidateSha) fail('study candidate binding mismatch');
  if (candidateTree && manifest.candidateTree !== candidateTree) fail('study candidate tree binding mismatch');
  const pairs = studyPairs(value);
  if (canonical(manifest.pairs) !== canonical(pairs) || !Array.isArray(manifest.tasks) || manifest.tasks.length !== 12)
    fail('study pair/task registration differs from frozen protocol');
  if (expectedKind === 'CORE_VALUE_V2') {
    if (typeof manifest.cohortId !== 'string' || !manifest.cohortId ||
        manifest.cohortIdHash !== `sha256:${sha256(manifest.cohortId)}` ||
        !/^sha256:[a-f0-9]{64}$/.test(manifest.qualificationHash ?? '') ||
        typeof manifest.qualificationProfileId !== 'string' || !manifest.qualificationProfileId ||
        manifest.faultScheduleHash !== `sha256:${sha256(value.controlledTrials)}`)
      fail('CORE_VALUE_V2 manifest lacks qualification/cohort/fault bindings');
  }
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

export async function createStudyManifest({ profile, identities, protocol: value, jevTrustedPublicKeyFingerprint = null, at = nowIso() }) {
  const checked = validateProfile(profile, { ...identities, requireLive: false, requirePilot: false,
    protocolId: value.protocolId ?? 'FIXTURE_VALUE_V1', protocolHash: `sha256:${sha256(value)}` });
  const pairs = studyPairs(value);
  const tasks = [];
  for (const pair of pairs) for (const [index, arm] of pair.order.entries()) {
    const executionId = `${pair.pairId}:${arm}`;
    tasks.push({ executionId, pairId: pair.pairId, taskId: pair.taskId, repeat: pair.repeat, arm, orderIndex: index + 1, registeredStart: at, infrastructureUsd: null, evaluatorUsd: null, setupAllocationUsd: null });
  }
  const protocolId = value.protocolId ?? 'FIXTURE_VALUE_V1';
  const body = {
    schemaVersion: 1,
    studyKind: protocolId,
    protocolId,
    studyId: value.studyId,
    registrationKind: 'STUDY',
    evidenceClass: 'LIVE_REGISTRATION',
    protocolHash: `sha256:${sha256(value)}`,
    valueProtocolRef: protocolId === 'CORE_VALUE_V2' ? 'scripts/delivery/baseline/core-value-protocol.json' : 'scripts/delivery/baseline/value-protocol.json',
    valueProtocolHash: `sha256:${sha256(value)}`,
    profileHash: checked.profileHash,
    armHash: checked.armHash,
    candidateSha: profile.candidateSha,
    candidateTree: profile.candidateTree,
    jevTrustedPublicKeyFingerprint,
    cohortId: profile.cohortId ?? `${value.studyId}:${checked.profileHash.slice(0, 16)}`,
    cohortIdHash: `sha256:${sha256(profile.cohortId ?? `${value.studyId}:${checked.profileHash.slice(0, 16)}`)}`,
    qualificationHash: profile.qualificationHash ?? null,
    qualificationProfileId: profile.qualificationProfileId ?? null,
    qualificationRef: profile.qualificationRef ?? null,
    faultScheduleHash: protocolId === 'CORE_VALUE_V2' ? `sha256:${sha256(value.controlledTrials)}` : null,
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

async function assertQualification({ profile, profilePath, value }) {
  if (value.protocolId !== 'CORE_VALUE_V2') return null;
  if (!profilePath || !profile.qualificationRef) fail('CORE_VALUE_V2 registration requires the selected qualification profile and artifact', 3);
  const { validateQualificationArtifact } = await import('./qualification.mjs');
  const profileRoot = dirname(resolve(profilePath));
  const artifactPath = resolve(profileRoot, profile.qualificationRef);
  if (relative(profileRoot, artifactPath).startsWith('..')) fail('qualification reference escapes the profile directory', 3);
  const artifact = await plainJson(artifactPath).catch(() => null);
  if (!artifact) fail('qualification artifact is missing before registration', 3);
  validateQualificationArtifact({ artifact, profile, value });
  return { artifact, artifactPath };
}

function safeEvidenceRef(output, ref) {
  if (typeof ref !== 'string' || !ref || ref.startsWith('/') || ref.split('/').includes('..'))
    fail('qualification evidence reference is not portable');
  const path = resolve(output, ref);
  if (relative(resolve(output), path).startsWith('..')) fail('qualification evidence reference escapes study output');
  return path;
}

async function materializeQualificationSetup({ output, profileRoot, artifact }) {
  const selected = artifact.attempts?.find(item => item.profileId === artifact.selectedProfileId);
  if (!selected?.outputRef) fail('qualification artifact lacks selected setup output', 3);
  const sourceRoot = resolve(profileRoot, selected.outputRef);
  const sourceManifest = await plainJson(join(sourceRoot, 'setup', 'probes.json')).catch(() => null);
  if (!sourceManifest) fail('qualification setup probe manifest is missing', 3);
  const targetManifestPath = join(output, 'setup', 'probes.json');
  const targetManifest = { ...sourceManifest, qualificationHash: artifact.qualificationHash,
    selectedProfileId: artifact.selectedProfileId };
  for (const probe of sourceManifest.probes ?? []) {
    const probeId = probe.probeId;
    const resultRef = `setup/${String(probeId).toLowerCase()}/result.json`;
    const sourceResult = resolve(sourceRoot, resultRef);
    const targetResult = safeEvidenceRef(output, resultRef);
    await mkdir(dirname(targetResult), { recursive: true });
    await copyFile(sourceResult, targetResult);
    if (!probe.providerEvidenceRef) fail(`qualification probe lacks provider evidence: ${probeId}`, 3);
    const sourceEvidence = resolve(sourceRoot, probe.providerEvidenceRef);
    const targetEvidence = safeEvidenceRef(output, probe.providerEvidenceRef);
    await mkdir(dirname(targetEvidence), { recursive: true });
    await copyFile(sourceEvidence, targetEvidence);
  }
  await writeOnce(targetManifestPath, targetManifest);
  return { ...targetManifest, qualificationHash: artifact.qualificationHash };
}

async function loadMaterializedQualificationSetup({ output, profile, value }) {
  if (value.protocolId !== 'CORE_VALUE_V2') return null;
  const manifest = await plainJson(join(output, 'setup', 'probes.json')).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!manifest) fail('CORE_VALUE_V2 registration is missing materialized qualification probes', 3);
  const required = value.qualification.requiredSuccessfulProbes;
  if (manifest.evidenceClass !== 'LIVE_PROVIDER_PROBES' || manifest.modelId !== profile.model.providerModelId ||
      manifest.selectedProfileId !== profile.qualificationProfileId || manifest.qualificationHash !== profile.qualificationHash ||
      manifest.probes?.length < required || (manifest.failures ?? []).length > 0)
    fail('materialized qualification probes are not bound to the selected profile', 3);
  for (const probe of manifest.probes) {
    if (probe.providerEvidenceRef && await digestFile(safeEvidenceRef(output, probe.providerEvidenceRef)) !== probe.providerEvidenceHash)
      fail(`materialized qualification evidence changed: ${probe.probeId}`, 3);
    const result = await plainJson(safeEvidenceRef(output, `setup/${String(probe.probeId).toLowerCase()}/result.json`));
    if (result.status !== 'PASS' || result.toolCall?.toolName !== 'bash' || result.toolCall?.command !== `printf 'EXHARNESS_PROBE_${String(probe.probeId).match(/(\d+)$/)?.[1]}'`)
      fail(`materialized qualification result is invalid: ${probe.probeId}`, 3);
  }
  return { ...manifest, ready: true, prerequisiteMissing: false, selectedProfileId: profile.qualificationProfileId, failures: [] };
}

async function registerStudy({ profile, profilePath, output }) {
  const identities = await fixtureIdentities();
  const value = await protocolFor({ profile });
  const checked = validateProfile(profile, { ...identities, requireLive: false, requirePilot: false,
    protocolId: value.protocolId ?? 'FIXTURE_VALUE_V1', protocolHash: `sha256:${sha256(value)}` });
  ensureCandidate(profile);
  const qualification = await assertQualification({ profile, profilePath, value });
  const trust = await trustedJevMaterial(output);
  const manifest = await createStudyManifest({ profile, identities, protocol: value, jevTrustedPublicKeyFingerprint: trust.fingerprint });
  await mkdir(output, { recursive: true });
  const existing = await readFile(join(output, 'manifest.json'), 'utf8').then(JSON.parse).catch(() => null);
  if (existing && canonical(existing) !== canonical(manifest)) fail('study registration is immutable; changed input requires a new cohort');
  if (qualification) {
    await writeOnce(join(output, 'qualification.json'), qualification.artifact);
    await materializeQualificationSetup({ output, profileRoot: dirname(resolve(profilePath)), artifact: qualification.artifact });
  }
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

function studyError(message, code, studyReason) {
  return Object.assign(new Error(message), { code, studyReason });
}

async function requireProviderEligibility({ resource, executionId, clock }) {
  const state = await resource.state();
  const item = state.executions[executionId];
  if (state.cohortTerminalReason) throw studyError(`cohort is terminal: ${state.cohortTerminalReason}`, 'RESOURCE_LIMIT_EXCEEDED', 'RESOURCE_EXHAUSTED');
  const clockValue = clock();
  const now = clockValue instanceof Date ? clockValue : new Date(clockValue);
  if (!Number.isFinite(now.getTime())) fail('study clock returned an invalid timestamp');
  if (item?.deadline && now.getTime() >= Date.parse(item.deadline)) {
    await resource.terminal({ executionId, reason: 'RESOURCE_EXHAUSTED' });
    throw studyError('execution deadline expired', 'RESOURCE_LIMIT_EXCEEDED', 'RESOURCE_EXHAUSTED');
  }
  const candidates = [item?.nextEligibleAt, state.routeNextEligibleAt].filter(Boolean).map(Date.parse);
  if (state.lastProviderDispatchAt && resource.limits.minRequestIntervalSeconds > 0)
    candidates.push(Date.parse(state.lastProviderDispatchAt) + resource.limits.minRequestIntervalSeconds * 1000);
  const eligibleMs = Math.max(now.getTime(), ...candidates.filter(Number.isFinite));
  if (eligibleMs <= now.getTime()) return;
  const waitMs = eligibleMs - now.getTime();
  const deadlineMs = item?.deadline ? Date.parse(item.deadline) : null;
  const waitAlreadyMs = (item?.providerWaitMs ?? 0) + (item?.waitStartedAt ? Math.max(0, now.getTime() - Date.parse(item.waitStartedAt)) : 0);
  if (deadlineMs != null && eligibleMs >= deadlineMs || waitAlreadyMs + waitMs > resource.limits.maxProviderWaitSeconds * 1000) {
    await resource.terminal({ executionId, reason: 'RESOURCE_EXHAUSTED' });
    throw studyError('provider wait exceeds the registered deadline/ceiling', 'RESOURCE_LIMIT_EXCEEDED', 'RESOURCE_EXHAUSTED');
  }
  if (!item?.nextEligibleAt || Date.parse(item.nextEligibleAt) < eligibleMs) {
    await resource.wait({ executionId, nextAt: new Date(eligibleMs), waitMs,
      reason: state.routeNextEligibleAt && Date.parse(state.routeNextEligibleAt) === eligibleMs ? 'PROVIDER_RETRY_AFTER' : 'PROVIDER_ROUTE_PACING' });
  }
  throw studyError(`provider is eligible at ${new Date(eligibleMs).toISOString()}`, 'RESOURCE_WAIT', 'WAITING_PROVIDER');
}

export async function recoverCapturedSuffix({ output, task, resource }) {
  const state = await resource.state();
  const execution = state.executions[task.executionId];
  if (!execution || !['RESULT_CAPTURED', 'VERIFIED', 'CORE_ADOPTED'].includes(execution.status)) return null;
  const attempt = execution.attemptHistory.at(-1);
  const captured = attempt?.capturedResult;
  if (!attempt || !captured) fail(`captured execution ${task.executionId} has no attempt result`, 4);
  const verificationPath = resolve(output, captured.path);
  const pathFromRoot = relative(resolve(output), verificationPath);
  if (!pathFromRoot || pathFromRoot.startsWith('..') || pathFromRoot.includes('..\\')) fail('captured result path escapes the cohort output', 4);
  if (await digestFile(verificationPath) !== captured.resultHash) fail(`captured result hash changed: ${captured.path}`, 4);
  const verification = await plainJson(verificationPath);
  if (verification.executionId !== task.executionId || verification.candidateDigest !== captured.candidateDigest ||
      !['ACCEPTED', 'REJECTED', 'INCONCLUSIVE'].includes(verification.status)) fail('captured verification identity/status is invalid', 4);
  const executionDir = join(output, 'executions', task.executionId.replaceAll(':', '__'));
  const metricsPath = join(executionDir, 'metrics.json');
  const metrics = await plainJson(metricsPath).catch(() => null);
  if (!metrics || metrics.executionId !== task.executionId || metrics.verificationHash !== captured.resultHash ||
      metrics.candidateDigest !== captured.candidateDigest || metrics.attemptId !== attempt.attemptId)
    fail('captured suffix lacks matching durable metric facts', 4);
  await resource.verified({ executionId: task.executionId, attemptId: attempt.attemptId,
    verificationHash: captured.resultHash, status: verification.status });
  let coreTrace = null;
  if (task.arm === 'EXHARNESS') {
    coreTrace = await auditCoreTrace(join(executionDir, 'core-events.json'), { executionId: task.executionId });
    const eventHash = coreTrace.events.at(-1)?.id;
    if (!eventHash) fail('Core trace lacks a terminal event identity', 4);
    await resource.adopted({ executionId: task.executionId, attemptId: attempt.attemptId,
      sessionId: task.executionId, eventHash });
  }
  const reason = metrics.terminalReason;
  const status = reason === 'COMPLETED' ? 'COMPLETED' :
    ['RESOURCE_EXHAUSTED', 'UNRESOLVED_PROVIDER', 'ATTEMPT_LIMIT'].includes(reason) ? 'TERMINAL' : 'RETRYABLE';
  await resource.terminal({ executionId: task.executionId, attemptId: attempt.attemptId, reason: reason ?? 'RECOVERED_RESULT',
    status, activeMs: metrics.attemptActiveMs, terminalAt: metrics.timing.terminalAt });
  return metrics;
}

async function executeOne({ profile, registeredProfile = profile, output, task, resource, executor = executeMiniAttempt, verify = verifyCandidate, clock = () => new Date() }) {
  const executionDir = join(output, 'executions', task.executionId.replaceAll(':', '__'));
  await mkdir(executionDir, { recursive: true });
  const current = await resource.state();
  const execution = current.executions[task.executionId];
  if (execution?.status === 'COMPLETED' || execution?.status === 'TERMINAL') return null;
  const recovered = await recoverCapturedSuffix({ output, task, resource });
  if (recovered) return recovered;
  await requireProviderEligibility({ resource, executionId: task.executionId, clock });
  const taskFixture = (await plainJson(join(fixture, 'tasks.json'))).tasks.find(item => item.id === task.taskId);
  if (!taskFixture) fail(`unknown fixture task: ${task.taskId}`);
  const interruptedAttempts = (execution?.attemptHistory ?? []).filter(row => row.startedAt && !row.terminalAt);
  if (interruptedAttempts.length) {
    await resource.terminal({ executionId: task.executionId, reason: 'RESOURCE_EXHAUSTED' });
    throw studyError('interrupted active attempt holds the remaining execution budget as unrecoverable', 'RESOURCE_LIMIT_EXCEEDED', 'RESOURCE_EXHAUSTED');
  }
  const remainingActiveMs = resource.limits.maxExecutionActiveSeconds * 1000 - (execution?.activeMs ?? 0);
  if (remainingActiveMs <= 0) {
    await resource.terminal({ executionId: task.executionId, reason: 'RESOURCE_EXHAUSTED' });
    throw studyError('execution active-time budget exhausted or cannot be recovered safely', 'RESOURCE_LIMIT_EXCEEDED', 'RESOURCE_EXHAUSTED');
  }
  const attemptNumber = (execution?.attempts ?? 0) + 1;
  const attemptId = `${task.executionId}:attempt-${attemptNumber}`;
  await resource.registerAttempt({ executionId: task.executionId, attemptId, attemptNumber });
  const attemptDir = join(executionDir, `attempt-${attemptNumber}`);
  await mkdir(attemptDir, { recursive: true });
  const candidateDir = join(attemptDir, 'candidate');
  const resetDigest = await prepareAttemptCandidate({ executionDir, attemptNumber, candidateDir });
  const startedAt = clock();
  const startedDate = startedAt instanceof Date ? startedAt : new Date(startedAt);
  if (!Number.isFinite(startedDate.getTime())) fail('study clock returned an invalid timestamp');
  const monotonicStartedAt = performance.now();
  await resource.startAttempt({ executionId: task.executionId, attemptId });
  const resourceContext = {
    journalPath: resource.journalPath,
    experimentId: resource.experimentId,
    ...resource.identity,
    limits: resource.limits,
    executionId: task.executionId
  };
  let common;
  let armResult;
  let verification;
  try {
    const attemptProfile = { ...profile, budgets: { ...profile.budgets, maxWallSeconds: Math.max(0.001, remainingActiveMs / 1000) } };
    const runCommon = async () => executor({ profile: attemptProfile, task: taskFixture, output, executionId: task.executionId, attemptId, candidateDir, attemptDir, resourceContext });
    if (task.arm === 'EXHARNESS') {
      const arm = createCoreArm({
        directory: executionDir,
        executionId: task.executionId,
        cohortId: resource.experimentId,
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
    if (error.code === 'RESOURCE_WAIT') {
      const waitState = await resource.state();
      const currentExecution = waitState.executions[task.executionId];
      const sendAt = waitState.lastProviderDispatchAt ? Date.parse(waitState.lastProviderDispatchAt) + resource.limits.minRequestIntervalSeconds * 1000 : null;
      const nextAt = error.nextEligibleAt ?? error.next_eligible_at ?? currentExecution?.nextEligibleAt ?? (sendAt == null ? null : new Date(sendAt).toISOString());
      if (nextAt) await resource.wait({ executionId: task.executionId, nextAt, waitMs: Math.max(0, Date.parse(nextAt) - Date.parse(nowIso())),
        reason: 'PROVIDER_ROUTE_PACING', routeWide: true });
      throw Object.assign(error, { studyReason: 'WAITING_PROVIDER' });
    }
    const reason = ['RESOURCE_LIMIT_EXCEEDED', 'RESOURCE_EXHAUSTED'].includes(error.code) ? 'RESOURCE_EXHAUSTED' : 'INFRASTRUCTURE_FAILURE';
    if (reason === 'RESOURCE_EXHAUSTED') await resource.terminal({ executionId: task.executionId, reason });
    throw Object.assign(error, { studyReason: reason });
  }
  const verificationPath = join(attemptDir, 'verification.json');
  await writeOnce(verificationPath, { ...verification, taskId: task.taskId, arm: task.arm, executionId: task.executionId, candidateDigest: common.candidateDigest, independent: true, evidenceClass: 'LIVE' });
  const checkCount = verificationCounts(verification);
  const resultHash = await digestFile(verificationPath);
  const attemptRows = (common.provider.rows ?? []).filter(row => row.attemptId === attemptId);
  const unknownRows = attemptRows.filter(row => row.status === 'UNKNOWN');
  const resourceState = await resource.state();
  const executionState = resourceState.executions[task.executionId];
  const executionRequests = Object.values(resourceState.requests).filter(row => row.executionId === task.executionId && row.attemptId === attemptId);
  const unresolvedResourceRequests = executionRequests.filter(row => ['INTENT', 'IN_FLIGHT', 'UNKNOWN'].includes(row.status));
  const providerUnresolved = unknownRows.length > 0 || unresolvedResourceRequests.length > 0;
  for (const row of attemptRows) {
    const shared = resourceState.requests[row.requestId];
    if (!shared || shared.executionId !== task.executionId || shared.attemptId !== attemptId || shared.status !== row.status)
      fail(`provider ledger/resource journal mismatch for ${row.requestId}`, 4);
  }
  const resourceExhausted = ['RESOURCE_LIMIT_EXCEEDED', 'RESOURCE_EXHAUSTED'].includes(common.driverResult?.resourceCode);
  const accepted = verification.status === 'ACCEPTED' && !providerUnresolved && !resourceExhausted;
  const terminalReason = providerUnresolved ? 'UNRESOLVED_PROVIDER' : resourceExhausted ? 'TASK_BUDGET_EXHAUSTED' : accepted ? 'COMPLETED' : attemptNumber >= 2 ? 'ATTEMPT_LIMIT' : 'RETRYABLE_VERIFIER_REJECTION';
  const terminalStatus = providerUnresolved || resourceExhausted || attemptNumber >= 2 ? 'TERMINAL' : accepted ? 'COMPLETED' : 'RETRYABLE';
  const terminalClock = clock();
  const terminalDate = terminalClock instanceof Date ? terminalClock : new Date(terminalClock);
  if (!Number.isFinite(terminalDate.getTime())) fail('study clock returned an invalid terminal timestamp');
  const terminalAt = terminalDate.toISOString();
  const inAttemptWaitMs = Math.max(0, executionState.providerWaitMs - (execution?.providerWaitMs ?? 0));
  const attemptActiveMs = Math.max(0, performance.now() - monotonicStartedAt - inAttemptWaitMs);
  const registeredAt = task.registeredStart ?? executionState.registeredAt;
  const executionStartedAt = executionState.attemptHistory.find(row => row.startedAt)?.startedAt ?? startedDate.toISOString();
  const providerWaitMs = executionState.providerWaitMs;
  const activeRecoverable = executionState.attemptHistory.every(row => row.attemptId === attemptId ||
    ['COMPLETED', 'RETRYABLE', 'TERMINAL'].includes(row.status));
  const activeMs = activeRecoverable ? executionState.activeMs + attemptActiveMs : null;
  const elapsedMs = Math.max(0, Date.parse(terminalAt) - Date.parse(registeredAt));
  const timing = { registeredAt, startedAt: executionStartedAt, terminalAt, activeMs, attemptActiveMs, providerWaitMs, elapsedMs };
  let coreEvidence = null;
  if (task.arm === 'EXHARNESS') {
    const eventHash = armResult?.core?.events?.at(-1)?.id;
    if (!eventHash) fail('EXHARNESS result has no terminal Core event identity', 4);
    coreEvidence = armResult.core;
  }
  const metrics = {
    schemaVersion: 1,
    evidenceClass: 'LIVE',
    executionId: task.executionId,
    pairId: task.pairId,
    taskId: task.taskId,
    repeat: task.repeat,
    arm: task.arm,
    attemptId,
    profileHash: sha256(registeredProfile),
    promptHash: `sha256:${sha256(taskFixture.prompt)}`,
    resetDigest,
    candidateDigest: common.candidateDigest,
    attemptCount: attemptNumber,
    terminalReason,
    verificationStatus: verification.status,
    checksPassed: checkCount.checksPassed,
    checksTotal: checkCount.checksTotal,
    verificationChecks: (verification.checks ?? []).map(item => ({ check: item.check, pass: Boolean(item.pass) })),
    verificationHash: resultHash,
    accepted,
    provider: common.provider,
    timing,
    overheadUsd: null,
    humanIntervals: [],
    core: coreEvidence
  };
  const metricsPath = join(executionDir, 'metrics.json');
  const previousMetrics = await plainJson(metricsPath).catch(() => null);
  if (previousMetrics && (previousMetrics.attemptCount >= attemptNumber || !['RETRYABLE_VERIFIER_REJECTION'].includes(previousMetrics.terminalReason)))
    fail('execution metrics are immutable outside a registered retry', 4);
  const attemptStatus = accepted ? 'ACCEPTED' : verification.status === 'INCONCLUSIVE' || providerUnresolved ? 'INCONCLUSIVE' : resourceExhausted ? 'FAILED' : 'REJECTED';
  await appendJsonlOnce(join(output, 'attempts.jsonl'), 'attemptId', { schemaVersion: 1, executionId: task.executionId, taskId: task.taskId, arm: task.arm, attemptId, attemptNumber, status: attemptStatus, registeredAt: executionState.attemptHistory.find(row => row.attemptId === attemptId)?.registeredAt, startedAt: startedDate.toISOString(), terminalTimestamp: terminalAt, activeMs: attemptActiveMs, candidateDigest: common.candidateDigest, verification: { status: verification.status, candidateDigest: common.candidateDigest }, providerDispatched: attemptRows.length > 0 });
  for (const row of attemptRows) await appendJsonlOnce(join(output, 'usage.jsonl'), 'requestId', { schemaVersion: 1, executionId: task.executionId, taskId: task.taskId, arm: task.arm, attemptId, requestId: row.requestId, providerRequestId: row.providerRequestId, status: row.status, inputTokens: row.inputTokens, cachedInputTokens: row.cachedInputTokens, cacheEvidence: row.cacheEvidence, outputTokens: row.outputTokens, costUsd: row.costUsd, httpStatus: row.httpStatus, retryAfter: row.retryAfter, providerEvidenceHash: row.providerEvidenceHash, providerEvidenceRef: row.providerEvidenceRef });
  await writeAtomicJson(metricsPath, metrics);
  await resource.captureResult({ executionId: task.executionId, attemptId, resultHash, candidateDigest: common.candidateDigest, path: relative(output, verificationPath).replaceAll('\\', '/') });
  await resource.verified({ executionId: task.executionId, attemptId, verificationHash: resultHash, status: verification.status });
  if (task.arm === 'EXHARNESS') await resource.adopted({ executionId: task.executionId, attemptId, sessionId: `${resource.experimentId}:${task.executionId}`, eventHash: coreEvidence.events.at(-1).id });
  await resource.terminal({ executionId: task.executionId, attemptId, reason: terminalReason, status: terminalStatus, activeMs: attemptActiveMs, terminalAt });
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

async function materializeStudySnapshot({ output, manifest, resource, observationAsOf = nowIso(), runError = null, setupStatus = null }) {
  const state = await resource.state();
  const metrics = await collectMetrics(output, manifest);
  await writeAtomicJson(join(output, 'metrics.json'), metrics);
  const report = calculateStudyReport({ manifest, metrics, observationAsOf, resourceState: state });
  await writeAtomicJson(join(output, 'report.json'), report);
  await writeAtomicJson(join(output, 'observation.json'), { schemaVersion: 1, asOf: observationAsOf, evidenceClass: 'LIVE' });
  const blockedRequests = Object.values(state.requests).filter(item => ['INTENT', 'IN_FLIGHT', 'UNKNOWN'].includes(item.status));
  const waitingForProvider = [state.routeNextEligibleAt, ...Object.values(state.executions).map(item => item.nextEligibleAt)]
    .some(value => value && Date.parse(value) > Date.parse(observationAsOf));
  const setupReady = setupStatus?.ready ?? Boolean(await plainJson(join(output, 'setup', 'probes.json')).catch(() => null));
  const setupBlocked = !setupReady && setupStatus?.unresolvedProvider;
  const setupFailed = !setupReady && setupStatus?.prerequisiteMissing;
  await writeAtomicJson(join(output, 'current.json'), {
    schemaVersion: 1,
    evidenceClass: 'LIVE_HANDOFF',
    runStatus: runError ? 'STOPPED_WITH_ERROR' : state.cohortTerminalReason ? state.cohortTerminalReason : report.complete ? 'COMPLETE' : blockedRequests.length ? 'BLOCKED_PROVIDER' : waitingForProvider ? 'WAITING_PROVIDER' : setupFailed ? 'PREREQUISITE_MISSING' : 'INCOMPLETE',
    stopReason: runError ? String(runError.message ?? runError).slice(0, 1024) : state.cohortTerminalReason ?? (blockedRequests.length ? 'UNRESOLVED_PROVIDER_REQUEST' : setupFailed ? 'TWO_BUDGETED_PROVIDER_PROBES_FAILED' : null),
    studyId: manifest.studyId,
    profileHash: manifest.profileHash,
    candidateSha: manifest.candidateSha,
    candidateTree: manifest.candidateTree,
    resource: state,
    setup: { probes: setupStatus ?? null, complete: setupReady,
      missingPrerequisites: setupReady ? [] : [setupBlocked ? 'RECONCILE_PROVIDER_PROBE' : 'TWO_BUDGETED_PROVIDER_TOOL_PROBES'] },
    blockedRequests: blockedRequests.map(item => ({ requestId: item.requestId, executionId: item.executionId, status: item.status, reason: item.reason })),
    missingExecutions: manifest.tasks.map(task => task.executionId).filter(id => !metrics.executions.some(row => row.executionId === id)),
    nextEligibleAt: [state.routeNextEligibleAt, ...Object.values(state.executions).map(item => item.nextEligibleAt)].filter(Boolean).sort()[0] ?? null
  });
  await exportStudy(output);
  return { metrics, report, state };
}

export async function runStudy({ profile, output, executor = executeMiniAttempt, verify = verifyCandidate, clock = () => new Date() } = {}) {
  const identities = await fixtureIdentities();
  const value = await protocolFor({ profile });
  validateProfile(profile, { ...identities, requireLive: true, requirePilot: false,
    protocolId: value.protocolId ?? 'FIXTURE_VALUE_V1', protocolHash: `sha256:${sha256(value)}` });
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
  await assertRegisteredJevTrust({ output, manifest });
  const resource = new ResourceState({ journalPath: join(output, 'events.jsonl'), experimentId: manifest.studyId, profileHash: manifest.profileHash, candidateSha: manifest.candidateSha, candidateTree: manifest.candidateTree, protocolHash: manifest.protocolHash, limits: value.limits, now: clock });
  const owner = await resource.acquireCohortLock();
  let failure = null;
  let snapshot = null;
  let setupStatus = null;
  try {
    await recoverProviderJournal({ output, resource });
    setupStatus = await loadMaterializedQualificationSetup({ output, profile: executionProfile, value }) ??
      await runProviderProbes({ profile: executionProfile, output, manifest, resource, clock });
    for (const task of setupStatus.ready ? manifest.tasks : []) {
      const state = await resource.state();
      if (state.cohortTerminalReason) break;
      if (Object.values(state.requests).some(item => ['INTENT', 'IN_FLIGHT', 'UNKNOWN'].includes(item.status))) break;
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
        if (['WAITING_PROVIDER', 'RESOURCE_EXHAUSTED', 'UNRESOLVED_PROVIDER'].includes(error.studyReason)) break;
        throw error;
      }
      await materializeStudySnapshot({ output, manifest, resource });
      if ((await resource.state()).requests && Object.values((await resource.state()).requests).some(item => ['INTENT', 'IN_FLIGHT', 'UNKNOWN'].includes(item.status))) break;
    }
  } catch (error) {
    failure = error;
  } finally {
      try { snapshot = await materializeStudySnapshot({ output, manifest, resource, runError: failure, setupStatus }); }
    catch (error) { if (!failure) failure = error; }
    await resource.releaseCohortLock(owner);
  }
  if (failure) throw failure;
  const report = snapshot.report;
  const activeRequests = Object.values(snapshot.state.requests).filter(item => ['INTENT', 'IN_FLIGHT', 'UNKNOWN'].includes(item.status));
  const pendingTimes = [snapshot.state.routeNextEligibleAt, ...Object.values(snapshot.state.executions).map(item => item.nextEligibleAt)].filter(Boolean);
  const waiting = pendingTimes.some(value => Date.parse(value) > Date.parse(nowIso()));
  const exhausted = snapshot.state.cohortTerminalReason === 'RESOURCE_EXHAUSTED' || Object.values(snapshot.state.executions).some(item => item.status === 'TERMINAL' && item.terminalReason === 'RESOURCE_EXHAUSTED');
  const missingPrerequisite = setupStatus && !setupStatus.ready && setupStatus.prerequisiteMissing;
  const exitCode = report.complete ? 0 : activeRequests.length ? 11 : exhausted || setupStatus?.resourceExhausted ? 12 : waiting ? 10 : missingPrerequisite ? 3 : 4;
  return { mode: 'live', studyId: manifest.studyId, setup: setupStatus, measuredExecutions: snapshot.metrics.executions.length, complete: report.complete, exitCode };
}

export async function exportStudy(output) {
  const manifest = await loadManifest(output);
  const value = await protocolFor({ manifest });
  validateStudyManifest(manifest, { protocol: value, candidateSha: manifest.candidateSha, candidateTree: manifest.candidateTree });
  const state = await foldResourceJournal(await readResourceJournal(join(output, 'events.jsonl')), { experimentId: manifest.studyId, profileHash: manifest.profileHash, candidateSha: manifest.candidateSha, candidateTree: manifest.candidateTree, protocolHash: manifest.protocolHash });
  const files = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      if (entry.name.startsWith('.') || entry.name.endsWith('.owner') || entry.name.endsWith('.cohort-owner') || ['driver-config.json', 'probe-config.json'].includes(entry.name)) continue;
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile() && absolute !== join(output, 'handoff.json') && !entry.name.endsWith('.tmp') && !entry.name.includes('private') && !entry.name.includes('secret')) files.push(absolute);
    }
  }
  await visit(resolve(output));
  files.sort();
  const snapshot = await writeResourceSnapshot({ path: join(output, 'handoff.json'), state, journalPath: join(output, 'events.jsonl'), files });
  return { mode: 'export', output: 'handoff.json', fileCount: snapshot.files.length, stateHash: `sha256:${sha256(snapshot.state)}` };
}

async function auditHandoff({ output, manifest, resourceState }) {
  const handoff = await plainJson(join(output, 'handoff.json'));
  if (handoff.schemaVersion !== 1 || handoff.state?.experimentId !== manifest.studyId ||
      handoff.state?.profileHash !== manifest.profileHash || handoff.state?.candidateSha !== manifest.candidateSha ||
      handoff.state?.candidateTree !== manifest.candidateTree || canonical(handoff.state) !== canonical(portableResourceState(resourceState)))
    fail('handoff resource state identity is stale');
  const journalRef = handoff.journal?.ref;
  if (journalRef !== 'events.jsonl' || handoff.journal.hash !== await digestFile(join(output, journalRef))) fail('handoff journal hash is stale');
  const refs = new Set();
  for (const row of handoff.files ?? []) {
    if (!row.ref || row.ref.startsWith('/') || row.ref.split('/').includes('..') || refs.has(row.ref)) fail('handoff contains an unsafe or duplicate file reference');
    refs.add(row.ref);
    const path = resolve(output, row.ref);
    if (relative(resolve(output), path).startsWith('..')) fail('handoff file reference escapes output');
    const body = await readFile(path).catch(() => null);
    if (!body || body.byteLength !== row.bytes || `sha256:${createHash('sha256').update(body).digest('hex')}` !== row.hash)
      fail(`handoff file hash/size mismatch: ${row.ref}`);
  }
  for (const required of ['manifest.json', 'registration.json', 'events.jsonl', 'metrics.json', 'report.json', 'observation.json'])
    if (!refs.has(required)) fail(`handoff is missing required evidence: ${required}`);
  return handoff;
}

export async function auditStudy({ profile, profilePath = null, output }) {
  const identities = await fixtureIdentities();
  const manifest = await loadManifest(output);
  const value = await protocolFor({ profile, manifest });
  validateProfile(profile, { ...identities, requireLive: false, requirePilot: false,
    protocolId: value.protocolId ?? 'FIXTURE_VALUE_V1', protocolHash: `sha256:${sha256(value)}` });
  ensureCandidate(profile);
  const qualification = await assertQualification({ profile, profilePath, value });
  validateStudyManifest(manifest, { protocol: value, profileHash: sha256(profile), candidateSha: profile.candidateSha, candidateTree: profile.candidateTree });
  if (!['FIXTURE_VALUE_V1', 'CORE_VALUE_V2'].includes(manifest.studyKind) || manifest.evidenceClass !== 'LIVE_REGISTRATION' ||
      manifest.valueProtocolHash !== `sha256:${sha256(value)}`) fail('study manifest is synthetic, stale or uses another protocol');
  await assertRegisteredJevTrust({ output, manifest, requireController: false });
  const registration = await plainJson(join(output, 'registration.json'));
  if (registration.manifestHash !== `sha256:${sha256(manifest)}` || registration.manifestRef !== 'manifest.json' ||
      registration.resourceJournalRef !== 'events.jsonl') fail('registration identity is stale');
  if (qualification) {
    const bundledQualification = await plainJson(join(output, 'qualification.json')).catch(() => null);
    if (!bundledQualification || canonical(bundledQualification) !== canonical(qualification.artifact))
      fail('bundled qualification artifact is missing or stale');
  }
  const events = await readResourceJournal(join(output, 'events.jsonl'));
  const resourceState = foldResourceJournal(events, { experimentId: manifest.studyId, profileHash: manifest.profileHash,
    candidateSha: manifest.candidateSha, candidateTree: manifest.candidateTree, protocolHash: manifest.protocolHash });
  const metrics = await plainJson(join(output, 'metrics.json'));
  if (metrics.studyId !== manifest.studyId || !Array.isArray(metrics.executions)) fail('metrics identity/schema mismatch');
  const attempts = await jsonLines(join(output, 'attempts.jsonl'));
  const attemptById = new Map(attempts.map(row => [row.attemptId, row]));
  for (const task of manifest.tasks) {
    const executionState = resourceState.executions[task.executionId];
    if (!executionState) fail(`registered execution is missing from resource journal: ${task.executionId}`);
    const row = metrics.executions.find(item => item.executionId === task.executionId);
    if (!row) continue;
    if (row.profileHash !== manifest.profileHash || row.pairId !== task.pairId || row.arm !== task.arm ||
        row.taskId !== task.taskId || row.attemptCount !== executionState.attempts ||
        row.attemptId !== executionState.attemptHistory.at(-1)?.attemptId) fail(`metric/resource identity mismatch: ${task.executionId}`);
    const executionDir = join(output, 'executions', task.executionId.replaceAll(':', '__'));
    const attemptDir = join(executionDir, `attempt-${row.attemptCount}`);
    const actualCandidate = await candidateDigest(join(attemptDir, 'candidate'));
    if (actualCandidate !== row.candidateDigest) fail(`candidate digest mismatch: ${task.executionId}`);
    const verificationPath = join(attemptDir, 'verification.json');
    if (await digestFile(verificationPath) !== row.verificationHash) fail(`verification evidence hash mismatch: ${task.executionId}`);
    const verification = await plainJson(verificationPath);
    if (verification.executionId !== task.executionId || verification.arm !== task.arm || verification.taskId !== task.taskId ||
        verification.candidateDigest !== row.candidateDigest || verification.status !== row.verificationStatus || verification.evidenceClass !== 'LIVE')
      fail(`verification binding mismatch: ${task.executionId}`);
    if (row.timing.registeredAt !== task.registeredStart ||
        row.timing.terminalAt && row.timing.elapsedMs !== Date.parse(row.timing.terminalAt) - Date.parse(task.registeredStart) ||
        row.timing.activeMs != null && !Number.isFinite(row.timing.activeMs) ||
        row.timing.providerWaitMs != null && !Number.isFinite(row.timing.providerWaitMs))
      fail(`timing facts are inconsistent: ${task.executionId}`);
    const logAttempt = attemptById.get(row.attemptId);
    if (!logAttempt || logAttempt.executionId !== task.executionId || logAttempt.candidateDigest !== row.candidateDigest ||
        logAttempt.verification?.status !== row.verificationStatus) fail(`attempt evidence mismatch: ${task.executionId}`);
    const ledgerPath = await taskProviderLedgerPath(output, task.executionId);
    const localProvider = await providerFacts(ledgerPath);
    for (const field of ['wireRequests', 'modelCalls', 'inputTokens', 'outputTokens', 'cachedTokens', 'apiUsd', 'usageUnknown'])
      if (canonical(localProvider[field]) !== canonical(row.provider[field])) fail(`provider usage total mismatch for ${task.executionId}: ${field}`);
    const taskRequests = Object.values(resourceState.requests).filter(request => request.executionId === task.executionId);
    if (taskRequests.length !== localProvider.wireRequests) fail(`resource/provider wire count mismatch: ${task.executionId}`);
    for (const providerRow of localProvider.rows) {
      const shared = resourceState.requests[providerRow.requestId];
      if (!shared || shared.executionId !== task.executionId || shared.attemptId !== providerRow.attemptId || shared.status !== providerRow.status)
        fail(`resource/provider request binding mismatch: ${providerRow.requestId}`);
      if (providerRow.status === 'SETTLED' && (shared.responseHash !== providerRow.providerEvidenceHash ||
          shared.usage?.inputTokens !== providerRow.inputTokens || shared.usage?.outputTokens !== providerRow.outputTokens ||
          shared.usage?.costUsd !== providerRow.costUsd)) fail(`settled usage differs from resource journal: ${providerRow.requestId}`);
      await verifyProviderEvidenceRef({ output, providerRow, events });
    }
    if (task.arm === 'EXHARNESS') {
      const trace = await auditCoreTrace(join(executionDir, 'core-events.json'), { executionId: task.executionId, sessionId: `${manifest.studyId}:${task.executionId}` });
      if (canonical(trace.eventCounts) !== canonical(row.core?.eventCounts) || !row.core?.events?.length)
        fail(`Core lifecycle evidence mismatch: ${task.executionId}`);
    }
  }
  const probeManifest = await plainJson(join(output, 'setup', 'probes.json')).catch(() => null);
  const requiredProbeCount = value.qualification?.requiredSuccessfulProbes ?? value.limits.maxProbeRequests;
  const qualificationBacked = value.protocolId === 'CORE_VALUE_V2' &&
    probeManifest?.qualificationHash === profile.qualificationHash &&
    probeManifest?.selectedProfileId === profile.qualificationProfileId;
  const anyTaskDispatch = Object.values(resourceState.requests).some(row => !row.executionId.startsWith('SETUP:'));
  if (anyTaskDispatch && (!probeManifest || probeManifest.probes?.length < requiredProbeCount ||
      value.protocolId === 'CORE_VALUE_V2' && !qualificationBacked))
    fail('task provider dispatch occurred before the required successful registered probes');
  if (probeManifest) {
    if (probeManifest.evidenceClass !== 'LIVE_PROVIDER_PROBES' || probeManifest.modelId !== profile.model.providerModelId ||
        probeManifest.probes?.length < requiredProbeCount ||
        value.protocolId === 'CORE_VALUE_V2' && !qualificationBacked)
      fail('provider probe manifest identity/count mismatch');
    for (const probe of probeManifest.probes ?? []) {
      const probeId = probe.probeId;
      const index = Number(probeId?.match(/(\d+)$/)?.[1]);
      if (!Number.isInteger(index)) fail(`provider probe id is invalid: ${probeId}`);
      if (!probe || !probe.providerEvidenceRef || !probe.providerEvidenceHash ||
          await digestFile(safeEvidenceRef(output, probe.providerEvidenceRef)).catch(() => null) !== probe.providerEvidenceHash ||
          probe.outputTokens > value.limits.maxProbeOutputTokens)
        fail(`provider probe evidence incomplete: ${probeId}`);
      if (!qualificationBacked) {
        const executionId = `SETUP:${probeId}`;
        const setupExecution = resourceState.executions[executionId];
        const request = Object.values(resourceState.requests).find(item => item.executionId === executionId);
        if (setupExecution?.status !== 'COMPLETED' || request?.status !== 'SETTLED' ||
            probe.requestId !== request.requestId || probe.providerEvidenceHash !== request.responseHash ||
            probe.inputTokens !== request.usage?.inputTokens || probe.outputTokens !== request.usage?.outputTokens ||
            probe.costUsd !== request.usage?.costUsd)
          fail(`provider probe resource evidence incomplete: ${probeId}`);
      }
      const probeResult = await plainJson(safeEvidenceRef(output, `setup/${probeId.toLowerCase()}/result.json`));
      if (probeResult.status !== 'PASS' || probeResult.providerEvidenceRef !== probe.providerEvidenceRef ||
          probeResult.providerEvidenceHash !== probe.providerEvidenceHash ||
          probeResult.toolCall?.toolName !== 'bash' || probeResult.toolCall?.command !== `printf 'EXHARNESS_PROBE_${index}'` ||
          probeResult.usage?.outputTokens !== probe.outputTokens)
        fail(`provider probe tool-call result invalid: ${probeId}`);
    }
  }
  const observation = await plainJson(join(output, 'observation.json'));
  const report = calculateStudyReport({ manifest, metrics, observationAsOf: observation.asOf, resourceState });
  const stored = await plainJson(join(output, 'report.json'));
  if (canonical(stored) !== canonical(report)) fail('study report is stale');
  await auditHandoff({ output, manifest, resourceState });
  const outstanding = Object.values(resourceState.requests).filter(item => ['INTENT', 'IN_FLIGHT', 'UNKNOWN'].includes(item.status));
  const pendingAt = [resourceState.routeNextEligibleAt, ...Object.values(resourceState.executions).map(item => item.nextEligibleAt)]
    .some(at => at && Date.parse(at) > Date.now());
  const exhausted = resourceState.cohortTerminalReason === 'RESOURCE_EXHAUSTED' ||
    Object.values(resourceState.executions).some(item => item.terminalReason === 'RESOURCE_EXHAUSTED');
  const prerequisiteMissing = !probeManifest;
  const exitCode = report.complete ? 0 : outstanding.length ? 11 : exhausted ? 12 : pendingAt ? 10 : prerequisiteMissing ? 3 : 4;
  return { mode: 'audit', studyId: manifest.studyId, measuredExecutions: report.measuredExecutionCount,
    complete: report.complete, exitCode, valueEvaluationRef: report.valueEvaluationRef, evidenceClass: report.evidenceClass };
}

export async function statusStudy(output) {
  const manifest = await loadManifest(output);
  const state = await foldResourceJournal(await readResourceJournal(join(output, 'events.jsonl')), { experimentId: manifest.studyId });
  const outstandingRequests = Object.values(state.requests).filter(item => ['INTENT', 'IN_FLIGHT', 'UNKNOWN'].includes(item.status));
  return { mode: 'status', studyId: manifest.studyId, cohortTerminalReason: state.cohortTerminalReason,
    registeredExecutions: manifest.tasks.length, remainingExecutions: manifest.tasks.map(task => task.executionId).filter(id => !['COMPLETED', 'TERMINAL'].includes(state.executions[id]?.status)),
    executions: Object.values(state.executions).map(item => ({ executionId: item.executionId, status: item.status, attempts: item.attempts, activeMs: item.activeMs, providerWaitMs: item.providerWaitMs, deadline: item.deadline, nextEligibleAt: item.nextEligibleAt, outstandingRequestIds: item.outstandingRequestIds })),
    outstandingRequests: outstandingRequests.map(item => ({ requestId: item.requestId, executionId: item.executionId, status: item.status, reservedTokens: Number(item.inputTokensReserved ?? 0) + Number(item.outputTokensReserved ?? 0), reservedUsd: item.costUsdReserved })),
    earliestRetryAt: [state.routeNextEligibleAt, ...Object.values(state.executions).map(item => item.nextEligibleAt)].filter(value => value && Date.parse(value) > Date.now()).sort()[0] ?? null };
}

export async function main(args = process.argv.slice(2)) {
  const mode = option(args, '--mode') ?? 'status';
  const output = option(args, '--output');
  const profilePath = option(args, '--profile');
  if (!output) fail('--output is required');
  const out = resolve(output);
  if (mode === 'register') return registerStudy({ profile: await plainJson(resolve(profilePath)), profilePath: resolve(profilePath), output: out });
  if (mode === 'live' || mode === 'resume') return runStudy({ profile: await plainJson(resolve(profilePath)), output: out });
  if (mode === 'audit') return auditStudy({ profile: await plainJson(resolve(profilePath)), profilePath: resolve(profilePath), output: out });
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
