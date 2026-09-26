import { randomBytes, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, lstat, readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtureIdentities, sha256, validateProfile } from './contract.mjs';
import { ResourceState, readResourceJournal } from './resource-state.mjs';
import { canaryDigest } from './fixture/acceptance.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const fail = (message, code = 2) => {
  const error = new Error(`BASELINE_CANARY_INVALID: ${message}`);
  error.exitCode = code;
  throw error;
};
const option = (args, name) => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
const plainJson = path => readFile(path, 'utf8').then(JSON.parse);
const nowIso = () => new Date().toISOString();

export const CANARY_CAPS = Object.freeze({
  maxWireRequests: 4,
  maxTotalTokens: 50000,
  maxActiveSeconds: 1200,
  maxApiUsd: 5
});
const CANARY_EXECUTION_ID = 'CANARY:AUX';
const CANARY_TASK_ID = 'CANARY-AUX';
const CANARY_MAX_OUTPUT_TOKENS = 4096;

function artifactDigest(artifact) {
  return `sha256:${sha256(Object.fromEntries(Object.entries(artifact).filter(([key]) => key !== 'digest')))}`;
}

function canaryProfileFor(profile) {
  const budgets = profile.budgets ?? {};
  const num = (value, fallback) => Number.isFinite(value) ? value : fallback;
  return {
    ...profile,
    budgets: {
      ...budgets,
      maxWireRequestsPerExecution: Math.min(num(budgets.maxWireRequestsPerExecution, CANARY_CAPS.maxWireRequests), CANARY_CAPS.maxWireRequests),
      maxModelCalls: Math.min(num(budgets.maxModelCalls ?? budgets.maxModelCallsPerExecution, CANARY_CAPS.maxWireRequests), CANARY_CAPS.maxWireRequests),
      maxTotalTokens: Math.min(num(budgets.maxTotalTokens ?? budgets.maxTotalTokensPerExecution, CANARY_CAPS.maxTotalTokens), CANARY_CAPS.maxTotalTokens),
      maxApiUsd: Math.min(num(budgets.maxApiUsd ?? budgets.maxApiUsdPerExecution, CANARY_CAPS.maxApiUsd), CANARY_CAPS.maxApiUsd),
      maxWallSeconds: Math.min(num(budgets.maxWallSeconds ?? budgets.maxExecutionActiveSeconds, CANARY_CAPS.maxActiveSeconds), CANARY_CAPS.maxActiveSeconds)
    }
  };
}

function canaryPrompt(nonce) {
  return `Runtime-readiness check with two separate tool steps. First, read /workspace/nonce.txt with bash and observe its exact content. ` +
    `Then, in a separate later step, write exactly the marker text CANARY-MARKER-${nonce} into /workspace/marker.txt ` +
    `using the nonce value you observed (one trailing newline at most, no other content). ` +
    `Do not combine the read and the write in a single command. When the marker file holds the exact marker, submit.`;
}

export function countCanaryToolTurns(trajectory) {
  const messages = Array.isArray(trajectory?.messages) ? trajectory.messages : [];
  const isActionTurn = message => Array.isArray(message?.extra?.actions) && message.extra.actions.length > 0;
  const isObservation = message => message?.role === 'tool' ||
    (message?.role === 'user' && message?.extra && Object.hasOwn(message.extra, 'raw_output'));
  let toolTurns = 0;
  let toolResults = 0;
  for (const message of messages) {
    if (isActionTurn(message)) toolTurns += 1;
    if (isObservation(message)) toolResults += 1;
  }
  let interleaved = false;
  let stage = 0;
  for (const message of messages) {
    if (stage === 0 && isActionTurn(message)) stage = 1;
    else if (stage === 1 && isObservation(message)) stage = 2;
    else if (stage === 2 && isActionTurn(message)) { interleaved = true; break; }
  }
  return { toolTurns, toolResults, interleaved };
}

