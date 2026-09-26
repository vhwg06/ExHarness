import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runFactualAudit } from '../../scripts/delivery/baseline/factual-audit.mjs';
import { ResourceState } from '../../scripts/delivery/baseline/resource-state.mjs';
import { loadValueProtocol } from '../../scripts/delivery/baseline/study.mjs';
import { runControlledTrials } from '../../scripts/delivery/baseline/controlled-trials.mjs';
import { sha256 } from '../../scripts/delivery/baseline/contract.mjs';

function canaryDigest(record) {
  return `sha256:${sha256(Object.fromEntries(Object.entries(record).filter(([key]) => key !== 'digest')))}`;
}

async function liveBundle(t, { canaryStatus = 'PASS', reportComplete = true, unknownLedger = false, dropControlled = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'baseline-factual-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const value = await loadValueProtocol('CORE_VALUE_V2');
  const pairs = value.pairs.map((pair, index) => ({ ...pair, orderIndex: index + 1 }));
  const tasks = pairs.flatMap(pair => pair.order.map((arm, index) => ({ executionId: `${pair.pairId}:${arm}`,
    pairId: pair.pairId, taskId: pair.taskId, repeat: pair.repeat, arm, orderIndex: index + 1,
    registeredStart: '2026-09-26T00:00:00.000Z' })));
  const cohortId = `${value.studyId}:factual-test`;
  const profileHash = 'sha256:profile';
  const canaryBody = { schemaVersion: 1, evidenceClass: 'LIVE_CANARY', task: 'NONCE_MARKER', profileHash,
    candidateSha: 'a'.repeat(40), candidateTree: 'b'.repeat(40), modelId: 'nvidia/nemotron-3.5-lightning-30b-a3b',
    nonce: 'abc123', marker: 'CANARY-MARKER-abc123', markerRef: 'canary/attempt-1/candidate/marker.txt',
    trajectoryRef: 'canary/attempt-1/trajectory.json', ledgerRef: 'executions/CANARY:AUX/provider-ledger.jsonl',
    toolTurns: 2, toolResults: 2, toolTurnsInterleaved: true, wireRequests: 1, inputTokens: 400, outputTokens: 90,
    apiUsd: 0, activeMs: 60000, exitStatus: 'Submitted', driverFailed: null,
    caps: { maxWireRequests: 4, maxTotalTokens: 50000, maxActiveSeconds: 1200, maxApiUsd: 5 },
    status: canaryStatus, generatedAt: '2026-09-26T00:00:00.000Z' };
  const canary = { ...canaryBody, digest: canaryDigest(canaryBody) };
  const qualificationHash = `sha256:${'c'.repeat(64)}`;
  const manifestBody = { schemaVersion: 1, studyKind: value.protocolId, protocolId: value.protocolId, studyId: value.studyId,
    registrationKind: 'STUDY', evidenceClass: 'LIVE_REGISTRATION', protocolHash: `sha256:${sha256(value)}`,
    valueProtocolRef: 'scripts/delivery/baseline/core-value-protocol.json', valueProtocolHash: `sha256:${sha256(value)}`,
    profileHash, armHash: 'sha256:arm', candidateSha: 'a'.repeat(40), candidateTree: 'b'.repeat(40),
    jevTrustedPublicKeyFingerprint: `sha256:${'f'.repeat(64)}`, cohortId, cohortIdHash: `sha256:${sha256(cohortId)}`,
    qualificationHash, qualificationProfileId: 'A', qualificationRef: 'qualification.json',
    canaryHash: canary.digest, canaryRef: 'canary/canary.json',
    canaryUsage: { wireRequests: 1, inputTokens: 400, outputTokens: 90, apiUsd: 0, activeMs: 60000, toolTurns: 2 },
    faultScheduleHash: `sha256:${sha256(value.controlledTrials)}`, fixtureDigest: `sha256:${'d'.repeat(64)}`,
    acceptanceDigest: `sha256:${'e'.repeat(64)}`, operatorId: 'operator', reviewerId: 'reviewer',
    seed: value.seed, pairs, tasks, budgets: value.limits, registeredAt: '2026-09-26T00:00:00.000Z' };
  const manifest = { ...manifestBody, digest: `sha256:${sha256(manifestBody)}` };
  await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest));
  await mkdir(join(root, 'canary'), { recursive: true });
  await writeFile(join(root, 'canary', 'canary.json'), JSON.stringify(canary));
  const executions = tasks.map(task => ({ executionId: task.executionId, pairId: task.pairId, taskId: task.taskId,
    arm: task.arm, repeat: task.repeat, evidenceClass: 'LIVE', verificationStatus: 'REJECTED', checksPassed: 7,
    checksTotal: 8, accepted: false, attemptCount: 2, terminalReason: 'ATTEMPT_LIMIT', profileHash,
    resetDigest: `sha256:${task.executionId}`, candidateDigest: `sha256:${task.executionId}`,
    provider: unknownLedger
      ? { wireRequests: 1, modelCalls: 1, inputTokens: null, outputTokens: null, cachedTokens: null, usageUnknown: true, apiUsd: null }
      : { wireRequests: 1, modelCalls: 1, inputTokens: 100, outputTokens: 20, cachedTokens: 0, usageUnknown: false, apiUsd: 0 },
    timing: { registeredAt: task.registeredStart, startedAt: task.registeredStart, terminalAt: '2026-09-26T01:00:00.000Z',
      activeMs: 60000, providerWaitMs: 0, elapsedMs: 3600000 }, overheadUsd: null, humanIntervals: [], core: null }));
  const metrics = { schemaVersion: 1, studyId: manifest.studyId, executions };
  await writeFile(join(root, 'metrics.json'), JSON.stringify(metrics));
  for (const task of tasks) {
    const dir = join(root, 'executions', task.executionId.replaceAll(':', '__'));
    await mkdir(dir, { recursive: true });
    const rows = [{ schemaVersion: 1, kind: 'RESERVE', requestId: `${task.executionId}-r1`, taskId: task.taskId,
      attemptId: `${task.executionId}:attempt-1`, timestamp: task.registeredStart, inputTokensReserved: 16384,
      outputTokensReserved: 4096, costUsdReserved: 0 },
      unknownLedger
        ? { schemaVersion: 1, kind: 'UNKNOWN', requestId: `${task.executionId}-r1`, taskId: task.taskId,
          attemptId: `${task.executionId}:attempt-1`, timestamp: task.registeredStart, reason: 'provider timeout' }
        : { schemaVersion: 1, kind: 'SETTLED', requestId: `${task.executionId}-r1`, providerRequestId: `provider-${task.executionId}`,
          taskId: task.taskId, attemptId: `${task.executionId}:attempt-1`, timestamp: task.registeredStart,
          inputTokens: 100, cachedInputTokens: null, cacheEvidence: 'NOT_REPORTED', outputTokens: 20, costUsd: 0,
          providerEvidenceRef: `executions/${task.executionId}/provider-responses/r1.json`,
          providerEvidenceHash: `sha256:${createHash('sha256').update('{}').digest('hex')}` }];
    await writeFile(join(dir, 'provider-ledger.jsonl'), rows.map(row => JSON.stringify(row)).join('\n') + '\n');
  }
  const report = { schemaVersion: 1, studyId: manifest.studyId, studyKind: value.protocolId, protocolHash: manifest.protocolHash,
    profileHash, candidateSha: manifest.candidateSha, candidateTree: manifest.candidateTree, evidenceClass: 'LIVE',
    registeredExecutionCount: 12, measuredExecutionCount: 12, complete: reportComplete,
    completenessReasons: reportComplete ? [] : ['MISSING_EXECUTIONS'], executions,
    pairs: pairs.map(pair => ({ pairId: pair.pairId, taskId: pair.taskId, repeat: pair.repeat, order: pair.order,
      directExecutionId: `${pair.pairId}:DIRECT`, exharnessExecutionId: `${pair.pairId}:EXHARNESS`,
      directAccepted: false, exharnessAccepted: false, activeTimeRatio: 1, tokenRatio: 1, costRatio: null,
      directActiveMs: 60000, exharnessActiveMs: 60000 })),
    medianActiveTimeRatio: 1, pairedBootstrap95: [1, 1], observationAsOf: '2026-09-26T02:00:00.000Z', valueEvaluationRef: null };
  await writeFile(join(root, 'report.json'), JSON.stringify(report));
  const resource = new ResourceState({ journalPath: join(root, 'events.jsonl'), experimentId: manifest.studyId,
    profileHash, candidateSha: manifest.candidateSha, candidateTree: manifest.candidateTree,
    protocolHash: manifest.protocolHash, limits: value.limits });
  for (const task of tasks) {
    await resource.registerExecution({ ...task, deadline: '2026-09-29T00:00:00.000Z' });
    await resource.terminal({ executionId: task.executionId, reason: 'COMPLETED' });
  }
  const probes = [1, 2].map(index => {
    const ref = `setup/probe-${index}/provider-response.json`;
    const bytes = Buffer.from(JSON.stringify({ id: `provider-probe-${index}` }) + '\n');
    return { probe: { probeId: `PROBE-${index}`, requestId: `probe-request-${index}`, providerRequestId: `provider-probe-${index}`,
      inputTokens: 20, outputTokens: 4, costUsd: 0, providerEvidenceRef: ref,
      providerEvidenceHash: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
      toolCall: { toolCallId: `probe-call-${index}`, toolName: 'bash', command: `printf 'EXHARNESS_PROBE_${index}'` } }, bytes };
  });
  for (const { probe, bytes } of probes) {
    await mkdir(join(root, 'setup', `probe-${probe.probeId.slice(-1)}`), { recursive: true });
    await writeFile(join(root, probe.providerEvidenceRef), bytes);
    await writeFile(join(root, 'setup', probe.probeId.toLowerCase(), 'result.json'), JSON.stringify({ status: 'PASS',
      providerEvidenceRef: probe.providerEvidenceRef, providerEvidenceHash: probe.providerEvidenceHash,
      toolCall: probe.toolCall, usage: { outputTokens: probe.outputTokens } }));
  }
  await writeFile(join(root, 'setup', 'probes.json'), JSON.stringify({ schemaVersion: 1, evidenceClass: 'LIVE_PROVIDER_PROBES',
    modelId: 'nvidia/nemotron-3.5-lightning-30b-a3b', required: 2, outputTokenLimit: value.limits.maxProbeOutputTokens,
    probes: probes.map(item => item.probe), failures: [], selectedProfileId: 'A', qualificationHash }));
  await writeFile(join(root, 'qualification.json'), JSON.stringify({ qualificationHash, selectedProfileId: 'A' }));
  if (!dropControlled) {
    await runControlledTrials({ profile: { candidateSha: manifest.candidateSha, candidateTree: manifest.candidateTree }, output: root });
  }
  return { root, manifest };
}

test('factual audit passes a complete live-bound bundle before any Jev call', async t => {
  const { root } = await liveBundle(t);
  const result = await runFactualAudit({ output: root });
  assert.deepEqual(result.checks, ['manifest', 'twelve-executions', 'report-complete', 'execution-ledgers',
    'resource-journal', 'canary', 'qualification-probes', 'controlled-trials', 'jev-observations-within-bound']);
  assert.equal(result.exitCode, 0);
});

test('factual audit blocks Jev on canary, ledger, report and controlled gaps', async t => {
  const failed = await liveBundle(t, { canaryStatus: 'FAIL' });
  await assert.rejects(() => runFactualAudit({ output: failed.root }), /canary/);
  const unknown = await liveBundle(t, { unknownLedger: true });
  await assert.rejects(() => runFactualAudit({ output: unknown.root }), /unresolved provider usage/);
  const incomplete = await liveBundle(t, { reportComplete: false });
  await assert.rejects(() => runFactualAudit({ output: incomplete.root }), /complete twelve-execution/);
  const uncontrolled = await liveBundle(t, { dropControlled: true });
  await assert.rejects(() => runFactualAudit({ output: uncontrolled.root }), /controlled/);
});
