import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCoreArm } from '../../scripts/delivery/baseline/core-arm.mjs';
import { auditCoreTrace } from '../../scripts/delivery/baseline/core-arm.mjs';

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
