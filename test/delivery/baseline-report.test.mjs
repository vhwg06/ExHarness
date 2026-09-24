import test from 'node:test';
import assert from 'node:assert/strict';
import { PROTOCOL_HASH, sha256 } from '../../scripts/delivery/baseline/contract.mjs';
import { calculateReport, humanMinutes } from '../../scripts/delivery/baseline/report.mjs';

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
  return { taskId, attemptId: `${taskId}-a${attemptNumber}`, requestId: `${taskId}-r${attemptNumber}`, providerRequestId: `${taskId}-provider-${attemptNumber}`, status: 'SETTLED', inputTokens: 100, cachedInputTokens: 0, outputTokens: 20, costUsd };
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
  assert.equal(result.valueVerdict, 'INCONCLUSIVE');
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

test('complete matched cohort evaluates fixed gates and preserves inconclusive or no-go outcomes', () => {
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
  assert.equal(result.valueVerdict, 'PASS');
  assert.equal(result.medianPairedHumanRatio, 0.7);
  assert.deepEqual(result.pairedBootstrap95, [0.7, 0.7]);
  assert.deepEqual(calculateReport(input), result);
  const slower = structuredClone(input);
  for (const row of slower.humanEvents) if (row.taskId.endsWith('EXHARNESS') && row.action === 'STOP') row.timestamp = atMinute(9);
  assert.equal(calculateReport(slower).valueVerdict, 'NO_GO');
  const unknown = structuredClone(input);
  unknown.usage[0] = { ...unknown.usage[0], status: 'UNKNOWN', inputTokens: null, outputTokens: null, costUsd: null };
  assert.equal(calculateReport(unknown).valueVerdict, 'INCONCLUSIVE');
  const missing = structuredClone(input);
  missing.attempts.pop();
  missing.usage.pop();
  assert.equal(calculateReport(missing).valueVerdict, 'INCONCLUSIVE');
});
