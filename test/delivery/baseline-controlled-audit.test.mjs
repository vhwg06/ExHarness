import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { auditControlledTrials, auditQualificationProbes } from '../../scripts/delivery/baseline/controlled-audit.mjs';
import { loadValueProtocol } from '../../scripts/delivery/baseline/study.mjs';
import { runControlledTrials } from '../../scripts/delivery/baseline/controlled-trials.mjs';
import { sha256 } from '../../scripts/delivery/baseline/contract.mjs';

async function controlledOutput(t) {
  const root = await mkdtemp(join(tmpdir(), 'baseline-controlled-audit-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const value = await loadValueProtocol('CORE_VALUE_V2');
  const pairs = value.pairs.map((pair, index) => ({ ...pair, orderIndex: index + 1 }));
  const tasks = pairs.flatMap(pair => pair.order.map((arm, index) => ({ executionId: `${pair.pairId}:${arm}`,
    pairId: pair.pairId, taskId: pair.taskId, repeat: pair.repeat, arm, orderIndex: index + 1 })));
  const cohortId = `${value.studyId}:audit-test`;
  const manifestBody = { schemaVersion: 1, studyKind: value.protocolId, protocolId: value.protocolId, studyId: value.studyId,
    protocolHash: `sha256:${sha256(value)}`, valueProtocolHash: `sha256:${sha256(value)}`, profileHash: 'sha256:profile',
    candidateSha: 'a'.repeat(40), candidateTree: 'b'.repeat(40), evidenceClass: 'LIVE_REGISTRATION', cohortId,
    cohortIdHash: `sha256:${sha256(cohortId)}`, qualificationHash: `sha256:${'c'.repeat(64)}`, qualificationProfileId: 'A',
    qualificationRef: 'qualification.json', faultScheduleHash: `sha256:${sha256(value.controlledTrials)}`, pairs, tasks };
  const manifest = { ...manifestBody, digest: `sha256:${sha256(manifestBody)}` };
  await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest));
  await runControlledTrials({ profile: { candidateSha: manifest.candidateSha, candidateTree: manifest.candidateTree }, output: root });
  return { root, manifest };
}

test('controlled audit reopens oracle, trace, journal and candidate evidence', async t => {
  const { root } = await controlledOutput(t);
  const result = await auditControlledTrials({ output: root });
  assert.equal(result.count, 24);
  assert.equal(result.exitCode, 0);
});

test('controlled audit detects tampered oracle, outcome, mechanism, journal and trace', async t => {
  const { root } = await controlledOutput(t);
  const artifact = JSON.parse(await readFile(join(root, 'controlled-trials.json'), 'utf8'));
  const directRow = artifact.trials.find(row => row.arm === 'DIRECT');
  const oraclePath = join(root, directRow.oracleRef);
  const oracle = JSON.parse(await readFile(oraclePath, 'utf8'));
  await writeFile(oraclePath, JSON.stringify({ ...oracle, observed: { ...oracle.observed, recoveryWork: 9 } }));
  await assert.rejects(() => auditControlledTrials({ output: root }), /oracle changed|recomputed|differs/);
  await writeFile(oraclePath, JSON.stringify(oracle));
  const tampered = structuredClone(artifact);
  const target = tampered.trials.find(row => row.trialId === directRow.trialId);
  target.mechanism = { cutPoint: 'POST_VERIFICATION_SWAP', swapObserved: true };
  target.digest = undefined;
  const { digest, ...body } = tampered;
  await writeFile(join(root, 'controlled-trials.json'), JSON.stringify({ ...body, digest: `sha256:${sha256(body)}` }));
  await assert.rejects(() => auditControlledTrials({ output: root }), /mechanism/);
  await writeFile(join(root, 'controlled-trials.json'), JSON.stringify(artifact));
  const journalPath = join(root, dirname(directRow.oracleRef), 'trial-journal.json');
  const journal = JSON.parse(await readFile(journalPath, 'utf8'));
  await writeFile(journalPath, JSON.stringify({ ...journal, executorCalls: 2 }));
  await assert.rejects(() => auditControlledTrials({ output: root }), /counters|replayed/);
  await writeFile(journalPath, JSON.stringify(journal));
  const exharnessRow = artifact.trials.find(row => row.arm === 'EXHARNESS');
  await writeFile(join(root, exharnessRow.traceRef), 'tampered');
  await assert.rejects(() => auditControlledTrials({ output: root }), /trace/i);
});

test('controlled audit rejects misattributed EXHARNESS deltas', async t => {
  const { root } = await controlledOutput(t);
  const artifact = JSON.parse(await readFile(join(root, 'controlled-trials.json'), 'utf8'));
  const tampered = structuredClone(artifact);
  const target = tampered.trials.find(row => row.arm === 'EXHARNESS');
  target.attribution = target.attribution === 'CORE' ? 'COMMON' : 'CORE';
  const { digest, ...body } = tampered;
  await writeFile(join(root, 'controlled-trials.json'), JSON.stringify({ ...body, digest: `sha256:${sha256(body)}` }));
  const direct = tampered.trials.find(row => row.arm === 'DIRECT' && row.scenario === target.scenario && row.family === target.family);
  const expected = direct.accepted === target.accepted && direct.recoveryWork === target.recoveryWork ? 'COMMON' : 'CORE';
  if (target.attribution !== expected) {
    await assert.rejects(() => auditControlledTrials({ output: root }), /attribution/);
  } else {
    assert.equal((await auditControlledTrials({ output: root })).count, 24);
  }
});

async function probeBundle(t) {
  const root = await mkdtemp(join(tmpdir(), 'baseline-qual-audit-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const value = await loadValueProtocol('CORE_VALUE_V2');
  const qualificationHash = `sha256:${'c'.repeat(64)}`;
  const manifest = { schemaVersion: 1, studyKind: value.protocolId, protocolId: value.protocolId, studyId: value.studyId,
    protocolHash: `sha256:${sha256(value)}`, qualificationHash };
  await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest));
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
    modelId: 'pinned-model', required: 2, outputTokenLimit: value.limits.maxProbeOutputTokens,
    probes: probes.map(item => item.probe), failures: [], selectedProfileId: 'A', qualificationHash }));
  await writeFile(join(root, 'qualification.json'), JSON.stringify({ qualificationHash, selectedProfileId: 'A' }));
  return root;
}

test('qualification audit matches materialized probes to the hash-bound record', async t => {
  const root = await probeBundle(t);
  assert.equal((await auditQualificationProbes({ output: root })).probes, 2);
  await writeFile(join(root, 'setup', 'probe-1', 'provider-response.json'), '{"id":"changed"}\n');
  await assert.rejects(() => auditQualificationProbes({ output: root }), /changed or missing/);
});
