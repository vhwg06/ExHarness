import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { mkdir, open, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { callJev, validateResponse } from '../../blackboard-jev.mjs';
import { canonical, sha256 } from './contract.mjs';
import { writeAtomicJson } from './resource-state.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const protocolPath = join(root, 'value-protocol.json');
const MODEL = 'jev-1.13.0';
const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const fail = (message, code = 'JUDGMENT_INVALID') => { const error = new Error(`${code}: ${message}`); error.code = code; throw error; };
const plainJson = path => readFile(path, 'utf8').then(JSON.parse);
const choice = (criteria, statement) => ({
  type: 'choice',
  instructions: statement,
  criteria: Array.isArray(criteria)
    ? Object.fromEntries(criteria.map(value => [value, value === 'SATISFIED' ? 'The supplied factual evidence establishes this atomic claim.' : value === 'CONTRADICTED' ? 'Adequate factual evidence refutes this atomic claim.' : 'The supplied factual evidence is incomplete or unresolved for this atomic claim.']))
    : criteria
});
const hashBody = value => `sha256:${sha256(value)}`;
const JEV_STAGE_INPUT_RESERVE = 64_000;
const JEV_INPUT_USD_PER_MILLION = 0.042;
const JEV_STAGE_USD_RESERVE = JEV_STAGE_INPUT_RESERVE * JEV_INPUT_USD_PER_MILLION / 1_000_000;
const JEV_PRICE_SOURCE = 'docs/blackboard/artifacts/ready-implement-plan/BB-065.json#jevValueContract.limits';
const JEV_PRICE_OBSERVED_AT = '2026-09-25';
const jevBudgetPath = output => join(output, 'jev-budget.jsonl');

async function readJevBudget(output) {
  let body;
  try { body = await readFile(jevBudgetPath(output), 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  return body.split(/\r?\n/).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); }
    catch { fail(`Jev budget journal line ${index + 1} is invalid`); }
  });
}

function foldJevBudget(events, limits) {
  const stages = {};
  let previousEventHash = null;
  for (const [index, event] of events.entries()) {
    const { eventHash, ...body } = event;
    if (event.schemaVersion !== 1 || event.sequence !== index + 1 || event.previousEventHash !== previousEventHash ||
        eventHash !== hashBody(body)) fail(`Jev budget journal chain is invalid at row ${index + 1}`);
    previousEventHash = eventHash;
    const { stage } = event.payload ?? {};
    if (!['STAGE_ONE', 'STAGE_TWO'].includes(stage)) fail('Jev budget journal contains an unknown stage');
    let record = stages[stage];
    if (event.kind === 'STAGE_RESERVED') {
      if (record || (stage === 'STAGE_TWO' && stages.STAGE_ONE?.status !== 'SETTLED')) fail(`Jev stage reservation order is invalid: ${stage}`);
      if (stage === 'STAGE_TWO' && stages.STAGE_ONE.wireAttempts.some(row => row.status === 'UNKNOWN' || row.status === 'RESERVED'))
        fail('Jev stage two cannot follow unresolved stage-one wire usage');
      if (event.payload.maxInputTokensPerWireAttempt !== JEV_STAGE_INPUT_RESERVE || event.payload.maxUsdPerWireAttempt !== JEV_STAGE_USD_RESERVE ||
          event.payload.pricing?.inputUsdPerMillion !== JEV_INPUT_USD_PER_MILLION ||
          event.payload.pricing?.outputUsdPerMillion !== 0 || event.payload.pricing?.observedAt !== JEV_PRICE_OBSERVED_AT ||
          event.payload.pricing?.sourceRef !== JEV_PRICE_SOURCE || typeof event.payload.requestHash !== 'string')
        fail(`Jev stage reservation does not match registered price/limit: ${stage}`);
      stages[stage] = { requestHash: event.payload.requestHash, status: 'RESERVED', wireAttempts: [] };
      continue;
    }
    if (!record || record.status !== 'RESERVED') fail(`Jev budget event has no open stage reservation: ${stage}`);
    if (event.kind === 'WIRE_ATTEMPT') {
      const expected = record.wireAttempts.length + 1;
      if (event.payload.attempt !== expected || expected > limits.maxJevTransportAttemptsPerStage ||
          event.payload.reservedInputTokens !== JEV_STAGE_INPUT_RESERVE || event.payload.reservedUsd !== JEV_STAGE_USD_RESERVE ||
          !['LIVE_HTTP', 'DETERMINISTIC_TEST_DOUBLE'].includes(event.payload.transport))
        fail(`Jev transport-attempt budget exceeded: ${stage}`);
      record.wireAttempts.push({ attempt: expected, transport: event.payload.transport, status: 'RESERVED',
        reservedInputTokens: event.payload.reservedInputTokens, reservedUsd: event.payload.reservedUsd });
      continue;
    }
    if (event.kind === 'WIRE_RESPONSE') {
      const attempt = record.wireAttempts.find(row => row.attempt === event.payload.attempt);
      if (!attempt || attempt.responseSeen || (event.payload.httpStatus != null && (!Number.isInteger(event.payload.httpStatus) || event.payload.httpStatus < 100 || event.payload.httpStatus > 599)))
        fail(`Jev wire response does not match an outstanding attempt: ${stage}`);
      if (event.payload.retryAfterSeconds != null && (!Number.isFinite(event.payload.retryAfterSeconds) || event.payload.retryAfterSeconds < 0))
        fail(`Jev retry-after evidence is invalid: ${stage}`);
      attempt.responseSeen = true;
      attempt.httpStatus = event.payload.httpStatus ?? null;
      attempt.retryAfterSeconds = event.payload.retryAfterSeconds ?? null;
      if (attempt.httpStatus === 429) attempt.status = 'NOT_ADMITTED';
      else if (attempt.httpStatus == null || attempt.httpStatus < 200 || attempt.httpStatus >= 300) attempt.status = 'UNKNOWN';
      continue;
    }
    if (event.kind === 'WIRE_FAILURE') {
      const attempt = record.wireAttempts.find(row => row.attempt === event.payload.attempt);
      if (!attempt || attempt.responseSeen || attempt.failureSeen) fail(`Jev wire failure does not match an outstanding attempt: ${stage}`);
      attempt.failureSeen = true;
      attempt.status = 'UNKNOWN';
      continue;
    }
    if (event.kind === 'STAGE_SETTLED') {
      const inputTokens = event.payload.inputTokens;
      const outputTokens = event.payload.outputTokens;
      const attempts = event.payload.attempts;
      const costUsd = inputTokens * JEV_INPUT_USD_PER_MILLION / 1_000_000;
      const settledAttempt = record.wireAttempts.find(row => row.attempt === event.payload.settledAttempt);
      if (event.payload.requestHash !== record.requestHash || event.payload.responseHash == null ||
          !Number.isInteger(inputTokens) || inputTokens < 0 || inputTokens > JEV_STAGE_INPUT_RESERVE ||
          !Number.isInteger(outputTokens) || outputTokens < 0 ||
          !Number.isInteger(attempts) || attempts < 1 || attempts !== record.wireAttempts.length ||
          event.payload.settledAttempt !== attempts || !settledAttempt || settledAttempt.status !== 'RESERVED' ||
          !settledAttempt.responseSeen || settledAttempt.httpStatus < 200 || settledAttempt.httpStatus >= 300 ||
          !Number.isFinite(event.payload.costUsd) || event.payload.costUsd !== costUsd)
        fail(`Jev settled usage exceeds or contradicts reservation: ${stage}`);
      Object.assign(settledAttempt, { status: 'SETTLED', inputTokens, outputTokens, costUsd });
      Object.assign(record, { status: 'SETTLED', inputTokens, outputTokens, attempts, costUsd, responseHash: event.payload.responseHash });
      continue;
    }
    if (event.kind === 'STAGE_UNKNOWN') {
      if (event.payload.requestHash !== record.requestHash || event.payload.attempts !== record.wireAttempts.length)
        fail(`Jev unknown usage does not match the reserved stage: ${stage}`);
      for (const attempt of record.wireAttempts) if (attempt.status === 'RESERVED') attempt.status = 'UNKNOWN';
      record.status = 'UNKNOWN';
      record.unknownReason = event.payload.reason;
      continue;
    }
    fail(`unknown Jev budget event: ${event.kind}`);
  }
  const values = Object.values(stages);
  if (values.length > limits.maxJevStageCalls || values.reduce((sum, row) => sum + row.wireAttempts.length, 0) >
      limits.maxJevStageCalls * limits.maxJevTransportAttemptsPerStage) fail('Jev registered stage/transport budget exceeded');
  const attempts = values.flatMap(row => row.wireAttempts);
  const inputTokens = attempts.reduce((sum, row) => sum + (row.status === 'SETTLED' ? row.inputTokens : row.status === 'NOT_ADMITTED' ? 0 : row.reservedInputTokens), 0);
  const costUsd = attempts.reduce((sum, row) => sum + (row.status === 'SETTLED' ? row.costUsd : row.status === 'NOT_ADMITTED' ? 0 : row.reservedUsd), 0);
  if (inputTokens > limits.maxJevTotalInputTokens || costUsd > limits.maxJevUsd) fail('Jev total input/cost budget exceeded');
  return { stages, inputTokens, costUsd, stageCalls: values.length,
    transportAttempts: values.reduce((sum, row) => sum + row.wireAttempts.length, 0) };
}

