import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluateValue, auditValue } from '../../scripts/delivery/baseline/jev-value.mjs';
import { sha256 } from '../../scripts/delivery/baseline/contract.mjs';

async function fixture(t, evidenceClass = 'LIVE') {
  const output = await mkdtemp(join(tmpdir(), 'baseline-jev-'));
  t.after(() => rm(output, { recursive: true, force: true }));
  const keyRoot = await mkdtemp(join(tmpdir(), 'baseline-jev-keys-'));
  t.after(() => rm(keyRoot, { recursive: true, force: true }));
  const protocol = JSON.parse(await (await import('node:fs/promises')).readFile('scripts/delivery/baseline/value-protocol.json', 'utf8'));
  const pairs = protocol.pairs;
  const tasks = pairs.flatMap(pair => pair.order.map((arm, index) => ({ executionId: `${pair.pairId}:${arm}`, pairId: pair.pairId, taskId: pair.taskId, repeat: pair.repeat, arm, orderIndex: index + 1, registeredStart: '2026-09-25T00:00:00.000Z' })));
  const manifestBody = { schemaVersion: 1, studyKind: 'FIXTURE_VALUE_V1', studyId: protocol.studyId, protocolHash: `sha256:${sha256(protocol)}`, valueProtocolHash: `sha256:${sha256(protocol)}`, profileHash: 'sha256:profile', candidateSha: 'a'.repeat(40), candidateTree: 'b'.repeat(40), evidenceClass: evidenceClass === 'LIVE' ? 'LIVE_REGISTRATION' : 'DETERMINISTIC_REGISTRATION', pairs, tasks };
  const manifest = { ...manifestBody, digest: `sha256:${sha256(manifestBody)}` };
  const executions = tasks.map(task => ({ executionId: task.executionId, pairId: task.pairId, taskId: task.taskId, arm: task.arm, repeat: task.repeat, evidenceClass, verificationStatus: 'ACCEPTED', checksPassed: 6, checksTotal: 6, accepted: true, attemptCount: 1, terminalReason: 'COMPLETED', profileHash: manifest.profileHash, resetDigest: `sha256:${task.executionId}`, candidateDigest: `sha256:${task.executionId}`, provider: { wireRequests: 1, modelCalls: 1, inputTokens: 100, outputTokens: 20, cachedTokens: 0, usageUnknown: false, apiUsd: 0 }, timing: { registeredAt: task.registeredStart, startedAt: task.registeredStart, terminalAt: '2026-09-25T00:01:00.000Z', activeMs: task.arm === 'EXHARNESS' ? 40000 : 60000, providerWaitMs: 0, elapsedMs: 60000 }, overheadUsd: null, humanIntervals: [], core: task.arm === 'EXHARNESS' ? { eventCounts: { SESSION_STARTED: 1, OBSERVED: 1, ACTED: 1, VERIFIED: 1, EVALUATED: 1, PROMOTED: 1 }, stateBytes: 100 } : null }));
  const report = { schemaVersion: 1, studyId: manifest.studyId, studyKind: 'FIXTURE_VALUE_V1', protocolHash: manifest.protocolHash, profileHash: manifest.profileHash, candidateSha: manifest.candidateSha, candidateTree: manifest.candidateTree, evidenceClass, registeredExecutionCount: 12, measuredExecutionCount: 12, complete: true, completenessReasons: [], executions, pairs: pairs.map(pair => ({ pairId: pair.pairId, taskId: pair.taskId, repeat: pair.repeat, order: pair.order, directExecutionId: `${pair.pairId}:DIRECT`, exharnessExecutionId: `${pair.pairId}:EXHARNESS`, directAccepted: true, exharnessAccepted: true, activeTimeRatio: 2 / 3, tokenRatio: 1, costRatio: null, directActiveMs: 60000, exharnessActiveMs: 40000 })), medianActiveTimeRatio: 2 / 3, pairedBootstrap95: [2 / 3, 2 / 3], observationAsOf: '2026-09-25T00:02:00.000Z', valueEvaluationRef: null };
  const metrics = { schemaVersion: 1, studyId: manifest.studyId, executions };
  await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest));
  await writeFile(join(output, 'report.json'), JSON.stringify(report));
  await writeFile(join(output, 'metrics.json'), JSON.stringify(metrics));
  await mkdir(join(output, 'setup'), { recursive: true });
  await writeFile(join(output, 'setup', 'probes.json'), JSON.stringify({
    schemaVersion: 1, evidenceClass: 'LIVE_PROVIDER_PROBES', modelId: 'pinned-model', required: 2, outputTokenLimit: 128,
    probes: [1, 2].map(index => ({ probeId: `PROBE-${index}`, requestId: `probe-request-${index}`,
      providerRequestId: `provider-probe-${index}`, inputTokens: 20, outputTokens: 4,
      costUsd: 0,
      providerEvidenceRef: `setup/probe-${index}/provider-response.json`, providerEvidenceHash: `sha256:${'c'.repeat(64)}`,
      toolCall: { toolCallId: `probe-call-${index}`, toolName: 'bash', command: `printf 'EXHARNESS_PROBE_${index}'` } }))
  }));
  const keyPair = generateKeyPairSync('ed25519');
  await writeFile(join(keyRoot, 'private.pem'), keyPair.privateKey.export({ type: 'pkcs8', format: 'pem' }));
  await writeFile(join(keyRoot, 'public.pem'), keyPair.publicKey.export({ type: 'spki', format: 'pem' }));
  return { output, protocol, manifest, report, metrics, privateKeyPath: join(keyRoot, 'private.pem'), publicKeyPath: join(keyRoot, 'public.pem') };
}

