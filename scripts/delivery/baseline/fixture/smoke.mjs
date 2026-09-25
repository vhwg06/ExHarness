import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequestTracker } from './server.mjs';

const args = process.argv.slice(2);
const fault = args[args.indexOf('--fault') + 1];
if (!['NORM-01', 'STATUS-01', 'ORDER-01'].includes(fault)) {
  console.error('usage: node smoke.mjs --fault NORM-01|STATUS-01|ORDER-01');
  process.exitCode = 2;
} else {
  const directory = await mkdtemp(join(tmpdir(), 'request-tracker-smoke-'));
  const app = createRequestTracker({ databasePath: join(directory, 'requests.db'), fault });
  try {
    const base = await app.listen();
    const request = async (method, path, body) => {
      const response = await fetch(`${base}${path}`, { method,
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined });
      return { status: response.status, body: await response.json() };
    };
    const create = title => request('POST', '/requests', { title, description: 'smoke' });
    const first = await create('First');
    assert.equal(first.status, 201);
    if (fault === 'NORM-01') {
      for (const title of ['', '   ', 'x'.repeat(121)]) assert.equal((await create(title)).status, 400);
      assert.equal((await request('PATCH', `/requests/${first.body.id}`, { title: '   ' })).status, 400);
    } else if (fault === 'STATUS-01') {
      assert.equal((await request('PATCH', `/requests/${first.body.id}`, { title: 'Changed', status: 'INVALID' })).status, 400);
      assert.equal((await request('GET', `/requests/${first.body.id}`)).body.title, 'First');
    } else {
      const second = await create('Second');
      assert.equal(second.status, 201);
      assert.deepEqual((await request('GET', '/requests')).body.map(row => row.id), [first.body.id, second.body.id]);
    }
    console.log(`${fault} public smoke PASS`);
  } catch (error) {
    console.error(`${fault} public smoke FAIL: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
}
