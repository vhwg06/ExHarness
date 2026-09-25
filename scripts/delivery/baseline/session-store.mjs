import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, open, readdir } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { normalizePersistentState } from '../../../packages/core-harness/src/persistence.js';

const clone = value => structuredClone(value);
const keyFor = sessionId => createHash('sha256').update(sessionId).digest('hex');
const assertSessionId = value => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9:_-]+$/.test(value)) throw new Error('BASELINE_SESSION_INVALID: unsafe session id');
  return value;
};

export function sessionFile(root, sessionId) {
  return join(resolve(root), 'sessions', `${keyFor(assertSessionId(sessionId))}.json`);
}

export function createFileSessionStore(root) {
  const directory = resolve(root);
  async function load(sessionId) {
    const path = sessionFile(directory, sessionId);
    try { return JSON.parse(await readFile(path, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  async function save(session, { expectedRevision = session?.revision ?? 0 } = {}) {
    if (!session?.id) throw new Error('BASELINE_SESSION_INVALID: session id is required');
    const path = sessionFile(directory, session.id);
    const current = await load(session.id);
    const actual = current?.revision ?? 0;
    if (actual !== expectedRevision) {
      const error = new Error(`BASELINE_SESSION_CONFLICT: expected ${expectedRevision}, found ${actual}`);
      error.code = 'SESSION_CONFLICT';
      throw error;
    }
    const next = normalizePersistentState(clone(session));
    next.revision = expectedRevision + 1;
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${process.pid}.tmp`;
    const handle = await open(temporary, 'w');
    try { await handle.writeFile(JSON.stringify(next, null, 2) + '\n'); await handle.sync(); }
    finally { await handle.close(); }
    await rename(temporary, path);
    session.revision = next.revision;
    return Object.freeze({ revision: next.revision, path });
  }
  async function list() {
    try {
      return (await readdir(join(directory, 'sessions'))).filter(name => name.endsWith('.json')).sort();
    } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  }
  return Object.freeze({ supportsRevisions: true, load, save, list, path: sessionFile });
}

export async function readSessionSnapshot(root, sessionId) {
  const store = createFileSessionStore(root);
  return store.load(sessionId);
}