async function appendJevBudgetEvent(output, kind, payload) {
  const path = jevBudgetPath(output);
  await mkdir(dirname(path), { recursive: true });
  const events = await readJevBudget(output);
  const value = await protocol();
  const folded = foldJevBudget(events, value.limits);
  if (kind === 'WIRE_ATTEMPT') {
    const stage = folded.stages[payload.stage];
    if (!stage || stage.status !== 'RESERVED' || payload.attempt !== stage.wireAttempts.length + 1 ||
        payload.attempt > value.limits.maxJevTransportAttemptsPerStage) fail(`Jev transport-attempt limit reached: ${payload.stage}`, 'JUDGMENT_UNAVAILABLE');
    if (payload.reservedInputTokens !== JEV_STAGE_INPUT_RESERVE || payload.reservedUsd !== JEV_STAGE_USD_RESERVE ||
        folded.inputTokens + payload.reservedInputTokens > value.limits.maxJevTotalInputTokens ||
        folded.costUsd + payload.reservedUsd > value.limits.maxJevUsd)
      fail(`Jev worst-case wire reservation exceeds the registered total budget: ${payload.stage}`, 'JUDGMENT_UNAVAILABLE');
  }
  const eventBody = { schemaVersion: 1, sequence: events.length + 1, at: new Date().toISOString(),
    previousEventHash: events.at(-1)?.eventHash ?? null, kind, payload };
  const event = { ...eventBody, eventHash: hashBody(eventBody) };
  const handle = await open(path, 'a');
  try { await handle.writeFile(`${JSON.stringify(event)}\n`); await handle.sync(); }
  finally { await handle.close(); }
  return event;
}

async function reserveJevStage(output, stage, requestHash, limits) {
  const state = foldJevBudget(await readJevBudget(output), limits);
  const prior = state.stages[stage];
  if (prior) {
    if (prior.requestHash !== requestHash) fail(`Jev ${stage} request changed; register a new value cohort`, 'JUDGMENT_UNAVAILABLE');
    return prior;
  }
  if (state.stageCalls >= limits.maxJevStageCalls) fail('Jev stage-call limit exhausted', 'JUDGMENT_UNAVAILABLE');
  if (stage === 'STAGE_TWO' && (state.stages.STAGE_ONE?.status !== 'SETTLED' ||
      state.stages.STAGE_ONE.wireAttempts.some(row => row.status === 'UNKNOWN' || row.status === 'RESERVED')))
    fail('Jev stage two requires fully reconciled stage-one wire usage', 'JUDGMENT_UNAVAILABLE');
  await appendJevBudgetEvent(output, 'STAGE_RESERVED', { stage, requestHash, maxInputTokensPerWireAttempt: JEV_STAGE_INPUT_RESERVE,
    maxUsdPerWireAttempt: JEV_STAGE_USD_RESERVE, pricing: { inputUsdPerMillion: JEV_INPUT_USD_PER_MILLION,
      outputUsdPerMillion: 0, observedAt: JEV_PRICE_OBSERVED_AT, sourceRef: JEV_PRICE_SOURCE } });
  return null;
}