function transport() {
  let calls = 0;
  const payloads = [];
  const call = async payload => {
    calls += 1;
    payloads.push(payload);
    if (payload.questions.value) {
      return { response: { model: payload.model, answers: { value: { type: 'choice', choice: 'VALUE_DEMONSTRATED', confidence: 0.9, probabilities: { VALUE_DEMONSTRATED: 0.9, NO_VALUE_DEMONSTRATED: 0.05, INCONCLUSIVE: 0.05 } } }, usage: { input_tokens: 1200, output_tokens: 1 } }, attempts: 1 };
    }
    const answers = {};
    for (const id of Object.keys(payload.questions)) answers[id] = { type: 'choice', choice: 'SATISFIED', confidence: 0.9, probabilities: { SATISFIED: 0.9, INSUFFICIENT_EVIDENCE: 0.05, CONTRADICTED: 0.05 } };
    return { response: { model: payload.model, answers, usage: { input_tokens: 1800, output_tokens: 4 } }, attempts: 1 };
  };
  return { call, calls: () => calls, payloads: () => payloads };
}

test('value evaluation is two-stage, signed, cacheable and only copies Jev choices', async t => {
  const fixture = await fixtureFor(t);
  const fake = transport();
  const first = await evaluateValue({ output: fixture.output, callJevImpl: fake.call, allowDeterministic: true, privateKeyPath: fixture.privateKeyPath, publicKeyPath: fixture.publicKeyPath });
  assert.equal(first.finalChoice, 'VALUE_DEMONSTRATED');
  assert.equal(first.evidenceClass, 'DETERMINISTIC_VALUE_EVALUATION');
  assert.equal(fake.calls(), 2);
  const valueQuestion = fake.payloads()[1].questions.value;
  assert.match(valueQuestion.instructions, /Compared with DIRECT/);
  assert.match(valueQuestion.instructions, /NORM-01, STATUS-01 and ORDER-01/);
  assert.match(valueQuestion.instructions, /FIXTURE_VALUE_V1/);
  assert.match(valueQuestion.criteria.VALUE_DEMONSTRATED, /20% lower median paired active time/);
  assert.match(valueQuestion.criteria.VALUE_DEMONSTRATED, /one more accepted execution than DIRECT/);
  assert.match(valueQuestion.criteria.VALUE_DEMONSTRATED, /protected verifier boundary/);
  assert.match(valueQuestion.criteria.VALUE_DEMONSTRATED, /zero-priced route requires measured call\/token totals/);
  assert.match(valueQuestion.criteria.NO_VALUE_DEMONSTRATED, /valid negative finding/);
  assert.match(valueQuestion.criteria.INCONCLUSIVE, /not a negative result/);
  assert.equal(new Set(Object.values(valueQuestion.criteria)).size, 3);
  const stageOneRequest = fake.payloads()[0];
  assert.ok(Buffer.byteLength(JSON.stringify(stageOneRequest)) < fixture.protocol.jev.evidenceByteLimit);
  assert.equal(stageOneRequest.state.study.executions.length, 12);
  assert.equal(stageOneRequest.state.study.providerProbes.probes.length, 2);
  assert.equal(Object.hasOwn(stageOneRequest.state.study, 'metrics'), false, 'actual execution facts are materialized once');
  const second = await evaluateValue({ output: fixture.output, callJevImpl: async () => { throw new Error('cache should avoid provider'); }, allowDeterministic: true, privateKeyPath: fixture.privateKeyPath, publicKeyPath: fixture.publicKeyPath });
  assert.equal(second.finalChoice, 'VALUE_DEMONSTRATED');
  assert.equal((await auditValue({ output: fixture.output, publicKeyPath: fixture.publicKeyPath, allowDeterministic: true })).finalChoice, 'VALUE_DEMONSTRATED');
  const budget = (await readFile(join(fixture.output, 'jev-budget.jsonl'), 'utf8')).trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(budget.filter(row => row.kind === 'STAGE_RESERVED').length, 2);
  assert.equal(budget.filter(row => row.kind === 'WIRE_ATTEMPT' && row.payload.transport === 'DETERMINISTIC_TEST_DOUBLE').length, 2);
  assert.equal((await JSON.parse(await readFile(join(fixture.output, 'value.json'), 'utf8'))).judgmentUsage.inputTokens, 3000);
});