export function inspectCanaryNative(trajectory, { maxOutputTokens = CANARY_MAX_OUTPUT_TOKENS } = {}) {
  const messages = Array.isArray(trajectory?.messages) ? trajectory.messages : [];
  const responses = [];
  for (const message of messages) {
    const raw = message?.extra?.response;
    if (raw && typeof raw === 'object') responses.push(raw);
  }
  let nativeToolCalls = 0;
  let maxObserved = 0;
  let truncated = false;
  let missing = false;
  for (const raw of responses) {
    const choice = raw?.choices?.[0];
    const msg = choice?.message ?? {};
    const calls = msg?.tool_calls;
    const hasCalls = Array.isArray(calls) && calls.length > 0;
    if (hasCalls) nativeToolCalls += 1;
    else missing = true;
    const usage = raw?.usage ?? choice?.usage ?? null;
    const completion = Number(usage?.completion_tokens ?? usage?.outputTokens ?? NaN);
    if (Number.isFinite(completion)) {
      maxObserved = Math.max(maxObserved, completion);
      if (completion >= maxOutputTokens) truncated = true;
    }
    const finish = choice?.finish_reason ?? choice?.finishReason ?? null;
    if (finish === 'length') truncated = true;
  }
  // Fall back to ledger-adjacent evidence when trajectory omits raw responses:
  // missing stays false when there were no responses to inspect (telemetry only).
  return {
    responses: responses.length,
    nativeToolCalls,
    missingNativeToolCall: responses.length > 0 && missing,
    truncatedResponse: truncated,
    maxOutputTokensObserved: maxObserved
  };
}

export function inspectCanaryOrdering(trajectory, nonce, marker) {
  const messages = Array.isArray(trajectory?.messages) ? trajectory.messages : [];
  if (!nonce || !marker) return { readObserved: false, writeObserved: false, readBeforeWrite: null };
  let firstReadResult = -1;
  let writeAfterRead = false;
  let readObserved = false;
  let writeObserved = false;
  messages.forEach((message, index) => {
    if (message?.role === 'tool' && typeof message?.content === 'string' && message.content.includes(nonce)) {
      readObserved = true;
      if (firstReadResult < 0) firstReadResult = index;
    }
    const actions = message?.extra?.actions;
    if (Array.isArray(actions)) {
      for (const action of actions) {
        const cmd = typeof action?.command === 'string' ? action.command : JSON.stringify(action ?? '');
        if (cmd.includes(marker)) {
          writeObserved = true;
          if (firstReadResult >= 0 && index > firstReadResult) writeAfterRead = true;
        }
      }
    }
  });
  return { readObserved, writeObserved, readBeforeWrite: readObserved && writeObserved ? writeAfterRead : null };
}

async function readLedgerRows(ledgerPath) {
  const body = await readFile(ledgerPath, 'utf8').catch(error => {
    if (error.code === 'ENOENT') return '';
    throw error;
  });
  return body.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
}

function foldCanaryLedger(rows) {
  const reserves = rows.filter(row => row.kind === 'RESERVE').length;
  const settled = rows.filter(row => row.kind === 'SETTLED');
  const unknown = rows.filter(row => row.kind === 'UNKNOWN');
  const notAdmitted = rows.filter(row => row.kind === 'NOT_ADMITTED');
  return {
    wireRequests: reserves,
    settled: settled.length,
    unknown: unknown.length,
    notAdmitted: notAdmitted.length,
    inputTokens: settled.reduce((sum, row) => sum + (row.inputTokens ?? 0), 0),
    outputTokens: settled.reduce((sum, row) => sum + (row.outputTokens ?? 0), 0),
    apiUsd: settled.reduce((sum, row) => sum + (row.costUsd ?? 0), 0),
    settledRows: settled,
    unknownRows: unknown
  };
}

