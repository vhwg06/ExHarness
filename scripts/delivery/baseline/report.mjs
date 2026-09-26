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
  const criticalExharnessDefects = defects.filter(defect => defect.arm === 'EXHARNESS' && defect.severity === 'CRITICAL').length;
  const majorDefectCounts = Object.fromEntries(['DIRECT', 'EXHARNESS'].map(arm => [arm, defects.filter(defect => defect.arm === arm && defect.severity === 'MAJOR').length]));
  const costPerAcceptedTaskRatio = arms.DIRECT.costPerAcceptedTaskUsd > 0 && arms.EXHARNESS.costPerAcceptedTaskUsd != null
    ? arms.EXHARNESS.costPerAcceptedTaskUsd / arms.DIRECT.costPerAcceptedTaskUsd : null;
  const valueInputs = {
    complete,
    medianPairedHumanRatio,
    maxMedianPairedHumanRatio: PROTOCOL.gates.maxMedianPairedHumanRatio,
    directAcceptedRate: arms.DIRECT.acceptedRate,
    exharnessAcceptedRate: arms.EXHARNESS.acceptedRate,
    costPerAcceptedTaskRatio,
    maxCostPerAcceptedRelativeToDirect: PROTOCOL.gates.maxCostPerAcceptedRelativeToDirect,
    criticalExharnessDefects,
    majorDefectCounts,
    qualityWindowComplete: Boolean(qualityWindowComplete)
  };
  return { schemaVersion: 1, experimentId: manifest.experimentId, protocolHash: PROTOCOL_HASH, tasks: resultTasks, arms, pairs, medianPairedHumanRatio, pairedBootstrap95: interval, defects, qualityWindowComplete: Boolean(qualityWindowComplete), valueInputs };
}

