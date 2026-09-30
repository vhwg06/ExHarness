// COHORT dataset: sealed development and held-out manifests bound to the
// delivered substrate reservation.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { scratchDir } from './helpers.mjs';

let tmp;
test.before(() => { tmp = scratchDir('dataset'); assert.ok(fs.statSync(tmp).isDirectory()); });

test('development cohort seals six tasks with digests and environment identity', async () => {
  const { developmentEntries } = await import('../protocol.mjs');
  const entries = await developmentEntries();
  assert.equal(entries.length, 6);
  assert.deepEqual(entries.map((entry) => entry.id), [
    'fix-git',
    'cancel-async-tasks',
    'query-optimize',
    'nginx-request-logging',
    'fix-code-vulnerability',
    'sqlite-db-truncate'
  ]);
  for (const entry of entries) {
    assert.match(entry.bundleDigest, /^sha256:[0-9a-f]{64}$/);
    assert.match(entry.instructionDigest, /^sha256:[0-9a-f]{64}$/);
    assert.ok(entry.environmentIdentity.includes('7131e4375048a0e408a8fb404b5f499d726b695b'));
  }
});

test('task digests match the sealed substrate reservation', async () => {
  const { loadSubstrateManifest } = await import('../preflight.mjs');
  const { developmentEntries, heldOutEntries } = await import('../protocol.mjs');
  const { manifest } = await loadSubstrateManifest();
  const reserved = new Map(manifest.reservation.reserved.map((entry) => [entry.name, entry.digest]));
  for (const entry of [...(await developmentEntries()), ...(await heldOutEntries())]) {
    assert.equal(reserved.get(entry.bundle), entry.bundleDigest, entry.bundle);
  }
});

test('held-out set reserves four tasks for the future decision', async () => {
  const [{ heldOutEntries }, { heldOutManifest }] = await Promise.all([
    import('../protocol.mjs'),
    import('../protocol.mjs')
  ]);
  const entries = await heldOutEntries();
  assert.equal(entries.length, 4);
  assert.deepEqual(entries.map((entry) => entry.id), [
    'git-leak-recovery',
    'pypi-server',
    'kv-store-grpc',
    'sanitize-git-repo'
  ]);
  const manifestDoc = await heldOutManifest();
  assert.equal(manifestDoc.kind, 'BB077_HELD_OUT_V1');
  assert.equal(manifestDoc.setId, 'BB081-HELD-OUT-V1');
  assert.equal(manifestDoc.tasks.length, 4);
});

test('materialized cohort manifests round-trip with substrate binding', async () => {
  const { loadSubstrateManifest } = await import('../preflight.mjs');
  const { cohortBinding, developmentManifest } = await import('../protocol.mjs');
  const { writeCohortManifests, readCohortManifests } = await import('../cohort.mjs');
  const { manifest } = await loadSubstrateManifest();
  const binding = await cohortBinding({ substrateManifest: manifest });
  const written = await writeCohortManifests({ binding, root: tmp });
  assert.equal(written.development.kind, 'BB077_DEVELOPMENT_COHORT_V1');
  assert.equal(written.development.substrateDigest, binding.substrateDigest);
  const reread = await readCohortManifests({ root: tmp });
  assert.deepEqual(reread.development, written.development);
  assert.deepEqual(reread.heldOut, written.heldOut);
  assert.deepEqual(await developmentManifest({ binding }), written.development);
  void path;
});
