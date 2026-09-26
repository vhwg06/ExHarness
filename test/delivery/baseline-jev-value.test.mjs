import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildStageOnePayload, completeValue, evaluateValue, auditValue } from '../../scripts/delivery/baseline/jev-value.mjs';
import { runControlledTrials } from '../../scripts/delivery/baseline/controlled-trials.mjs';
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

test('an incomplete live-bound cohort is sent to Jev for an INCONCLUSIVE choice', async t => {
  const fixture = await fixtureFor(t);
  await writeFile(join(fixture.output, 'report.json'), JSON.stringify({
    ...fixture.report,
    evidenceClass: 'UNMEASURED',
    measuredExecutionCount: 0,
    complete: false,
    completenessReasons: ['MISSING_EXECUTIONS', 'UNSETTLED_OR_UNKNOWN_USAGE'],
    executions: [],
    pairs: fixture.report.pairs.map(pair => ({
      ...pair,
      directAccepted: null,
      exharnessAccepted: null,
      activeTimeRatio: null,
      tokenRatio: null,
      costRatio: null,
      directActiveMs: null,
      exharnessActiveMs: null
    })),
    medianActiveTimeRatio: null,
    pairedBootstrap95: null
  }));
  await writeFile(join(fixture.output, 'metrics.json'), JSON.stringify({ schemaVersion: 1, studyId: fixture.manifest.studyId, executions: [] }));
  const payloads = [];
  const call = async payload => {
    payloads.push(payload);
    if (payload.questions.value) {
      return { response: { model: payload.model, answers: { value: { type: 'choice', choice: 'INCONCLUSIVE', confidence: 0.95, probabilities: { VALUE_DEMONSTRATED: 0.01, NO_VALUE_DEMONSTRATED: 0.01, INCONCLUSIVE: 0.98 } } }, usage: { input_tokens: 1200, output_tokens: 1 } }, attempts: 1 };
    }
    const answers = {};
    for (const id of Object.keys(payload.questions)) answers[id] = { type: 'choice', choice: 'INSUFFICIENT_EVIDENCE', confidence: 0.95, probabilities: { SATISFIED: 0.01, INSUFFICIENT_EVIDENCE: 0.98, CONTRADICTED: 0.01 } };
    return { response: { model: payload.model, answers, usage: { input_tokens: 1800, output_tokens: 4 } }, attempts: 1 };
  };
  const result = await evaluateValue({ output: fixture.output, callJevImpl: call, allowDeterministic: true, privateKeyPath: fixture.privateKeyPath, publicKeyPath: fixture.publicKeyPath });
  assert.equal(result.finalChoice, 'INCONCLUSIVE');
  assert.equal(payloads.length, 2);
  assert.equal(payloads[0].state.study.report.complete, false);
  assert.equal(payloads[0].state.study.report.completenessReasons.includes('UNSETTLED_OR_UNKNOWN_USAGE'), true);
  assert.equal((await auditValue({ output: fixture.output, publicKeyPath: fixture.publicKeyPath, allowDeterministic: true })).finalChoice, 'INCONCLUSIVE');
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

async function coreFixture(t) {
  const base = await fixture(t);
  const value = JSON.parse(await readFile('scripts/delivery/baseline/core-value-protocol.json', 'utf8'));
  const pairs = value.pairs;
  const cohortId = `${value.studyId}:jev-test`;
  const manifestBody = { ...base.manifest, studyKind: value.protocolId, protocolId: value.protocolId, studyId: value.studyId,
    protocolHash: `sha256:${sha256(value)}`, valueProtocolHash: `sha256:${sha256(value)}`, evidenceClass: 'LIVE_REGISTRATION',
    cohortId, cohortIdHash: `sha256:${sha256(cohortId)}`, qualificationHash: `sha256:${'c'.repeat(64)}`,
    qualificationProfileId: 'A', qualificationRef: 'qualification.json', faultScheduleHash: `sha256:${sha256(value.controlledTrials)}`, pairs };
  delete manifestBody.digest;
  const manifest = { ...manifestBody, digest: `sha256:${sha256(manifestBody)}` };
  const executions = base.metrics.executions.map(row => ({ ...row, profileHash: manifest.profileHash }));
  const report = { ...base.report, studyId: manifest.studyId, studyKind: value.protocolId, protocolHash: manifest.protocolHash,
    profileHash: manifest.profileHash, candidateSha: manifest.candidateSha, candidateTree: manifest.candidateTree, evidenceClass: 'LIVE' };
  const metrics = { ...base.metrics, studyId: manifest.studyId, executions };
  await writeFile(join(base.output, 'manifest.json'), JSON.stringify(manifest));
  await writeFile(join(base.output, 'report.json'), JSON.stringify(report));
  await writeFile(join(base.output, 'metrics.json'), JSON.stringify(metrics));
  const probes = JSON.parse(await readFile(join(base.output, 'setup', 'probes.json'), 'utf8'));
  await writeFile(join(base.output, 'setup', 'probes.json'), JSON.stringify({ ...probes, outputTokenLimit: value.limits.maxProbeOutputTokens,
    selectedProfileId: 'A', qualificationHash: manifest.qualificationHash }));
  await runControlledTrials({ output: base.output, profile: { candidateSha: manifest.candidateSha, candidateTree: manifest.candidateTree } });
  return { ...base, protocol: value, manifest, report, metrics };
}

test('CORE_VALUE_V2 sends controlled evidence to Jev and permits attributable control value without an efficiency gate', async t => {
  const fixture = await coreFixture(t);
  const payloads = [];
  const call = async payload => {
    payloads.push(payload);
    if (payload.questions.value) {
      return { response: { model: payload.model, answers: { value: { type: 'choice', choice: 'VALUE_DEMONSTRATED', confidence: 0.8,
        probabilities: { VALUE_DEMONSTRATED: 0.8, NO_VALUE_DEMONSTRATED: 0.1, INCONCLUSIVE: 0.1 } } }, usage: { input_tokens: 1800, output_tokens: 1 } }, attempts: 1 };
    }
    const answers = Object.fromEntries(Object.keys(payload.questions).map(id => {
      const selected = id === 'efficiency' || id === 'recovery' ? 'INSUFFICIENT_EVIDENCE' : 'SATISFIED';
      return [id, { type: 'choice', choice: selected, confidence: 0.8,
        probabilities: selected === 'SATISFIED' ? { SATISFIED: 0.8, INSUFFICIENT_EVIDENCE: 0.1, CONTRADICTED: 0.1 } :
          { SATISFIED: 0.1, INSUFFICIENT_EVIDENCE: 0.8, CONTRADICTED: 0.1 } }];
    }));
    return { response: { model: payload.model, answers, usage: { input_tokens: 2200, output_tokens: 6 } }, attempts: 1 };
  };
  const result = await evaluateValue({ output: fixture.output, callJevImpl: call, allowDeterministic: true,
    privateKeyPath: fixture.privateKeyPath, publicKeyPath: fixture.publicKeyPath });
  assert.equal(result.finalChoice, 'VALUE_DEMONSTRATED');
  assert.deepEqual(Object.keys(payloads[0].questions).sort(), ['candidate_control', 'comparison', 'efficiency', 'evidence', 'quality', 'recovery']);
  assert.equal(payloads[0].state.study.controlledTrials.count, 24);
  assert.equal(payloads[0].state.study.controlledTrials.evidenceClass, 'CONTROLLED_REPLAY');
  const studies = [payloads[0].state.study, payloads[1].state.study];
  for (const study of studies) {
    assert.equal(study.executions.length, 12);
    assert.equal(study.controlledTrials.trials.length, 24);
    assert.equal(study.providerProbes.probes.length, 2);
    assert.equal(study.report.complete, true);
    assert.ok(study.executions.some(row => row[0] === 'P01:DIRECT'));
  }
  assert.equal(payloads[0].state.evidenceRoot, `sha256:${sha256((await import('../../scripts/delivery/baseline/contract.mjs')).canonical(payloads[0].state.study))}`);
  assert.equal(payloads[1].state.evidenceRoot, payloads[0].state.evidenceRoot);
  assert.deepEqual(Object.keys(payloads[1].state.stageOneAnswers).sort(), ['candidate_control', 'comparison', 'efficiency', 'evidence', 'quality', 'recovery']);
  assert.equal(payloads[1].state.stageOneAnswers.evidence.choice, 'SATISFIED');
  assert.equal(payloads[1].state.stageOneAnswers.efficiency.choice, 'INSUFFICIENT_EVIDENCE');
  const valueCriteria = payloads[1].questions.value.criteria;
  assert.equal(valueCriteria.VALUE_DEMONSTRATED, 'Complete comparable evidence and preserved quality plus attributable efficiency OR candidate-control OR recovery benefit justify measured overhead according to Jev. Efficiency need not be SATISFIED when another benefit justifies overhead.');
  assert.equal(valueCriteria.NO_VALUE_DEMONSTRATED, 'Adequate comparable evidence establishes no incremental benefit, worsened quality, or overhead outweighing benefits. Shared safeguards and ties are not Core benefit.');
  assert.equal(valueCriteria.INCONCLUSIVE, 'Essential evidence/comparability is missing or unresolved confounds prevent a supported scoped conclusion; no availability failure may become a negative value conclusion.');
  assert.equal(new Set(Object.values(valueCriteria)).size, 3);
  assert.ok(Buffer.byteLength(JSON.stringify(payloads[0])) < fixture.protocol.jev.evidenceByteLimit);
  assert.ok(Buffer.byteLength(JSON.stringify(payloads[1])) < fixture.protocol.jev.evidenceByteLimit);
  const audited = await auditValue({ output: fixture.output, publicKeyPath: fixture.publicKeyPath, allowDeterministic: true });
  assert.equal(audited.finalChoice, 'VALUE_DEMONSTRATED');
  const complete = await completeValue({ output: fixture.output, publicKeyPath: fixture.publicKeyPath, allowDeterministic: true });
  assert.equal(complete.benchmarkComplete, true);
});

test('Jev negative and inconclusive verdicts are stored verbatim with no validator veto', async t => {
  for (const finalChoice of ['NO_VALUE_DEMONSTRATED', 'INCONCLUSIVE']) {
    const fixture = await coreFixture(t);
    const call = async payload => {
      if (payload.questions.value) {
        const probabilities = { VALUE_DEMONSTRATED: 0.1, NO_VALUE_DEMONSTRATED: 0.1, INCONCLUSIVE: 0.1 };
        probabilities[finalChoice] = 0.8;
        return { response: { model: payload.model, answers: { value: { type: 'choice', choice: finalChoice, confidence: 0.7,
          probabilities } }, usage: { input_tokens: 1800, output_tokens: 1 } }, attempts: 1 };
      }
      const answers = Object.fromEntries(Object.keys(payload.questions).map(id =>
        [id, { type: 'choice', choice: 'SATISFIED', confidence: 0.9,
          probabilities: { SATISFIED: 0.9, INSUFFICIENT_EVIDENCE: 0.05, CONTRADICTED: 0.05 } }]));
      return { response: { model: payload.model, answers, usage: { input_tokens: 2200, output_tokens: 6 } }, attempts: 1 };
    };
    const result = await evaluateValue({ output: fixture.output, callJevImpl: call, allowDeterministic: true,
      privateKeyPath: fixture.privateKeyPath, publicKeyPath: fixture.publicKeyPath });
    assert.equal(result.finalChoice, finalChoice);
    assert.equal((await auditValue({ output: fixture.output, publicKeyPath: fixture.publicKeyPath, allowDeterministic: true })).finalChoice, finalChoice);
    if (finalChoice === 'INCONCLUSIVE') {
      await assert.rejects(() => completeValue({ output: fixture.output, publicKeyPath: fixture.publicKeyPath, allowDeterministic: true }), /not benchmark-complete/);
    } else {
      assert.equal((await completeValue({ output: fixture.output, publicKeyPath: fixture.publicKeyPath, allowDeterministic: true })).benchmarkComplete, true);
    }
  }
});

test('stage-one observations carry canary and ledger facts inside the bound', async t => {
  const f = await coreFixture(t);
  const args = { manifest: f.manifest, report: f.report, metrics: f.metrics, protocol: f.protocol,
    setupProbes: JSON.parse(await readFile(join(f.output, 'setup/probes.json'), 'utf8')),
    controlledTrials: JSON.parse(await readFile(join(f.output, 'controlled-trials.json'), 'utf8')),
    allowDeterministic: true };
  const without = buildStageOnePayload(args);
  assert.equal(without.state.study.canary, null);
  assert.equal(without.state.study.resource, null);
  const canary = { evidenceClass: 'LIVE_CANARY', status: 'PASS', toolTurns: 3, toolResults: 3,
    wireRequests: 2, inputTokens: 400, outputTokens: 90, apiUsd: 0, digest: `sha256:${'f'.repeat(64)}` };
  const resourceSummary = { journalHash: `sha256:${'e'.repeat(64)}`,
    counters: { wireRequests: 24, settled: 24, notAdmitted: 0, unknown: 0 }, cohortTerminalReason: null };
  const payload = buildStageOnePayload({ ...args, canary, resourceSummary });
  assert.equal(payload.state.study.canary.status, 'PASS');
  assert.equal(payload.state.study.canary.toolTurns, 3);
  assert.equal(payload.state.study.canary.digest, canary.digest);
  assert.equal(payload.state.study.resource.journalHash, resourceSummary.journalHash);
  assert.equal(payload.state.study.resource.counters.settled, 24);
  assert.ok(Buffer.byteLength(JSON.stringify({ model: payload.model, state: payload.state, questions: payload.questions })) < f.protocol.jev.evidenceByteLimit);
  await assert.rejects(() => evaluateValue({ output: f.output, callJevImpl: transport().call, allowDeterministic: false,
    privateKeyPath: f.privateKeyPath, publicKeyPath: f.publicKeyPath }), /canary|journal|credential|unavailable/i);
});

test('full live request ledgers fit the Jev transport with bound factual summaries and explicit failures', async t => {
  const f = await coreFixture(t);
  const metrics = structuredClone(f.metrics);
  for (const row of metrics.executions) row.provider.rows = Array.from({ length: 12 }, (_, i) => ({
    requestId: `${row.executionId}-${i}`, status: 'SETTLED', inputTokens: 100, outputTokens: 20,
    providerEvidenceRef: `executions/${row.executionId}/provider-responses/${i}.json`, providerEvidenceHash: `sha256:${'d'.repeat(64)}`
  }));
  const args = { ...f, protocol: f.protocol, metrics, allowDeterministic: true,
    setupProbes: JSON.parse(await readFile(join(f.output, 'setup/probes.json'), 'utf8')),
    controlledTrials: JSON.parse(await readFile(join(f.output, 'controlled-trials.json'), 'utf8')) };
  const payload = buildStageOnePayload(args);
  assert.equal(payload.state.study.executions[0][10].count, 12);
  assert.equal(payload.state.study.executions[0][10].knownInputTokens, 1200);
  assert.equal(payload.state.study.executions[0][10].evidenceBoundCount, 12);
  assert.deepEqual(payload.state.study.executions[0][10].statuses, { SETTLED: 12 });
  const root = payload.state.study.executions[0][10].root;
  metrics.executions[0].provider.rows[0].status = 'UNKNOWN';
  metrics.executions[0].provider.rows[0].reason = 'provider timeout';
  const changed = buildStageOnePayload(args);
  assert.notEqual(changed.state.study.executions[0][10].root, root);
  assert.deepEqual(changed.state.study.executions[0][10].failures, [['P01:DIRECT-0', 'UNKNOWN', 'provider timeout']]);
  metrics.executions[0].provider.rows[0].reason = 'x'.repeat(24000);
  assert.throws(() => buildStageOnePayload(args), /materialization bound/);
});
