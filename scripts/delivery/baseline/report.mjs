import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROTOCOL, PROTOCOL_HASH, canonical, sha256 } from './contract.mjs';

const fail = message => { throw new Error(`BASELINE_REPORT_INVALID: ${message}`); };
const ms = value => { const time = Date.parse(value); if (!Number.isFinite(time)) fail('invalid UTC timestamp'); return time; };
const finiteNonnegative = value => Number.isFinite(value) && value >= 0;
const nullableSum = values => values.every(finiteNonnegative) ? values.reduce((sum, value) => sum + value, 0) : null;
const median = values => { if (!values.length) return null; const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; };

function uniqueByIdentity(rows, identity, label) {
  const seen = new Map();
  for (const row of rows) {
    const id = row[identity];
    if (typeof id !== 'string' || !id) fail(`${label} missing ${identity}`);
    const previous = seen.get(id);
    if (previous && canonical(previous) !== canonical(row)) fail(`conflicting duplicate ${label}: ${id}`);
    seen.set(id, row);
  }
  return [...seen.values()];
}

export function humanMinutes(events, taskIds) {
  const rows = uniqueByIdentity(events, 'eventId', 'human event');
  const sessions = new Map();
  for (const event of rows) {
    if (!taskIds.has(event.taskId) || !event.personId || !event.intervalId || !['START', 'STOP'].includes(event.action) ||
        !['REVIEW', 'REPAIR', 'COORDINATION', 'SETUP'].includes(event.activity)) fail('invalid human event');
    const key = `${event.personId}\0${event.intervalId}`;
    const record = sessions.get(key) ?? { personId: event.personId, taskId: event.taskId, activity: event.activity };
    if (record.taskId !== event.taskId || record.activity !== event.activity || record[event.action]) fail('conflicting human interval');
    record[event.action] = ms(event.timestamp);
    sessions.set(key, record);
  }
  const byPerson = new Map();
  for (const session of sessions.values()) {
    if (session.START == null || session.STOP == null || session.STOP < session.START) fail('unclosed or reversed human interval');
    const intervals = byPerson.get(session.personId) ?? [];
    intervals.push({ start: session.START, stop: session.STOP, taskId: session.taskId, activity: session.activity });
    byPerson.set(session.personId, intervals);
  }
  const totals = new Map([...taskIds].map(id => [id, null]));
  for (const intervals of byPerson.values()) {
    intervals.sort((a, b) => a.start - b.start || a.stop - b.stop);
    for (let index = 0; index < intervals.length; index++)
      for (let next = index + 1; next < intervals.length && intervals[next].start < intervals[index].stop; next++)
        if (intervals[next].taskId !== intervals[index].taskId) fail('overlapping cross-task human allocation');
    const byTask = new Map();
    for (const item of intervals) {
      const list = byTask.get(item.taskId) ?? []; list.push(item); byTask.set(item.taskId, list);
    }
    for (const [taskId, list] of byTask) {
      let minutes = 0, start = null, stop = null;
      for (const item of list) {
        if (start == null) { start = item.start; stop = item.stop; }
        else if (item.start <= stop) stop = Math.max(stop, item.stop);
        else { minutes += (stop - start) / 60000; start = item.start; stop = item.stop; }
      }
      minutes += (stop - start) / 60000;
      totals.set(taskId, (totals.get(taskId) ?? 0) + minutes);
    }
  }
  return totals;
}

function usageByTask(rows, taskIds) {
  const requests = uniqueByIdentity(rows, 'requestId', 'provider request');
  const grouped = new Map([...taskIds].map(id => [id, []]));
  const providerSeen = new Map();
  for (const request of requests) {
    if (!grouped.has(request.taskId) || !request.attemptId || !['SETTLED', 'UNKNOWN'].includes(request.status)) fail('invalid usage record');
    const cacheReported = request.cacheEvidence === 'REPORTED' && finiteNonnegative(request.cachedInputTokens) &&
      request.cachedInputTokens <= request.inputTokens;
    const cacheOmitted = request.cacheEvidence === 'NOT_REPORTED' && request.cachedInputTokens === null;
    if (request.status === 'SETTLED' && (!finiteNonnegative(request.inputTokens) || !(cacheReported || cacheOmitted) ||
        !finiteNonnegative(request.outputTokens) || !finiteNonnegative(request.costUsd))) fail('settled usage missing measured values');
    if (request.status === 'SETTLED') {
      if (!request.providerRequestId) fail('settled usage missing provider request id');
      const previous = providerSeen.get(request.providerRequestId);
      const measured = { taskId: request.taskId, inputTokens: request.inputTokens, cachedInputTokens: request.cachedInputTokens,
        cacheEvidence: request.cacheEvidence,
        outputTokens: request.outputTokens, costUsd: request.costUsd };
      if (previous && canonical(previous) !== canonical(measured)) fail('conflicting provider request usage');
      if (previous) continue;
      providerSeen.set(request.providerRequestId, measured);
    }
    grouped.get(request.taskId).push(request);
  }
  return grouped;
}

