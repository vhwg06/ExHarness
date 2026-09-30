// COHORT / ARM_ISOLATION protocol: preregistered development cohort, three
// paired repeats with alternating order, held-out rejection, and substrate
// binding. Admissibility reads delivered substrate controls only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { scratchDir } from './helpers.mjs';
import { ARMS, DEVELOPMENT_TASKS, HELD_OUT_TASKS, REPEATS } from '../constants.mjs';

let tmp;
test.before(() => { tmp = scratchDir('protocol'); assert.ok(fs.statSync(tmp).isDirectory()); });

test('pair schedule has three alternating repeats per development task', async () => {
  const { pairSchedule } = await import('../protocol.mjs');
  const schedule = await pairSchedule();
  assert.equal(schedule.length, DEVELOPMENT_TASKS.length * REPEATS);
  for (const task of DEVELOPMENT_TASKS) {
    const rows = schedule.filter((row) => row.taskId === task.id);
    assert.equal(rows.length, 3);
    assert.deepEqual(rows.map((row) => row.order), [
      'DIRECT_CODEACT->CORE_SYNC',
      'CORE_SYNC->DIRECT_CODEACT',
      'DIRECT_CODEACT->CORE_SYNC'
    ]);
    assert.deepEqual([rows[0].first, rows[0].second], ['DIRECT_CODEACT', 'CORE_SYNC']);
    assert.deepEqual([rows[1].first, rows[1].second], ['CORE_SYNC', 'DIRECT_CODEACT']);
    for (const row of rows) {
      assert.ok(row.pairId.startsWith(`${task.id}:r`));
      assert.match(row.fixedDigest, /^sha256:[0-9a-f]{64}$/);
    }
  }
});

test('cohort registers every task, repeat and arm exactly once', async () => {
  const { cohortUnitIds, unitIdFor } = await import('../protocol.mjs');
  const ids = await cohortUnitIds();
  assert.equal(ids.length, DEVELOPMENT_TASKS.length * REPEATS * ARMS.length);
  assert.equal(new Set(ids).size, ids.length);
  for (const task of DEVELOPMENT_TASKS) {
    for (let repeat = 0; repeat < REPEATS; repeat += 1) {
      for (const arm of ARMS) assert.ok(ids.includes(unitIdFor({ taskId: task.id, arm, repeatIndex: repeat })));
    }
  }
});

test('held-out tasks are hard-rejected and never scheduled', async () => {
  const { assertNotHeldOut, assertDevelopment, pairSchedule, cohortUnitIds } = await import('../protocol.mjs');
  for (const task of HELD_OUT_TASKS) {
    assert.throws(() => assertNotHeldOut(task.id), /HELD_OUT/);
    assert.throws(() => assertDevelopment(task.id), /HELD_OUT/);
  }
  for (const task of DEVELOPMENT_TASKS) assert.equal(await assertDevelopment(task.id), true);
  assert.throws(() => assertDevelopment('unknown-task'), /UNKNOWN_TASK/);
  const schedule = await pairSchedule();
  const ids = await cohortUnitIds();
  for (const task of HELD_OUT_TASKS) {
    assert.ok(!schedule.some((row) => row.taskId === task.id));
    assert.ok(!ids.some((id) => id.startsWith(`${task.id}--`)));
  }
});

test('a changed substrate manifest starts a new cohort instead of mixing', async () => {
  const { cohortBinding, assertCohortBinding } = await import('../protocol.mjs');
  const { loadSubstrateManifest } = await import('../preflight.mjs');
  const { manifest } = await loadSubstrateManifest();
  const binding = await cohortBinding({ substrateManifest: manifest });
  assert.equal(await assertCohortBinding({ binding, substrateManifest: manifest }), true);
  const drifted = { ...manifest, sealedAt: '2026-10-01T00:00:00.000Z' };
  assert.throws(() => assertCohortBinding({ binding, substrateManifest: drifted }), /SUBSTRATE_DRIFT/);
});

test('task admissibility reads substrate controls without mutating calibration', async () => {
  const { admissibility } = await import('../protocol.mjs');
  assert.deepEqual(await admissibility({ oraclePasses: 5, nopFails: 1 }), { admissible: true, reason: null });
  assert.equal((await admissibility({ oraclePasses: 4, nopFails: 1 })).admissible, false);
  assert.equal((await admissibility({ oraclePasses: 5, nopFails: 0 })).admissible, false);
  const { manifest } = await (await import('../preflight.mjs')).loadSubstrateManifest();
  assert.equal(manifest.controls.length, 2);
  assert.ok(manifest.controls.every((control) => control.oracle.length === 5 && control.nop.length === 1));
});
