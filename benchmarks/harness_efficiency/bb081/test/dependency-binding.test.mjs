// DEPENDENCY acceptance: exact DONE BB-077/078/079/080 outputs construct
// independent A/B/C/D without mutation; mismatches fail PLAN_INPUT_CONTRADICTION.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEPENDENCY_CONTRACT,
  assertDependencyContract,
  assertComposableCore,
  computeDependencyDigest,
  defaultDescriptors,
  getDependencyManifest
} from '../dependency-binding.mjs';

test('dependency manifest binds exact DONE BB-077/078/079/080 refs', () => {
  const manifest = getDependencyManifest();
  assert.equal(manifest.contract, DEPENDENCY_CONTRACT);
  assert.equal(manifest.requires.length, 4);
  assert.deepEqual(manifest.requires.map((r) => r.taskId), ['BB-077', 'BB-078', 'BB-079', 'BB-080']);
  for (const req of manifest.requires) {
    assert.equal(req.status, 'DONE');
    assert.ok(req.implementationResultRef.endsWith('.implementation-result.json'));
    assert.ok(req.judgmentRef.endsWith('.candidate-jev-evaluation.json'));
    assert.ok(req.deliveredRef.endsWith('.delivered-feature.json'));
  }
  assert.ok(computeDependencyDigest(manifest).startsWith('sha256:'));
});

test('valid descriptors satisfy the contract with a composable Core', async () => {
  const desc = defaultDescriptors();
  const core = await import('../../../../packages/core-harness/src/index.js');
  const out = assertDependencyContract({ ...desc, core });
  assert.equal(out.satisfied, true);
  assert.equal(out.contract, DEPENDENCY_CONTRACT);
  assert.deepEqual(assertComposableCore({ core }).arms, ['A', 'B', 'C', 'D']);
});

test('A/B/C/D construction fails closed without dependency-source mutation', () => {
  const desc = defaultDescriptors();
  // Missing descriptor.
  assert.throws(() => assertDependencyContract({ ...desc, bb080: null }), /PLAN_INPUT_CONTRADICTION/);
  // Non-DONE status.
  assert.throws(
    () => assertDependencyContract({ ...desc, bb079: { ...desc.bb079, status: 'WORKER_SCHEDULABLE' } }),
    /PLAN_INPUT_CONTRADICTION/
  );
  // Incompatible ref.
  assert.throws(
    () => assertDependencyContract({ ...desc, bb077: { ...desc.bb077, deliveredRef: 'forged.json' } }),
    /PLAN_INPUT_CONTRADICTION/
  );
  // Incompatible envelope/API.
  assert.throws(
    () => assertDependencyContract({ ...desc, bb078: { ...desc.bb078, storeApi: ['createDetachedOperationManager'] } }),
    /PLAN_INPUT_CONTRADICTION/
  );
  assert.throws(
    () => assertDependencyContract({ ...desc, bb079: { ...desc.bb079, checkpointApi: ['createAsyncResultContextState'] } }),
    /PLAN_INPUT_CONTRADICTION/
  );
  assert.throws(
    () => assertDependencyContract({ ...desc, bb080: { ...desc.bb080, coordinatorApi: [] } }),
    /PLAN_INPUT_CONTRADICTION/
  );
});

test('non-composable B/C/D is never approximated', async () => {
  const desc = defaultDescriptors();
  const core = await import('../../../../packages/core-harness/src/index.js');
  const stripped = { ...core };
  delete stripped.createAsyncAgentCoordinator;
  assert.throws(() => assertComposableCore({ core: stripped }), /PLAN_INPUT_CONTRADICTION/);
  assert.throws(() => assertDependencyContract({ ...desc, core: stripped }), /PLAN_INPUT_CONTRADICTION/);
  assert.throws(() => assertComposableCore({ core: null }), /PLAN_INPUT_CONTRADICTION/);
});
