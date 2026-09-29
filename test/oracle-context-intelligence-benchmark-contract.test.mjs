import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (ref) => fs.readFileSync(path.join(root, ref), 'utf8');

test('benchmark freezes Oracle profile only with UNKNOWN accounting', (t) => {
  const out = JSON.parse(execFileSync('node', ['scripts/oracle-context-intelligence/benchmark-profile.mjs', '--mode', 'validate'], { cwd: root, encoding: 'utf8' }));
  assert.equal(out.kind, 'ORACLE_BENCHMARK_VALIDATED');
  assert.deepEqual(out.arms, ['O0_STATIC_CONTEXT_CONTROL', 'O1_ORACLE_FOUNDATION_V1']);
  assert.equal(out.unknown, 'UNKNOWN');
  t.diagnostic('O0 vs O1 with 11 fixed factors, 17 metrics, UNKNOWN stays UNKNOWN');
});

test('benchmark boundary rejects drift/value claims and protects async work', (t) => {
  const plan = JSON.parse(read('docs/blackboard/artifacts/ready-implement-plan/BB-064.json'));
  assert.ok(plan.benchmarkHandoff.fixedFactors.length >= 10);
  assert.match(plan.benchmarkHandoff.accounting, /UNKNOWN stays UNKNOWN/);
  assert.match(JSON.stringify(plan.continuationSchedule), /BB-083/);
  assert.match(plan.continuationSchedule.nonOverload, /BB-077..081/);
  const readme = read('scripts/oracle-context-intelligence/README.md');
  assert.match(readme, /graph productization|planner optimization|progressive runtime|adaptive.*budget|Core interaction|held-out/i);
  assert.doesNotMatch(readme, /tokens saved|live productivity|pilot value/i);
  t.diagnostic('fixed-factor handoff with continuation BB-083; BB-077..081 remain Core async work; no fixture-to-value claim');
});
