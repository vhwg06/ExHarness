// BOUNDARY: only benchmark comparison tooling and Living truth change. No
// writes to packages/benchmark, benchmarks/substrate, Core product runtime or
// async capability implementation. Hermetic: read-only scans plus a
// forbidden-prefix check over the candidate's own changes (committed diff
// against the main line plus working-tree entries). Blackboard gate-owned
// bookkeeping paths are exempt (see boundary-paths.mjs): the evidence gate
// writes them into the checkout itself, so they are unrelated to the
// candidate.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { importSpecifiers, scratchDir } from './helpers.mjs';
import { classifyEntries } from '../boundary-paths.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const REPO = path.resolve(HERE, '..', '..', '..');

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
    // Reaching into forbidden code means importing it, not merely naming the
    // path (the boundary-paths classifier itself lists forbidden prefixes).
    for (const spec of importSpecifiers(code)) {
      assert.ok(!spec.includes('packages/benchmark/') && !spec.includes('packages/agentic-system/'),
        `${path.relative(REPO, file)} imports forbidden code ${spec}`);
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

function mergeBase(cwd) {
  for (const ref of ['origin/main', 'main']) {
    try {
      const out = execFileSync('git', ['merge-base', 'HEAD', ref], { cwd, encoding: 'utf8' }).trim();
      if (out) return out;
    } catch {
      continue;
    }
  }
  return null;
}

function committedEntries(cwd) {
  const base = mergeBase(cwd);
  if (!base) return [];
  const out = execFileSync('git', ['diff', '--name-only', base, 'HEAD'], { cwd, encoding: 'utf8' });
  return out.split('\n').map((line) => line.trim()).filter(Boolean)
    .map((file) => ({ file, tracked: true }));
}

function workingTreeEntries(cwd) {
  const status = execFileSync('git', ['status', '--short'], { cwd, encoding: 'utf8' });
  return status.split('\n').map((line) => line.trimEnd()).filter((line) => line.trim().length > 0)
    .map((line) => ({
      code: line.slice(0, 2).trim(),
      file: line.slice(3).trim().split(/\s+/).pop()
    }))
    .map(({ code, file }) => ({ file, tracked: code !== '??' }));
}

test('no benchmark-kernel, substrate or product runtime diff is introduced', async (t) => {
  let entries;
  try {
    entries = [...committedEntries(REPO), ...workingTreeEntries(REPO)];
  } catch {
    t.skip('git unavailable');
    return;
  }
  const unique = [...new Map(entries.map((entry) => [entry.file, entry])).values()];
  const { forbidden, outsideScope } = classifyEntries(unique);
  assert.deepEqual(forbidden, [], `forbidden writes: ${forbidden.join(', ')}`);
  assert.deepEqual(outsideScope, [], `tracked edits outside write scope: ${outsideScope.join(', ')}`);
});

test('gate bookkeeping is exempt but other blackboard and kernel paths stay forbidden', async () => {
  const { isForbidden } = await import('../boundary-paths.mjs');
  // Gate-owned bookkeeping: accepted in both assertions.
  for (const file of [
    'docs/blackboard/state.md',
    'docs/blackboard/work-graph.json',
    'docs/blackboard/context/BB-077/t',
    'docs/blackboard/evidence/BB-077/t',
    'docs/blackboard/artifacts/blackboard-foo.json'
  ]) {
    assert.equal(isForbidden(file), false, `${file} must be exempt`);
  }
  // Everything else under docs/blackboard/ stays forbidden, so widening the
  // exemption to all of docs/blackboard/ would fail this test.
  for (const file of [
    'docs/blackboard/artifacts/objective/X.json',
    'docs/blackboard/artifacts/ready-implement-plan/X.json',
    'docs/blackboard/process/notes.md',
    'packages/benchmark/x.js',
    'benchmarks/substrate/x',
    'package.json'
  ]) {
    assert.equal(isForbidden(file), true, `${file} must stay forbidden`);
  }
  const { forbidden, outsideScope } = classifyEntries([
    { file: 'docs/blackboard/state.md', tracked: true },
    { file: 'docs/blackboard/context/BB-077/t', tracked: false },
    { file: 'docs/blackboard/artifacts/objective/X.json', tracked: true }
  ]);
  assert.deepEqual(forbidden, ['docs/blackboard/artifacts/objective/X.json']);
  assert.deepEqual(outsideScope, []);
});
