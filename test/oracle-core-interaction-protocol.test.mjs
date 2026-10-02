// BB-094 (K3) — ORACLE_CORE_INTERACTION_V1 protocol validation tests.
//
// Runs scripts/oracle-context-intelligence/core-interaction-protocol.mjs in
// --mode validate against the live repo state and against fixture graph
// inputs for both the published and unpublished async states (D5).
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'oracle-context-intelligence', 'core-interaction-protocol.mjs');

// Fixed factors copied verbatim from ORACLE_CONTEXT_BENCHMARK_V1
// (scripts/oracle-context-intelligence/benchmark-profile.mjs).
const BENCHMARK_FIXED_FACTORS = [
  'model snapshot and provider route',
  'task + task digest',
  'prompt/instruction',
  'initial workspace/source snapshot',
  'Core execution profile',
  'capability/tool surface',
  'model/runtime/resource ceilings',
  'artifact extraction',
  'independent evaluator',
  'repeat/sample schedule',
  'pricing/accounting semantics',
];

function runValidate({ workGraph = null, decisionDir = null } = {}) {
  const args = ['--mode', 'validate'];
  if (workGraph) args.push('--work-graph', workGraph);
  if (decisionDir) args.push('--decision-dir', decisionDir);
  const stdout = execFileSync('node', [SCRIPT, ...args], { encoding: 'utf8' });
  return JSON.parse(stdout);
}

function writeFixture({ bb081Status, decision }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb094-protocol-'));
  fs.writeFileSync(
    path.join(dir, 'work-graph.json'),
    JSON.stringify({ tasks: { 'BB-081': { id: 'BB-081', status: bb081Status } } })
  );
  const decisionDir = path.join(dir, 'decisions');
  fs.mkdirSync(decisionDir);
  if (decision) {
    fs.writeFileSync(
      path.join(decisionDir, 'BB-081.delivered-feature.json'),
      JSON.stringify({
        kind: 'BLACKBOARD_ARTIFACT',
        artifactType: 'DELIVERED_FEATURE',
        artifactId: 'BB-081-delivery',
        decision,
      })
    );
  }
  return { workGraph: path.join(dir, 'work-graph.json'), decisionDir };
}

test('validate on the live repo: 1x2 design with async NOT_EVALUATED and a reason', () => {
  const out = runValidate();
  assert.equal(out.kind, 'ORACLE_CORE_INTERACTION_VALIDATED');
  assert.equal(out.schema, 'ORACLE_CORE_INTERACTION_V1');
  assert.equal(out.design, '1x2');
  assert.equal(out.asyncPublished, false);
  assert.equal(out.evaluatedCells, 2);
  assert.equal(out.notEvaluatedCells, 2);
  assert.deepEqual(out.bb081.taskStatus, 'DONE');
  assert.equal(out.bb081.decision, null);
  const asyncCells = out.cells.filter((c) => c.coreArm === 'CORE_ASYNC_FIRST_V1');
  assert.equal(asyncCells.length, 2);
  for (const cell of asyncCells) {
    assert.equal(cell.status, 'NOT_EVALUATED');
    assert.match(cell.reason, /PROMOTE_ASYNC/);
  }
  const syncCells = out.cells.filter((c) => c.coreArm === 'CORE_SYNC');
  assert.equal(syncCells.length, 2);
  for (const cell of syncCells) assert.equal(cell.status, 'EVALUATED');
  assert.equal(out.fixedFactors, 11);
});

test('fixture: PROMOTE_ASYNC on DONE BB-081 resolves a 2x2 design with every cell EVALUATED', () => {
  const fixture = writeFixture({ bb081Status: 'DONE', decision: 'PROMOTE_ASYNC' });
  const out = runValidate(fixture);
  assert.equal(out.design, '2x2');
  assert.equal(out.asyncPublished, true);
  assert.equal(out.evaluatedCells, 4);
  assert.equal(out.notEvaluatedCells, 0);
  for (const cell of out.cells) assert.equal(cell.status, 'EVALUATED');
});

test('fixture: KEEP_SYNC_BASELINE keeps 1x2 with async NOT_EVALUATED and a reason', () => {
  const fixture = writeFixture({ bb081Status: 'DONE', decision: 'KEEP_SYNC_BASELINE' });
  const out = runValidate(fixture);
  assert.equal(out.design, '1x2');
  assert.equal(out.asyncPublished, false);
  const asyncCells = out.cells.filter((c) => c.coreArm === 'CORE_ASYNC_FIRST_V1');
  assert.equal(asyncCells.length, 2);
  for (const cell of asyncCells) {
    assert.equal(cell.status, 'NOT_EVALUATED');
    assert.match(cell.reason, /PROMOTE_ASYNC/);
  }
});

test('fixture: BB-081 not DONE records async cells NOT_EVALUATED instead of skipping them', () => {
  const fixture = writeFixture({ bb081Status: 'PLANNED', decision: null });
  const out = runValidate(fixture);
  assert.equal(out.design, '1x2');
  assert.equal(out.asyncPublished, false);
  // The matrix still covers every oracle x core combination: nothing is
  // silently skipped.
  assert.equal(out.cells.length, 4);
  const asyncCells = out.cells.filter((c) => c.coreArm === 'CORE_ASYNC_FIRST_V1');
  assert.equal(asyncCells.length, 2);
  for (const cell of asyncCells) assert.equal(cell.status, 'NOT_EVALUATED');
});

test('fixed factors match ORACLE_CONTEXT_BENCHMARK_V1 verbatim and the manifest is frozen', () => {
  const source = fs.readFileSync(SCRIPT, 'utf8');
  for (const factor of BENCHMARK_FIXED_FACTORS) {
    assert.ok(source.includes(`'${factor}'`), `protocol embeds benchmark factor: ${factor}`);
  }
  assert.match(source, /frozen: true/);
  assert.match(source, /runs no experiment/);
});

test('unknown mode exits non-zero', () => {
  assert.throws(() => execFileSync('node', [SCRIPT, '--mode', 'run'], { encoding: 'utf8', stdio: 'pipe' }));
});
