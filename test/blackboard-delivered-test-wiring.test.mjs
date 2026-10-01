import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { createOracleContextResolver } from '../packages/oracle/src/index.js';
import { verifySupersession } from '../scripts/blackboard-objective-supersession.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJsonPath = () => process.env.TW_PACKAGE_JSON || path.join(root, 'package.json');
const readPackageScripts = () => JSON.parse(fs.readFileSync(packageJsonPath(), 'utf8')).scripts;
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

function assertOracleWiring(scripts, files) {
  const script = scripts?.['test:oracle'];
  assert.ok(typeof script === 'string', 'test:oracle script must exist');
  assert.ok(
    String(script).includes('test/oracle-*.test.mjs'),
    'test:oracle must include test/oracle-*.test.mjs'
  );
  assert.deepEqual(oracleScriptCoverage(script, files), []);
}

function assertWorkGraphWiring(scripts) {
  const script = scripts?.['test:blackboard-work-graph'];
  assert.ok(typeof script === 'string', 'test:blackboard-work-graph script must exist');
  assert.ok(
    String(script).includes('test/blackboard-objective-supersession.test.mjs'),
    'test:blackboard-work-graph must include test/blackboard-objective-supersession.test.mjs'
  );
  assert.deepEqual(workGraphScriptCoverage(script), []);
}

test('TW1 test:oracle includes the oracle test glob', (t) => {
  const scripts = readPackageScripts();
  const files = listOracleTestFiles();
  assertOracleWiring(scripts, files);
  const script = scripts['test:oracle'];
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
  if (!process.env.TW_NEGATIVE_CHILD) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw1-'));
    try {
      const realPkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
      const mutated = JSON.parse(JSON.stringify(realPkg));
      mutated.scripts = {
        ...realPkg.scripts,
        'test:oracle': String(realPkg.scripts['test:oracle']).replace('test/oracle-*.test.mjs', '').trim(),
      };
      assert.ok(!String(mutated.scripts['test:oracle']).includes('test/oracle-*.test.mjs'), 'mutated copy must omit the oracle glob');
      const mutatedPath = path.join(tmpDir, 'package.json');
      fs.writeFileSync(mutatedPath, JSON.stringify(mutated, null, 2));
      const thisFile = fileURLToPath(import.meta.url);
      const childArgs = ['--test', '--test-name-pattern', '^TW1 ', thisFile];
      const mutatedEnv = { ...process.env, TW_PACKAGE_JSON: mutatedPath, TW_NEGATIVE_CHILD: '1' };
      delete mutatedEnv.NODE_TEST_CONTEXT;
      const controlEnv = { ...process.env, TW_PACKAGE_JSON: path.join(root, 'package.json'), TW_NEGATIVE_CHILD: '1' };
      delete controlEnv.NODE_TEST_CONTEXT;
      let childOutput = '';
      let childStatus = 0;
      try {
        childOutput = execFileSync(process.execPath, childArgs, {
          cwd: root,
          encoding: 'utf8',
          env: mutatedEnv,
        });
        childStatus = 0;
      } catch (e) {
        childStatus = e.status ?? 1;
        childOutput = String(e.stdout ?? '') + String(e.stderr ?? '');
      }
      assert.notEqual(childStatus, 0, `mutated TW1 child must fail (got ${childStatus}): ${String(childOutput).slice(0, 2000)}`);
      assert.ok(String(childOutput).includes('not ok'), `mutated TW1 child output must contain failure: ${String(childOutput).slice(0, 2000)}`);
      assert.ok(
        String(childOutput).includes('test/oracle-*.test.mjs'),
        `mutated TW1 child output must mention the missing path: ${String(childOutput).slice(0, 2000)}`
      );
      const tw1FailureLine = String(childOutput)
        .split(/\r?\n/)
        .find((line) => line.includes('must include') || line.includes('test/oracle-*.test.mjs'));
      const tw1FailureMessage = String(tw1FailureLine ?? '').trim().slice(0, 200);
      assert.ok(tw1FailureMessage.length > 0, `mutated TW1 child must expose a failure message: ${String(childOutput).slice(0, 2000)}`);
      let tw1ControlStatus = -1;
      const tw1ControlResult = spawnSync(process.execPath, childArgs, {
        cwd: root,
        encoding: 'utf8',
        env: controlEnv,
      });
      tw1ControlStatus = tw1ControlResult.status;
      const controlOutput = String(tw1ControlResult.stdout ?? '') + String(tw1ControlResult.stderr ?? '');
      assert.equal(tw1ControlResult.error, undefined, 'control TW1 child must spawn without error');
      assert.equal(tw1ControlStatus, 0, `control TW1 child must exit 0: ${String(controlOutput).slice(0, 2000)}`);
      assert.ok(String(controlOutput).includes('# fail 0'), 'control TW1 child must report # fail 0');
      t.diagnostic(`NC-TW-oracle: mutated test:oracle without test/oracle-*.test.mjs -> child TW1 exit=${childStatus}, failed with: ${tw1FailureMessage}`);
      t.diagnostic(`NC-TW-oracle control: real package.json -> child TW1 exit=${tw1ControlStatus}`);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }
});

