// ROBUSTNESS + SAFETY acceptance: deterministic fault matrix with explicit
// arm applicability; N/A never passes; D duplicates stay zero.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SCENARIOS,
  armsFor,
  assertMatrixComplete,
  countPasses,
  dSafetySatisfied,
  declaredCells,
  faultMatrixManifest,
  isApplicable,
  isDeclaredCell,
  requiredDCells,
  runFaultCell,
  runFaultMatrix
} from '../fault-matrix.mjs';

test('fault matrix declares exactly the ten frozen scenarios with applicability', () => {
  assert.equal(SCENARIOS.length, 10);
  assert.equal(armsFor('PROVIDER_TIMEOUT'), 'ABCD');
  assert.equal(armsFor('KILL_AFTER_DURABLE_OPERATION'), 'BCD');
  assert.equal(armsFor('DUPLICATE_TRANSITION'), 'CD');
  assert.equal(armsFor('DUPLICATE_WAKE'), 'D');
  assert.equal(armsFor('STALE_MODEL_AFTER_STEER'), 'D');
  assert.equal(armsFor('NON_RECONCILABLE_AMBIGUITY'), 'BCD');
  assert.equal(isApplicable('DUPLICATE_WAKE', 'D'), true);
  assert.equal(isApplicable('DUPLICATE_WAKE', 'A'), false);
  assert.equal(isApplicable('PROVIDER_TIMEOUT', 'A'), true);
  // 16 + 3 + 3 + 2 + 1 + 1 + 3 = 29 declared cells.
  assert.equal(declaredCells().length, 29);
  assert.equal(faultMatrixManifest().version, 1);
});

test('deterministic fixtures separate provider/termination from quality', () => {
  const cells = runFaultMatrix();
  assertMatrixComplete(cells);
  assert.equal(countPasses(cells), 29);
  assert.equal(dSafetySatisfied(cells), true);
  for (const cell of cells) {
    assert.ok(cell.traceDigest.startsWith('sha256:'));
    assert.ok(['NOT_APPLICABLE', 'RECOVERED', 'ESCALATED', 'FAILED'].includes(cell.recoveryOutcome));
  }
  // Provider timeout: termination/provider recorded beside quality, never as quality.
  const timeout = cells.find((c) => c.scenario === 'PROVIDER_TIMEOUT' && c.arm === 'A');
  assert.equal(timeout.providerStatus, 'PROVIDER_TIMEOUT');
  assert.equal(timeout.quality, 'NOT_EVALUATED');
  // Ambiguous completion never becomes authority.
  const ambiguous = cells.find((c) => c.scenario === 'AMBIGUOUS_COMPLETION' && c.arm === 'D');
  assert.equal(ambiguous.recoveryOutcome, 'ESCALATED');
  // Unresolved NON_RECONCILABLE fails closed (escalate, no second dispatch).
  const nonRec = cells.find((c) => c.scenario === 'NON_RECONCILABLE_AMBIGUITY' && c.arm === 'D');
  assert.equal(nonRec.recoveryOutcome, 'ESCALATED');
  assert.equal(nonRec.duplicateEffects, 0);
});

test('N/A is never counted as pass; D negatives force failure', () => {
  const na = runFaultCell({ scenario: 'DUPLICATE_WAKE', arm: 'A' });
  assert.equal(na.applicable, false);
  assert.equal(na.status, 'N/A');
  assert.equal(na.passed, null);
  assert.equal(isDeclaredCell({ scenario: 'DUPLICATE_WAKE', arm: 'A' }), false);
  assert.equal(countPasses([na]), 0);
  // Duplicate effect in D fails the cell and the safety gate.
  const dup = runFaultMatrix({ mutateCell: ({ scenario, arm }) => (scenario === 'DUPLICATE_WAKE' && arm === 'D' ? { duplicateEffects: 1 } : null) });
  assert.equal(dSafetySatisfied(dup), false);
  // Stale-model dispatch in D fails.
  const stale = runFaultMatrix({ mutateCell: ({ scenario, arm }) => (scenario === 'STALE_MODEL_AFTER_STEER' ? { staleDispatches: 2 } : null) });
  assert.equal(dSafetySatisfied(stale), false);
  // Non-reconcilable resolved as success instead of escalate fails.
  const badResolve = runFaultMatrix({ mutateCell: ({ scenario }) => (scenario === 'NON_RECONCILABLE_AMBIGUITY' ? { recoveryOutcome: 'RECOVERED' } : null) });
  assert.equal(dSafetySatisfied(badResolve), false);
  // Wake storm (two wakes) fails.
  const storm = runFaultMatrix({ mutateCell: ({ scenario, arm }) => (scenario === 'DUPLICATE_WAKE' && arm === 'D' ? { wakes: 2 } : null) });
  assert.equal(dSafetySatisfied(storm), false);
  assert.ok(requiredDCells(dup).length > 0);
});