async function settleJevStage(output, { stage, requestHash, response, attempts, limits }) {
  const state = foldJevBudget(await readJevBudget(output), limits);
  const record = state.stages[stage];
  if (!record || record.status !== 'RESERVED' || record.requestHash !== requestHash) fail(`Jev stage cannot settle: ${stage}`, 'JUDGMENT_UNAVAILABLE');
  const inputTokens = response?.usage?.input_tokens;
  const outputTokens = response?.usage?.output_tokens;
  const actualCost = inputTokens * JEV_INPUT_USD_PER_MILLION / 1_000_000;
  const settledAttempt = record.wireAttempts.at(-1);
  if (!Number.isInteger(inputTokens) || inputTokens < 0 || inputTokens > JEV_STAGE_INPUT_RESERVE ||
      !Number.isInteger(outputTokens) || outputTokens < 0 || attempts !== record.wireAttempts.length || attempts < 1 ||
      !settledAttempt || settledAttempt.status !== 'RESERVED' || !settledAttempt.responseSeen ||
      settledAttempt.httpStatus < 200 || settledAttempt.httpStatus >= 300 || !Number.isFinite(actualCost) ||
      state.inputTokens - settledAttempt.reservedInputTokens + inputTokens > limits.maxJevTotalInputTokens ||
      state.costUsd - settledAttempt.reservedUsd + actualCost > limits.maxJevUsd)
    fail(`Jev stage response exceeds registered token, attempt or cost bounds: ${stage}`, 'JUDGMENT_UNAVAILABLE');
  await appendJevBudgetEvent(output, 'STAGE_SETTLED', { stage, requestHash, responseHash: hashBody(response),
    inputTokens, outputTokens, attempts, settledAttempt: attempts, costUsd: actualCost });
}

async function markJevStageUnknown(output, { stage, requestHash, reason, limits }) {
  const state = foldJevBudget(await readJevBudget(output), limits);
  const record = state.stages[stage];
  if (!record || record.status !== 'RESERVED') return;
  await appendJevBudgetEvent(output, 'STAGE_UNKNOWN', { stage, requestHash,
    reason: String(reason ?? 'JEV_TRANSPORT_OR_RESPONSE_INVALID').replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 96),
    attempts: record.wireAttempts.length });
}

function jevBudgetSummary(events, limits) {
  const state = foldJevBudget(events, limits);
  if (state.stageCalls !== limits.maxJevStageCalls || ['STAGE_ONE', 'STAGE_TWO'].some(stage => state.stages[stage]?.status !== 'SETTLED' ||
      state.stages[stage].wireAttempts.some(row => row.status === 'UNKNOWN' || row.status === 'RESERVED')))
    fail('both Jev stages must have settled within the registered budget', 'JUDGMENT_UNAVAILABLE');
  return { stageCalls: state.stageCalls, transportAttempts: state.transportAttempts,
    inputTokens: state.inputTokens,
    outputTokens: Object.values(state.stages).reduce((sum, row) => sum + row.outputTokens, 0),
    apiUsd: state.costUsd,
    inputUsdPerMillion: JEV_INPUT_USD_PER_MILLION, outputUsdPerMillion: 0,
    pricingObservedAt: JEV_PRICE_OBSERVED_AT, pricingSourceRef: JEV_PRICE_SOURCE,
    stages: Object.fromEntries(Object.entries(state.stages).map(([stage, row]) => [stage,
      { requestHash: row.requestHash, responseHash: row.responseHash, attempts: row.attempts,
        inputTokens: row.inputTokens, outputTokens: row.outputTokens, apiUsd: row.costUsd }])) };
}

function studyTotalApiUsd(report, setupProbes, judgmentApiUsd) {
  const costs = [
    ...(report.executions ?? []).map(row => row.provider?.apiUsd),
    ...(setupProbes?.probes ?? []).map(row => row.costUsd)
  ];
  if (costs.some(cost => !Number.isFinite(cost) || cost < 0)) return null;
  return costs.reduce((sum, cost) => sum + cost, judgmentApiUsd);
}

export const VALUE_DIMENSIONS = Object.freeze(['evidence', 'comparison', 'quality', 'efficiency']);
export const VALUE_CHOICES = Object.freeze(['VALUE_DEMONSTRATED', 'NO_VALUE_DEMONSTRATED', 'INCONCLUSIVE']);
// A LIVE_REGISTRATION may have a factually live but incomplete report.  The
// report's UNMEASURED class means that the study cannot support a positive or
// negative value finding yet; it must still be eligible for a real Jev call so
// Jev can issue the registered INCONCLUSIVE choice.  Deterministic reports
// remain excluded by the manifest gate below.
const LIVE_REPORT_EVIDENCE_CLASSES = Object.freeze(new Set(['LIVE', 'UNMEASURED']));
const VALUE_CHOICE_CRITERIA = Object.freeze({
  VALUE_DEMONSTRATED: 'Complete comparable live evidence establishes that ExHarness accepted count is not lower than DIRECT and no protected verifier boundary is violated, plus either at least 20% lower median paired active time with no more than 10% additional provider tokens or at least one more accepted execution than DIRECT with no more than 10% additional provider tokens. The registered cost constraint is met: known positive total cost increases by no more than 10%; a zero-priced route requires measured call/token totals and limits any finding to operational rather than financial value when infrastructure cost is unknown.',
  NO_VALUE_DEMONSTRATED: 'Complete comparable live evidence is adequate and establishes a quality regression, failure of both preregistered benefit paths, or failure of the applicable cost constraint. This is a valid negative finding, including when neither arm produces an accepted result.',
  INCONCLUSIVE: 'The cohort or comparison is incomplete, provider usage or verification is unresolved, or confounds/missing facts prevent a supported positive or negative value finding. Missing evidence is not a negative result.'
});

async function protocol() { return plainJson(protocolPath); }

