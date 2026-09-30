// Sealed external-preflight manifest: committed evidence passes; post-outcome mutations fail closed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CONTROLS_REF, MANIFEST_REF, verifyExternalPreflight } from '../external-sanity.mjs';
import { REPO_ROOT, pretty, readJson } from '../common.mjs';
import { tempDir } from './helpers.mjs';

async function copyManifests() {
  const tmp = await tempDir('external-preflight-');
  await mkdir(join(tmp, 'benchmarks', 'substrate'), { recursive: true });
  await cp(join(REPO_ROOT, 'benchmarks', 'substrate', 'manifests'), join(tmp, 'benchmarks', 'substrate', 'manifests'), { recursive: true });
  return tmp;
}

async function mutateManifest(tmp, mutate) {
  const path = join(tmp, MANIFEST_REF);
  const manifest = await readJson(path);
  mutate(manifest);
  await writeFile(path, pretty(manifest));
  return manifest;
}

async function assertFailsWith(tmp, pattern) {
  const result = await verifyExternalPreflight({ root: tmp });
  assert.equal(result.status, 'FAIL');
  assert.match(result.problems.join('\n'), pattern, result.problems.join('\n'));
}

test('committed sealed manifest passes with two oracle 5/5 and nop fail 1/1 tasks', async () => {
  const result = await verifyExternalPreflight();
  assert.equal(result.status, 'PASS');
  assert.deepEqual(result.problems, []);
  assert.equal(result.selected.length, 2);
  assert.equal(result.controls.length, 2);
  for (const selected of result.selected) {
    const control = result.controls.find(entry => entry.name === selected.name);
    assert.ok(control, selected.name);
    assert.deepEqual(control.oracle, Array(5).fill('ACCEPTED'));
    assert.deepEqual(control.nop, ['REJECTED']);
  }
  const manifest = await readJson(join(REPO_ROOT, MANIFEST_REF));
  assert.equal(manifest.codingModelCalls, 0);
});

test('selected tasks swapped after seeing outcomes fail the preregistered rule', async () => {
  const tmp = await copyManifests();
  const manifest = await readJson(join(tmp, MANIFEST_REF));
  const replacement = manifest.candidateOrder.find(name => !manifest.selected.some(entry => entry.name === name));
  await mutateManifest(tmp, next => { next.selected[1] = { ...next.selected[1], name: replacement }; });
  await assertFailsWith(tmp, /selected tasks do not follow the preregistered rule/);
});

test('removing a reserved task fails reservation recomputation', async () => {
  const tmp = await copyManifests();
  await mutateManifest(tmp, manifest => { manifest.reservation.reserved.pop(); });
  await assertFailsWith(tmp, /reserved downstream tasks do not recompute from the canonical plans at the reservation commit/);
});

test('a control oracle tally rewritten to include REJECTED fails the evidence check', async () => {
  const tmp = await copyManifests();
  await mutateManifest(tmp, manifest => { manifest.controls[0].oracle[4] = 'REJECTED'; });
  await assertFailsWith(tmp, /tallies differ from the evidence/);
});

test('a modified control evidence file fails audit', async () => {
  const tmp = await copyManifests();
  const reward = join(tmp, CONTROLS_REF, 'TB21-CONTROL-hf-model-inference',
    'hf-model-inference--ORACLE--r0', 'hf-model-inference--ORACLE--r0--attempt-1', 'evidence', 'verifier', 'reward.txt');
  await writeFile(reward, '0\n');
  await assertFailsWith(tmp, /control evidence fails audit/);
});

test('reordering preregistration candidateOrder fails the digest check', async () => {
  const tmp = await copyManifests();
  const path = join(tmp, CONTROLS_REF, 'preregistration.json');
  const preregistration = await readJson(path);
  const [first, second, ...rest] = preregistration.candidateOrder;
  preregistration.candidateOrder = [second, first, ...rest];
  await writeFile(path, pretty(preregistration));
  await assertFailsWith(tmp, /preregistration digest mismatch/);
});

test('codingModelCalls set to 1 fails the no-coding-model check', async () => {
  const tmp = await copyManifests();
  await mutateManifest(tmp, manifest => { manifest.codingModelCalls = 1; });
  await assertFailsWith(tmp, /external sanity must make no coding-model call and read no downstream result/);
});
