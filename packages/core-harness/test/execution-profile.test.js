// PROFILE acceptance: CORE_SYNC stays supported; CORE_ASYNC_FIRST_V1 only
// after PROMOTE_ASYNC with exact binding and quiescent rollback. B/C never publish.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CORE_ASYNC_FIRST_V1,
  CORE_SYNC,
  assertEvidenceFresh,
  assertProfilePublishable,
  createEvidenceBinding,
  defaultProfile,
  executionProfileManifest,
  getSupportedProfiles,
  isDiagnosticArm,
  isSupported,
  rollbackToSync
} from '../src/execution-profile.js';

function bindingFixture() {
  return createEvidenceBinding({
    decision: 'PROMOTE_ASYNC',
    ablationProtocolHash: 'sha256:' + 'a'.repeat(64),
    faultProtocolVersion: 1,
    evaluatedSourceSha: 'abc123',
    dependencyDigest: 'sha256:' + 'b'.repeat(64),
    providerProfile: { transport: 'OpenRouter', model: 'anthropic/claude-sonnet-4.6' }
  });
}

test('CORE_SYNC stays supported; async publishes only after PROMOTE_ASYNC', () => {
  assert.deepEqual([...getSupportedProfiles({ decision: 'KEEP_SYNC_BASELINE' })], [CORE_SYNC]);
  assert.deepEqual([...getSupportedProfiles({ decision: 'INCONCLUSIVE' })], [CORE_SYNC]);
  assert.deepEqual([...getSupportedProfiles({ decision: 'PROMOTE_ASYNC' })], [CORE_SYNC, CORE_ASYNC_FIRST_V1]);
  assert.equal(isSupported({ profile: CORE_SYNC, decision: 'INCONCLUSIVE' }), true);
  assert.equal(isSupported({ profile: CORE_ASYNC_FIRST_V1, decision: 'INCONCLUSIVE' }), false);
  assert.equal(isSupported({ profile: CORE_ASYNC_FIRST_V1, decision: 'PROMOTE_ASYNC' }), true);
  assert.equal(defaultProfile(), CORE_SYNC);
  assert.ok(executionProfileManifest().noImplicitDefault);
});

test('async publication needs exact evidence binding; B/C never publish', () => {
  const binding = bindingFixture();
  assert.equal(assertProfilePublishable({ profile: CORE_SYNC, decision: 'INCONCLUSIVE' }).publishable, true);
  assert.equal(assertProfilePublishable({ profile: CORE_ASYNC_FIRST_V1, decision: 'PROMOTE_ASYNC', evidenceBinding: binding }).publishable, true);
  assert.throws(() => assertProfilePublishable({ profile: CORE_ASYNC_FIRST_V1, decision: 'INCONCLUSIVE', evidenceBinding: binding }), /PROMOTE_ASYNC/);
  assert.throws(() => assertProfilePublishable({ profile: CORE_ASYNC_FIRST_V1, decision: 'PROMOTE_ASYNC' }), /evidence binding/);
  assert.throws(() => assertProfilePublishable({ profile: 'B', decision: 'PROMOTE_ASYNC', evidenceBinding: binding }), /diagnostic/);
  assert.throws(() => assertProfilePublishable({ profile: 'C', decision: 'PROMOTE_ASYNC', evidenceBinding: binding }), /diagnostic/);
  assert.throws(() => createEvidenceBinding({ decision: 'INCONCLUSIVE', ablationProtocolHash: 'x', evaluatedSourceSha: 'y', dependencyDigest: 'z' }), /PROMOTE_ASYNC/);
  assert.equal(isDiagnosticArm('B'), true);
  assert.equal(isDiagnosticArm('C'), true);
  assert.equal(isDiagnosticArm('D'), false);
});

test('freshness binding invalidates on source/dependency drift', () => {
  const binding = bindingFixture();
  assert.equal(assertEvidenceFresh({ binding, current: { ablationProtocolHash: binding.ablationProtocolHash, evaluatedSourceSha: binding.evaluatedSourceSha, dependencyDigest: binding.dependencyDigest } }).fresh, true);
  assert.throws(() => assertEvidenceFresh({ binding, current: { ablationProtocolHash: 'sha256:' + 'f'.repeat(64), evaluatedSourceSha: binding.evaluatedSourceSha, dependencyDigest: binding.dependencyDigest } }), /STALE/);
  assert.throws(() => assertEvidenceFresh({ binding: { ...binding, ablationProtocolHash: 'tampered' }, current: { ablationProtocolHash: 'tampered', evaluatedSourceSha: binding.evaluatedSourceSha, dependencyDigest: binding.dependencyDigest } }), /STALE/);
});

test('rollback is quiescent-session only; mid-flight is rejected', () => {
  assert.equal(rollbackToSync({ session: { isNewSession: true, inFlightAsyncOperations: 0, unresolvedEffects: 0, pendingModelTurns: 0 } }).profile, CORE_SYNC);
  assert.throws(() => rollbackToSync({ session: { isNewSession: true, inFlightAsyncOperations: 1, unresolvedEffects: 0, pendingModelTurns: 0 } }), /ROLLBACK/);
  assert.throws(() => rollbackToSync({ session: { isNewSession: false, quiescent: false, inFlightAsyncOperations: 0, unresolvedEffects: 0, pendingModelTurns: 0 } }), /ROLLBACK/);
  assert.throws(() => rollbackToSync({ session: { isNewSession: true, inFlightAsyncOperations: 0, unresolvedEffects: 2, pendingModelTurns: 0 } }), /ROLLBACK/);
});

test('public entry exposes the profile contract without changing defaults', async () => {
  const core = await import('../src/index.js');
  assert.equal(typeof core.createAgentRuntime, 'function');
  assert.equal(core.CORE_SYNC, 'CORE_SYNC');
  assert.equal(core.CORE_ASYNC_FIRST_V1, 'CORE_ASYNC_FIRST_V1');
  assert.equal(core.defaultProfile(), 'CORE_SYNC');
});
