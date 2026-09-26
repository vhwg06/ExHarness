import test from 'node:test';
import assert from 'node:assert/strict';
import { PROTOCOL_HASH, sha256 } from '../../scripts/delivery/baseline/contract.mjs';
import { calculateReport, calculateStudyReport, humanMinutes } from '../../scripts/delivery/baseline/report.mjs';

const timestamp = '2026-09-01T00:00:00.000Z';
const atMinute = minute => new Date(Date.parse(timestamp) + minute * 60000).toISOString();
function manifest(tasks) {
  const value = { schemaVersion: 1, experimentId: 'report-fixture', protocolHash: PROTOCOL_HASH, qualityWindowEnd: '2026-09-08T00:00:00.000Z', tasks };
  return { ...value, digest: `sha256:${sha256(value)}` };
}
function event(taskId, personId, intervalId, action, minute) {
  return { eventId: `${taskId}-${personId}-${intervalId}-${action}`, taskId, personId, intervalId, activity: 'REVIEW', action, timestamp: atMinute(minute) };
}
function task(taskId, arm = 'DIRECT', pairId = null) {
  return { taskId, arm, pairId, registeredStart: timestamp, infrastructureUsd: 0, evaluatorUsd: 0, setupAllocationUsd: 0 };
}
function accepted(taskId, attemptNumber = 1) {
  return { taskId, attemptId: `${taskId}-a${attemptNumber}`, attemptNumber, status: 'ACCEPTED', terminalTimestamp: atMinute(20), candidateDigest: `sha256:${'a'.repeat(64)}`, verification: { status: 'ACCEPTED', candidateDigest: `sha256:${'a'.repeat(64)}` } };
}
function usage(taskId, attemptNumber = 1, costUsd = 1) {
  return { taskId, attemptId: `${taskId}-a${attemptNumber}`, requestId: `${taskId}-r${attemptNumber}`, providerRequestId: `${taskId}-provider-${attemptNumber}`, status: 'SETTLED', inputTokens: 100, cachedInputTokens: 0, cacheEvidence: 'REPORTED', outputTokens: 20, costUsd };
}

test('all registered tasks and failed attempts stay in the denominator and cost', () => {
  const tasks = [task('success'), task('failed'), task('missing')];
  const attempts = [accepted('success'), { taskId: 'failed', attemptId: 'failed-a1', attemptNumber: 1, status: 'FAILED', terminalTimestamp: atMinute(10) }, { taskId: 'failed', attemptId: 'failed-a2', attemptNumber: 2, status: 'REJECTED', terminalTimestamp: atMinute(20) }];
  const costs = [usage('success'), usage('failed', 1, 2), usage('failed', 2, 3)];
  const result = calculateReport({ manifest: manifest(tasks), attempts, usage: costs, humanEvents: [event('success', 'p1', 'i1', 'START', 0), event('success', 'p1', 'i1', 'STOP', 10)], observationAsOf: '2026-09-09T00:00:00.000Z' });
  assert.equal(result.arms.DIRECT.registeredCount, 3);
  assert.equal(result.arms.DIRECT.attemptedCount, 2);
  assert.equal(result.tasks.find(item => item.taskId === 'failed').attemptCount, 2);
  assert.equal(result.arms.DIRECT.totalCostUsd, null); // missing task cost remains unknown
  assert.equal(result.tasks.find(item => item.taskId === 'failed').totalCostUsd, 5);
  assert.equal(result.tasks.find(item => item.taskId === 'missing').humanActiveMinutes, null);
  assert.equal(Object.hasOwn(result, 'valueVerdict'), false);
  assert.equal(result.valueInputs.complete, false);
  const duplicate = { ...costs[0], requestId: 'success-local-retry' };
  assert.equal(calculateReport({ manifest: manifest(tasks), attempts, usage: [...costs, duplicate] }).tasks.find(item => item.taskId === 'success').totalCostUsd, 1);
  assert.throws(() => calculateReport({ manifest: manifest(tasks), attempts, usage: [...costs, { ...duplicate, costUsd: 9 }] }), /conflicting provider request usage/);
});

