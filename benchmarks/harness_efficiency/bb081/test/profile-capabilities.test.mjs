// Profile capabilities: frozen A/B/C/D composition; B/C diagnostic-only;
// D sole promotion candidate; fixed factors unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROFILES,
  assertAllComposable,
  assertComposable,
  getProfileCapabilities,
  isDiagnostic,
  isPromotionCandidate,
  profileCapabilitiesManifest,
  toolActivationExpectation
} from '../profile-capabilities.mjs';

test('A/B/C/D composition is frozen with diagnostic markers', () => {
  assert.equal(getProfileCapabilities('A').description, 'CORE_SYNC control');
  assert.equal(getProfileCapabilities('D').promotionCandidate, true);
  assert.equal(isDiagnostic('B'), true);
  assert.equal(isDiagnostic('C'), true);
  assert.equal(isDiagnostic('A'), false);
  assert.equal(isDiagnostic('D'), false);
  assert.equal(isPromotionCandidate('D'), true);
  assert.equal(isPromotionCandidate('A'), false);
  assert.equal(isPromotionCandidate('B'), false);
  assert.equal(isPromotionCandidate('C'), false);
  assert.throws(() => getProfileCapabilities('E'), /ARM/);
  assert.deepEqual(Object.keys(PROFILES), ['A', 'B', 'C', 'D']);
  assert.ok(profileCapabilitiesManifest().rule.includes('Only delivered Core capability composition varies'));
});

test('every arm composes independently against the delivered Core', async () => {
  const core = await import('../../../../packages/core-harness/src/index.js');
  assert.deepEqual(assertAllComposable({ core }).arms, ['A', 'B', 'C', 'D']);
  for (const arm of ['A', 'B', 'C', 'D']) {
    assert.equal(assertComposable({ arm, core }).composable, true);
  }
  // Tool activation: same identity; A waits, B/C/D return RUNNING first.
  assert.equal(toolActivationExpectation('A').returnsRunning, false);
  assert.equal(toolActivationExpectation('B').returnsRunning, true);
  assert.equal(toolActivationExpectation('C').returnsRunning, true);
  assert.equal(toolActivationExpectation('D').returnsRunning, true);
});

test('non-composable arms fail PLAN_INPUT_CONTRADICTION, never approximate', () => {
  assert.throws(() => assertComposable({ arm: 'B', core: {} }), /PLAN_INPUT_CONTRADICTION/);
  assert.throws(() => assertComposable({ arm: 'D', core: null }), /PLAN_INPUT_CONTRADICTION/);
  assert.throws(() => assertComposable({ arm: 'Z', core: {} }), /ARM/);
});