function ensureBoundStudy(manifest, report, value, { allowDeterministic = false, setupProbes = null } = {}) {
  if (manifest?.studyKind !== 'FIXTURE_VALUE_V1' || report?.studyId !== manifest.studyId) fail('study/report identity mismatch');
  if (manifest.valueProtocolHash !== hashBody(value) || report.protocolHash !== manifest.protocolHash) fail('study protocol hash mismatch');
  if (!allowDeterministic && (manifest.evidenceClass !== 'LIVE_REGISTRATION' || !LIVE_REPORT_EVIDENCE_CLASSES.has(report.evidenceClass)))
    fail('only live-bound study evidence can produce a production value receipt', 'JUDGMENT_UNAVAILABLE');
  if (manifest.tasks?.length !== 12 || report.registeredExecutionCount !== 12) fail('complete twelve-execution registration is required');
  if (!allowDeterministic && report.complete && (setupProbes?.evidenceClass !== 'LIVE_PROVIDER_PROBES' ||
      setupProbes.probes?.length !== value.limits.maxProbeRequests || setupProbes.probes.some(row =>
        !row.requestId || !row.providerRequestId || !row.providerEvidenceRef || !row.providerEvidenceHash ||
        !Number.isInteger(row.outputTokens) || row.outputTokens > value.limits.maxProbeOutputTokens || row.toolCall?.toolName !== 'bash')))
    fail('complete live value evidence requires both bounded, attested provider tool-call probes', 'JUDGMENT_UNAVAILABLE');
}

function evidenceText({ manifest, report, metrics, value, setupProbes = null }) {
  const checkCatalog = [...new Set((metrics.executions ?? []).flatMap(row => (row.verificationChecks ?? []).map(item => item.check)).filter(label => typeof label === 'string'))].sort();
  const compactExecution = row => ({
    executionId: row.executionId,
    pairId: row.pairId,
    taskId: row.taskId,
    repeat: row.repeat,
    arm: row.arm,
    attemptCount: row.attemptCount,
    terminalReason: row.terminalReason,
    verificationStatus: row.verificationStatus,
    checksPassed: row.checksPassed,
    checksTotal: row.checksTotal,
    checkMask: checkCatalog.map(name => {
      const check = (row.verificationChecks ?? []).find(item => item.check === name);
      return check == null ? '?' : check.pass ? '1' : '0';
    }).join(''),
    verificationHash: row.verificationHash ?? null,
    accepted: row.accepted,
    provider: {
      wireRequests: row.provider?.wireRequests ?? null,
      modelCalls: row.provider?.modelCalls ?? null,
      inputTokens: row.provider?.inputTokens ?? null,
      knownInputTokens: row.provider?.knownInputTokens ?? row.provider?.inputTokens ?? null,
      outputTokens: row.provider?.outputTokens ?? null,
      knownOutputTokens: row.provider?.knownOutputTokens ?? row.provider?.outputTokens ?? null,
      cachedTokens: row.provider?.cachedTokens ?? null,
      apiUsd: row.provider?.apiUsd ?? null,
      usageUnknown: row.provider?.usageUnknown ?? null,
      requests: (row.provider?.rows ?? []).map(item => ({
        requestId: item.requestId,
        status: item.status,
        providerRequestId: item.providerRequestId,
        inputTokens: item.inputTokens,
        outputTokens: item.outputTokens,
        costUsd: item.costUsd,
        httpStatus: item.httpStatus,
        retryAfter: item.retryAfter,
        evidenceRef: item.providerEvidenceRef,
        evidenceHash: item.providerEvidenceHash
      }))
    },
    timing: row.timing,
    overheadUsd: row.overheadUsd,
    core: row.core ? { eventCounts: row.core.eventCounts, eventTypes: (row.core.events ?? []).map(event => event.type), stateBytes: row.core.stateBytes } : null,
    resetDigest: row.resetDigest,
    candidateDigest: row.candidateDigest
  });
  const compactManifest = { ...manifest, tasks: manifest.tasks?.map(task => ({ executionId: task.executionId, pairId: task.pairId, taskId: task.taskId, repeat: task.repeat, arm: task.arm, orderIndex: task.orderIndex })) };
  const data = {
    evidenceClass: report.evidenceClass,
    manifest: {
      studyId: manifest.studyId,
      protocolHash: manifest.protocolHash,
      valueProtocolHash: manifest.valueProtocolHash,
      profileHash: manifest.profileHash,
      candidateSha: manifest.candidateSha,
      candidateTree: manifest.candidateTree,
      jevTrustedPublicKeyFingerprint: manifest.jevTrustedPublicKeyFingerprint ?? null,
      pairs: manifest.pairs,
      tasks: compactManifest.tasks
    },
    protocol: { limits: value.limits, commonPolicy: value.commonPolicy },
    providerProbes: setupProbes ? {
      evidenceClass: setupProbes.evidenceClass,
      modelId: setupProbes.modelId,
      outputTokenLimit: setupProbes.outputTokenLimit,
      probes: setupProbes.probes
    } : null,
    report: {
      complete: report.complete,
      completenessReasons: report.completenessReasons,
      registeredExecutionCount: report.registeredExecutionCount,
      measuredExecutionCount: report.measuredExecutionCount,
      pairs: report.pairs,
      medianActiveTimeRatio: report.medianActiveTimeRatio,
      pairedBootstrap95: report.pairedBootstrap95,
      observationAsOf: report.observationAsOf
    },
    checkCatalog,
    executions: (metrics.executions ?? []).map(compactExecution),
    rubric: value.rubric
  };
  const text = canonical(data);
  if (Buffer.byteLength(text) > value.jev.evidenceByteLimit) fail('Jev evidence exceeds the registered materialization bound');
  return { data, text, hash: hashBody(text), bytes: Buffer.byteLength(text) };
}