test('human time unions same-task overlaps, deduplicates events, and rejects cross-task allocation', () => {
  const events = [event('a', 'p1', 'i1', 'START', 0), event('a', 'p1', 'i1', 'STOP', 10), event('a', 'p1', 'i2', 'START', 5), event('a', 'p1', 'i2', 'STOP', 15), event('a', 'p2', 'i3', 'START', 0), event('a', 'p2', 'i3', 'STOP', 5)];
  assert.equal(humanMinutes([...events, events[0]], new Set(['a'])).get('a'), 20);
  assert.throws(() => humanMinutes([...events, event('b', 'p1', 'x', 'START', 6), event('b', 'p1', 'x', 'STOP', 8)], new Set(['a', 'b'])), /cross-task/);
  assert.throws(() => humanMinutes(events.slice(0, -1), new Set(['a'])), /unclosed/);
  assert.throws(() => humanMinutes([...events, { ...events[0], timestamp: atMinute(2) }], new Set(['a'])), /conflicting duplicate/);
});

test('complete matched cohort reports preregistered facts without deciding value', () => {
  const tasks = [], attempts = [], requests = [], people = [];
  for (let pair = 1; pair <= 20; pair++) {
    const pairId = `P${String(pair).padStart(2, '0')}`;
    for (const arm of ['DIRECT', 'EXHARNESS']) {
      const id = `${pairId}-${arm}`;
      tasks.push(task(id, arm, pairId));
      attempts.push(accepted(id));
      requests.push(usage(id, 1, arm === 'DIRECT' ? 1 : 1.05));
      people.push(event(id, `reviewer-${id}`, 'review', 'START', 0), event(id, `reviewer-${id}`, 'review', 'STOP', arm === 'DIRECT' ? 10 : 7));
    }
  }
  const input = { manifest: manifest(tasks), attempts, usage: requests, humanEvents: people, observationAsOf: '2026-09-09T00:00:00.000Z' };
  const result = calculateReport(input);
  assert.equal(Object.hasOwn(result, 'valueVerdict'), false);
  assert.equal(result.valueInputs.complete, true);
  assert.equal(result.medianPairedHumanRatio, 0.7);
  assert.equal(result.valueInputs.directAcceptedRate, 1);
  assert.equal(result.valueInputs.exharnessAcceptedRate, 1);
  assert.ok(Math.abs(result.valueInputs.costPerAcceptedTaskRatio - 1.05) < 1e-12);
  assert.deepEqual(result.pairedBootstrap95, [0.7, 0.7]);
  assert.deepEqual(calculateReport(input), result);
  const slower = structuredClone(input);
  for (const row of slower.humanEvents) if (row.taskId.endsWith('EXHARNESS') && row.action === 'STOP') row.timestamp = atMinute(9);
  assert.equal(calculateReport(slower).valueInputs.medianPairedHumanRatio, 0.9);
  const unknown = structuredClone(input);
  unknown.usage[0] = { ...unknown.usage[0], status: 'UNKNOWN', inputTokens: null, outputTokens: null, costUsd: null };
  assert.equal(calculateReport(unknown).valueInputs.complete, false);
  const missing = structuredClone(input);
  missing.attempts.pop();
  missing.usage.pop();
  assert.equal(calculateReport(missing).valueInputs.complete, false);
});