export function decideCanaryStatus({ markerOk, exitSubmitted, turns, ledger, capsOk, driverFailed, captureError = null, timingMissing = false, nativeMissing = false, truncated = false }) {
  if (ledger.unknown > 0 || driverFailed === 'ambiguous') return { status: 'UNRESOLVED', failureReason: 'UNKNOWN_USAGE', failureReasons: ['UNKNOWN_USAGE'] };
  const reasons = [];
  if (captureError) reasons.push('CAPTURE_ERROR');
  if (timingMissing) reasons.push('TIMING_MISSING');
  if (!markerOk) reasons.push('MARKER_MISMATCH');
  if (!exitSubmitted) reasons.push('MISSING_SUBMISSION');
  if (!turns.interleaved || turns.toolTurns < 2) reasons.push('MISSING_INTERLEAVED_TURNS');
  if (!capsOk) reasons.push('CAP_BREACH');
  if (nativeMissing) reasons.push('NO_NATIVE_TOOL_CALL');
  if (truncated) reasons.push('OUTPUT_TRUNCATED');
  if (reasons.length === 0) return { status: 'PASS', failureReason: null, failureReasons: [] };
  return { status: 'FAIL', failureReason: reasons[0], failureReasons: reasons };
}

function legacyDecideCanaryStatus({ markerOk, exitSubmitted, turns, ledger, capsOk, driverFailed }) {
  if (ledger.unknown > 0 || driverFailed === 'ambiguous') return 'UNRESOLVED';
  if (!markerOk || !exitSubmitted || !turns.interleaved || turns.toolTurns < 2 || !capsOk) return 'FAIL';
  return 'PASS';
}