export function buildStageOnePayload({ manifest, report, metrics, protocol: value, setupProbes = null, allowDeterministic = false } = {}) {
  ensureBoundStudy(manifest, report, value, { allowDeterministic, setupProbes });
  const evidence = evidenceText({ manifest, report, metrics, value, setupProbes });
  const state = {
    evidenceClass: report.evidenceClass,
    evidenceRoot: evidence.hash,
    evidenceBytes: evidence.bytes,
    study: evidence.data,
    rubric: value.rubric,
    authority: 'JEV_ONLY',
    valueVerdict: null
  };
  const questions = {
    evidence: choice(['SATISFIED', 'INSUFFICIENT_EVIDENCE', 'CONTRADICTED'], 'Do the supplied actual records establish a complete and traceable live cohort?'),
    comparison: choice(['SATISFIED', 'INSUFFICIENT_EVIDENCE', 'CONTRADICTED'], 'Are DIRECT and EXHARNESS matched except for the declared real Core treatment, with scope and confounds adequately recorded?'),
    quality: choice(['SATISFIED', 'INSUFFICIENT_EVIDENCE', 'CONTRADICTED'], 'Does ExHarness preserve accepted fixture quality and protected verification boundaries?'),
    efficiency: choice(['SATISFIED', 'INSUFFICIENT_EVIDENCE', 'CONTRADICTED'], 'Does the observed accepted-outcome/time/token/cost tradeoff satisfy the preregistered fixture-benefit rubric?')
  };
  const payload = { model: MODEL, state, questions, evidence, rubricHash: hashBody(value.rubric), endpoint: ENDPOINT };
  if (Buffer.byteLength(canonical(requestBody(payload))) > value.jev.evidenceByteLimit)
    fail('Jev stage-one request exceeds the registered materialization bound');
  return payload;
}

export function buildStageTwoPayload({ stageOnePayload, stageOneResponse, protocol: value }) {
  const state = {
    ...stageOnePayload.state,
    stageOneResponse: stageOneResponse.answers,
    stageOneResponseHash: hashBody(stageOneResponse),
    stageOnePayloadHash: hashBody({ model: stageOnePayload.model, state: stageOnePayload.state, questions: stageOnePayload.questions }),
    rubric: value.rubric,
    authority: 'JEV_ONLY'
  };
  const payload = {
    model: MODEL,
    state,
    questions: {
      value: choice(VALUE_CHOICE_CRITERIA, 'Compared with DIRECT, does adding the current ExHarness Core treatment deliver value on the registered NORM-01, STATUS-01 and ORDER-01 fixture tasks under the frozen FIXTURE_VALUE_V1 rubric, considering accepted outcomes, paired active time, provider tokens, cost and evidence adequacy?')
    },
    evidence: stageOnePayload.evidence,
    rubricHash: stageOnePayload.rubricHash,
    endpoint: ENDPOINT
  };
  if (Buffer.byteLength(canonical(requestBody(payload))) > value.jev.evidenceByteLimit)
    fail('Jev stage-two request exceeds the registered materialization bound');
  return payload;
}

function requestBody(payload) { return { model: payload.model, state: payload.state, questions: payload.questions }; }
async function readPem(path, label) { if (!path) fail(`${label} path is missing`, 'JUDGMENT_UNAVAILABLE'); try { return await readFile(resolve(path)); } catch { fail(`${label} is unavailable`, 'JUDGMENT_UNAVAILABLE'); } }
function keyFingerprint(publicKey) { return hashBody(publicKey.export({ type: 'spki', format: 'der' })); }

async function signingMaterial({ privateKeyPath, publicKeyPath, output, allowOutputKeys = false } = {}) {
  if (!allowOutputKeys && privateKeyPath && relative(resolve(output), resolve(privateKeyPath)) && !relative(resolve(output), resolve(privateKeyPath)).startsWith('..')) fail('signing key must be outside study output', 'JUDGMENT_UNAVAILABLE');
  const privateKey = createPrivateKey(await readPem(privateKeyPath, 'trusted signing key'));
  const publicKey = createPublicKey(publicKeyPath ? await readPem(publicKeyPath, 'trusted public key') : privateKey);
  if (publicKey.asymmetricKeyType !== 'ed25519') fail('trusted receipt key must be Ed25519', 'JUDGMENT_UNAVAILABLE');
  return { privateKey, publicKey, fingerprint: keyFingerprint(publicKey) };
}

function signReceipt({ stage, request, response, manifest, report, evidence, parentReceiptHash = null, material, liveTransport }) {
  const requestHash = hashBody(request);
  const responseHash = hashBody(response);
  const body = {
    schemaVersion: 1,
    evidenceClass: liveTransport ? 'LIVE_JEV_RECEIPT' : 'DETERMINISTIC_JEV_RECEIPT',
    stage,
    model: MODEL,
    endpoint: ENDPOINT,
    requestHash,
    responseHash,
    usage: response.usage,
    evidenceRoot: evidence.hash,
    evidenceClassBound: report.evidenceClass,
    manifestHash: hashBody(manifest),
    reportHash: hashBody(report),
    profileHash: manifest.profileHash,
    candidateSha: manifest.candidateSha,
    candidateTree: manifest.candidateTree,
    rubricHash: hashBody(request.state.rubric),
    parentReceiptHash,
    issuerPublicKeyFingerprint: material.fingerprint
  };
  return { ...body, signature: sign(null, Buffer.from(canonical(body)), material.privateKey).toString('base64') };
}

function verifyReceipt(receipt, { request, response, manifest, report, evidence, publicKey, allowDeterministic = false }) {
  const body = Object.fromEntries(Object.entries(receipt).filter(([key]) => key !== 'signature'));
  if (!receipt.signature || !verify(null, Buffer.from(canonical(body)), publicKey, Buffer.from(receipt.signature, 'base64'))) fail('Jev receipt signature is invalid');
  if (receipt.model !== MODEL || receipt.endpoint !== ENDPOINT || receipt.requestHash !== hashBody(request) || receipt.responseHash !== hashBody(response) || receipt.evidenceRoot !== evidence.hash || receipt.manifestHash !== hashBody(manifest) || receipt.reportHash !== hashBody(report) || receipt.candidateSha !== manifest.candidateSha || receipt.candidateTree !== manifest.candidateTree || receipt.evidenceClassBound !== report.evidenceClass) fail('Jev receipt binding is stale or forged');
  if (!allowDeterministic && receipt.evidenceClass !== 'LIVE_JEV_RECEIPT') fail('deterministic Jev receipt cannot satisfy production audit');
  validateResponse(response, request);
  return true;
}

