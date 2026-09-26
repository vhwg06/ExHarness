import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtureIdentities, sha256, validateProfile } from './contract.mjs';
import { ResourceState } from './resource-state.mjs';

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

function decideCanaryStatus({ markerOk, exitSubmitted, turns, ledger, capsOk, driverFailed }) {
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
  try {
    attempt = await runExecutor({ profile: attemptProfile, task: { taskId: CANARY_TASK_ID, prompt: canaryPrompt(nonce) },
      output: directory, executionId: CANARY_EXECUTION_ID, attemptId: `${CANARY_EXECUTION_ID}:attempt-1`,
      candidateDir, attemptDir, resourceContext });
  } catch (error) {
    driverFailed = error?.code === 'RESOURCE_WAIT' || /ambiguous|unknown|timeout/i.test(String(error?.message ?? '')) ? 'ambiguous' : 'definitive';
    attempt = { driverResult: { exitStatus: 'FAILED', error: String(error?.message ?? error).slice(0, 512) },
      provider: { wireRequests: 0, inputTokens: 0, outputTokens: 0, apiUsd: 0, usageUnknown: driverFailed === 'ambiguous' },
      timing: { activeMs: 0, providerWaitMs: 0 } };
  }
  const ledgerPath = join(directory, 'executions', CANARY_EXECUTION_ID, 'provider-ledger.jsonl');
  const ledger = foldCanaryLedger(await readLedgerRows(ledgerPath));
  const trajectory = await plainJson(join(attemptDir, 'trajectory.json')).catch(() => null);
  const turns = countCanaryToolTurns(trajectory);
  const marker = await readFile(join(candidateDir, 'marker.txt'), 'utf8').catch(() => null);
  const markerOk = marker != null && marker.replace(/\r?\n$/, '') === expectedMarker;
  const exitSubmitted = attempt?.driverResult?.exitStatus === 'Submitted';
  const activeMs = Number(attempt?.timing?.activeMs ?? 0);
  const capsOk = ledger.wireRequests <= CANARY_CAPS.maxWireRequests &&
    ledger.inputTokens + ledger.outputTokens <= CANARY_CAPS.maxTotalTokens &&
    (Number.isFinite(activeMs) ? activeMs : Infinity) <= CANARY_CAPS.maxActiveSeconds * 1000 &&
    ledger.apiUsd <= CANARY_CAPS.maxApiUsd;
  const status = decideCanaryStatus({ markerOk, exitSubmitted, turns, ledger, capsOk, driverFailed });
  const terminalReason = status === 'PASS' ? 'COMPLETED' : status === 'UNRESOLVED' ? 'UNRESOLVED_PROVIDER' : 'INFRASTRUCTURE_FAILURE';
  await resource.terminal({ executionId: CANARY_EXECUTION_ID, attemptId: `${CANARY_EXECUTION_ID}:attempt-1`,
    reason: terminalReason, activeMs: Number.isFinite(activeMs) ? Math.max(0, activeMs) : 0,
    terminalAt: (clock() instanceof Date ? clock() : new Date(clock())).toISOString() });
  const body = { schemaVersion: 1, evidenceClass: 'LIVE_CANARY', task: 'NONCE_MARKER',
    profileHash, candidateSha: profile.candidateSha, candidateTree: profile.candidateTree,
    modelId: profile.model.providerModelId, nonce, marker: expectedMarker,
    markerRef: 'canary/attempt-1/candidate/marker.txt', trajectoryRef: 'canary/attempt-1/trajectory.json',
    ledgerRef: `executions/${CANARY_EXECUTION_ID}/provider-ledger.jsonl`,
    toolTurns: turns.toolTurns, toolResults: turns.toolResults, toolTurnsInterleaved: turns.interleaved,
    wireRequests: ledger.wireRequests, inputTokens: ledger.inputTokens, outputTokens: ledger.outputTokens,
    apiUsd: ledger.apiUsd, activeMs: Number.isFinite(activeMs) ? Math.max(0, activeMs) : null,
    exitStatus: attempt?.driverResult?.exitStatus ?? 'FAILED', driverFailed: driverFailed ?? null, caps: { ...CANARY_CAPS },
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
    const { createHash } = await import('node:crypto');
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
  const marker = await readFile(resolve(directory, artifact.markerRef), 'utf8').catch(() => null);
  const markerOk = marker != null && marker.replace(/\r?\n$/, '') === artifact.marker;
  if (!markerOk) fail('canary marker file does not hold the recorded marker');
  const capsOk = artifact.wireRequests <= CANARY_CAPS.maxWireRequests &&
    artifact.inputTokens + artifact.outputTokens <= CANARY_CAPS.maxTotalTokens &&
    (artifact.activeMs ?? Infinity) <= CANARY_CAPS.maxActiveSeconds * 1000 && artifact.apiUsd <= CANARY_CAPS.maxApiUsd;
  const recomputed = decideCanaryStatus({ markerOk, exitSubmitted: artifact.exitStatus === 'Submitted',
    turns, ledger, capsOk, driverFailed: artifact.driverFailed ?? null });
  if (recomputed !== artifact.status)
    fail(`canary record status ${artifact.status} contradicts re-materialized facts (${recomputed})`);
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