export async function runCanary({ profile, output, executor = null, clock = () => new Date() } = {}) {
  if (!profile || !output) fail('profile and output are required');
  const directory = resolve(output);
  const identities = await fixtureIdentities();
  const value = await plainJson(join(root, 'core-value-protocol.json'));
  validateProfile(profile, { ...identities, requireLive: true, requirePilot: false,
    protocolId: value.protocolId, protocolHash: `sha256:${sha256(value)}` });
  const profileHash = sha256(profile);
  const canaryRoot = join(directory, 'canary');
  const artifactPath = join(canaryRoot, 'canary.json');
  const prior = await plainJson(artifactPath).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (prior) {
    const audited = await auditCanary({ output: directory, profile });
    if (audited.status !== 'PASS') fail(`recorded canary did not pass: ${audited.status}`);
    return { mode: 'canary', status: 'PASS', output: artifactPath, cached: true, exitCode: 0 };
  }
  const nonce = randomBytes(8).toString('hex');
  const expectedMarker = `CANARY-MARKER-${nonce}`;
  const attemptDir = join(canaryRoot, 'attempt-1');
  const candidateDir = join(attemptDir, 'candidate');
  await mkdir(candidateDir, { recursive: true });
  await mkdir(join(directory, 'executions', CANARY_EXECUTION_ID), { recursive: true });
  await writeFile(join(candidateDir, 'nonce.txt'), `${nonce}\n`);
  const journalPath = join(canaryRoot, 'events.jsonl');
  const resource = new ResourceState({ journalPath, experimentId: `CANARY:${profileHash.slice(0, 16)}`,
    profileHash, candidateSha: profile.candidateSha, candidateTree: profile.candidateTree,
    protocolHash: `sha256:${sha256(value)}`, limits: value.limits, now: clock });
  const startedAt = clock();
  const startedDate = startedAt instanceof Date ? startedAt : new Date(startedAt);
  const wallStartedMs = Date.now();
  await resource.registerExecution({ executionId: CANARY_EXECUTION_ID, pairId: 'CANARY', taskId: CANARY_TASK_ID,
    arm: 'DIRECT', repeat: 1, deadline: new Date(startedDate.getTime() + CANARY_CAPS.maxActiveSeconds * 1000).toISOString() });
  await resource.registerAttempt({ executionId: CANARY_EXECUTION_ID, attemptId: `${CANARY_EXECUTION_ID}:attempt-1`, attemptNumber: 1 });
  await resource.startAttempt({ executionId: CANARY_EXECUTION_ID, attemptId: `${CANARY_EXECUTION_ID}:attempt-1` });
  const attemptProfile = canaryProfileFor(profile);
  const resourceContext = { journalPath, experimentId: resource.experimentId, ...resource.identity,
    limits: resource.limits, executionId: CANARY_EXECUTION_ID };
  const runExecutor = executor ?? (await import('./study.mjs')).executeMiniAttempt;
  let attempt = null;
  let driverFailed = null;
  let captureError = null;
  try {
    attempt = await runExecutor({ profile: attemptProfile, task: { taskId: CANARY_TASK_ID, prompt: canaryPrompt(nonce) },
      output: directory, executionId: CANARY_EXECUTION_ID, attemptId: `${CANARY_EXECUTION_ID}:attempt-1`,
      candidateDir, attemptDir, resourceContext, workspaceKind: 'canary' });
    if (attempt?.candidateDigestError) captureError = String(attempt.candidateDigestError).slice(0, 512);
  } catch (error) {
    driverFailed = error?.code === 'RESOURCE_WAIT' || /ambiguous|unknown|timeout/i.test(String(error?.message ?? '')) ? 'ambiguous' : 'definitive';
    captureError = String(error?.message ?? error).slice(0, 512);
    // Preserve durable driver evidence instead of overwriting it with a
    // synthetic model failure. Read the driver-result file the child wrote
    // (e.g. LimitsExceeded) and measure real timing; never zero it.
    const filed = await plainJson(join(attemptDir, 'driver-result.json')).catch(() => null);
    const activeFallback = Math.max(0, Date.now() - wallStartedMs);
    attempt = {
      driverResult: filed ?? { exitStatus: 'FAILED', error: captureError },
      provider: { wireRequests: 0, inputTokens: 0, outputTokens: 0, apiUsd: 0, usageUnknown: driverFailed === 'ambiguous' },
      timing: { activeMs: activeFallback, providerWaitMs: Number(filed?.providerWaitSeconds ?? 0) * 1000 || 0, provenance: 'measured-catch' },
      candidateDigest: null,
      candidateDigestError: captureError
    };
  }
  // Ensure the driver-result file exists for audit cross-checks (stub
  // executors return an object without writing the file).
  const driverRef = 'canary/attempt-1/driver-result.json';
  const driverPath = join(attemptDir, 'driver-result.json');
  const existingDriver = await plainJson(driverPath).catch(() => null);
  if (!existingDriver && attempt?.driverResult) {
    await writeFile(driverPath, `${JSON.stringify({ schemaVersion: 1, ...attempt.driverResult })}\n`);
  }
  const filedDriver = await plainJson(driverPath).catch(() => null);
  const driverExitStatus = String(filedDriver?.exitStatus ?? attempt?.driverResult?.exitStatus ?? 'MISSING');
  const ledgerPath = join(directory, 'executions', CANARY_EXECUTION_ID, 'provider-ledger.jsonl');
  const ledger = foldCanaryLedger(await readLedgerRows(ledgerPath));
  const trajectory = await plainJson(join(attemptDir, 'trajectory.json')).catch(() => null);
  const turns = countCanaryToolTurns(trajectory);
  const native = inspectCanaryNative(trajectory);
  const ordering = inspectCanaryOrdering(trajectory, nonce, expectedMarker);
  const marker = await readFile(join(candidateDir, 'marker.txt'), 'utf8').catch(() => null);
  const markerOk = marker != null && marker.replace(/\r?\n$/, '') === expectedMarker;
  const exitSubmitted = driverExitStatus === 'Submitted';
  const rawActive = Number(attempt?.timing?.activeMs);
  const timingMissing = !Number.isFinite(rawActive);
  const activeMs = timingMissing ? null : Math.max(0, rawActive);
  const timingProvenance = attempt?.timing?.provenance ?? (timingMissing ? 'missing' : 'measured');
  const capsOk = !timingMissing &&
    ledger.wireRequests <= CANARY_CAPS.maxWireRequests &&
    ledger.inputTokens + ledger.outputTokens <= CANARY_CAPS.maxTotalTokens &&
    activeMs <= CANARY_CAPS.maxActiveSeconds * 1000 &&
    ledger.apiUsd <= CANARY_CAPS.maxApiUsd;
  const usageSettled = ledger.unknown === 0;
  let workspaceDigest = null;
  try {
    workspaceDigest = await canaryDigest(candidateDir);
  } catch (error) {
    const msg = String(error?.message ?? error).slice(0, 512);
    captureError = captureError ? `${captureError} | ${msg}` : msg;
  }
  const decided = decideCanaryStatus({ markerOk, exitSubmitted, turns, ledger, capsOk, driverFailed,
    captureError, timingMissing, nativeMissing: native.missingNativeToolCall, truncated: native.truncatedResponse });
  const status = decided.status;
  const terminalReason = status === 'PASS' ? 'COMPLETED' : status === 'UNRESOLVED' ? 'UNRESOLVED_PROVIDER' : 'INFRASTRUCTURE_FAILURE';
  await resource.terminal({ executionId: CANARY_EXECUTION_ID, attemptId: `${CANARY_EXECUTION_ID}:attempt-1`,
    reason: terminalReason, status: status === 'PASS' ? 'COMPLETED' : 'TERMINAL', activeMs: activeMs ?? 0,
    terminalAt: (clock() instanceof Date ? clock() : new Date(clock())).toISOString() });
  const body = { schemaVersion: 1, evidenceClass: 'LIVE_CANARY', task: 'NONCE_MARKER',
    profileHash, candidateSha: profile.candidateSha, candidateTree: profile.candidateTree,
    modelId: profile.model.providerModelId, nonce, marker: expectedMarker,
    markerRef: 'canary/attempt-1/candidate/marker.txt', trajectoryRef: 'canary/attempt-1/trajectory.json',
    ledgerRef: `executions/${CANARY_EXECUTION_ID}/provider-ledger.jsonl`,
    driverRef,
    toolTurns: turns.toolTurns, toolResults: turns.toolResults, toolTurnsInterleaved: turns.interleaved,
    wireRequests: ledger.wireRequests, inputTokens: ledger.inputTokens, outputTokens: ledger.outputTokens,
    apiUsd: ledger.apiUsd, activeMs,
    exitStatus: driverExitStatus, driverExitStatus, driverFailed: driverFailed ?? null,
    captureError: captureError ?? null,
    submissionObserved: exitSubmitted, markerVerified: markerOk, usageSettled,
    timingProvenance,
    canaryDigest: workspaceDigest,
    nativeResponses: native.responses, nativeToolCalls: native.nativeToolCalls,
    missingNativeToolCall: native.missingNativeToolCall, truncatedResponse: native.truncatedResponse,
    maxOutputTokensObserved: native.maxOutputTokensObserved,
    readObserved: ordering.readObserved, writeObserved: ordering.writeObserved, readBeforeWrite: ordering.readBeforeWrite,
    failureReason: decided.failureReason, failureReasons: decided.failureReasons,
    caps: { ...CANARY_CAPS },
    status, generatedAt: nowIso() };
  const artifact = { ...body, digest: artifactDigest(body) };
  try {
    await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, { flag: 'wx' });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    fail('canary record changed under a concurrent run');
  }
  return { mode: 'canary', status, output: artifactPath, cached: false, exitCode: status === 'PASS' ? 0 : 1 };
}