function finalChoice(response) {
  const value = response.answers?.value?.choice;
  if (!VALUE_CHOICES.includes(value)) fail('Jev final choice is invalid');
  return value;
}

function consistencyCheck(stageOne, value) {
  const choices = Object.fromEntries(VALUE_DIMENSIONS.map(id => [id, stageOne.answers?.[id]?.choice]));
  const final = finalChoice(value);
  const allSatisfied = Object.values(choices).every(choiceValue => choiceValue === 'SATISFIED');
  if (final === 'VALUE_DEMONSTRATED' && !allSatisfied) fail('Jev final value choice contradicts stage-one prerequisites');
  if (final === 'NO_VALUE_DEMONSTRATED' && (!['SATISFIED'].includes(choices.evidence) || !['SATISFIED'].includes(choices.comparison))) fail('Jev negative value choice lacks comparable evidence prerequisites');
  if (final === 'NO_VALUE_DEMONSTRATED' && allSatisfied) fail('Jev negative value choice contradicts four satisfied dimensions');
  if (final === 'INCONCLUSIVE' && choices.evidence === 'SATISFIED' && choices.comparison === 'SATISFIED' && choices.quality === 'SATISFIED' && choices.efficiency === 'SATISFIED') fail('Jev inconclusive choice contradicts four satisfied dimensions');
  return final;
}

async function invoke(payload, call = callJev, options = undefined) {
  try {
    const result = await call(requestBody(payload), options);
    const response = result?.response ?? result;
    validateResponse(response, requestBody(payload));
    return { response, attempts: result?.attempts ?? 1 };
  } catch (error) {
    if (error.code === 'JUDGMENT_INVALID') throw error;
    fail(error.message || 'Jev transport failed', 'JUDGMENT_UNAVAILABLE');
  }
}

async function executeBudgetedStage({ output, stage, payload, callJevImpl, allowDeterministic, limits }) {
  const request = requestBody(payload);
  const requestHash = hashBody(request);
  const prefix = stage === 'STAGE_ONE' ? 'jev-stage-one' : 'jev-stage-two';
  const metadataPath = join(output, `${prefix}.json`);
  const responsePath = join(output, `${prefix}.response.json`);
  const cachedMetadata = await plainJson(metadataPath).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
  const cachedResponse = await plainJson(responsePath).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
  if (cachedMetadata && cachedMetadata.requestHash !== requestHash) fail(`cached ${stage} request is stale; use a new value cohort`, 'JUDGMENT_UNAVAILABLE');

  const prior = await reserveJevStage(output, stage, requestHash, limits);
  if (prior?.status === 'SETTLED') {
    if (!cachedResponse || hashBody(cachedResponse) !== prior.responseHash ||
        cachedMetadata && cachedMetadata.attempts !== prior.attempts) fail(`settled ${stage} response cache is missing or changed`, 'JUDGMENT_UNAVAILABLE');
    validateResponse(cachedResponse, request);
    return { request, requestHash, response: cachedResponse, attempts: prior.attempts, cached: true };
  }
  if (prior?.status === 'UNKNOWN') fail(`${stage} has unresolved provider usage; it cannot be replayed`, 'JUDGMENT_UNAVAILABLE');
  if (prior?.status === 'RESERVED') {
    if (!cachedResponse) {
      await markJevStageUnknown(output, { stage, requestHash, reason: 'INTERRUPTED_AFTER_STAGE_RESERVATION', limits });
      fail(`${stage} was interrupted after reservation and cannot be replayed`, 'JUDGMENT_UNAVAILABLE');
    }
    validateResponse(cachedResponse, request);
    const attempts = cachedMetadata?.attempts ?? prior.wireAttempts.length;
    await settleJevStage(output, { stage, requestHash, response: cachedResponse, attempts, limits });
    return { request, requestHash, response: cachedResponse, attempts, cached: true };
  }
  if (cachedMetadata || cachedResponse) fail(`${stage} cache exists without a matching budget reservation`, 'JUDGMENT_UNAVAILABLE');

  let wireAttempts = 0;
  const recordTestDoubleAttempts = async attempts => {
    if (!allowDeterministic || !Number.isInteger(attempts) || attempts < 1)
      fail(`${stage} transport attempts exceed the registered limit`, 'JUDGMENT_UNAVAILABLE');
    while (wireAttempts < attempts) {
      wireAttempts += 1;
      await appendJevBudgetEvent(output, 'WIRE_ATTEMPT', { stage, attempt: wireAttempts, transport: 'DETERMINISTIC_TEST_DOUBLE',
        reservedInputTokens: JEV_STAGE_INPUT_RESERVE, reservedUsd: JEV_STAGE_USD_RESERVE });
      await appendJevBudgetEvent(output, 'WIRE_RESPONSE', { stage, attempt: wireAttempts, httpStatus: 200, retryAfterSeconds: null });
    }
    if (wireAttempts !== attempts) fail(`${stage} transport attempt evidence differs from result`, 'JUDGMENT_UNAVAILABLE');
  };
  const options = callJevImpl === callJev ? {
    fetchImpl: async (url, init) => {
      wireAttempts += 1;
      await appendJevBudgetEvent(output, 'WIRE_ATTEMPT', { stage, attempt: wireAttempts, transport: 'LIVE_HTTP',
        reservedInputTokens: JEV_STAGE_INPUT_RESERVE, reservedUsd: JEV_STAGE_USD_RESERVE });
      try {
        const response = await fetch(url, init);
        const retryHeader = response.headers?.get?.('retry-after') ?? null;
        const retryAfterSeconds = retryHeader && /^\d+(?:\.\d+)?$/.test(retryHeader) ? Number(retryHeader) : null;
        await appendJevBudgetEvent(output, 'WIRE_RESPONSE', { stage, attempt: wireAttempts,
          httpStatus: response.status, retryAfterSeconds: Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : null });
        return response;
      } catch (error) {
        await appendJevBudgetEvent(output, 'WIRE_FAILURE', { stage, attempt: wireAttempts,
          errorType: String(error?.name ?? 'TransportError').replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 64) });
        throw error;
      }
    }
  } : undefined;

  try {
    const result = await invoke(payload, callJevImpl, options);
    if (callJevImpl !== callJev) await recordTestDoubleAttempts(result.attempts);
    if (result.attempts !== wireAttempts || result.attempts > limits.maxJevTransportAttemptsPerStage)
      fail(`${stage} transport attempts do not match the registered journal`, 'JUDGMENT_UNAVAILABLE');
    await writeAtomicJson(responsePath, result.response);
    await settleJevStage(output, { stage, requestHash, response: result.response, attempts: result.attempts, limits });
    return { request, requestHash, response: result.response, attempts: result.attempts, cached: false };
  } catch (error) {
    await markJevStageUnknown(output, { stage, requestHash, reason: error.code ?? error.name, limits });
    throw error;
  }
}