test('tampered study facts or an unavailable trusted key fail closed', async t => {
  const fixture = await fixtureFor(t);
  const fake = transport();
  await evaluateValue({ output: fixture.output, callJevImpl: fake.call, allowDeterministic: true, privateKeyPath: fixture.privateKeyPath, publicKeyPath: fixture.publicKeyPath });
  await writeFile(join(fixture.output, 'report.json'), JSON.stringify({ ...fixture.report, medianActiveTimeRatio: 0.01 }));
  await assert.rejects(() => auditValue({ output: fixture.output, publicKeyPath: fixture.publicKeyPath, allowDeterministic: true }), /stale|binding|signature/i);
  const missing = await fixtureFor(t);
  await assert.rejects(() => evaluateValue({ output: missing.output, callJevImpl: fake.call, allowDeterministic: true, privateKeyPath: join(missing.output, 'missing.pem'), publicKeyPath: missing.publicKeyPath }), /JUDGMENT_UNAVAILABLE/);
});

test('deterministic transport is explicitly labelled and cannot pass production audit', async t => {
  const fixture = await fixtureFor(t, 'DETERMINISTIC');
  const fake = transport();
  await evaluateValue({ output: fixture.output, callJevImpl: fake.call, privateKeyPath: fixture.privateKeyPath, publicKeyPath: fixture.publicKeyPath, allowDeterministic: true });
  await assert.rejects(() => auditValue({ output: fixture.output, publicKeyPath: fixture.publicKeyPath }), /LIVE|production/i);
  assert.equal((await auditValue({ output: fixture.output, publicKeyPath: fixture.publicKeyPath, allowDeterministic: true })).evidenceClass, 'DETERMINISTIC_VALUE_EVALUATION');
});

test('an injected Jev mock cannot produce a LIVE receipt and stage attempts stay inside the bound', async t => {
  const fixture = await fixtureFor(t);
  const fake = transport();
  await assert.rejects(() => evaluateValue({ output: fixture.output, callJevImpl: fake.call,
    privateKeyPath: fixture.privateKeyPath, publicKeyPath: fixture.publicKeyPath }), /test-only|deterministic/i);
  const tooMany = async payload => {
    const result = await fake.call(payload);
    return { ...result, attempts: fixture.protocol.limits.maxJevTransportAttemptsPerStage + 1 };
  };
  await assert.rejects(() => evaluateValue({ output: fixture.output, callJevImpl: tooMany, allowDeterministic: true,
    privateKeyPath: fixture.privateKeyPath, publicKeyPath: fixture.publicKeyPath }), /transport-attempt limit/i);
  const budget = (await readFile(join(fixture.output, 'jev-budget.jsonl'), 'utf8')).trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(budget.filter(row => row.kind === 'WIRE_ATTEMPT').length, fixture.protocol.limits.maxJevTransportAttemptsPerStage);
  assert.equal(budget.at(-1).kind, 'STAGE_UNKNOWN');
});

async function fixtureFor(t, evidenceClass = 'LIVE') { return fixture(t, evidenceClass); }