test('report preserves measured phase timings and nulls absent or invalid phases', async () => {
  const value = JSON.parse(await (await import('node:fs/promises')).readFile('scripts/delivery/baseline/value-protocol.json', 'utf8'));
  const tasks = value.pairs.flatMap(pair => pair.order.map((arm, index) => ({
    executionId: `${pair.pairId}:${arm}`, pairId: pair.pairId, taskId: pair.taskId, repeat: pair.repeat,
    arm, orderIndex: index + 1, registeredStart: timestamp
  })));
  const body = { schemaVersion: 1, studyKind: 'FIXTURE_VALUE_V1', studyId: value.studyId,
    protocolHash: `sha256:${sha256(value)}`, profileHash: 'sha256:profile', candidateSha: 'a'.repeat(40),
    candidateTree: 'b'.repeat(40), seed: value.seed, pairs: value.pairs, tasks };
  const manifest = { ...body, digest: `sha256:${sha256(body)}` };
  const metrics = { executions: tasks.map(task => ({
    executionId: task.executionId, evidenceClass: 'LIVE', verificationStatus: 'ACCEPTED',
    checksPassed: 8, checksTotal: 8, terminalReason: 'COMPLETED', attemptCount: 1,
    provider: { wireRequests: 1, modelCalls: 1, inputTokens: 100, outputTokens: 20, usageUnknown: false, apiUsd: 0 },
    timing: { activeMs: 60000, providerWaitMs: 0, elapsedMs: 60000,
      phases: task.arm === 'DIRECT' ? { executorMs: 50000, verifyMs: 9000, coreMs: null } : { executorMs: 40000, verifyMs: null, coreMs: 45000 } },
    accepted: true
  })) };
  const report = calculateStudyReport({ manifest, metrics, observationAsOf: timestamp });
  assert.equal(report.complete, true);
  const direct = report.executions.find(row => row.executionId === 'P01:DIRECT');
  assert.deepEqual(direct.timing.phases, { executorMs: 50000, verifyMs: 9000, coreMs: null });
  const exharness = report.executions.find(row => row.executionId === 'P01:EXHARNESS');
  assert.deepEqual(exharness.timing.phases, { executorMs: 40000, verifyMs: null, coreMs: 45000 });
  const invalid = structuredClone(metrics);
  invalid.executions[0].timing.phases = { executorMs: -1, verifyMs: 0, coreMs: 0 };
  delete invalid.executions[1].timing.phases;
  const second = calculateStudyReport({ manifest, metrics: invalid, observationAsOf: timestamp });
  assert.equal(second.executions[0].timing.phases, null);
  assert.equal(second.executions[1].timing.phases, null);
});

test('a fully measured cohort with zero accepted outputs is complete evidence for Jev negative judgment', async () => {
  const value = JSON.parse(await (await import('node:fs/promises')).readFile('scripts/delivery/baseline/value-protocol.json', 'utf8'));
  const tasks = value.pairs.flatMap(pair => pair.order.map((arm, index) => ({
    executionId: `${pair.pairId}:${arm}`, pairId: pair.pairId, taskId: pair.taskId, repeat: pair.repeat,
    arm, orderIndex: index + 1, registeredStart: timestamp
  })));
  const body = { schemaVersion: 1, studyKind: 'FIXTURE_VALUE_V1', studyId: value.studyId,
    protocolHash: `sha256:${sha256(value)}`, profileHash: 'sha256:profile', candidateSha: 'a'.repeat(40),
    candidateTree: 'b'.repeat(40), seed: value.seed, pairs: value.pairs, tasks };
  const manifest = { ...body, digest: `sha256:${sha256(body)}` };
  const metrics = { executions: tasks.map(task => ({
    executionId: task.executionId, evidenceClass: 'LIVE', verificationStatus: 'REJECTED',
    checksPassed: 0, checksTotal: 8, terminalReason: 'ATTEMPT_LIMIT', attemptCount: 2,
    provider: { wireRequests: 2, modelCalls: 2, inputTokens: 200, outputTokens: 80, usageUnknown: false, apiUsd: 0 },
    timing: { activeMs: 90000 },
    accepted: false
  })) };
  const report = calculateStudyReport({ manifest, metrics, observationAsOf: timestamp });
  assert.equal(report.complete, true);
  assert.equal(report.executions.every(row => !row.accepted), true);
  assert.equal(report.completenessReasons.length, 0);
  const resourceState = { executions: Object.fromEntries(tasks.map(task => [task.executionId,
    { status: 'COMPLETED', terminalReason: 'COMPLETED' }])) };
  resourceState.executions[tasks[0].executionId] = { status: 'VERIFIED', terminalReason: null };
  const interrupted = calculateStudyReport({ manifest, metrics, observationAsOf: timestamp, resourceState });
  assert.equal(interrupted.complete, false);
  assert.ok(interrupted.completenessReasons.includes('RESOURCE_EXECUTION_NOT_TERMINAL'));
});
