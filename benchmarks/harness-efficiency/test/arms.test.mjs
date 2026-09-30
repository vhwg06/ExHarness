// ARM_ISOLATION: DIRECT_CODEACT and CORE_SYNC share exact model/task/prompt/
// workspace/tool/evaluator/budget identities and differ only in benchmark-owned
// direct orchestration versus createAgentRuntime synchronous Core orchestration.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { scratchDir } from './helpers.mjs';
import { DEVELOPMENT_TASKS } from '../constants.mjs';

let tmp;
test.before(() => { tmp = scratchDir('arms'); assert.ok(fs.statSync(tmp).isDirectory()); });

const TASK = { taskId: DEVELOPMENT_TASKS[0].id, bundleDigest: DEVELOPMENT_TASKS[0].bundleDigest };

test('both arms share the exact fixed-factor identity', async () => {
  const { createDirectCodeactAdapter } = await import('../adapters/direct-codeact.mjs');
  const direct = await createDirectCodeactAdapter();
  const { createCoreSyncAdapter } = await import('../adapters/core-sync.mjs');
  const core = await createCoreSyncAdapter();
  assert.deepEqual(direct.fixedFactors(TASK), core.fixedFactors(TASK));
  assert.equal(direct.fixedDigest(TASK), core.fixedDigest(TASK));
  const factors = direct.fixedFactors(TASK);
  assert.equal(factors.modelRoute, 'OpenRouter/anthropic/claude-sonnet-4.6');
  assert.equal(factors.provider, 'Anthropic');
  assert.equal(factors.fallback, 'disabled');
  assert.equal(factors.strategyConfig.strategy, 'javascript-codeact');
  assert.equal(factors.executor, 'reference-javascript-session-executor@1');
  assert.deepEqual(factors.capabilities, ['execute_javascript', 'read_file', 'write_file']);
  assert.equal(factors.evaluator, 'harbor-task-verifier@0.23.0');
});

test('arms differ only in benchmark-owned orchestration', async () => {
  const { createDirectCodeactAdapter } = await import('../adapters/direct-codeact.mjs');
  const direct = await createDirectCodeactAdapter();
  const { createCoreSyncAdapter } = await import('../adapters/core-sync.mjs');
  const core = await createCoreSyncAdapter();
  assert.equal(direct.arm, 'DIRECT_CODEACT');
  assert.equal(core.arm, 'CORE_SYNC');
  assert.notEqual(direct.orchestration, core.orchestration);
  assert.equal(direct.orchestration, 'direct-minimal-shim');
  assert.equal(core.orchestration, 'createAgentRuntime-sync');
  const rawDirect = await direct.run({ ...TASK, attemptId: 'probe-1' });
  const rawCore = await core.run({ ...TASK, attemptId: 'probe-1' });
  assert.equal(rawDirect.orchestration, direct.orchestration);
  assert.equal(rawCore.orchestration, core.orchestration);
  assert.ok(rawDirect.modelTurns > 0 && rawCore.modelTurns > 0);
  assert.ok(rawDirect.toolCalls > 0 && rawCore.toolCalls > 0);
});

test('an arm that changes model input is detected by the fixed digest', async () => {
  const { createDirectCodeactAdapter } = await import('../adapters/direct-codeact.mjs');
  const direct = await createDirectCodeactAdapter();
  const { createCoreSyncAdapter } = await import('../adapters/core-sync.mjs');
  const core = await createCoreSyncAdapter();
  const changed = { ...TASK, bundleDigest: 'sha256:0000000000000000000000000000000000000000000000000000000000000000' };
  assert.notEqual(direct.fixedDigest(changed), core.fixedDigest(TASK));
  assert.notDeepEqual(direct.fixedFactors(changed), core.fixedFactors(TASK));
});

test('changed workspace, tools, evaluator or budget break pair identity', async () => {
  const { assertPairIdentity } = await import('../protocol.mjs');
  const base = {
    arm: 'DIRECT_CODEACT',
    task: { id: 'terminal-bench/fix-git', bundleDigest: TASK.bundleDigest },
    environmentIdentity: 'env-a',
    instructionDigest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    producerProfile: 'bb077-codeact-profile',
    budgetProfileHash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    repeatIndex: 0
  };
  const mate = { ...base, arm: 'CORE_SYNC', task: { ...base.task } };
  assert.equal(await assertPairIdentity(base, mate), true);
  for (const mutate of [
    (unit) => ({ ...unit, environmentIdentity: 'env-b' }),
    (unit) => ({ ...unit, instructionDigest: 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc' }),
    (unit) => ({ ...unit, producerProfile: 'other-profile' }),
    (unit) => ({ ...unit, budgetProfileHash: 'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd' }),
    (unit) => ({ ...unit, task: { ...unit.task, bundleDigest: 'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' } }),
    (unit) => ({ ...unit, repeatIndex: 2 })
  ]) {
    assert.throws(() => assertPairIdentity(base, mutate(mate)), /FIXED_FACTOR_DRIFT/);
  }
});

test('protocol rejects a pair that varies more than the arm', async () => {
  const { assertPairIdentity } = await import('../protocol.mjs');
  const direct = { arm: 'DIRECT_CODEACT', task: { id: 't', bundleDigest: TASK.bundleDigest } };
  const other = { arm: 'OTHER_ARM', task: { id: 't', bundleDigest: TASK.bundleDigest } };
  assert.throws(() => assertPairIdentity(direct, other), /ARM/);
});
