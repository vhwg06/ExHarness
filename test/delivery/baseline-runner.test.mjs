import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { main } from '../../scripts/delivery/baseline/run.mjs';

test('deterministic mode runs real verifier and is never labelled LIVE', async t => {
  const output = await mkdtemp(join(tmpdir(), 'baseline-deterministic-'));
  t.after(() => rm(output, { recursive: true, force: true }));
  const result = await main(['--mode', 'deterministic', '--output', output]);
  assert.deepEqual(result, { mode: 'deterministic', positive: 'ACCEPTED', negative: 'REJECTED' });
  const artifact = JSON.parse(await readFile(join(output, 'deterministic.json'), 'utf8'));
  assert.equal(artifact.productionEvidence, false);
  assert.equal(artifact.evidenceClass, 'DETERMINISTIC');
});

test('live preflight rejects an unregistered profile before any provider dispatch', async () => {
  await assert.rejects(() => main(['--mode', 'validate', '--profile', 'scripts/delivery/baseline/profile.json']), /experiment\/operator\/reviewer identity/);
});

test('Python provider ledger reserves before calls, shares retries and fences unknown usage', async t => {
  const output = await mkdtemp(join(tmpdir(), 'baseline-budget-'));
  t.after(() => rm(output, { recursive: true, force: true }));
  const source = resolve('scripts/delivery/baseline').replaceAll('\\', '/');
  const ledger = join(output, 'usage.jsonl').replaceAll('\\', '/');
  const script = `import sys\nsys.path.insert(0, ${JSON.stringify(source)})\nfrom provider_budget import ProviderBudget, BudgetError\nprofile = {'budgets': {'maxInputTokensPerCall': 10, 'maxOutputTokensPerCall': 5, 'maxModelCalls': 2, 'maxTotalTokens': 30, 'maxApiUsd': 1}, 'model': {'maxContextTokens': 20, 'inputUsdPerMillion': 1, 'outputUsdPerMillion': 2}}\np = ProviderBudget(${JSON.stringify(ledger)}, profile, 'T1', 'A1')\na = p.reserve(10, 5)\np.settle(a, 'provider-1', 8, 3)\np2 = ProviderBudget(${JSON.stringify(ledger)}, profile, 'T1', 'A2')\nb = p2.reserve(10, 5)\np2.unknown(b, 'timeout')\ntry:\n    p2.reserve(1, 1)\nexcept BudgetError as e:\n    assert 'unresolved' in str(e)\nelse:\n    raise AssertionError('unknown response must fence retry')\nprint('budget-ok')\n`;
  const result = execFileSync('python', ['-c', script], { encoding: 'utf8' });
  assert.match(result, /budget-ok/);
  const rows = (await readFile(join(output, 'usage.jsonl'), 'utf8')).trim().split(/\r?\n/).map(JSON.parse);
  assert.deepEqual(rows.map(row => row.kind), ['RESERVE', 'SETTLED', 'RESERVE', 'UNKNOWN']);
});

test('reservation overshoot and a third attempt cannot exceed the shared call budget', async t => {
  const output = await mkdtemp(join(tmpdir(), 'baseline-budget-limit-'));
  t.after(() => rm(output, { recursive: true, force: true }));
  const source = resolve('scripts/delivery/baseline').replaceAll('\\', '/');
  const ledger = join(output, 'usage.jsonl').replaceAll('\\', '/');
  const script = `import sys\nsys.path.insert(0, ${JSON.stringify(source)})\nfrom provider_budget import ProviderBudget, BudgetError\nprofile = {'budgets': {'maxInputTokensPerCall': 10, 'maxOutputTokensPerCall': 5, 'maxModelCalls': 2, 'maxTotalTokens': 30, 'maxApiUsd': 1}, 'model': {'maxContextTokens': 20, 'inputUsdPerMillion': 1, 'outputUsdPerMillion': 2}}\np = ProviderBudget(${JSON.stringify(ledger)}, profile, 'T1', 'A1')\na = p.reserve(10, 5)\np.settle(a, 'provider-1', 8, 3)\np = ProviderBudget(${JSON.stringify(ledger)}, profile, 'T1', 'A2')\nb = p.reserve(10, 5)\np.settle(b, 'provider-2', 8, 3)\ntry:\n    p.reserve(1, 1)\nexcept BudgetError as e:\n    assert 'exhausted' in str(e)\nelse:\n    raise AssertionError('third provider call exceeded budget')\nprint('shared-budget-ok')\n`;
  assert.match(execFileSync('python', ['-c', script], { encoding: 'utf8' }), /shared-budget-ok/);
  const overshoot = join(output, 'overshoot.jsonl').replaceAll('\\', '/');
  const overshootScript = `import sys\nsys.path.insert(0, ${JSON.stringify(source)})\nfrom provider_budget import ProviderBudget, BudgetError\nprofile = {'budgets': {'maxInputTokensPerCall': 10, 'maxOutputTokensPerCall': 5, 'maxModelCalls': 2, 'maxTotalTokens': 30, 'maxApiUsd': 1}, 'model': {'maxContextTokens': 20, 'inputUsdPerMillion': 1, 'outputUsdPerMillion': 2}}\np = ProviderBudget(${JSON.stringify(overshoot)}, profile, 'T1', 'A1')\na = p.reserve(10, 5)\ntry:\n    p.settle(a, 'provider-1', 11, 3)\nexcept BudgetError as e:\n    assert 'exceeds reservation' in str(e)\nelse:\n    raise AssertionError('overshoot must fail')\ntry:\n    p.reserve(1, 1)\nexcept BudgetError as e:\n    assert 'unresolved' in str(e)\nelse:\n    raise AssertionError('overshoot uncertainty must fence future calls')\nprint('overshoot-fenced')\n`;
  assert.match(execFileSync('python', ['-c', overshootScript], { encoding: 'utf8' }), /overshoot-fenced/);
});
