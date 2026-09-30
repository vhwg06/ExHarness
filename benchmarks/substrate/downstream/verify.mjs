// Verifies the downstream handoff contract for a consumer fixture (currently BB-077):
// public-API-only imports, AttemptLedger usage, no duplicated accounting/evidence truth,
// tamper detection through the kernel audit, and kernel/consumer ownership split.
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { AttemptLedger } from '@exharness/benchmark';
import { REPO_ROOT, SUBSTRATE_ROOT } from '../common.mjs';

export const CONSUMERS = Object.freeze({ 'BB-077': join(SUBSTRATE_ROOT, 'downstream', 'bb077-contract-fixture.mjs') });
const PLAN = join(REPO_ROOT, 'docs/blackboard/artifacts/ready-implement-plan/BB-065.json');

/** Import specifiers of an ES module source (static and dynamic). */
export function importSpecifiers(source) {
  const specifiers = new Set();
  for (const match of source.matchAll(/\bimport\s+(?:[^'"()]*?\s+from\s+)?['"]([^'"]+)['"]/g)) specifiers.add(match[1]);
  for (const match of source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) specifiers.add(match[1]);
  for (const match of source.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) specifiers.add(match[1]);
  return [...specifiers].sort();
}

/** A downstream consumer may import only node built-ins and the package root. */
export function importViolations(specifiers) {
  return specifiers.filter(specifier => !(specifier.startsWith('node:') || specifier === '@exharness/benchmark'));
}

// Re-implementing kernel truth downstream: computing record/manifest seals, usage status or
// zero-fill decisions, or mapping verdicts to quality outside normalizeOutcome.
const DUPLICATED_TRUTH = [
  [/\b(?:recordDigest|manifestDigest|registrationDigest|unitDigest)\s*:(?!\s*manifest\.manifestDigest)/, 'writes a kernel seal field'],
  [/\busageStatus\s*:/, 'decides usageStatus'],
  [/\bZERO_FILL\b|zeroFill/, 'decides zero-fill'],
  [/\bquality\s*:\s*\{/, 'constructs a quality verdict'],
  [/function\s+(?:normalize|audit|seal|canonical)\w*/i, 'defines a kernel-named reducer'],
  [/packages\/benchmark\/src/, 'references package internals']
];

export function duplicatedTruth(source) {
  return DUPLICATED_TRUTH.filter(([pattern]) => pattern.test(source)).map(([, label]) => label);
}

async function kernelSources() {
  const dir = join(REPO_ROOT, 'packages/benchmark/src');
  const files = (await readdir(dir)).filter(name => name.endsWith('.js')).sort();
  return Promise.all(files.map(async name => ({ name, text: await readFile(join(dir, name), 'utf8') })));
}

export async function verifyDownstream({ consumer } = {}) {
  const path = CONSUMERS[consumer];
  if (!path) return { kind: 'BENCHMARK_DOWNSTREAM_VERIFICATION_V1', status: 'FAIL', consumer: consumer ?? null, error: `unknown consumer; known: ${Object.keys(CONSUMERS).join(', ')}` };
  const source = await readFile(path, 'utf8');
  const plan = JSON.parse(await readFile(PLAN, 'utf8'));
  const fixture = await import(path);
  const checks = [];
  const check = (name, ok, detail = null) => checks.push({ name, status: ok ? 'PASS' : 'FAIL', ...(detail === null ? {} : { detail }) });

  const specifiers = importSpecifiers(source);
  check('public-api-only-imports', importViolations(specifiers).length === 0, { specifiers, violations: importViolations(specifiers) });
  check('reads-substrate-manifest', source.includes("'../fixtures/manifest.json'"));
  check('no-duplicated-kernel-truth', duplicatedTruth(source).length === 0, duplicatedTruth(source));
  check('consumer-owns-declared-logic', JSON.stringify([...fixture.OWNS].sort()) === JSON.stringify([...plan.downstreamContract.bb077Owns].sort()), fixture.OWNS);

  const kernel = await kernelSources();
  const leaks = kernel.filter(file => /DIRECT_CODEACT|CORE_SYNC|BB-0\d\d|winner|promotion/i.test(file.text)).map(file => file.name);
  check('kernel-has-no-experiment-logic', leaks.length === 0, leaks);

  const run = await fixture.runFixture();
  check('uses-attempt-ledger', run.ledger instanceof AttemptLedger);
  const attempts = run.ledger.attempts();
  check('every-unit-settled-through-ledger', attempts.length === run.units.length && attempts.every(attempt => attempt.status === 'SETTLED'), attempts.length);
  const replayed = AttemptLedger.replay({ registration: run.registration, units: run.units, events: run.ledger.events(), records: run.settled.map(item => item.record) });
  check('ledger-replays-to-same-records', JSON.stringify(replayed.attempts().map(a => a.record.recordDigest)) === JSON.stringify(attempts.map(a => a.record.recordDigest)));
  check('kernel-audit-passes', run.audits.every(audit => audit.status === 'PASS'), run.audits.map(audit => audit.status));
  let resettleRejected = false;
  try { run.ledger.settleAttempt({ ...run.settled[0].record, quality: { ...run.settled[0].record.quality } }, { settledAt: '2026-09-30T00:00:09.000Z' }); } catch { resettleRejected = true; }
  check('settled-attempt-cannot-be-resettled', resettleRejected);

  const tampered = await fixture.runFixture({ tamper: 'artifacts/patch.diff' });
  check('tampered-evidence-fails-kernel-audit', tampered.audits[0].status === 'FAIL' && tampered.audits[0].findings.some(finding => finding.code === 'TAMPERED'), tampered.audits[0].findings?.map(finding => finding.code));
  check('comparison-has-no-decision', !/winner|promot|superior|verdict/i.test(JSON.stringify(Object.keys(run.comparison.perArm.DIRECT_CODEACT))) && !('winner' in run.comparison));

  return {
    kind: 'BENCHMARK_DOWNSTREAM_VERIFICATION_V1',
    status: checks.every(item => item.status === 'PASS') ? 'PASS' : 'FAIL',
    consumer,
    importGraph: { [path.slice(REPO_ROOT.length + 1)]: specifiers },
    comparison: run.comparison,
    checks
  };
}
