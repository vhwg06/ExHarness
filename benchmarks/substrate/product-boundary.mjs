// Verifies BB-065 stays a benchmark-substrate change: every changed path is inside the plan
// write scope, no product runtime changes, and no emitted output carries a promotion decision.
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { REPO_ROOT, SUBSTRATE_ROOT, git } from './common.mjs';

export const PLAN_REF = 'docs/blackboard/artifacts/ready-implement-plan/BB-065.json';
export const PRODUCT_RUNTIME = Object.freeze(['packages/core-harness/', 'packages/agentic-system/']);
// Keys that would turn a substrate output into a harness, async, delivery-value or release decision.
export const DECISION_KEYS = /^(?:winner|winningArm|harnessWinner|promotion|promote|promoted|promotionDecision|asyncPromotion|deliveryValue|productValue|valueClaim|releaseDecision|releaseAccepted|releaseAcceptance|economicsVerdict|recommendation)$/i;

export function globToRegExp(glob) {
  let pattern = '';
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    if (char === '*' && glob[index + 1] === '*') { pattern += '.*'; index += 1; }
    else if (char === '*') pattern += '[^/]*';
    else pattern += char.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${pattern}$`);
}

export const matchesAny = (path, globs) => globs.some(glob => globToRegExp(glob).test(path));

export function decisionKeys(value, path = '$', found = []) {
  if (Array.isArray(value)) value.forEach((item, index) => decisionKeys(item, `${path}[${index}]`, found));
  else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (DECISION_KEYS.test(key)) found.push(`${path}.${key}`);
      decisionKeys(item, `${path}.${key}`, found);
    }
  }
  return found;
}

export function changedPaths({ root = REPO_ROOT, base = process.env.BENCHMARK_BOUNDARY_BASE } = {}) {
  const resolvedBase = base || git(['merge-base', 'HEAD', 'origin/main'], { cwd: root }).trim();
  const listed = args => git(args, { cwd: root }).split('\n').filter(Boolean);
  // Uncommitted Blackboard control files and local run caches are bookkeeping, not candidate source.
  const bookkeeping = path => /^(?:docs\/blackboard|artifacts|\.cache)\//.test(path);
  const local = [...listed(['diff', '--name-only', 'HEAD']), ...listed(['ls-files', '--others', '--exclude-standard'])].filter(path => !bookkeeping(path));
  return { base: resolvedBase, paths: [...new Set([...listed(['diff', '--name-only', resolvedBase, 'HEAD']), ...local])].sort() };
}

async function jsonFiles(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await jsonFiles(path));
    else if (entry.name.endsWith('.json')) out.push(path);
  }
  return out;
}

export async function verifyProductBoundary({ root = REPO_ROOT } = {}) {
  const plan = JSON.parse(await readFile(join(root, PLAN_REF), 'utf8'));
  const { write, forbiddenWrite } = plan.sourceScope;
  const { base, paths } = changedPaths({ root });
  const outOfScope = paths.filter(path => !matchesAny(path, write));
  const forbidden = paths.filter(path => matchesAny(path, forbiddenWrite));
  const productRuntime = paths.filter(path => PRODUCT_RUNTIME.some(prefix => path.startsWith(prefix)));

  const scanned = [];
  const decisions = [];
  for (const file of [...await jsonFiles(join(SUBSTRATE_ROOT, 'manifests')), ...await jsonFiles(join(SUBSTRATE_ROOT, 'calibration')), join(root, 'packages/benchmark/package.json')]) {
    const ref = relative(root, file);
    scanned.push(ref);
    decisions.push(...decisionKeys(JSON.parse(await readFile(file, 'utf8'))).map(path => `${ref}:${path}`));
  }
  const { CONTRACT_KINDS } = await import('@exharness/benchmark');
  const kindHits = Object.values(CONTRACT_KINDS).filter(kind => /WINNER|PROMOTION|VALUE|RELEASE/.test(kind));
  const productImports = git(['grep', '-l', '@exharness/benchmark', 'HEAD', '--', ...PRODUCT_RUNTIME], { cwd: root, allowFailure: true }) ?? '';

  const checks = [
    { name: 'changed-paths-in-write-scope', status: outOfScope.length ? 'FAIL' : 'PASS', detail: outOfScope },
    { name: 'no-forbidden-writes', status: forbidden.length ? 'FAIL' : 'PASS', detail: forbidden },
    { name: 'no-product-runtime-writes', status: productRuntime.length ? 'FAIL' : 'PASS', detail: productRuntime },
    { name: 'product-runtime-does-not-import-benchmark', status: productImports.trim() ? 'FAIL' : 'PASS', detail: productImports.split('\n').filter(Boolean) },
    { name: 'output-schema-has-no-decisions', status: decisions.length || kindHits.length ? 'FAIL' : 'PASS', detail: { decisions, kindHits, scanned: scanned.length } }
  ];
  return {
    kind: 'BENCHMARK_PRODUCT_BOUNDARY_V1', status: checks.every(item => item.status === 'PASS') ? 'PASS' : 'FAIL',
    base, changedPaths: paths.length, checks
  };
}
