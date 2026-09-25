import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { readFile } from 'node:fs/promises';
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
const choice = (criteria, statement) => ({ type: 'choice', instructions: statement, criteria: Object.fromEntries(criteria.map(value => [value, value === 'SATISFIED' ? 'The supplied factual evidence establishes this atomic claim.' : value === 'CONTRADICTED' ? 'Adequate factual evidence refutes this atomic claim.' : 'The supplied factual evidence is incomplete or unresolved for this atomic claim.'])) });
const hashBody = value => `sha256:${sha256(value)}`;

export const VALUE_DIMENSIONS = Object.freeze(['evidence', 'comparison', 'quality', 'efficiency']);
export const VALUE_CHOICES = Object.freeze(['VALUE_DEMONSTRATED', 'NO_VALUE_DEMONSTRATED', 'INCONCLUSIVE']);

async function protocol() { return plainJson(protocolPath); }

function ensureBoundStudy(manifest, report, value, { allowDeterministic = false } = {}) {
  if (manifest?.studyKind !== 'FIXTURE_VALUE_V1' || report?.studyId !== manifest.studyId) fail('study/report identity mismatch');
  if (manifest.valueProtocolHash !== hashBody(value) || report.protocolHash !== manifest.protocolHash) fail('study protocol hash mismatch');
  if (!allowDeterministic && (manifest.evidenceClass !== 'LIVE_REGISTRATION' || report.evidenceClass !== 'LIVE')) fail('only LIVE study evidence can produce a production value receipt', 'JUDGMENT_UNAVAILABLE');
  if (manifest.tasks?.length !== 12 || report.registeredExecutionCount !== 12) fail('complete twelve-execution registration is required');
}

function evidenceText({ manifest, report, metrics, value }) {
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
    accepted: row.accepted,
    provider: row.provider,
    timing: row.timing,
    overheadUsd: row.overheadUsd,
    core: row.core ? { eventCounts: row.core.eventCounts, stateBytes: row.core.stateBytes } : null,
    resetDigest: row.resetDigest,
    candidateDigest: row.candidateDigest
  });
  const compactManifest = { ...manifest, tasks: manifest.tasks?.map(task => ({ executionId: task.executionId, pairId: task.pairId, taskId: task.taskId, repeat: task.repeat, arm: task.arm, orderIndex: task.orderIndex })) };
  const compactReport = { ...report, executions: report.executions?.map(compactExecution) };
  const compactMetrics = { ...metrics, executions: metrics.executions?.map(compactExecution) };
  const data = {
    evidenceClass: report.evidenceClass,
    manifest: {
      studyId: manifest.studyId,
      protocolHash: manifest.protocolHash,
      valueProtocolHash: manifest.valueProtocolHash,
      profileHash: manifest.profileHash,
      candidateSha: manifest.candidateSha,
      candidateTree: manifest.candidateTree,
      pairs: manifest.pairs,
      tasks: compactManifest.tasks
    },
    report: compactReport,
    metrics: compactMetrics,
    rubric: value.rubric
  };
  const text = canonical(data);
  if (Buffer.byteLength(text) > value.jev.evidenceByteLimit) fail('Jev evidence exceeds the registered materialization bound');
  return { data, text, hash: hashBody(text), bytes: Buffer.byteLength(text) };
}

