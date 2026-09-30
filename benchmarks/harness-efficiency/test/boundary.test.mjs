// BOUNDARY: only benchmark comparison tooling and Living truth change. No
// writes to packages/benchmark, benchmarks/substrate, Core product runtime or
// async capability implementation. Hermetic: read-only scans plus a
// forbidden-prefix check over git status (untracked files from other work are
// ignored; only forbidden writes fail).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scratchDir } from './helpers.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const REPO = path.resolve(HERE, '..', '..', '..');

const WRITE_SCOPE = ['benchmarks/harness-efficiency/', 'docs/living/system/core-harness/'];
const FORBIDDEN = [
  'packages/benchmark/',
  'benchmarks/substrate/',
  'packages/core-harness/src/',
  'packages/agentic-system/',
  '.github/',
  'docs/blackboard/',
  'package.json',
  'scripts/blackboard-jev.mjs'
];

let tmp;
test.before(() => { tmp = scratchDir('boundary'); assert.ok(fs.statSync(tmp).isDirectory()); });

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
}

test('implementation sources never target forbidden write areas', async () => {
  const sources = [];
  const collect = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      if (name === 'manifests') continue;
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) {
        if (full !== HERE) collect(full);
      } else if (name.endsWith('.mjs')) sources.push(full);
    }
  };
  collect(ROOT);
  assert.ok(sources.length >= 8);
  // Consuming the delivered substrate manifest path as a read reference is
  // required; only write-shaped operations or code imports into forbidden
  // implementation areas count as violations.
  const writeToForbidden = /(writeFile|appendFile|mkdir|copyFile|rename|rmSync|openSync)\s*\([^)]*(packages\/benchmark|benchmarks\/substrate|packages\/core-harness\/src|packages\/agentic-system|\.github|docs\/blackboard|package\.json|blackboard-jev)/;
  for (const file of sources) {
    const code = stripComments(fs.readFileSync(file, 'utf8'));
    assert.ok(!writeToForbidden.test(code), `${path.relative(REPO, file)} writes outside the write scope`);
    for (const prefix of ['packages/benchmark/', 'packages/agentic-system/']) {
      assert.ok(!code.includes(prefix), `${path.relative(REPO, file)} reaches into forbidden code ${prefix}`);
    }
    // Core may be used only through its public entry; any other deep file is
    // a violation.
    const coreDeep = [...code.matchAll(/core-harness\/src\/([A-Za-z0-9_.-]+)/g)].map((match) => match[1]);
    for (const hit of coreDeep) {
      assert.equal(hit, 'index.js', `${path.relative(REPO, file)} deep-imports Core file ${hit}`);
    }
  }
  void tmp;
  void os;
});

test('no async capability implementation or promotion verdict exists here', async () => {
  const sources = [];
  const collect = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) {
        if (name === 'test' || name === 'manifests') continue;
        collect(full);
      } else if (name.endsWith('.mjs')) sources.push(full);
    }
  };
  collect(ROOT);
  for (const file of sources) {
    const source = fs.readFileSync(file, 'utf8');
    // A published verdict is a verdict-shaped field carrying the promotion
    // token. Naming the preregistered gate vocabulary (INCONCLUSIVE/KEEP_SYNC
    // fallback) or recording asyncCandidates: NOT_EXECUTED is not a verdict.
    assert.ok(!/:\s*['"](PROMOTE_ASYNC|KEEP_SYNC)['"]/.test(source),
      `${path.relative(REPO, file)} publishes an async verdict`);
    assert.ok(!/['"]PROMOTE_ASYNC['"]/.test(source),
      `${path.relative(REPO, file)} publishes an async verdict`);
    assert.ok(!/class\s+\w*(Async|Detached)\w*|function\s+\w*(AsyncArm|AsyncScheduler|DetachedScheduler)\w*|cacheStableContext/i.test(source),
      `${path.relative(REPO, file)} implements async capability work`);
  }
});

test('no benchmark-kernel, substrate or product runtime diff is introduced', async () => {
  let status;
  try {
    status = execFileSync('git', ['status', '--short'], { cwd: REPO, encoding: 'utf8' });
  } catch {
    return;
  }
  const changed = status.split('\n').map((line) => line.trimEnd()).filter((line) => line.trim().length > 0)
    .map((line) => ({ code: line.slice(0, 2).trim(), file: line.slice(3).trim().split(/\s+/).pop() }));
  const forbiddenWrites = changed
    .filter(({ file }) => FORBIDDEN.some((prefix) => file === prefix || file.startsWith(prefix)))
    .map(({ file }) => file);
  assert.deepEqual(forbiddenWrites, [], `forbidden writes: ${forbiddenWrites.join(', ')}`);
  const trackedOutsideScope = changed
    .filter(({ code, file }) => code !== '??' && !WRITE_SCOPE.some((prefix) => file.startsWith(prefix)))
    .map(({ file }) => file);
  assert.deepEqual(trackedOutsideScope, [], `tracked edits outside write scope: ${trackedOutsideScope.join(', ')}`);
});