function studyBootstrap(values, seed = 65074) {
  if (!values.length) return null;
  let state = seed >>> 0;
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

function knownNonnegative(value) { return Number.isFinite(value) && value >= 0; }

/**
 * Build facts for the six-pair fixture study. This deliberately has no
 * valueVerdict field: semantic value is supplied only by jev-value.mjs.
 */
export function calculateStudyReport({ manifest, executions = [], metrics = null, observationAsOf = null, resourceState = null }) {
  if (manifest?.schemaVersion !== 1 || !['FIXTURE_VALUE_V1', 'CORE_VALUE_V2'].includes(manifest.studyKind) || !Array.isArray(manifest.tasks))
    fail('study manifest/schema mismatch');
  const body = Object.fromEntries(Object.entries(manifest).filter(([key]) => key !== 'digest'));
  if (manifest.digest !== `sha256:${sha256(body)}`) fail('study manifest changed after registration');
  const rows = metrics?.executions ?? executions;
  if (!Array.isArray(rows)) fail('study metrics executions must be an array');
  const registered = new Map();
  for (const task of manifest.tasks) {
    if (!task.executionId || !task.pairId || !['DIRECT', 'EXHARNESS'].includes(task.arm) || registered.has(task.executionId)) fail('invalid study registration row');
    registered.set(task.executionId, task);
  }
  const seen = new Set();
  const resultTasks = manifest.tasks.map(task => {
    const row = rows.find(item => item.executionId === task.executionId);
    if (row) {
      if (seen.has(row.executionId)) fail('duplicate study metric row');
      seen.add(row.executionId);
    }
    const provider = row?.provider ?? {};
    const timing = row?.timing ?? {};
    const checksPassed = Number.isInteger(row?.checksPassed) ? row.checksPassed : null;
    const checksTotal = Number.isInteger(row?.checksTotal) ? row.checksTotal : null;
    const accepted = checksPassed != null && checksTotal != null && checksTotal > 0 && checksPassed === checksTotal && row?.verificationStatus === 'ACCEPTED';
    const usageUnknown = provider.usageUnknown === true || !knownNonnegative(provider.inputTokens) || !knownNonnegative(provider.outputTokens);
    return {
      executionId: task.executionId,
      pairId: task.pairId,
      taskId: task.taskId,
      repeat: task.repeat,
      arm: task.arm,
      orderIndex: task.orderIndex,
      attemptCount: row?.attemptCount ?? 0,
      terminalReason: row?.terminalReason ?? null,
      verificationStatus: row?.verificationStatus ?? null,
      checksPassed,
      checksTotal,
      accepted,
      provider: {
        wireRequests: Number.isInteger(provider.wireRequests) ? provider.wireRequests : null,
        modelCalls: Number.isInteger(provider.modelCalls) ? provider.modelCalls : null,
        inputTokens: knownNonnegative(provider.inputTokens) ? provider.inputTokens : null,
        outputTokens: knownNonnegative(provider.outputTokens) ? provider.outputTokens : null,
        cachedTokens: provider.cachedTokens == null ? null : (knownNonnegative(provider.cachedTokens) ? provider.cachedTokens : null),
        usageUnknown,
        apiUsd: provider.apiUsd == null ? null : (knownNonnegative(provider.apiUsd) ? provider.apiUsd : null)
      },
      timing: {
        registeredAt: timing.registeredAt ?? task.registeredStart ?? null,
        startedAt: timing.startedAt ?? null,
        terminalAt: timing.terminalAt ?? null,
        activeMs: knownNonnegative(timing.activeMs) ? timing.activeMs : null,
        providerWaitMs: knownNonnegative(timing.providerWaitMs) ? timing.providerWaitMs : null,
        elapsedMs: knownNonnegative(timing.elapsedMs) ? timing.elapsedMs : null,
        phases: timing.phases != null && [timing.phases.executorMs, timing.phases.verifyMs, timing.phases.coreMs]
          .every(value => value == null || knownNonnegative(value))
          ? { executorMs: timing.phases.executorMs ?? null, verifyMs: timing.phases.verifyMs ?? null,
            coreMs: timing.phases.coreMs ?? null } : null
      },
      overheadUsd: row?.overheadUsd == null ? null : (knownNonnegative(row.overheadUsd) ? row.overheadUsd : null),
      humanIntervals: Array.isArray(row?.humanIntervals) ? row.humanIntervals : [],
      core: row?.core ?? null,
      profileHash: row?.profileHash ?? null,
      resetDigest: row?.resetDigest ?? null,
      candidateDigest: row?.candidateDigest ?? null,
      evidenceClass: row?.evidenceClass ?? null
    };
  });
  const missing = resultTasks.filter(task => !seen.has(task.executionId)).map(task => task.executionId);
  const pairs = [];
  for (const pair of manifest.pairs ?? []) {
    const direct = resultTasks.find(row => row.executionId === `${pair.pairId}:DIRECT`);
    const exharness = resultTasks.find(row => row.executionId === `${pair.pairId}:EXHARNESS`);
    const activeTimeRatio = direct?.timing.activeMs > 0 && exharness?.timing.activeMs != null ? exharness.timing.activeMs / direct.timing.activeMs : null;
    const directTokens = direct?.provider.inputTokens != null && direct?.provider.outputTokens != null ? direct.provider.inputTokens + direct.provider.outputTokens : null;
    const exharnessTokens = exharness?.provider.inputTokens != null && exharness?.provider.outputTokens != null ? exharness.provider.inputTokens + exharness.provider.outputTokens : null;
    const tokenRatio = directTokens > 0 && exharnessTokens != null ? exharnessTokens / directTokens : null;
    const directCost = direct?.provider.apiUsd;
    const exharnessCost = exharness?.provider.apiUsd;
    const costRatio = directCost > 0 && exharnessCost != null ? exharnessCost / directCost : null;
    pairs.push({
      pairId: pair.pairId,
      taskId: pair.taskId,
      repeat: pair.repeat,
      order: pair.order,
      directExecutionId: direct?.executionId ?? `${pair.pairId}:DIRECT`,
      exharnessExecutionId: exharness?.executionId ?? `${pair.pairId}:EXHARNESS`,
      directAccepted: direct?.accepted ?? null,
      exharnessAccepted: exharness?.accepted ?? null,
      activeTimeRatio,
      tokenRatio,
      costRatio,
      directActiveMs: direct?.timing.activeMs ?? null,
      exharnessActiveMs: exharness?.timing.activeMs ?? null
    });
  }
  const ratios = pairs.map(pair => pair.activeTimeRatio).filter(value => value != null);
  const allSettled = resultTasks.length === manifest.tasks.length && resultTasks.every(row => row.terminalReason != null &&
    !['RESOURCE_EXHAUSTED', 'UNRESOLVED_PROVIDER', 'INFRASTRUCTURE_FAILURE'].includes(row.terminalReason) &&
    !row.provider.usageUnknown && row.timing.activeMs != null);
  const verificationComplete = resultTasks.length === manifest.tasks.length && resultTasks.every(row =>
    ['ACCEPTED', 'REJECTED'].includes(row.verificationStatus) && Number.isInteger(row.checksPassed) &&
    Number.isInteger(row.checksTotal) && row.checksTotal > 0 && row.checksPassed >= 0 && row.checksPassed <= row.checksTotal);
  const evidenceClasses = new Set(resultTasks.filter(row => seen.has(row.executionId)).map(row => row.evidenceClass));
  const evidenceClass = evidenceClasses.size === 1 && evidenceClasses.has('LIVE') ? 'LIVE' : evidenceClasses.has('DETERMINISTIC') ? 'DETERMINISTIC' : 'UNMEASURED';
  const hasLiveEvidence = resultTasks.every(row => row.evidenceClass === 'LIVE' && row.provider.wireRequests > 0 && row.provider.modelCalls > 0);
  const resourceTerminal = resourceState == null || manifest.tasks.every(task => {
    const execution = resourceState.executions?.[task.executionId];
    const metric = resultTasks.find(row => row.executionId === task.executionId);
    const taskBudgetStop = metric?.terminalReason === 'TASK_BUDGET_EXHAUSTED' && execution?.terminalReason === 'RESOURCE_EXHAUSTED';
    return ['COMPLETED', 'TERMINAL'].includes(execution?.status) &&
      (taskBudgetStop || !['RESOURCE_EXHAUSTED', 'UNRESOLVED_PROVIDER', 'INFRASTRUCTURE_FAILURE', 'INVALID_INPUT', 'PREREQUISITE_MISSING'].includes(execution?.terminalReason));
  });
  const reasons = [];
  if (missing.length) reasons.push('MISSING_EXECUTIONS');
  if (!allSettled) reasons.push('UNSETTLED_OR_UNKNOWN_USAGE');
  if (!hasLiveEvidence) reasons.push('LIVE_PROVIDER_EVIDENCE_MISSING');
  if (!verificationComplete) reasons.push('INDEPENDENT_VERIFICATION_INCOMPLETE');
  if (!resourceTerminal) reasons.push('RESOURCE_EXECUTION_NOT_TERMINAL');
  return {
    schemaVersion: 1,
    studyId: manifest.studyId,
    studyKind: manifest.studyKind,
    protocolHash: manifest.protocolHash,
    profileHash: manifest.profileHash,
    candidateSha: manifest.candidateSha,
    candidateTree: manifest.candidateTree,
    evidenceClass,
    registeredExecutionCount: manifest.tasks.length,
    measuredExecutionCount: seen.size,
    complete: reasons.length === 0,
    completenessReasons: reasons,
    executions: resultTasks,
    pairs,
    medianActiveTimeRatio: ratios.length === pairs.length ? median(ratios) : null,
    pairedBootstrap95: ratios.length === pairs.length ? studyBootstrap(ratios, manifest.seed ?? 65074) : null,
    observationAsOf,
    valueEvaluationRef: null
  };
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

export async function studyReportDirectory(directory) {
  const root = resolve(directory);
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
  const metrics = JSON.parse(await readFile(join(root, 'metrics.json'), 'utf8'));
  const observation = await readFile(join(root, 'observation.json'), 'utf8').then(JSON.parse).catch(() => ({ asOf: null }));
  return calculateStudyReport({ manifest, metrics, observationAsOf: observation.asOf });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
  const input = option('--input'), output = option('--output');
  if (!input || !output) fail('usage: report.mjs --input <directory> --output <report.json>');
  const result = await reportDirectory(input);
  await writeFile(output, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ output, complete: result.valueInputs.complete, valueInputs: result.valueInputs }));
}
