import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import { join, relative, resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(packageRoot, '..', '..');
const SPECIFIER = /(?:^|[^\w$.])(?:import|export)\s+(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]|(?:^|[^\w$.])import\s*\(\s*['"]([^'"]+)['"]\s*\)|(?:^|[^\w$.])require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const BUILTINS = new Set(builtinModules.flatMap(name => [name, `node:${name}`]));

async function files(dir, pattern) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) { if (entry.name !== 'node_modules') out.push(...await files(path, pattern)); }
    else if (pattern.test(entry.name)) out.push(path);
  }
  return out.sort();
}

async function specifiers(file) {
  const source = await readFile(file, 'utf8');
  return [...source.matchAll(SPECIFIER)].map(match => match[1] ?? match[2] ?? match[3]);
}

async function exists(path) {
  try { await stat(path); return true; } catch { return false; }
}

test('package source imports only Node built-ins and its own src modules', async () => {
  const src = join(packageRoot, 'src');
  const violations = [];
  for (const file of await files(src, /\.(m?js|cjs)$/)) {
    for (const specifier of await specifiers(file)) {
      if (BUILTINS.has(specifier)) continue;
      if (specifier.startsWith('./') && resolve(dirname(file), specifier).startsWith(src + sep)) continue;
      violations.push(`${relative(repoRoot, file)} -> ${specifier}`);
    }
  }
  assert.deepEqual(violations, []);
});

test('package source names no product runtime, Harbor, provider SDK, Blackboard controller or retired baseline module', async () => {
  const forbidden = /core-harness|agentic-system|@exharness\/(?!benchmark)|harbor|openai|anthropic|@google|nvidia|blackboard-|scripts\/delivery\/baseline|CORE_VALUE|core-arm|mini_driver|six-pair/i;
  const hits = [];
  for (const file of await files(join(packageRoot, 'src'), /\.(m?js|cjs)$/)) {
    for (const specifier of await specifiers(file)) if (forbidden.test(specifier)) hits.push(`${relative(repoRoot, file)} -> ${specifier}`);
  }
  assert.deepEqual(hits, []);
  assert.equal((await files(packageRoot, /\.py$/)).length, 0, 'the package contains no Harbor-facing Python');
});

test('substrate and downstream code consume only the package root, never src deep paths', async () => {
  const substrate = join(repoRoot, 'benchmarks', 'substrate');
  const violations = [];
  for (const file of await files(substrate, /\.(m?js|cjs)$/)) {
    for (const specifier of await specifiers(file)) {
      if (specifier.startsWith('@exharness/benchmark') && specifier !== '@exharness/benchmark') violations.push(`${relative(repoRoot, file)} -> ${specifier}`);
      if (specifier.startsWith('.') && resolve(dirname(file), specifier).startsWith(join(repoRoot, 'packages') + sep)) violations.push(`${relative(repoRoot, file)} -> ${specifier}`);
      if (/core-harness|agentic-system|scripts\/delivery\/baseline/.test(specifier)) violations.push(`${relative(repoRoot, file)} -> ${specifier}`);
    }
  }
  assert.deepEqual(violations, []);
});

test('no package outside the benchmark kernel is imported by it and the workspace wires test:benchmark', async () => {
  const pkg = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8'));
  assert.match(pkg.scripts['test:benchmark'], /packages\/benchmark\/test/);
  for (const [name, command] of Object.entries(pkg.scripts)) assert.doesNotMatch(command, /scripts\/delivery\/baseline|test\/delivery/, name);
});

test('the retired baseline implementation and its tests are gone', async () => {
  assert.equal(await exists(join(repoRoot, 'scripts', 'delivery', 'baseline')), false);
  assert.equal(await exists(join(repoRoot, 'test', 'delivery')), false);
});
