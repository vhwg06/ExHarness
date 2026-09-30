// Verifies retirement of the old development delivery baseline against the sealed inventory
// in manifests/legacy-retirement.json. Historical files stay recoverable from Git only.
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { REPO_ROOT, SUBSTRATE_ROOT, git, readJson } from './common.mjs';

export const LEGACY_MANIFEST = join(SUBSTRATE_ROOT, 'manifests', 'legacy-retirement.json');
// Files that must name the retired paths or tokens in order to police them.
export const SCAN_ALLOWLIST = Object.freeze([
  'benchmarks/substrate/legacy-retirement.mjs',
  'benchmarks/substrate/manifests/legacy-retirement.json',
  'benchmarks/substrate/test/legacy-retirement.test.mjs',
  'packages/benchmark/test/dependency-boundary.test.js'
]);
const EXECUTABLE = /\.(?:mjs|cjs|js|ts|py|sh|json|ya?ml)$/;
const RETIRED_REFERENCE = /(?:scripts\/delivery\/baseline|(?:^|[^\w-])test\/delivery\/)/;
const LEGACY_TOKENS = /\b(?:CORE_VALUE(?:_V2)?|six-pair|core-arm|mini_driver|controlled-trials|jev-value)\b/;
const FORBIDDEN_STATE_PHRASES = [/Development delivery baseline/i, /baseline (?:is|remains) (?:the )?current/i];

const lines = text => (text ?? '').split('\n').filter(Boolean);

function check(name, ok, detail = null) {
  return { name, status: ok ? 'PASS' : 'FAIL', ...(detail === null ? {} : { detail }) };
}

export async function verifyLegacyRetirement({ root = REPO_ROOT, manifestPath = LEGACY_MANIFEST } = {}) {
  const manifest = await readJson(manifestPath);
  const checks = [];
  const baseline = manifest.baselineCommit;
  checks.push(check('manifest-kind', manifest.kind === 'BENCHMARK_LEGACY_RETIREMENT_V1'));

  const baselineExists = git(['cat-file', '-e', `${baseline}^{commit}`], { cwd: root, allowFailure: true }) !== null;
  checks.push(check('baseline-recoverable', baselineExists, baseline));
  if (baselineExists) {
    for (const retiredRoot of manifest.retiredRoots) {
      const files = lines(git(['ls-tree', '-r', '--name-only', baseline, retiredRoot], { cwd: root }));
      checks.push(check(`historical-files:${retiredRoot}`, files.length === manifest.retiredFiles[retiredRoot], files.length));
    }
    const consumers = lines(git(['grep', '-l', 'delivery/baseline', baseline, '--', ':!docs/blackboard/**'], { cwd: root, allowFailure: true }))
      .map(line => line.slice(baseline.length + 1)).sort();
    const inventory = manifest.inventory.map(entry => entry.path).sort();
    checks.push(check('inventory-complete', JSON.stringify(consumers) === JSON.stringify(inventory),
      { missing: consumers.filter(path => !inventory.includes(path)), extra: inventory.filter(path => !consumers.includes(path)) }));
    const productHits = lines(git(['grep', '-l', 'delivery/baseline', baseline, '--', 'packages'], { cwd: root, allowFailure: true }));
    checks.push(check('no-product-runtime-dependency', productHits.length === 0, productHits));
    const baselineFiles = lines(git(['ls-tree', '-r', '--name-only', baseline, ...manifest.retiredRoots], { cwd: root }));
    for (const row of manifest.matrix) {
      const prefix = row.legacy.replace(/\*\*$/, '').replace(/baseline-\*\.test\.mjs$/, 'baseline-');
      checks.push(check(`matrix-legacy-exists:${row.legacy}`, baselineFiles.some(path => path.startsWith(prefix))));
    }
  }

  for (const row of manifest.matrix) {
    let ok = true;
    if (row.disposition === 'REIMPLEMENT_GENERIC') ok = row.owner.split(' + ').every(path => existsSync(join(root, path)));
    else if (row.disposition === 'REQUALIFY') ok = existsSync(join(root, row.owner.replace(/\/\*\*$/, '')));
    else if (row.disposition === 'DOWNSTREAM_OWNER') ok = existsSync(join(root, 'docs/blackboard/artifacts/ready-implement-plan', `${row.owner}.json`));
    else ok = row.disposition === 'DROP';
    checks.push(check(`matrix-owner:${row.legacy}`, ok, row.owner));
  }
  for (const entry of manifest.equivalence) {
    checks.push(check(`equivalence-tests:${entry.legacy}`, entry.tests.every(path => existsSync(join(root, path)))));
  }

  for (const retiredRoot of manifest.retiredRoots) {
    const tracked = lines(git(['ls-files', '--', retiredRoot], { cwd: root }));
    checks.push(check(`retired-absent:${retiredRoot}`, !existsSync(join(root, retiredRoot)) && tracked.length === 0, tracked.length));
  }

  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const entrypoints = Object.entries(pkg.scripts ?? {}).filter(([, command]) => RETIRED_REFERENCE.test(command)).map(([name]) => name);
  checks.push(check('root-entrypoints-cut', entrypoints.length === 0, entrypoints));

  const tracked = lines(git(['ls-files'], { cwd: root })).filter(path => !path.startsWith('docs/blackboard/') && !SCAN_ALLOWLIST.includes(path));
  const referenceHits = [];
  const tokenHits = [];
  for (const path of tracked) {
    const isExecutable = EXECUTABLE.test(path);
    const isBenchmarkCode = path.startsWith('benchmarks/substrate/') || path.startsWith('packages/benchmark/');
    if (!isExecutable && !isBenchmarkCode) continue;
    const text = await readFile(join(root, path), 'utf8').catch(() => '');
    if (isExecutable && RETIRED_REFERENCE.test(text)) {
      const stringFixture = manifest.inventory.find(entry => entry.path === path && entry.kind === 'STRING_FIXTURE');
      // A string fixture may carry the old test path as data but never import or run it.
      if (!stringFixture || /(?:import|require)\s*\(?\s*['"][^'"]*(?:scripts\/delivery\/baseline|test\/delivery\/)/.test(text)) referenceHits.push(path);
    }
    if (isBenchmarkCode && LEGACY_TOKENS.test(text)) tokenHits.push(path);
  }
  checks.push(check('forbidden-reference-scan', referenceHits.length === 0, referenceHits));
  checks.push(check('legacy-semantics-absent-from-benchmark', tokenHits.length === 0, tokenHits));

  const stateDoc = await readFile(join(root, 'docs/living/system/state.md'), 'utf8');
  const currentClaims = FORBIDDEN_STATE_PHRASES.filter(pattern => pattern.test(stateDoc)).map(String);
  const unmarked = stateDoc.split('\n').filter(line => /scripts\/delivery\/baseline/.test(line) && !/retired/i.test(line));
  checks.push(check('living-state-not-current', currentClaims.length === 0 && unmarked.length === 0, { currentClaims, unmarked }));

  const status = checks.every(item => item.status === 'PASS') ? 'PASS' : 'FAIL';
  return { kind: 'BENCHMARK_LEGACY_RETIREMENT_VERIFICATION_V1', status, baselineCommit: baseline, checks };
}