function attemptsByTask(rows, taskIds) {
  const grouped = new Map([...taskIds].map(id => [id, []]));
  const attemptIds = new Set();
  for (const attempt of rows) {
    if (!grouped.has(attempt.taskId) || !attempt.attemptId || attemptIds.has(attempt.attemptId) ||
        !Number.isInteger(attempt.attemptNumber) || attempt.attemptNumber < 1 || attempt.attemptNumber > PROTOCOL.budgets.maxAttemptsPerTask)
      fail('invalid or duplicate attempt');
    attemptIds.add(attempt.attemptId);
    if (!['ACCEPTED', 'REJECTED', 'INCONCLUSIVE', 'FAILED', 'TIMED_OUT', 'CANCELLED', 'RUNNING'].includes(attempt.status)) fail('invalid attempt status');
    grouped.get(attempt.taskId).push(attempt);
  }
  for (const list of grouped.values()) {
    if (new Set(list.map(item => item.attemptNumber)).size !== list.length) fail('duplicate attempt number');
    if (list.length > PROTOCOL.budgets.maxAttemptsPerTask) fail('attempt budget exceeded');
  }
  return grouped;
}

function bootstrapMedianInterval(values) {
  if (!values.length) return null;
  let state = PROTOCOL.seed >>> 0;
  const draws = [];
  for (let round = 0; round < 10000; round++) {
    const sample = [];
    for (let index = 0; index < values.length; index++) {
      state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
      sample.push(values[(state >>> 0) % values.length]);
    }
    draws.push(median(sample));
  }
  draws.sort((a, b) => a - b);
  return [draws[249], draws[9749]];
}

