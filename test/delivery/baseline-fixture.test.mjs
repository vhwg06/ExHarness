import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyCandidate } from '../../scripts/delivery/baseline/fixture/acceptance.mjs';

const fixture = 'scripts/delivery/baseline/fixture';
async function candidate(t) {
  const directory = await mkdtemp(join(tmpdir(), 'baseline-candidate-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const name of ['server.mjs', 'index.html', 'client.js', 'smoke.mjs']) await copyFile(join(fixture, name), join(directory, name));
  return directory;
}

test('real HTTP and SQLite acceptance passes a complete candidate through restart', async t => {
  const directory = await candidate(t);
  const result = await verifyCandidate({ candidateDir: directory, fault: 'NONE', browser: true });
  assert.equal(result.status, 'ACCEPTED', JSON.stringify(result));
  assert.ok(result.checks.some(check => check.check === 'same database persists across restart' && check.pass));
});

test('three independently seeded defects are rejected by the frozen verifier', async t => {
  const directory = await candidate(t);
  for (const fault of ['NORM-01', 'STATUS-01', 'ORDER-01']) {
    const result = await verifyCandidate({ candidateDir: directory, fault, browser: false });
    assert.equal(result.status, 'REJECTED', `${fault}: ${JSON.stringify(result)}`);
    assert.ok(result.checks.some(check => !check.pass));
  }
});