test('TW2 test:blackboard-work-graph includes supersession tests', (t) => {
  const scripts = readPackageScripts();
  assertWorkGraphWiring(scripts);
  const script = scripts['test:blackboard-work-graph'];
  const removed = String(script).replace('test/blackboard-objective-supersession.test.mjs', '');
  assert.deepEqual(workGraphScriptCoverage(removed), ['test/blackboard-objective-supersession.test.mjs']);
  assert.equal(fs.existsSync(path.join(root, 'test/blackboard-objective-supersession.test.mjs')), true);
  assert.throws(
    () => verifySupersession({ trustedRoot: root, subjectRoot: root, prBaseSha: 'x', candidateSha: 'y', targetWorkId: 'NOT-A-TARGET' }),
    /invalid supersession target/
  );
  if (!process.env.TW_NEGATIVE_CHILD) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw2-'));
    try {
      const realPkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
      const mutated = JSON.parse(JSON.stringify(realPkg));
      mutated.scripts = {
        ...realPkg.scripts,
        'test:blackboard-work-graph': String(realPkg.scripts['test:blackboard-work-graph'])
          .replace('test/blackboard-objective-supersession.test.mjs', '')
          .trim(),
      };
      assert.ok(
        !String(mutated.scripts['test:blackboard-work-graph']).includes('test/blackboard-objective-supersession.test.mjs'),
        'mutated copy must omit the supersession path'
      );
      const mutatedPath = path.join(tmpDir, 'package.json');
      fs.writeFileSync(mutatedPath, JSON.stringify(mutated, null, 2));
      const thisFile = fileURLToPath(import.meta.url);
      const childArgs = ['--test', '--test-name-pattern', '^TW2 ', thisFile];
      const mutatedEnv = { ...process.env, TW_PACKAGE_JSON: mutatedPath, TW_NEGATIVE_CHILD: '1' };
      delete mutatedEnv.NODE_TEST_CONTEXT;
      const controlEnv = { ...process.env, TW_PACKAGE_JSON: path.join(root, 'package.json'), TW_NEGATIVE_CHILD: '1' };
      delete controlEnv.NODE_TEST_CONTEXT;
      let childOutput = '';
      let childStatus = 0;
      try {
        childOutput = execFileSync(process.execPath, childArgs, {
          cwd: root,
          encoding: 'utf8',
          env: mutatedEnv,
        });
        childStatus = 0;
      } catch (e) {
        childStatus = e.status ?? 1;
        childOutput = String(e.stdout ?? '') + String(e.stderr ?? '');
      }
      assert.notEqual(childStatus, 0, `mutated TW2 child must fail (got ${childStatus}): ${String(childOutput).slice(0, 2000)}`);
      assert.ok(String(childOutput).includes('not ok'), `mutated TW2 child output must contain failure: ${String(childOutput).slice(0, 2000)}`);
      assert.ok(
        String(childOutput).includes('test/blackboard-objective-supersession.test.mjs'),
        `mutated TW2 child output must mention the missing path: ${String(childOutput).slice(0, 2000)}`
      );
      const tw2FailureLine = String(childOutput)
        .split(/\r?\n/)
        .find(
          (line) =>
            line.includes('must include') || line.includes('test/blackboard-objective-supersession.test.mjs')
        );
      const tw2FailureMessage = String(tw2FailureLine ?? '').trim().slice(0, 200);
      assert.ok(tw2FailureMessage.length > 0, `mutated TW2 child must expose a failure message: ${String(childOutput).slice(0, 2000)}`);
      let tw2ControlStatus = -1;
      const tw2ControlResult = spawnSync(process.execPath, childArgs, {
        cwd: root,
        encoding: 'utf8',
        env: controlEnv,
      });
      tw2ControlStatus = tw2ControlResult.status;
      const controlOutput = String(tw2ControlResult.stdout ?? '') + String(tw2ControlResult.stderr ?? '');
      assert.equal(tw2ControlResult.error, undefined, 'control TW2 child must spawn without error');
      assert.equal(tw2ControlStatus, 0, `control TW2 child must exit 0: ${String(controlOutput).slice(0, 2000)}`);
      assert.ok(String(controlOutput).includes('# fail 0'), 'control TW2 child must report # fail 0');
      t.diagnostic(`NC-TW-supersession: mutated test:blackboard-work-graph without test/blackboard-objective-supersession.test.mjs -> child TW2 exit=${childStatus}, failed with: ${tw2FailureMessage}`);
      t.diagnostic(`NC-TW-supersession control: real package.json -> child TW2 exit=${tw2ControlStatus}`);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }
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