export async function evaluateValue({ output, callJevImpl = callJev, privateKeyPath = process.env.EXHARNESS_JEV_SIGNING_KEY, publicKeyPath = process.env.EXHARNESS_JEV_TRUSTED_PUBLIC_KEY, allowDeterministic = false } = {}) {
  const directory = resolve(output);
  const value = await protocol();
  if (callJevImpl !== callJev && !allowDeterministic)
    fail('an injected Jev transport is test-only and requires explicit deterministic mode', 'JUDGMENT_UNAVAILABLE');
  const manifest = await plainJson(join(directory, 'manifest.json'));
  const report = await plainJson(join(directory, 'report.json'));
  const metrics = await plainJson(join(directory, 'metrics.json'));
  const setupProbes = await plainJson(join(directory, 'setup', 'probes.json')).catch(() => null);
  const stageOnePayload = buildStageOnePayload({ manifest, report, metrics, protocol: value, setupProbes, allowDeterministic });
  const material = await signingMaterial({ privateKeyPath, publicKeyPath, output: directory, allowOutputKeys: allowDeterministic });
  const liveTransport = callJevImpl === callJev && !allowDeterministic && manifest.evidenceClass === 'LIVE_REGISTRATION';
  const stageOne = await executeBudgetedStage({ output: directory, stage: 'STAGE_ONE', payload: stageOnePayload,
    callJevImpl, allowDeterministic, limits: value.limits });
  const stageOneRequest = stageOne.request;
  const stageOneRequestHash = stageOne.requestHash;
  const stageOneResponse = stageOne.response;
  const stageOneAttempts = stageOne.attempts;
  let stageOneReceipt;
  const cachedStageOne = await plainJson(join(directory, 'jev-stage-one.json')).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
  if (cachedStageOne) {
    if (cachedStageOne.requestHash !== stageOneRequestHash || cachedStageOne.responseHash !== hashBody(stageOneResponse) ||
        cachedStageOne.attempts !== stageOneAttempts || !cachedStageOne.receipt)
      fail('cached stage-one receipt metadata differs from its budgeted response', 'JUDGMENT_UNAVAILABLE');
    stageOneReceipt = cachedStageOne.receipt;
  } else {
    stageOneReceipt = signReceipt({ stage: 'STAGE_ONE', request: stageOneRequest, response: stageOneResponse,
      manifest, report, evidence: stageOnePayload.evidence, material, liveTransport });
    await writeAtomicJson(join(directory, 'jev-stage-one.request.json'), stageOneRequest);
    await writeAtomicJson(join(directory, 'jev-stage-one.receipt.json'), stageOneReceipt);
    await writeAtomicJson(join(directory, 'jev-stage-one.json'), { schemaVersion: 1, requestHash: stageOneRequestHash, responseHash: hashBody(stageOneResponse), attempts: stageOneAttempts, receipt: stageOneReceipt });
  }
  verifyReceipt(stageOneReceipt, { request: stageOneRequest, response: stageOneResponse, manifest, report, evidence: stageOnePayload.evidence, publicKey: material.publicKey, allowDeterministic });
  const stageTwoPayload = buildStageTwoPayload({ stageOnePayload, stageOneResponse, protocol: value });
  const stageTwo = await executeBudgetedStage({ output: directory, stage: 'STAGE_TWO', payload: stageTwoPayload,
    callJevImpl, allowDeterministic, limits: value.limits });
  const stageTwoRequest = stageTwo.request;
  const stageTwoRequestHash = stageTwo.requestHash;
  const stageTwoResponse = stageTwo.response;
  const stageTwoAttempts = stageTwo.attempts;
  let stageTwoReceipt;
  const cachedStageTwo = await plainJson(join(directory, 'jev-stage-two.json')).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
  if (cachedStageTwo) {
    if (cachedStageTwo.requestHash !== stageTwoRequestHash || cachedStageTwo.responseHash !== hashBody(stageTwoResponse) ||
        cachedStageTwo.attempts !== stageTwoAttempts || !cachedStageTwo.receipt)
      fail('cached stage-two receipt metadata differs from its budgeted response', 'JUDGMENT_UNAVAILABLE');
    stageTwoReceipt = cachedStageTwo.receipt;
  } else {
    stageTwoReceipt = signReceipt({ stage: 'STAGE_TWO', request: stageTwoRequest, response: stageTwoResponse,
      manifest, report, evidence: stageTwoPayload.evidence, parentReceiptHash: hashBody(stageOneReceipt), material, liveTransport });
    await writeAtomicJson(join(directory, 'jev-stage-two.request.json'), stageTwoRequest);
    await writeAtomicJson(join(directory, 'jev-stage-two.receipt.json'), stageTwoReceipt);
    await writeAtomicJson(join(directory, 'jev-stage-two.json'), { schemaVersion: 1, requestHash: stageTwoRequestHash, responseHash: hashBody(stageTwoResponse), attempts: stageTwoAttempts, receipt: stageTwoReceipt });
  }
  verifyReceipt(stageTwoReceipt, { request: stageTwoRequest, response: stageTwoResponse, manifest, report, evidence: stageTwoPayload.evidence, publicKey: material.publicKey, allowDeterministic });
  const choiceValue = consistencyCheck(stageOneResponse, stageTwoResponse);
  const judgmentUsage = jevBudgetSummary(await readJevBudget(directory), value.limits);
  if (judgmentUsage.stages.STAGE_ONE.requestHash !== stageOneRequestHash || judgmentUsage.stages.STAGE_TWO.requestHash !== stageTwoRequestHash ||
      judgmentUsage.stages.STAGE_ONE.responseHash !== hashBody(stageOneResponse) || judgmentUsage.stages.STAGE_TWO.responseHash !== hashBody(stageTwoResponse))
    fail('Jev budget journal is not bound to both signed stage responses', 'JUDGMENT_UNAVAILABLE');
  const totalApiUsd = studyTotalApiUsd(report, setupProbes, judgmentUsage.apiUsd);
  const pointer = { schemaVersion: 1, evidenceClass: liveTransport ? 'LIVE_VALUE_EVALUATION' : 'DETERMINISTIC_VALUE_EVALUATION', model: MODEL, endpoint: ENDPOINT, studyId: manifest.studyId, manifestHash: hashBody(manifest), reportHash: hashBody(report), evidenceRoot: stageTwoPayload.evidence.hash, stageOneRef: 'jev-stage-one.receipt.json', stageTwoRef: 'jev-stage-two.receipt.json', finalChoice: choiceValue, valueEvaluationRef: 'value.json', stageOneAttempts, stageTwoAttempts, judgmentUsage, studyKnownApiUsd: totalApiUsd, trustedPublicKeyFingerprint: material.fingerprint };
  await writeAtomicJson(join(directory, 'value.json'), pointer);
  return { mode: 'evaluate', valueEvaluationRef: 'value.json', finalChoice: choiceValue, stageOneAttempts, stageTwoAttempts, evidenceClass: pointer.evidenceClass };
}