export async function auditCanary({ output, profile } = {}) {
  if (!output || !profile) fail('output and profile are required');
  const directory = resolve(output);
  const artifact = await plainJson(join(directory, 'canary', 'canary.json')).catch(() => null);
  if (!artifact) fail('canary record is missing; qualification-then-canary must pass before cohort registration');
  if (artifact.schemaVersion !== 1 || artifact.evidenceClass !== 'LIVE_CANARY' || artifact.task !== 'NONCE_MARKER')
    fail('canary record identity is invalid');
  if (artifact.digest !== artifactDigest(artifact)) fail('canary record digest mismatch');
  const profileHash = sha256(profile);
  if (artifact.profileHash !== profileHash || artifact.candidateSha !== profile.candidateSha ||
      artifact.candidateTree !== profile.candidateTree || artifact.modelId !== profile.model.providerModelId)
    fail('canary record is not bound to the registered profile and candidate');
  const ledger = foldCanaryLedger(await readLedgerRows(resolve(directory, artifact.ledgerRef)));
  if (relative(directory, resolve(directory, artifact.ledgerRef)).startsWith('..')) fail('canary ledger reference escapes study output');
  if (ledger.wireRequests !== artifact.wireRequests || ledger.inputTokens !== artifact.inputTokens ||
      ledger.outputTokens !== artifact.outputTokens || ledger.apiUsd !== artifact.apiUsd)
    fail('canary ledger totals differ from the record');
  for (const row of ledger.settledRows) {
    if (!row.providerEvidenceRef || !row.providerEvidenceHash) fail(`canary settled request lacks evidence: ${row.requestId}`);
    const evidencePath = resolve(directory, row.providerEvidenceRef);
    if (relative(directory, evidencePath).startsWith('..')) fail('canary evidence reference escapes study output');
    const bytes = await readFile(evidencePath).catch(() => null);
    if (!bytes || `sha256:${createHash('sha256').update(bytes).digest('hex')}` !== row.providerEvidenceHash)
      fail(`canary provider evidence changed or missing: ${row.requestId}`);
  }
  const trajectory = await plainJson(resolve(directory, artifact.trajectoryRef)).catch(() => null);
  if (!trajectory) fail('canary trajectory is missing');
  const turns = countCanaryToolTurns(trajectory);
  if (turns.toolTurns !== artifact.toolTurns || turns.toolResults !== artifact.toolResults ||
      turns.interleaved !== artifact.toolTurnsInterleaved)
    fail('canary trajectory turn counts differ from the record');
  const native = inspectCanaryNative(trajectory);
  if (artifact.missingNativeToolCall !== undefined && Boolean(artifact.missingNativeToolCall) !== native.missingNativeToolCall)
    fail('canary native tool-call flag differs from the trajectory');
  if (artifact.truncatedResponse !== undefined && Boolean(artifact.truncatedResponse) !== native.truncatedResponse)
    fail('canary truncation flag differs from the trajectory');
  const marker = await readFile(resolve(directory, artifact.markerRef), 'utf8').catch(() => null);
  const markerOk = marker != null && marker.replace(/\r?\n$/, '') === artifact.marker;
  if (!markerOk) fail('canary marker file does not hold the recorded marker');
  // Cross-check durable driver evidence: the recorded exit status must match
  // the driver-result file even when the artifact digest was recomputed.
  const driverRef = artifact.driverRef ?? 'canary/attempt-1/driver-result.json';
  if (relative(directory, resolve(directory, driverRef)).startsWith('..')) fail('canary driver reference escapes study output');
  const filedDriver = await plainJson(resolve(directory, driverRef)).catch(() => null);
  if (!filedDriver) fail('canary driver result is missing');
  const filedExit = String(filedDriver.exitStatus ?? 'MISSING');
  const recordedExit = String(artifact.driverExitStatus ?? artifact.exitStatus ?? 'MISSING');
  if (filedExit !== recordedExit) fail(`canary driver exit status differs from the record: file ${filedExit} vs record ${recordedExit}`);
  if (artifact.submissionObserved !== undefined && Boolean(artifact.submissionObserved) !== (filedExit === 'Submitted'))
    fail('canary submission flag differs from the driver result');
  if (artifact.markerVerified !== undefined && Boolean(artifact.markerVerified) !== markerOk)
    fail('canary marker flag differs from the marker file');
  if (artifact.usageSettled !== undefined && Boolean(artifact.usageSettled) !== (ledger.unknown === 0))
    fail('canary usage flag differs from the ledger');
  // Timing: missing is missing evidence, never zero. A finite record must be
  // consistent with the journal terminal event; a null record must fail caps.
  const timingMissing = artifact.activeMs == null || !Number.isFinite(artifact.activeMs);
  if (artifact.timingProvenance !== undefined && timingMissing && artifact.timingProvenance !== 'missing' && artifact.timingProvenance !== 'measured-catch')
    fail('canary timing provenance contradicts missing timing');
  try {
    const journal = await readResourceJournal(join(directory, 'canary', 'events.jsonl'));
    const terminal = [...journal].reverse().find(event => (event.kind === 'ATTEMPT_TERMINAL' || event.kind === 'TERMINAL') && (event.attemptId === `${CANARY_EXECUTION_ID}:attempt-1` || event.executionId === CANARY_EXECUTION_ID));
    if (terminal?.kind === 'ATTEMPT_TERMINAL') {
      const journalMs = Number(terminal.payload?.activeMs);
      if (!timingMissing && Number.isFinite(journalMs) && journalMs !== Number(artifact.activeMs))
        fail(`canary timing differs from the journal: journal ${journalMs} vs record ${artifact.activeMs}`);
    }
    // Legacy TERMINAL records (pre-repair) carry reason only with no activeMs;
    // they are audited for driver/marker/ledger without retrofitting timing.
  } catch (error) {
    if (!String(error?.message ?? '').includes('BASELINE_CANARY_INVALID')) throw error;
    // Journal errors propagate as audit failures only when they indicate tampering;
    // a missing journal is itself missing evidence.
    fail(`canary journal is unreadable: ${String(error?.message ?? error).slice(0, 200)}`);
  }
  // Workspace digest: recompute from real files when the record carries one.
  // Legacy r6 records lack canaryDigest; they are still audited for marker,
  // driver, timing and ledger without retrofitting the digest.
  if (artifact.canaryDigest !== undefined && artifact.canaryDigest !== null) {
    const candidateDir = resolve(directory, dirname(artifact.markerRef));
    if (relative(directory, candidateDir).startsWith('..')) fail('canary marker reference escapes study output');
    const recomputed = await canaryDigest(candidateDir).catch(error => { throw new Error(`BASELINE_CANARY_INVALID: canary workspace digest failed: ${String(error?.message ?? error).slice(0, 200)}`); });
    if (recomputed !== artifact.canaryDigest) fail('canary workspace digest differs from the record');
  }
  if (artifact.captureError !== undefined && artifact.captureError !== null && typeof artifact.captureError !== 'string')
    fail('canary capture error is malformed');
  const capsOk = !timingMissing &&
    artifact.wireRequests <= CANARY_CAPS.maxWireRequests &&
    artifact.inputTokens + artifact.outputTokens <= CANARY_CAPS.maxTotalTokens &&
    artifact.activeMs <= CANARY_CAPS.maxActiveSeconds * 1000 && artifact.apiUsd <= CANARY_CAPS.maxApiUsd;
  const recomputed = decideCanaryStatus({ markerOk, exitSubmitted: filedExit === 'Submitted',
    turns, ledger, capsOk, driverFailed: artifact.driverFailed ?? null,
    captureError: artifact.captureError ?? null, timingMissing,
    nativeMissing: native.missingNativeToolCall, truncated: native.truncatedResponse });
  // Legacy records predate native/truncation flags: accept either the legacy
  // gate or the strict gate, but never upgrade FAIL to PASS.
  const legacy = legacyDecideCanaryStatus({ markerOk, exitSubmitted: filedExit === 'Submitted', turns, ledger, capsOk, driverFailed: artifact.driverFailed ?? null });
  if (recomputed.status !== artifact.status && !(artifact.status === 'FAIL' && legacy === 'FAIL' && recomputed.status === 'FAIL'))
    fail(`canary record status ${artifact.status} contradicts re-materialized facts (${recomputed.status})`);
  if (artifact.status === 'FAIL' && artifact.failureReason !== undefined) {
    const expected = recomputed.failureReason;
    // Allow legacy FAIL records without failureReason; new records must carry
    // the exact primary reason (tampering with exit/timing changes it).
    if (artifact.failureReason !== null && expected !== null && artifact.failureReason !== expected) {
      // Permit additional reasons in any order, but the primary must match
      // unless the record predates the reason taxonomy (failureReason null).
      fail(`canary failure reason ${artifact.failureReason} contradicts re-materialized facts (${expected})`);
    }
    if (Array.isArray(artifact.failureReasons)) {
      for (const reason of recomputed.failureReasons) {
        if (!artifact.failureReasons.includes(reason) && !(artifact.canaryDigest === undefined && (reason === 'NO_NATIVE_TOOL_CALL' || reason === 'OUTPUT_TRUNCATED'))) {
          // New strict reasons must be present in new records; legacy r6
          // predates them and is exempt from the extra-reason check.
          if (artifact.failureReason !== undefined && artifact.nativeResponses === undefined) break;
          fail(`canary failure reasons omit re-materialized fact (${reason})`);
        }
      }
    }
  }
  return { mode: 'canary-audit', status: artifact.status, toolTurns: turns.toolTurns, exitCode: artifact.status === 'PASS' ? 0 : 1 };
}

