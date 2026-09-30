import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createOracleContextResolver } from '../packages/oracle/src/index.js';
import { verifySupersession } from '../scripts/blackboard-objective-supersession.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readPackageScripts = () => JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts;
const stubCatalog = () => ({ authorityFor: () => ({}), validateCandidate: () => true });
const stubPlanner = () => ({ plan: () => ({}), execute: async () => ({}) });
const listOracleTestFiles = () => fs.readdirSync(path.join(root, 'test')).filter((name) => /^oracle-.*\.test\.mjs$/.test(name)).sort();

function oracleScriptCoverage(script, testDirFiles) {
  const text = String(script ?? '');
  const files = Array.isArray(testDirFiles) ? [...testDirFiles].sort() : [];
  const missing = [];
  if (!text.includes('packages/oracle/test/*.test.js')) missing.push('packages/oracle/test/*.test.js');
  const hasGlob = text.includes('test/oracle-*.test.mjs');
  if (!hasGlob) missing.push('test/oracle-*.test.mjs');
  for (const file of files.filter((name) => /^oracle-.*\.test\.mjs$/.test(name))) {
    const rel = `test/${file}`;
    if (!hasGlob && !text.includes(rel) && !text.includes(file)) missing.push(rel);
  }
  return missing;
}

function workGraphScriptCoverage(script) {
  const text = String(script ?? '');
  return text.includes('test/blackboard-objective-supersession.test.mjs')
    ? []
    : ['test/blackboard-objective-supersession.test.mjs'];
}

test('TW1 test:oracle includes the oracle test glob', () => {
  const script = readPackageScripts()['test:oracle'];
  const files = listOracleTestFiles();
  assert.deepEqual(oracleScriptCoverage(script, files), []);
  const globRemoved = String(script).replace('test/oracle-*.test.mjs', '');
  assert.ok(oracleScriptCoverage(globRemoved, files).includes('test/oracle-*.test.mjs'), 'omitting the oracle glob must be reported');
  const singleFile = 'node --test packages/oracle/test/*.test.js test/oracle-context-intelligence-architecture.test.mjs';
  const singleMissing = oracleScriptCoverage(singleFile, files);
  assert.ok(singleMissing.includes('test/oracle-*.test.mjs'), 'one explicit file must not satisfy the glob');
  assert.ok(singleMissing.includes('test/oracle-facade-accounting.test.mjs'), 'one explicit file must leave facade-accounting uncovered');
  assert.ok(!singleMissing.includes('test/oracle-context-intelligence-architecture.test.mjs'), 'the listed file counts as covered');
  const expanded = execFileSync('sh', ['-c', 'ls test/oracle-*.test.mjs'], { cwd: root, encoding: 'utf8' }).trim().split(/\s+/).sort();
  for (const file of files) {
    assert.ok(expanded.includes(`test/${file}`), `the glob must expand to test/${file}`);
  }
  const resolver = createOracleContextResolver({ sourceCatalog: stubCatalog(), retrievalPlanner: stubPlanner() });
  assert.equal(typeof resolver.resolve, 'function');
  assert.equal(typeof resolver.preObserve, 'function');
});

test('TW2 test:blackboard-work-graph includes supersession tests', () => {
  const script = readPackageScripts()['test:blackboard-work-graph'];
  assert.deepEqual(workGraphScriptCoverage(script), []);
  const removed = String(script).replace('test/blackboard-objective-supersession.test.mjs', '');
  assert.deepEqual(workGraphScriptCoverage(removed), ['test/blackboard-objective-supersession.test.mjs']);
  assert.equal(fs.existsSync(path.join(root, 'test/blackboard-objective-supersession.test.mjs')), true);
  assert.throws(
    () => verifySupersession({ trustedRoot: root, subjectRoot: root, prBaseSha: 'x', candidateSha: 'y', targetWorkId: 'NOT-A-TARGET' }),
    /invalid supersession target/
  );
});

test('TW3 test/delivery remains absent', () => {
  assert.equal(fs.existsSync(path.join(root, 'test/delivery')), false);
  const resolver = createOracleContextResolver({ sourceCatalog: stubCatalog(), retrievalPlanner: stubPlanner() });
  assert.equal(typeof resolver.resolve, 'function');
});

test('TW3 npm test does not run smoke:agent-tools', () => {
  const scripts = readPackageScripts();
  assert.ok(typeof scripts.test === 'string' && !scripts.test.includes('smoke:agent-tools'), 'npm test must not run smoke:agent-tools');
  const resolver = createOracleContextResolver({ sourceCatalog: stubCatalog(), retrievalPlanner: stubPlanner() });
  assert.equal(typeof resolver.preObserve, 'function');
});

test('TW3 Living docs contain no Blackboard ids', () => {
  for (const ref of ['docs/living/system/oracle/context-graph.md', 'docs/living/system/state.md']) {
    const body = fs.readFileSync(path.join(root, ref), 'utf8');
    assert.doesNotMatch(body, /\bBB-\d+\b/, `${ref} must not contain a Blackboard id`);
  }
  assert.throws(
    () => verifySupersession({ trustedRoot: root, subjectRoot: root, prBaseSha: '', candidateSha: '', targetWorkId: '' }),
    /invalid supersession target/
  );
});