export async function auditValue({ output, publicKeyPath = process.env.EXHARNESS_JEV_TRUSTED_PUBLIC_KEY, allowDeterministic = false } = {}) {
  const directory = resolve(output);
  const value = await protocol();
  const manifest = await plainJson(join(directory, 'manifest.json'));
  const report = await plainJson(join(directory, 'report.json'));
  const metrics = await plainJson(join(directory, 'metrics.json'));
  const setupProbes = await plainJson(join(directory, 'setup', 'probes.json')).catch(() => null);
  ensureBoundStudy(manifest, report, value, { allowDeterministic, setupProbes });
  const stageOnePayload = buildStageOnePayload({ manifest, report, metrics, protocol: value, setupProbes, allowDeterministic });
  const stageOneRequest = requestBody(stageOnePayload);
  const stageOneResponse = await plainJson(join(directory, 'jev-stage-one.response.json'));
  const stageOneReceipt = await plainJson(join(directory, 'jev-stage-one.receipt.json'));
  const material = { publicKey: createPublicKey(await readPem(publicKeyPath, 'trusted public key')), fingerprint: stageOneReceipt.issuerPublicKeyFingerprint };
  if (keyFingerprint(material.publicKey) !== material.fingerprint) fail('trusted public key fingerprint differs from receipt');
  verifyReceipt(stageOneReceipt, { request: stageOneRequest, response: stageOneResponse, manifest, report, evidence: stageOnePayload.evidence, publicKey: material.publicKey, allowDeterministic });
  const stageTwoPayload = buildStageTwoPayload({ stageOnePayload, stageOneResponse, protocol: value });
  const stageTwoRequest = requestBody(stageTwoPayload);
  const stageTwoResponse = await plainJson(join(directory, 'jev-stage-two.response.json'));
  const stageTwoReceipt = await plainJson(join(directory, 'jev-stage-two.receipt.json'));
  if (stageTwoReceipt.parentReceiptHash !== hashBody(stageOneReceipt)) fail('stage-two receipt is not bound to stage one');
  verifyReceipt(stageTwoReceipt, { request: stageTwoRequest, response: stageTwoResponse, manifest, report, evidence: stageTwoPayload.evidence, publicKey: material.publicKey, allowDeterministic });
  const pointer = await plainJson(join(directory, 'value.json'));
  const final = consistencyCheck(stageOneResponse, stageTwoResponse);
  const budget = jevBudgetSummary(await readJevBudget(directory), value.limits);
  const expectedLive = stageOneReceipt.evidenceClass === 'LIVE_JEV_RECEIPT' && stageTwoReceipt.evidenceClass === 'LIVE_JEV_RECEIPT' &&
    manifest.evidenceClass === 'LIVE_REGISTRATION' && LIVE_REPORT_EVIDENCE_CLASSES.has(report.evidenceClass);
  const evidenceClass = expectedLive ? 'LIVE_VALUE_EVALUATION' : 'DETERMINISTIC_VALUE_EVALUATION';
  const totalApiUsd = studyTotalApiUsd(report, setupProbes, budget.apiUsd);
  if (!allowDeterministic && !expectedLive) fail('deterministic Jev transport cannot pass production audit', 'JUDGMENT_UNAVAILABLE');
  if (pointer.finalChoice !== final || pointer.manifestHash !== hashBody(manifest) || pointer.reportHash !== hashBody(report) ||
      pointer.evidenceRoot !== stageTwoPayload.evidence.hash || pointer.evidenceClass !== evidenceClass ||
      pointer.stageOneAttempts !== budget.stages.STAGE_ONE.attempts || pointer.stageTwoAttempts !== budget.stages.STAGE_TWO.attempts ||
      canonical(pointer.judgmentUsage) !== canonical(budget) || pointer.studyKnownApiUsd !== totalApiUsd)
    fail('value pointer or Jev usage accounting is stale or caller-authored');
  return { mode: 'audit', valueEvaluationRef: 'value.json', finalChoice: final, evidenceClass: pointer.evidenceClass, trustedPublicKeyFingerprint: material.fingerprint };
}

export async function main(args = process.argv.slice(2)) {
  const mode = args.includes('--mode') ? args[args.indexOf('--mode') + 1] : 'audit';
  const output = args.includes('--output') ? args[args.indexOf('--output') + 1] : null;
  if (!output) fail('--output is required');
  if (mode === 'evaluate') return evaluateValue({ output });
  if (mode === 'audit') return auditValue({ output });
  fail(`unknown mode: ${mode}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await main())); }
  catch (error) { console.error(error.message); process.exitCode = error.code === 'JUDGMENT_UNAVAILABLE' ? 3 : 4; }
}
