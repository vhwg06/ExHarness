import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCoreArm } from '../../scripts/delivery/baseline/core-arm.mjs';
import { auditCoreTrace } from '../../scripts/delivery/baseline/core-arm.mjs';
import { coordinateDirectAttempt, loadValueProtocol } from '../../scripts/delivery/baseline/study.mjs';
import { runControlledTrials } from '../../scripts/delivery/baseline/controlled-trials.mjs';
import { sha256 } from '../../scripts/delivery/baseline/contract.mjs';

const clock = (() => {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 8, 25, 0, 0, tick++) );
})();

test('EXHARNESS arm invokes the real Core lifecycle and promotes only an independently accepted changed candidate', async t => {
  const root = await mkdtemp(join(tmpdir(), 'baseline-arms-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let calls = 0;
  const arm = createCoreArm({
    directory: root,
    executionId: 'P01:EXHARNESS',
    work: { taskId: 'NORM-01', pairId: 'P01' },
    seedCandidate: { id: 'P01:EXHARNESS', version: 'sha256:reset' },
    executeAttempt: async () => {
      calls += 1;
      return { candidateDigest: 'sha256:fixed-candidate', candidateRef: 'candidate', provider: { wireRequests: 1 } };
    },
    verifyCandidate: async () => ({ status: 'ACCEPTED', candidateDigest: 'sha256:fixed-candidate', checks: [{ check: 'all', pass: true }] }),
    clock
  });
  const result = await arm.run({ attemptId: 'a1', taskId: 'NORM-01', fault: 'NORM-01', verificationRef: 'verification.json' });
  assert.equal(calls, 1);
  assert.equal(result.evaluation.validity, 'VALID');
  assert.equal(result.evaluation.verdict, 'PASS');
  assert.equal(result.promotion.candidate.version, 'sha256:fixed-candidate');
  for (const type of ['SESSION_STARTED', 'OBSERVED', 'ACTED', 'VERIFIED', 'EVALUATED', 'PROMOTED']) assert.ok(result.core.events.some(event => event.type === type), type);
  const trace = await auditCoreTrace(join(root, 'core-events.json'), { executionId: 'P01:EXHARNESS', requirePromotion: true });
  assert.equal(trace.eventCounts.PROMOTED, 1);
});

test('a resumed Core arm adopts the existing result without replaying a provider action', async t => {
  const root = await mkdtemp(join(tmpdir(), 'baseline-arms-resume-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const options = {
    directory: root,
    executionId: 'P02:EXHARNESS',
    work: { taskId: 'STATUS-01', pairId: 'P02' },
    seedCandidate: { id: 'P02:EXHARNESS', version: 'sha256:reset' },
    executeAttempt: async () => ({ candidateDigest: 'sha256:fixed-candidate', candidateRef: 'candidate' }),
    verifyCandidate: async () => ({ status: 'ACCEPTED', candidateDigest: 'sha256:fixed-candidate', checks: [{ check: 'all', pass: true }] }),
    clock
  };
  const first = await createCoreArm(options).run({ attemptId: 'a1', taskId: 'STATUS-01', fault: 'STATUS-01' });
  let replayed = false;
  const resumed = await createCoreArm({ ...options, executeAttempt: async () => { replayed = true; throw new Error('provider action replayed'); } }).run({ attemptId: 'a1', taskId: 'STATUS-01', fault: 'STATUS-01' });
  assert.equal(first.candidateDigest, resumed.candidateDigest);
  assert.equal(replayed, false);
  assert.equal(resumed.promotion.candidate.version, 'sha256:fixed-candidate');
});

test('a no-op Core action is evaluated but cannot promote the baseline', async t => {
  const root = await mkdtemp(join(tmpdir(), 'baseline-arms-noop-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const result = await createCoreArm({
    directory: root,
    executionId: 'P03:EXHARNESS',
    work: { taskId: 'ORDER-01', pairId: 'P03' },
    seedCandidate: { id: 'P03:EXHARNESS', version: 'sha256:reset' },
    executeAttempt: async () => ({ candidateDigest: 'sha256:reset', candidateRef: 'candidate' }),
    verifyCandidate: async () => ({ status: 'REJECTED', candidateDigest: 'sha256:reset', checks: [{ check: 'order', pass: false }] }),
    clock
  }).run({ attemptId: 'a1', taskId: 'ORDER-01', fault: 'ORDER-01' });
  assert.equal(result.mutated, false);
  assert.equal(result.evaluation.verdict, 'GAP');
  assert.equal(result.promotion, null);
  assert.equal(result.core.eventCounts.PROMOTED ?? 0, 0);
});

test('the shared DIRECT seam binds executor output to independent verification', async () => {
  const produced = { candidateDigest: 'sha256:produced', candidateRef: 'candidate' };
  const verified = { status: 'ACCEPTED', candidateDigest: 'sha256:produced', checks: [] };
  let hooked = null;
  const result = await coordinateDirectAttempt({ runExecutor: async () => produced,
    verifyCandidate: async common => { assert.equal(common, produced); return verified; },
    onVerified: async ({ common, verification }) => { hooked = { common, verification }; return { observed: true }; } });
  assert.equal(result.common, produced);
  assert.equal(result.verification, verified);
  assert.deepEqual(hooked, { common: produced, verification: verified });
  assert.deepEqual(result.hook, { observed: true });
  assert.ok(Number.isFinite(result.executorMs) && Number.isFinite(result.verifyMs));
  await assert.rejects(() => coordinateDirectAttempt({ runExecutor: async () => produced,
    verifyCandidate: async () => ({ ...verified, candidateDigest: 'sha256:other' }) }), /digests differ/);
  await assert.rejects(() => coordinateDirectAttempt({ runExecutor: async () => ({}),
    verifyCandidate: async () => verified }), /no candidate-bound result/);
});

test('Core sessions are scoped to the cohort and reject cross-cohort joins', async t => {
  const root = await mkdtemp(join(tmpdir(), 'baseline-arms-cohort-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const arm = createCoreArm({ directory: root, executionId: 'P01:EXHARNESS', cohortId: 'BB065-CORE-VALUE-2:test',
    work: { taskId: 'NORM-01', pairId: 'P01' }, seedCandidate: { id: 'P01:EXHARNESS', version: 'sha256:reset' },
    executeAttempt: async () => ({ candidateDigest: 'sha256:fixed-candidate', candidateRef: 'candidate' }),
    verifyCandidate: async () => ({ status: 'ACCEPTED', candidateDigest: 'sha256:fixed-candidate', checks: [] }),
    clock });
  const result = await arm.run({ attemptId: 'a1', taskId: 'NORM-01', fault: 'NORM-01' });
  assert.equal(result.sessionId, 'BB065-CORE-VALUE-2:test:P01:EXHARNESS');
  await auditCoreTrace(join(root, 'core-events.json'), { executionId: 'P01:EXHARNESS', sessionId: 'BB065-CORE-VALUE-2:test:P01:EXHARNESS' });
  await assert.rejects(() => auditCoreTrace(join(root, 'core-events.json'), { executionId: 'P01:EXHARNESS', sessionId: 'OTHER:P01:EXHARNESS' }), /session/i);
});

test('controlled replay materializes all four fault scenarios across three families and both arms', async t => {
  const root = await mkdtemp(join(tmpdir(), 'baseline-controlled-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const value = await loadValueProtocol('CORE_VALUE_V2');
  const pairs = value.pairs.map((pair, index) => ({ ...pair, orderIndex: index + 1 }));
  const tasks = pairs.flatMap(pair => pair.order.map((arm, index) => ({ executionId: `${pair.pairId}:${arm}`, pairId: pair.pairId,
    taskId: pair.taskId, repeat: pair.repeat, arm, orderIndex: index + 1 })));
  const cohortId = `${value.studyId}:controlled-test`;
  const manifestBody = { schemaVersion: 1, studyKind: value.protocolId, protocolId: value.protocolId, studyId: value.studyId,
    protocolHash: `sha256:${sha256(value)}`, valueProtocolHash: `sha256:${sha256(value)}`, profileHash: 'sha256:profile',
    candidateSha: 'a'.repeat(40), candidateTree: 'b'.repeat(40), evidenceClass: 'LIVE_REGISTRATION', cohortId,
    cohortIdHash: `sha256:${sha256(cohortId)}`, qualificationHash: `sha256:${'c'.repeat(64)}`, qualificationProfileId: 'A',
    qualificationRef: 'qualification.json', faultScheduleHash: `sha256:${sha256(value.controlledTrials)}`, pairs, tasks };
  const manifest = { ...manifestBody, digest: `sha256:${sha256(manifestBody)}` };
  await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest));
  const result = await runControlledTrials({ profile: { candidateSha: manifest.candidateSha, candidateTree: manifest.candidateTree }, output: root });
  assert.equal(result.count, 24);
  const artifact = JSON.parse(await readFile(join(root, 'controlled-trials.json'), 'utf8'));
  assert.equal(artifact.evidenceClass, 'CONTROLLED_REPLAY');
  assert.equal(artifact.trials.length, 24);
  assert.equal(new Set(artifact.trials.map(row => row.arm)).size, 2);
  assert.equal(new Set(artifact.trials.map(row => row.scenario)).size, 4);
  assert.ok(artifact.trials.every(row => row.faultScheduleHash === manifest.faultScheduleHash && row.oracleHash));
  assert.ok(artifact.trials.filter(row => row.arm === 'EXHARNESS').every(row => row.traceHash && row.coreStateHash));
  const byScenario = scenario => artifact.trials.filter(row => row.scenario === scenario);
  for (const row of byScenario('STALE_CANDIDATE_VERIFICATION')) {
    assert.equal(row.mechanism.swapObserved, true);
    assert.equal(row.accepted, false);
    assert.equal(row.outcome, 'VERIFIER_REJECTED');
  }
  for (const row of byScenario('PRODUCER_SUCCESS_VERIFIER_REJECTION')) {
    assert.equal(row.mechanism.defectiveObserved, true);
    assert.equal(row.accepted, false);
  }
  for (const row of byScenario('CRASH_AFTER_DURABLE_RESULT')) {
    assert.equal(row.mechanism.killObserved, true);
    assert.equal(row.mechanism.resumedWithoutReplay, true);
    assert.equal(row.actionCalls, 1);
    assert.equal(row.recoveryWork, 1);
    assert.equal(row.duplicateEffect, false);
    assert.equal(row.lostResult, false);
  }
  for (const row of byScenario('RESTART_AFTER_FINALIZATION')) {
    assert.equal(row.mechanism.restartWithoutReplay, true);
    assert.equal(row.actionCalls, 1);
    assert.equal(row.duplicateEffect, false);
  }
  assert.ok(artifact.trials.filter(row => row.arm === 'DIRECT').every(row => row.attribution === 'COMMON'));
  assert.ok(artifact.trials.filter(row => row.arm === 'EXHARNESS').every(row => ['COMMON', 'CORE'].includes(row.attribution)));
  assert.ok(artifact.trials.every(row => row.unsafeAcceptance === false && row.mechanism && typeof row.mechanism.cutPoint === 'string'));
});