export function buildStageOnePayload({ manifest, report, metrics, protocol: value, allowDeterministic = false } = {}) {
  ensureBoundStudy(manifest, report, value, { allowDeterministic });
  const evidence = evidenceText({ manifest, report, metrics, value });
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
  return { model: MODEL, state, questions, evidence, rubricHash: hashBody(value.rubric), endpoint: ENDPOINT };
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
  return {
    model: MODEL,
    state,
    questions: {
      value: choice(VALUE_CHOICES, 'Using the exact factual study evidence and exact stage-one answers, is ExHarness value demonstrated for this bounded fixture benchmark?')
    },
    evidence: stageOnePayload.evidence,
    rubricHash: stageOnePayload.rubricHash,
    endpoint: ENDPOINT
  };
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

function signReceipt({ stage, request, response, manifest, report, evidence, parentReceiptHash = null, material }) {
  const requestHash = hashBody(request);
  const responseHash = hashBody(response);
  const body = {
    schemaVersion: 1,
    evidenceClass: report.evidenceClass === 'LIVE' ? 'LIVE_JEV_RECEIPT' : 'DETERMINISTIC_JEV_RECEIPT',
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
  if (receipt.model !== MODEL || receipt.endpoint !== ENDPOINT || receipt.requestHash !== hashBody(request) || receipt.responseHash !== hashBody(response) || receipt.evidenceRoot !== evidence.hash || receipt.manifestHash !== hashBody(manifest) || receipt.reportHash !== hashBody(report) || receipt.candidateSha !== manifest.candidateSha || receipt.candidateTree !== manifest.candidateTree) fail('Jev receipt binding is stale or forged');
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

async function invoke(payload, call = callJev) {
  try {
    const result = await call(requestBody(payload));
    const response = result?.response ?? result;
    validateResponse(response, requestBody(payload));
    return { response, attempts: result?.attempts ?? 1 };
  } catch (error) {
    if (error.code === 'JUDGMENT_INVALID') throw error;
    fail(error.message || 'Jev transport failed', 'JUDGMENT_UNAVAILABLE');
  }
}

export async function evaluateValue({ output, callJevImpl = callJev, privateKeyPath = process.env.EXHARNESS_JEV_SIGNING_KEY, publicKeyPath = process.env.EXHARNESS_JEV_TRUSTED_PUBLIC_KEY, allowDeterministic = false } = {}) {
  const directory = resolve(output);
  const value = await protocol();
  const manifest = await plainJson(join(directory, 'manifest.json'));
  const report = await plainJson(join(directory, 'report.json'));
  const metrics = await plainJson(join(directory, 'metrics.json'));
  const stageOnePayload = buildStageOnePayload({ manifest, report, metrics, protocol: value, allowDeterministic });
  const material = await signingMaterial({ privateKeyPath, publicKeyPath, output: directory, allowOutputKeys: allowDeterministic });
  const stageOneRequest = requestBody(stageOnePayload);
  const stageOneRequestHash = hashBody(stageOneRequest);
  const cachedStageOne = await plainJson(join(directory, 'jev-stage-one.json')).catch(() => null);
  let stageOneResponse;
  let stageOneAttempts = 0;
  let stageOneReceipt;
  if (cachedStageOne && cachedStageOne.requestHash === stageOneRequestHash) {
    stageOneResponse = await plainJson(join(directory, 'jev-stage-one.response.json'));
    stageOneReceipt = cachedStageOne.receipt;
    stageOneAttempts = cachedStageOne.attempts ?? 0;
  } else {
    const result = await invoke(stageOnePayload, callJevImpl);
    stageOneResponse = result.response;
    stageOneAttempts = result.attempts;
    stageOneReceipt = signReceipt({ stage: 'STAGE_ONE', request: stageOneRequest, response: stageOneResponse, manifest, report, evidence: stageOnePayload.evidence, material });
    await writeAtomicJson(join(directory, 'jev-stage-one.request.json'), stageOneRequest);
    await writeAtomicJson(join(directory, 'jev-stage-one.response.json'), stageOneResponse);
    await writeAtomicJson(join(directory, 'jev-stage-one.receipt.json'), stageOneReceipt);
    await writeAtomicJson(join(directory, 'jev-stage-one.json'), { schemaVersion: 1, requestHash: stageOneRequestHash, responseHash: hashBody(stageOneResponse), attempts: stageOneAttempts, receipt: stageOneReceipt });
  }
  verifyReceipt(stageOneReceipt, { request: stageOneRequest, response: stageOneResponse, manifest, report, evidence: stageOnePayload.evidence, publicKey: material.publicKey, allowDeterministic });
  const stageTwoPayload = buildStageTwoPayload({ stageOnePayload, stageOneResponse, protocol: value });
  const stageTwoRequest = requestBody(stageTwoPayload);
  const cachedStageTwo = await plainJson(join(directory, 'jev-stage-two.json')).catch(() => null);
  let stageTwoResponse;
  let stageTwoAttempts = 0;
  let stageTwoReceipt;
  if (cachedStageTwo && cachedStageTwo.requestHash === hashBody(stageTwoRequest)) {
    stageTwoResponse = await plainJson(join(directory, 'jev-stage-two.response.json'));
    stageTwoReceipt = cachedStageTwo.receipt;
    stageTwoAttempts = cachedStageTwo.attempts ?? 0;
  } else {
    const result = await invoke(stageTwoPayload, callJevImpl);
    stageTwoResponse = result.response;
    stageTwoAttempts = result.attempts;
    stageTwoReceipt = signReceipt({ stage: 'STAGE_TWO', request: stageTwoRequest, response: stageTwoResponse, manifest, report, evidence: stageTwoPayload.evidence, parentReceiptHash: hashBody(stageOneReceipt), material });
    await writeAtomicJson(join(directory, 'jev-stage-two.request.json'), stageTwoRequest);
    await writeAtomicJson(join(directory, 'jev-stage-two.response.json'), stageTwoResponse);
    await writeAtomicJson(join(directory, 'jev-stage-two.receipt.json'), stageTwoReceipt);
    await writeAtomicJson(join(directory, 'jev-stage-two.json'), { schemaVersion: 1, requestHash: hashBody(stageTwoRequest), responseHash: hashBody(stageTwoResponse), attempts: stageTwoAttempts, receipt: stageTwoReceipt });
  }
  verifyReceipt(stageTwoReceipt, { request: stageTwoRequest, response: stageTwoResponse, manifest, report, evidence: stageTwoPayload.evidence, publicKey: material.publicKey, allowDeterministic });
  const choiceValue = consistencyCheck(stageOneResponse, stageTwoResponse);
  const pointer = { schemaVersion: 1, evidenceClass: report.evidenceClass === 'LIVE' ? 'LIVE_VALUE_EVALUATION' : 'DETERMINISTIC_VALUE_EVALUATION', model: MODEL, endpoint: ENDPOINT, studyId: manifest.studyId, manifestHash: hashBody(manifest), reportHash: hashBody(report), evidenceRoot: stageTwoPayload.evidence.hash, stageOneRef: 'jev-stage-one.receipt.json', stageTwoRef: 'jev-stage-two.receipt.json', finalChoice: choiceValue, valueEvaluationRef: 'value.json', stageOneAttempts, stageTwoAttempts, trustedPublicKeyFingerprint: material.fingerprint };
  await writeAtomicJson(join(directory, 'value.json'), pointer);
  return { mode: 'evaluate', valueEvaluationRef: 'value.json', finalChoice: choiceValue, stageOneAttempts, stageTwoAttempts, evidenceClass: pointer.evidenceClass };
}

export async function auditValue({ output, publicKeyPath = process.env.EXHARNESS_JEV_TRUSTED_PUBLIC_KEY, allowDeterministic = false } = {}) {
  const directory = resolve(output);
  const value = await protocol();
  const manifest = await plainJson(join(directory, 'manifest.json'));
  const report = await plainJson(join(directory, 'report.json'));
  const metrics = await plainJson(join(directory, 'metrics.json'));
  ensureBoundStudy(manifest, report, value, { allowDeterministic });
  const stageOnePayload = buildStageOnePayload({ manifest, report, metrics, protocol: value, allowDeterministic });
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
  if (pointer.finalChoice !== final || pointer.manifestHash !== hashBody(manifest) || pointer.reportHash !== hashBody(report) || pointer.evidenceRoot !== stageTwoPayload.evidence.hash) fail('value pointer is stale or caller-authored');
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
