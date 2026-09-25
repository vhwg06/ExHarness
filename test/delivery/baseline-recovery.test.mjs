import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ResourceState, foldResourceJournal, nextEligibleAt, readResourceJournal, writeResourceSnapshot } from '../../scripts/delivery/baseline/resource-state.mjs';
import { validateStudyManifest } from '../../scripts/delivery/baseline/study.mjs';
import { sha256 } from '../../scripts/delivery/baseline/contract.mjs';

const limits = { maxConcurrentProviderRequests: 1, maxWireRequestsPerExecution: 4, maxTotalTokensPerExecution: 100, maxApiUsdPerExecution: 1, maxAttemptsPerExecution: 2, maxProviderWaitSeconds: 3600 };
const setup = async t => {
  const root = await mkdtemp(join(tmpdir(), 'baseline-recovery-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const resource = new ResourceState({ journalPath: join(root, 'events.jsonl'), experimentId: 'study', limits, now: () => new Date('2026-09-25T00:00:00.000Z') });
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
  await resource.wait({ executionId: 'P01:DIRECT', nextAt: eligible, waitMs: 10000 });
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

test('captured result and Core adoption fold idempotently and export retains hashes', async t => {
  const { root, resource } = await setup(t);
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