export function validateCanaryArtifact({ artifact, profile } = {}) {
  if (!artifact || artifact.schemaVersion !== 1 || artifact.evidenceClass !== 'LIVE_CANARY')
    fail('canary artifact identity is invalid', 3);
  if (artifact.digest !== artifactDigest(artifact)) fail('canary artifact digest mismatch', 3);
  if (artifact.profileHash !== sha256(profile) || artifact.candidateSha !== profile.candidateSha ||
      artifact.candidateTree !== profile.candidateTree) fail('canary artifact binding is stale', 3);
  if (typeof artifact.toolTurns !== 'number' || artifact.toolTurns < 2 || artifact.toolTurnsInterleaved !== true)
    fail('canary artifact lacks two interleaved tool turns', 3);
  if (artifact.wireRequests > CANARY_CAPS.maxWireRequests ||
      artifact.inputTokens + artifact.outputTokens > CANARY_CAPS.maxTotalTokens ||
      artifact.apiUsd > CANARY_CAPS.maxApiUsd) fail('canary artifact exceeds runtime-readiness caps', 3);
  if (artifact.status !== 'PASS') fail(`cohort registration requires a passing canary, found ${artifact.status}`, 3);
  return true;
}

export async function assertCanaryForRegistration({ output, profile } = {}) {
  const artifact = await plainJson(join(resolve(output), 'canary', 'canary.json')).catch(() => null);
  if (!artifact) fail('cohort registration requires a passing runtime-readiness canary before dispatch', 3);
  validateCanaryArtifact({ artifact, profile });
  await auditCanary({ output, profile });
  return artifact;
}

export async function main(args = process.argv.slice(2)) {
  const mode = option(args, '--mode') ?? 'run';
  const profilePath = option(args, '--profile');
  const output = option(args, '--output');
  if (!profilePath || !output) fail('--profile and --output are required');
  const profile = await plainJson(resolve(profilePath));
  if (mode === 'run') return runCanary({ profile, output: resolve(output) });
  if (mode === 'audit') return auditCanary({ output: resolve(output), profile });
  fail(`unknown mode: ${mode}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await main())); }
  catch (error) { console.error(error.message); process.exitCode = error.exitCode ?? 4; }
}