export function calculateReport({ manifest, attempts = [], usage = [], humanEvents = [], defects = [], observationAsOf = null }) {
  if (manifest?.schemaVersion !== 1 || manifest.protocolHash !== PROTOCOL_HASH || !Array.isArray(manifest.tasks)) fail('manifest/schema/protocol mismatch');
  const manifestBody = Object.fromEntries(Object.entries(manifest).filter(([key]) => key !== 'digest'));
  if (manifest.digest !== `sha256:${sha256(manifestBody)}`) fail('manifest changed after registration');
  const taskIds = new Set();
  for (const task of manifest.tasks) {
    if (!task.taskId || !['DIRECT', 'EXHARNESS'].includes(task.arm) || taskIds.has(task.taskId) || !task.registeredStart) fail('invalid registered task');
    taskIds.add(task.taskId);
  }
  const attemptGroups = attemptsByTask(attempts, taskIds);
  const usageGroups = usageByTask(usage, taskIds);
  const human = humanMinutes(humanEvents, taskIds);
  const resultTasks = manifest.tasks.map(task => {
    const list = attemptGroups.get(task.taskId);
    const terminal = list.filter(item => item.status !== 'RUNNING').sort((a, b) => a.attemptNumber - b.attemptNumber).at(-1);
    for (const item of list) if (item.status === 'ACCEPTED' && (item.verification?.status !== 'ACCEPTED' || item.verification.candidateDigest !== item.candidateDigest)) fail('accepted attempt lacks independent candidate verification');
    const accepted = list.some(item => item.status === 'ACCEPTED');
    const requests = usageGroups.get(task.taskId);
    for (const request of requests) if (!list.some(item => item.attemptId === request.attemptId)) fail('usage without registered attempt');
    const usageMissing = list.length === 0 || (list.some(item => item.providerDispatched !== false) && requests.length === 0);
    const providerCost = usageMissing ? null : nullableSum(requests.map(request => request.status === 'SETTLED' ? request.costUsd : null));
    const overhead = nullableSum([task.infrastructureUsd, task.evaluatorUsd, task.setupAllocationUsd]);
    const totalCostUsd = providerCost == null || overhead == null ? null : providerCost + overhead;
    const leadTimeSeconds = terminal?.terminalTimestamp ? (ms(terminal.terminalTimestamp) - ms(task.registeredStart)) / 1000 : null;
    if (leadTimeSeconds != null && leadTimeSeconds < 0) fail('negative lead time');
    return { taskId: task.taskId, pairId: task.pairId ?? null, partition: task.partition ?? null, arm: task.arm, attemptCount: list.length, accepted, status: terminal?.status ?? 'INCOMPLETE', humanActiveMinutes: human.get(task.taskId), leadTimeSeconds, totalCostUsd, usageUnknown: providerCost == null, censored: terminal == null };
  });
  const arms = {};
  for (const arm of ['DIRECT', 'EXHARNESS']) {
    const tasks = resultTasks.filter(task => task.arm === arm);
    const acceptedCount = tasks.filter(task => task.accepted).length;
    const totalCostUsd = nullableSum(tasks.map(task => task.totalCostUsd));
    arms[arm] = { registeredCount: tasks.length, attemptedCount: tasks.filter(task => task.attemptCount > 0).length, acceptedCount, acceptedRate: tasks.length ? acceptedCount / tasks.length : null, totalCostUsd, costPerAcceptedTaskUsd: acceptedCount && totalCostUsd != null ? totalCostUsd / acceptedCount : null, medianLeadTimeSeconds: tasks.every(task => task.leadTimeSeconds != null) ? median(tasks.map(task => task.leadTimeSeconds)) : null };
  }
  const pairs = [];
  for (const pairId of [...new Set(resultTasks.map(task => task.pairId).filter(Boolean))].sort()) {
    const direct = resultTasks.find(task => task.pairId === pairId && task.arm === 'DIRECT');
    const exharness = resultTasks.find(task => task.pairId === pairId && task.arm === 'EXHARNESS');
    const ratio = direct?.humanActiveMinutes > 0 && exharness?.humanActiveMinutes != null ? exharness.humanActiveMinutes / direct.humanActiveMinutes : null;
    pairs.push({ pairId, partition: direct?.partition ?? exharness?.partition ?? null, ratio });
  }
  const ratios = pairs.map(pair => pair.ratio).filter(value => value != null);
  const medianPairedHumanRatio = ratios.length === PROTOCOL.pairs ? median(ratios) : null;
  const interval = ratios.length === PROTOCOL.pairs ? bootstrapMedianInterval(ratios) : null;
  for (const defect of defects) if (!taskIds.has(defect.taskId) || !['CRITICAL', 'MAJOR', 'MINOR'].includes(defect.severity)) fail('invalid defect record');
  const qualityWindowComplete = manifest.qualityWindowEnd && observationAsOf && ms(observationAsOf) >= ms(manifest.qualityWindowEnd);
  const complete = resultTasks.length === PROTOCOL.pairs * 2 && pairs.length === PROTOCOL.pairs && resultTasks.every(task => !task.censored && task.humanActiveMinutes != null && task.totalCostUsd != null) && qualityWindowComplete && medianPairedHumanRatio != null && arms.DIRECT.costPerAcceptedTaskUsd > 0 && arms.EXHARNESS.costPerAcceptedTaskUsd != null;
  let valueVerdict = 'INCONCLUSIVE';
  if (complete) {
    const critical = defects.some(defect => defect.arm === 'EXHARNESS' && defect.severity === 'CRITICAL');
    const majorDirect = defects.filter(defect => defect.arm === 'DIRECT' && defect.severity === 'MAJOR').length;
    const majorExharness = defects.filter(defect => defect.arm === 'EXHARNESS' && defect.severity === 'MAJOR').length;
    valueVerdict = medianPairedHumanRatio <= PROTOCOL.gates.maxMedianPairedHumanRatio &&
      arms.EXHARNESS.acceptedRate >= arms.DIRECT.acceptedRate && !critical && majorExharness <= majorDirect &&
      arms.EXHARNESS.costPerAcceptedTaskUsd <= PROTOCOL.gates.maxCostPerAcceptedRelativeToDirect * arms.DIRECT.costPerAcceptedTaskUsd ? 'PASS' : 'NO_GO';
  }
  return { schemaVersion: 1, experimentId: manifest.experimentId, protocolHash: PROTOCOL_HASH, tasks: resultTasks, arms, pairs, medianPairedHumanRatio, pairedBootstrap95: interval, defects, qualityWindowComplete: Boolean(qualityWindowComplete), valueVerdict };
}

async function jsonl(path) {
  try { const body = await readFile(path, 'utf8'); return body.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}
export async function reportDirectory(directory) {
  const root = resolve(directory);
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
  const observation = JSON.parse(await readFile(join(root, 'observation.json'), 'utf8'));
  return calculateReport({ manifest, attempts: await jsonl(join(root, 'attempts.jsonl')), usage: await jsonl(join(root, 'usage.jsonl')), humanEvents: await jsonl(join(root, 'human-events.jsonl')), defects: await jsonl(join(root, 'defects.jsonl')), observationAsOf: observation.asOf });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
  const input = option('--input'), output = option('--output');
  if (!input || !output) fail('usage: report.mjs --input <directory> --output <report.json>');
  const result = await reportDirectory(input);
  await writeFile(output, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ output, valueVerdict: result.valueVerdict }));
}
