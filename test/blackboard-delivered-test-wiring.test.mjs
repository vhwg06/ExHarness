import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createOracleContextResolver } from '../packages/oracle/src/index.js';
import { verifySupersession } from '../scripts/blackboard-objective-supersession.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readPackageScripts = () => JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts;
const stubCatalog = () => ({ authorityFor: () => ({}), validateCandidate: () => true });
const stubPlanner = () => ({ plan: () => ({}), execute: async () => ({}) });

test('TW1 test:oracle includes the oracle test glob', () => {
  const scripts = readPackageScripts();
  const script = scripts['test:oracle'];
  assert.ok(typeof script === 'string' && script.includes('packages/oracle/test/*.test.js'), 'test:oracle must run packages/oracle/test/*.test.js');
  assert.ok(script.includes('test/oracle-*.test.mjs'), 'test:oracle must include the test/oracle-*.test.mjs glob');
  const oracleFiles = fs.readdirSync(path.join(root, 'test')).filter((name) => /^oracle-.*\.test\.mjs$/.test(name));
  for (const required of ['oracle-facade-accounting', 'oracle-context-graph-boundary', 'oracle-context-intelligence-foundation']) {
    assert.ok(oracleFiles.some((name) => name.includes(required)), `oracle glob must cover ${required}`);
  }
  const resolver = createOracleContextResolver({ sourceCatalog: stubCatalog(), retrievalPlanner: stubPlanner() });
  assert.equal(typeof resolver.resolve, 'function');
  assert.equal(typeof resolver.preObserve, 'function');
});

test('TW2 test:blackboard-work-graph includes supersession tests', () => {
  const scripts = readPackageScripts();
  const script = scripts['test:blackboard-work-graph'];
  assert.ok(typeof script === 'string' && script.includes('test/blackboard-objective-supersession.test.mjs'), 'test:blackboard-work-graph must run test/blackboard-objective-supersession.test.mjs');
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
