import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ResourceState, foldResourceJournal, nextEligibleAt, readResourceJournal, redactTransportValue, writeResourceSnapshot } from '../../scripts/delivery/baseline/resource-state.mjs';
import { prepareAttemptCandidate, recoverCapturedSuffix, recoverProviderJournal, requireProviderEligibility, validateStudyManifest, verifyProviderEvidenceRef } from '../../scripts/delivery/baseline/study.mjs';
import { candidateDigest } from '../../scripts/delivery/baseline/fixture/acceptance.mjs';
import { sha256 } from '../../scripts/delivery/baseline/contract.mjs';

const limits = { maxConcurrentProviderRequests: 1, maxWireRequestsPerExecution: 4, maxTotalTokensPerExecution: 100, maxApiUsdPerExecution: 1, maxAttemptsPerExecution: 2, maxProviderWaitSeconds: 3600 };
const setup = async (t, { resourceLimits = limits, clock = () => new Date('2026-09-25T00:00:00.000Z') } = {}) => {
  const root = await mkdtemp(join(tmpdir(), 'baseline-recovery-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const resource = new ResourceState({ journalPath: join(root, 'events.jsonl'), experimentId: 'study', limits: resourceLimits, now: clock });
  await resource.registerExecution({ executionId: 'P01:DIRECT', pairId: 'P01', taskId: 'NORM-01', arm: 'DIRECT', repeat: 1, deadline: '2026-09-26T00:00:00.000Z' });
  await resource.registerAttempt({ executionId: 'P01:DIRECT', attemptId: 'a1', attemptNumber: 1 });
  return { root, resource };
};

test('study registration is distinct, frozen to six pairs and rejects edited protocol identities', async () => {
  const value = JSON.parse(await readFile('scripts/delivery/baseline/value-protocol.json', 'utf8'));
  const pairs = value.pairs.map((pair, index) => ({ ...pair, orderIndex: index + 1 }));
  const tasks = pairs.flatMap(pair => pair.order.map((arm, index) => ({ executionId: `${pair.pairId}:${arm}`, pairId: pair.pairId, taskId: pair.taskId, repeat: pair.repeat, arm, orderIndex: index + 1 })));
  const body = { schemaVersion: 1, studyKind: 'FIXTURE_VALUE_V1', studyId: value.studyId, registrationKind: 'STUDY', protocolHash: `sha256:${sha256(value)}`, valueProtocolHash: `sha256:${sha256(value)}`, pairs, tasks };
  const manifest = { ...body, digest: `sha256:${sha256(body)}` };
  assert.equal(validateStudyManifest(manifest, { protocol: value }), true);
  const edited = { ...manifest, digest: `sha256:${sha256({ ...body, pairs: pairs.slice(0, 5) })}` };
  assert.throws(() => validateStudyManifest(edited, { protocol: value }), /hash|six pairs|protocol/i);
});

test('proven non-admission persists a bounded wait and a fresh state reader sends nothing early', async t => {
  const { root, resource } = await setup(t);
  const request = await resource.reserve({ executionId: 'P01:DIRECT', attemptId: 'a1', requestId: 'r1', inputTokens: 10, outputTokens: 5, costUsd: 0.01 });
  await resource.sendStarted({ executionId: 'P01:DIRECT', attemptId: 'a1', requestId: request.requestId });
  await resource.notAdmitted({ executionId: 'P01:DIRECT', attemptId: 'a1', requestId: 'r1', proofRef: 'probe-response.json', proofHash: 'sha256:proof', reason: 'HTTP_429_BEFORE_ADMISSION' });
  const eligible = nextEligibleAt({ now: '2026-09-25T00:00:00.000Z', retryIndex: 0, retryAfterSeconds: 10, jitterSeconds: 0 });
  assert.equal(Date.parse(eligible) - Date.parse('2026-09-25T00:00:00.000Z'), 60000);
  await resource.wait({ executionId: 'P01:DIRECT', nextAt: eligible, waitMs: 60000 });
  const fresh = new ResourceState({ journalPath: join(root, 'events.jsonl'), experimentId: 'study', limits, now: () => new Date('2026-09-25T00:00:01.000Z') });
  const state = await fresh.state();
  assert.equal(state.counters.wireRequests, 1);
  assert.equal(state.requests.r1.status, 'NOT_ADMITTED');
  assert.equal(state.executions['P01:DIRECT'].status, 'WAITING_PROVIDER');
  assert.equal(state.executions['P01:DIRECT'].nextEligibleAt, eligible);
});

test('ambiguous send remains UNKNOWN until one evidence-bound reconciliation and fences dispatch', async t => {
  const { root, resource } = await setup(t);
  const request = await resource.reserve({ executionId: 'P01:DIRECT', attemptId: 'a1', requestId: 'r-unknown', inputTokens: 10, outputTokens: 5, costUsd: 0.01 });
  await resource.sendStarted({ executionId: 'P01:DIRECT', attemptId: 'a1', requestId: request.requestId });
  await resource.unknown({ executionId: 'P01:DIRECT', attemptId: 'a1', requestId: request.requestId, reason: 'disconnect-after-send' });
  await assert.rejects(() => resource.reserve({ executionId: 'P01:DIRECT', attemptId: 'a1', requestId: 'r2', inputTokens: 10, outputTokens: 5, costUsd: 0.01 }), /concurrency limit|wire|resource/i);
  const journal = await readResourceJournal(join(root, 'events.jsonl'));
  const unknown = journal.find(event => event.requestId === 'r-unknown' && event.kind === 'UNKNOWN');
  await resource.reconcile({ executionId: 'P01:DIRECT', attemptId: 'a1', requestId: 'r-unknown', settled: false, originalEventHash: unknown.eventHash, proofHash: 'sha256:no-provider-admission' });
  const state = await resource.state();
  assert.equal(state.requests['r-unknown'].status, 'NOT_ADMITTED');
  assert.equal(state.counters.wireRequests, 1);
  const before = (await resource.events()).length;
  await resource.reconcile({ executionId: 'P01:DIRECT', attemptId: 'a1', requestId: 'r-unknown', settled: false, originalEventHash: unknown.eventHash, proofHash: 'sha256:again' });
  assert.equal((await resource.events()).length, before, 'identical reconciliation after settlement is a no-op');
});

test('UNKNOWN on one execution fences a different execution on the same provider route', async t => {
  const { resource } = await setup(t);
  const request = await resource.reserve({ executionId: 'P01:DIRECT', attemptId: 'a1', requestId: 'r-unknown', inputTokens: 10, outputTokens: 5, costUsd: 0.01 });
  await resource.sendStarted({ executionId: 'P01:DIRECT', attemptId: 'a1', requestId: request.requestId });
  await resource.unknown({ executionId: 'P01:DIRECT', attemptId: 'a1', requestId: request.requestId, reason: 'ambiguous-timeout' });
  await resource.registerExecution({ executionId: 'P02:EXHARNESS', pairId: 'P02', taskId: 'STATUS-01', arm: 'EXHARNESS', repeat: 1, deadline: '2026-09-26T00:00:00.000Z' });
  await resource.registerAttempt({ executionId: 'P02:EXHARNESS', attemptId: 'b1', attemptNumber: 1 });
  await assert.rejects(() => resource.reserve({ executionId: 'P02:EXHARNESS', attemptId: 'b1', requestId: 'r-next', inputTokens: 10, outputTokens: 5, costUsd: 0.01 }), /unresolved provider request fences cohort/);
});

test('settlement releases unused reservation and keeps numeric token evidence unredacted', async t => {
  let current = new Date('2026-09-25T00:00:00.000Z');
  const { resource } = await setup(t, { resourceLimits: { ...limits, maxTotalTokensPerExecution: 100 }, clock: () => current });
  const first = await resource.reserve({ executionId: 'P01:DIRECT', attemptId: 'a1', requestId: 'r1', inputTokens: 50, outputTokens: 20, costUsd: 0.1 });
  await resource.sendStarted({ executionId: 'P01:DIRECT', attemptId: 'a1', requestId: first.requestId });
  await resource.settled({ executionId: 'P01:DIRECT', attemptId: 'a1', requestId: 'r1', providerRequestId: 'provider-1', responseHash: 'sha256:response', usage: { inputTokens: 20, outputTokens: 10, costUsd: 0.02 } });
  current = new Date('2026-09-25T00:00:10.000Z');
  const second = await resource.reserve({ executionId: 'P01:DIRECT', attemptId: 'a1', requestId: 'r2', inputTokens: 50, outputTokens: 20, costUsd: 0.1 });
  assert.equal(second.status, 'INTENT');
  assert.deepEqual(redactTransportValue({ inputTokens: 16384, outputTokens: 4096, access_token: 'provider-secret' }), {
    inputTokens: 16384, outputTokens: 4096, access_token: '[REDACTED]'
  });
});

test('provider route enforces ten-second minimum spacing across executions', async t => {
  let current = new Date('2026-09-25T00:00:00.000Z');
  const { resource } = await setup(t, { resourceLimits: { ...limits, minRequestIntervalSeconds: 10 }, clock: () => current });
  const first = await resource.reserve({ executionId: 'P01:DIRECT', attemptId: 'a1', requestId: 'r1', inputTokens: 10, outputTokens: 5, costUsd: 0.01 });
  await resource.sendStarted({ executionId: 'P01:DIRECT', attemptId: 'a1', requestId: first.requestId });
  await resource.settled({ executionId: 'P01:DIRECT', attemptId: 'a1', requestId: 'r1', providerRequestId: 'provider-1', responseHash: 'sha256:response', usage: { inputTokens: 2, outputTokens: 1, costUsd: 0 } });
  await resource.registerExecution({ executionId: 'P02:EXHARNESS', pairId: 'P02', taskId: 'STATUS-01', arm: 'EXHARNESS', repeat: 1, deadline: '2026-09-26T00:00:00.000Z' });
  await resource.registerAttempt({ executionId: 'P02:EXHARNESS', attemptId: 'b1', attemptNumber: 1 });
  await assert.rejects(() => resource.reserve({ executionId: 'P02:EXHARNESS', attemptId: 'b1', requestId: 'r2', inputTokens: 10, outputTokens: 5, costUsd: 0.01 }), error => error.code === 'RESOURCE_WAIT' && error.nextEligibleAt === '2026-09-25T00:00:10.000Z');
  current = new Date('2026-09-25T00:00:10.000Z');
  assert.equal((await resource.reserve({ executionId: 'P02:EXHARNESS', attemptId: 'b1', requestId: 'r2', inputTokens: 10, outputTokens: 5, costUsd: 0.01 })).status, 'INTENT');
});

test('provider non-admission route backoff is cohort-wide and request reserve is idempotent', async t => {
  let current = new Date('2026-09-25T00:00:00.000Z');
  const { resource } = await setup(t, { resourceLimits: { ...limits, minRequestIntervalSeconds: 0 }, clock: () => current });
  const first = await resource.reserve({ executionId: 'P01:DIRECT', attemptId: 'a1', requestId: 'r1', inputTokens: 10, outputTokens: 5, costUsd: 0.01 });
  assert.equal((await resource.reserve({ executionId: 'P01:DIRECT', attemptId: 'a1', requestId: 'r1', inputTokens: 10, outputTokens: 5, costUsd: 0.01 })).requestId, first.requestId);
  await resource.sendStarted({ executionId: 'P01:DIRECT', attemptId: 'a1', requestId: 'r1' });
  await resource.notAdmitted({ executionId: 'P01:DIRECT', attemptId: 'a1', requestId: 'r1', proofRef: 'provider-admission/r1.json', proofHash: 'sha256:proof', reason: 'HTTP_429_NOT_ADMITTED' });
  await resource.wait({ executionId: 'P01:DIRECT', nextAt: '2026-09-25T00:01:00.000Z', waitMs: 60000, routeWide: true });
  await resource.registerExecution({ executionId: 'P02:EXHARNESS', pairId: 'P02', taskId: 'STATUS-01', arm: 'EXHARNESS', repeat: 1, deadline: '2026-09-26T00:00:00.000Z' });
  await resource.registerAttempt({ executionId: 'P02:EXHARNESS', attemptId: 'b1', attemptNumber: 1 });
  await assert.rejects(() => resource.reserve({ executionId: 'P02:EXHARNESS', attemptId: 'b1', requestId: 'r2', inputTokens: 10, outputTokens: 5, costUsd: 0.01 }), error => error.code === 'RESOURCE_WAIT' && error.nextEligibleAt === '2026-09-25T00:01:00.000Z');
  current = new Date('2026-09-25T00:01:00.000Z');
  assert.equal((await resource.reserve({ executionId: 'P02:EXHARNESS', attemptId: 'b1', requestId: 'r2', inputTokens: 10, outputTokens: 5, costUsd: 0.01 })).status, 'INTENT');
  assert.equal((await resource.state()).routeNextEligibleAt, '2026-09-25T00:01:00.000Z');
});

test('attempt two continues the prior candidate and resume preserves its working tree', async t => {
  const root = await mkdtemp(join(tmpdir(), 'baseline-attempt-candidate-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const executionDir = join(root, 'execution');
  await mkdir(join(executionDir, 'attempt-1'), { recursive: true });
  const firstCandidate = join(executionDir, 'attempt-1', 'candidate');
  const resetDigest = await prepareAttemptCandidate({ executionDir, attemptNumber: 1, candidateDir: firstCandidate });
  await appendFile(join(firstCandidate, 'server.mjs'), '\n// first attempt edit\n');
  const firstDigest = await candidateDigest(firstCandidate);
  await mkdir(join(executionDir, 'attempt-2'), { recursive: true });
  const secondCandidate = join(executionDir, 'attempt-2', 'candidate');
  assert.equal(await prepareAttemptCandidate({ executionDir, attemptNumber: 2, candidateDir: secondCandidate }), resetDigest);
  assert.equal(await candidateDigest(secondCandidate), firstDigest);
  await appendFile(join(secondCandidate, 'client.js'), '\n// resumed edit\n');
  const resumedDigest = await candidateDigest(secondCandidate);
  assert.equal(await prepareAttemptCandidate({ executionDir, attemptNumber: 2, candidateDir: secondCandidate }), resetDigest);
  assert.equal(await candidateDigest(secondCandidate), resumedDigest, 'resume does not reset the in-progress attempt');
});

test('captured result and Core adoption fold idempotently and export retains hashes', async t => {
  const { root, resource } = await setup(t);
  await resource.startAttempt({ executionId: 'P01:DIRECT', attemptId: 'a1' });
  await resource.captureResult({ executionId: 'P01:DIRECT', attemptId: 'a1', resultHash: 'sha256:result', candidateDigest: 'sha256:candidate', path: 'executions/P01__DIRECT/result.json' });
  await resource.verified({ executionId: 'P01:DIRECT', attemptId: 'a1', verificationHash: 'sha256:verification', status: 'ACCEPTED' });
  await resource.adopted({ executionId: 'P01:DIRECT', attemptId: 'a1', sessionId: 'P01:DIRECT', eventHash: 'event-1' });
  await resource.terminal({ executionId: 'P01:DIRECT', attemptId: 'a1', reason: 'COMPLETED', status: 'COMPLETED' });
  const state = await resource.state();
  assert.equal(state.executions['P01:DIRECT'].status, 'COMPLETED');
  const snapshot = await writeResourceSnapshot({ path: join(root, 'current.json'), state, journalPath: join(root, 'events.jsonl'), files: [join(root, 'events.jsonl')] });
  assert.equal(snapshot.state.executions['P01:DIRECT'].status, 'COMPLETED');
  assert.match((await readFile(join(root, 'current.json'), 'utf8')), /events\.jsonl/);
  const folded = foldResourceJournal(await readResourceJournal(join(root, 'events.jsonl')), { experimentId: 'study' });
  assert.deepEqual(folded.executions['P01:DIRECT'], state.executions['P01:DIRECT']);
});

test('recovery completes a captured verification suffix without issuing a provider request', async t => {
  const { root, resource } = await setup(t);
  await resource.startAttempt({ executionId: 'P01:DIRECT', attemptId: 'a1' });
  const executionDir = join(root, 'executions', 'P01__DIRECT');
  const attemptDir = join(executionDir, 'attempt-1');
  await mkdir(attemptDir, { recursive: true });
  const verificationPath = join(attemptDir, 'verification.json');
  const body = JSON.stringify({ status: 'REJECTED', executionId: 'P01:DIRECT', candidateDigest: 'a'.repeat(64), checks: [{ check: 'NORM-01', pass: false }] }, null, 2) + '\n';
  await writeFile(verificationPath, body);
  const verificationHash = `sha256:${createHash('sha256').update(body).digest('hex')}`;
  const terminalAt = '2026-09-25T00:00:01.000Z';
  const metrics = { schemaVersion: 1, executionId: 'P01:DIRECT', attemptId: 'a1', candidateDigest: 'a'.repeat(64),
    verificationHash, verificationStatus: 'REJECTED', accepted: false, attemptActiveMs: 25,
    terminalReason: 'COMPLETED', timing: { terminalAt } };
  await writeFile(join(executionDir, 'metrics.json'), JSON.stringify(metrics, null, 2) + '\n');
  await resource.captureResult({ executionId: 'P01:DIRECT', attemptId: 'a1', resultHash: verificationHash,
    candidateDigest: metrics.candidateDigest, path: 'executions/P01__DIRECT/attempt-1/verification.json' });
  const recovered = await recoverCapturedSuffix({ output: root, task: { executionId: 'P01:DIRECT', arm: 'DIRECT' }, resource });
  assert.equal(recovered.attemptId, 'a1');
  const state = await resource.state();
  assert.equal(state.executions['P01:DIRECT'].status, 'COMPLETED');
  assert.equal(state.counters.wireRequests, 0);
  assert.equal(state.executions['P01:DIRECT'].activeMs, 25);
});

test('incremental handoff permits journal growth but rejects changed prior evidence bytes', async t => {
  const { root, resource } = await setup(t);
  const responsePath = join(root, 'provider-responses', 'r1.json');
  await mkdir(join(root, 'provider-responses'), { recursive: true });
  await writeFile(responsePath, '{"id":"provider-r1"}\n');
  const handoffPath = join(root, 'handoff.json');
  const files = [join(root, 'events.jsonl'), responsePath];
  await writeResourceSnapshot({ path: handoffPath, state: await resource.state(), journalPath: join(root, 'events.jsonl'), files });
  await resource.registerExecution({ executionId: 'P02:DIRECT', pairId: 'P02', taskId: 'STATUS-01', arm: 'DIRECT', repeat: 1, deadline: '2026-09-26T00:00:00.000Z' });
  await writeResourceSnapshot({ path: handoffPath, state: await resource.state(), journalPath: join(root, 'events.jsonl'), files });
  await writeFile(responsePath, '{"id":"provider-r2"}\n');
  const changedState = await resource.state();
  await assert.rejects(() => writeResourceSnapshot({ path: handoffPath, state: changedState, journalPath: join(root, 'events.jsonl'), files }), /immutable handoff evidence changed/);
});

test('fresh-process recovery closes pre-send intent and fences ambiguous send as UNKNOWN', async t => {
  const beforeSend = await setup(t);
  await beforeSend.resource.reserve({ executionId: 'P01:DIRECT', attemptId: 'a1', requestId: 'r-intent', inputTokens: 10, outputTokens: 5, costUsd: 0.01 });
  await recoverProviderJournal({ output: beforeSend.root, resource: beforeSend.resource });
  const preSendState = await beforeSend.resource.state();
  assert.equal(preSendState.requests['r-intent'].status, 'NOT_ADMITTED');
  const localPreSendLedger = (await readFile(join(beforeSend.root, 'executions', 'P01__DIRECT', 'provider-ledger.jsonl'), 'utf8'))
    .split(/\r?\n/).filter(Boolean).map(JSON.parse);
  assert.deepEqual(localPreSendLedger.map(row => row.kind), ['RESERVE', 'NOT_ADMITTED']);

  const afterSend = await setup(t);
  await afterSend.resource.reserve({ executionId: 'P01:DIRECT', attemptId: 'a1', requestId: 'r-flight', inputTokens: 10, outputTokens: 5, costUsd: 0.01 });
  await afterSend.resource.sendStarted({ executionId: 'P01:DIRECT', attemptId: 'a1', requestId: 'r-flight' });
  await recoverProviderJournal({ output: afterSend.root, resource: afterSend.resource });
  const inFlightState = await afterSend.resource.state();
  assert.equal(inFlightState.requests['r-flight'].status, 'UNKNOWN');
  const localInFlightLedger = (await readFile(join(afterSend.root, 'executions', 'P01__DIRECT', 'provider-ledger.jsonl'), 'utf8'))
    .split(/\r?\n/).filter(Boolean).map(JSON.parse);
  assert.deepEqual(localInFlightLedger.map(row => row.kind), ['RESERVE', 'UNKNOWN']);
});

test('cumulative pre-dispatch and in-route waits exhaust the registered ceiling together', async t => {
  let current = new Date('2026-09-25T00:00:00.000Z');
  const at = seconds => new Date(Date.parse('2026-09-25T00:00:00.000Z') + seconds * 1000).toISOString();
  const { resource } = await setup(t, { resourceLimits: { ...limits, minRequestIntervalSeconds: 0 }, clock: () => current });
  await resource.wait({ executionId: 'P01:DIRECT', nextAt: at(3500), waitMs: 3500000 });
  current = new Date(at(3500));
  await resource.wait({ executionId: 'P01:DIRECT', nextAt: at(3700), waitMs: 200000 });
  await assert.rejects(() => requireProviderEligibility({ resource, executionId: 'P01:DIRECT', clock: () => current }),
    error => error.code === 'RESOURCE_LIMIT_EXCEEDED' && error.studyReason === 'RESOURCE_EXHAUSTED');
  const state = await resource.state();
  assert.equal(state.executions['P01:DIRECT'].status, 'TERMINAL');
  assert.equal(state.executions['P01:DIRECT'].terminalReason, 'RESOURCE_EXHAUSTED');
});

test('pre-send NOT_ADMITTED audit proof resolves an exact intent event, not a filesystem path', async () => {
  const intent = { eventId: 'intent-1', eventHash: 'sha256:intent-hash', kind: 'REQUEST_INTENT', requestId: 'wire-1' };
  const providerRow = { requestId: 'wire-1', status: 'NOT_ADMITTED', reason: 'CRASH_BEFORE_SEND_STARTED',
    providerEvidenceRef: 'events.jsonl#intent-1', providerEvidenceHash: intent.eventHash };
  assert.equal(await verifyProviderEvidenceRef({ output: '/unused', providerRow, events: [intent] }), true);
  await assert.rejects(() => verifyProviderEvidenceRef({ output: '/unused', providerRow,
    events: [intent, { eventId: 'send-1', eventHash: 'sha256:send', kind: 'SEND_STARTED', requestId: 'wire-1' }] }), /unsent request intent/);
  await assert.rejects(() => verifyProviderEvidenceRef({ output: '/unused', providerRow: { ...providerRow, requestId: 'other' }, events: [intent] }), /unsent request intent/);
});
