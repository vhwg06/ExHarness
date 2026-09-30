// Downstream handoff and product boundary helpers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { duplicatedTruth, importSpecifiers, importViolations } from '../downstream/verify.mjs';
import { decisionKeys, globToRegExp, matchesAny } from '../product-boundary.mjs';
import { compareArms, runFixture } from '../downstream/bb077-contract-fixture.mjs';

test('a downstream consumer may import only node built-ins and the package root', () => {
  const specifiers = importSpecifiers("import { AttemptLedger } from '@exharness/benchmark';\nimport x from '@exharness/benchmark/src/audit.js';\nconst y = await import('node:fs');\nrequire('../../packages/benchmark/src/ledger.js');");
  assert.deepEqual(importViolations(specifiers), ['../../packages/benchmark/src/ledger.js', '@exharness/benchmark/src/audit.js']);
});

test('re-implementing kernel truth downstream is detected', () => {
  assert.deepEqual(duplicatedTruth('const record = { recordDigest: sha(x) };'), ['writes a kernel seal field']);
  assert.ok(duplicatedTruth('const u = { usageStatus: "KNOWN" }').includes('decides usageStatus'));
  assert.ok(duplicatedTruth('return { quality: { verdict: "ACCEPTED" } }').includes('constructs a quality verdict'));
  assert.deepEqual(duplicatedTruth("ledger.settleAttempt(record)"), []);
});

test('the downstream contract fixture runs both arms through the ledger and audit catches tampering', async () => {
  const clean = await runFixture();
  assert.ok(clean.audits.every(audit => audit.status === 'PASS'));
  const tampered = await runFixture({ tamper: 'artifacts/patch.diff' });
  assert.ok(tampered.audits[0].findings.some(finding => finding.code === 'TAMPERED'));
  assert.equal(typeof compareArms, 'function');
});

test('scope globs and decision-key scan', () => {
  assert.ok(matchesAny('packages/benchmark/src/a.js', ['packages/benchmark/**']));
  assert.ok(!matchesAny('packages/core-harness/src/a.js', ['packages/benchmark/**']));
  assert.ok(globToRegExp('docs/*.md').test('docs/a.md') && !globToRegExp('docs/*.md').test('docs/x/a.md'));
  assert.deepEqual(decisionKeys({ a: { winner: 'X' }, b: [{ promotionDecision: true }], quality: 'ACCEPTED' }), ['$.a.winner', '$.b[0].promotionDecision']);
});
