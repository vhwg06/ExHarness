// COHORT acceptance: exactly four reserved digests, two repeats, frozen
// four-arm order under unchanged fixed factors and budgets.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ARMS,
  BUDGET,
  REGISTERED_ARM_UNITS,
  REPEATS,
  SCHEDULE,
  ablationContract,
  assertCohortBinding,
  assertHeldOut,
  assertRegisteredUnits,
  cohortBinding,
  heldOutEntries,
  protocolHash,
  registeredUnitIds,
  scheduleOrderFor,
  unitIdFor
} from '../ablation-contract.mjs';

test('ablation contract freezes A/B/C/D, four digests, 32 units, schedule', () => {
  const contract = ablationContract();
  assert.equal(contract.repeats, 2);
  assert.equal(contract.registeredArmUnits, 32);
  assert.equal(contract.schedule.length, 4);
  assert.deepEqual(contract.schedule, [...SCHEDULE]);
  assert.deepEqual(Object.keys(contract.arms), ['A', 'B', 'C', 'D']);
  assert.equal(contract.arms.D, 'C + BB-080 steering/wakeup/recovery (promotion candidate)');
  assert.ok(contract.protocolHash.startsWith('sha256:'));
  assert.equal(protocolHash(), contract.protocolHash);
});

test('held-out entries are exactly the four BB-077-reserved digests', () => {
  const entries = heldOutEntries();
  assert.equal(entries.length, 4);
  assert.deepEqual(entries.map((e) => e.bundleDigest), [
    'sha256:22a9ec10dbd4cd8b99477b70e1944103775ca41de9b9e0025ec4898cd17bd334',
    'sha256:1a1e0542f58e2d3362fec17a9bbb98667717d9a4a3e9a4c8413d3150a4fa0ff1',
    'sha256:973c5d4c111fb61a344457936f1c36400acd2d9e44389e7b319586fe23a7a307',
    'sha256:73c94a21ebe370bae843adbeeaaa9e991374867b18483aaf56c7cd470dcddea7'
  ]);
  assert.equal(registeredUnitIds().length, REGISTERED_ARM_UNITS);
  assert.equal(new Set(registeredUnitIds()).size, 32);
  assertRegisteredUnits(registeredUnitIds());
});

test('two-repeat balanced schedule covers every task with fresh order', () => {
  assert.deepEqual(scheduleOrderFor({ shortTaskId: 'git-leak', repeatIndex: 0 }), ['A', 'B', 'D', 'C']);
  assert.deepEqual(scheduleOrderFor({ shortTaskId: 'git-leak', repeatIndex: 1 }), ['C', 'D', 'B', 'A']);
  assert.deepEqual(scheduleOrderFor({ shortTaskId: 'pypi', repeatIndex: 0 }), ['B', 'C', 'A', 'D']);
  assert.deepEqual(scheduleOrderFor({ shortTaskId: 'sanitize', repeatIndex: 1 }), ['B', 'C', 'A', 'D']);
  // Every repeat order is a permutation of all four arms (balanced, no leak).
  for (const task of ['git-leak', 'pypi', 'kv-store', 'sanitize']) {
    for (let r = 0; r < REPEATS; r += 1) {
      assert.deepEqual([...scheduleOrderFor({ shortTaskId: task, repeatIndex: r })].sort(), ['A', 'B', 'C', 'D']);
    }
  }
  assert.equal(unitIdFor({ taskId: 'git-leak-recovery', arm: 'D', repeatIndex: 1 }), 'git-leak-recovery--D--r1');
});

test('DEV/replacement/mutated tasks are rejected; budgets stay frozen', async () => {
  assert.equal(assertHeldOut({ bundle: 'terminal-bench/pypi-server' }), true);
  assert.throws(() => assertHeldOut({ taskId: 'fix-git' }), /DEV_REJECTED/);
  assert.throws(() => assertHeldOut({ bundle: 'terminal-bench/replacement-task' }), /DEV_REJECTED/);
  assert.throws(() => assertRegisteredUnits([...registeredUnitIds()].slice(0, 31)), /COHORT/);
  assert.throws(() => assertRegisteredUnits([...registeredUnitIds(), 'forged--A--r0']), /COHORT/);
  assert.equal(BUDGET.maxUnitCostUsd, 0.6);
  assert.equal(BUDGET.maxCohortCostUsd, 25);
  assert.deepEqual([...ARMS], ['A', 'B', 'C', 'D']);
  const { manifest } = await (await import('../run.mjs')).loadSubstrateManifest().catch(() => ({ manifest: null }));
  if (manifest) {
    const binding = cohortBinding({ substrateManifest: manifest });
    assert.equal(assertCohortBinding({ binding, substrateManifest: manifest }), true);
    assert.throws(
      () => assertCohortBinding({ binding: { ...binding, substrateDigest: 'sha256:' + '0'.repeat(64) }, substrateManifest: manifest }),
      /SUBSTRATE_DRIFT/
    );
  }
});
