import test from 'node:test';
import assert from 'node:assert/strict';
import { createExperimentRegistration, createBenchmarkUnit, assertBenchmarkUnit } from '@exharness/benchmark';
import { registrationInput, unitInput, sha } from './fixtures.js';

const registration = createExperimentRegistration(registrationInput());

test('unit binds fixed factors into an immutable digest', () => {
  const unit = createBenchmarkUnit(unitInput('UNIT-A'), { registration });
  assert.equal(unit.kind, 'BENCHMARK_UNIT_V1');
  assert.match(unit.fixedFactorDigest, /^sha256:/);
  assert.match(unit.unitDigest, /^sha256:/);
  assert.ok(Object.isFrozen(unit.task));
  assert.equal(assertBenchmarkUnit(unit, { registration }), unit);
});

test('fixed-factor drift is rejected, never rewritten', () => {
  const unit = createBenchmarkUnit(unitInput('UNIT-A'), { registration });
  for (const [path, value] of [['task.bundleDigest', sha('changed-bundle')], ['instructionDigest', sha('changed')], ['environmentIdentity', 'docker:other'], ['arm', 'TREATMENT'], ['repeatIndex', 1]]) {
    const drifted = JSON.parse(JSON.stringify(unit));
    const keys = path.split('.');
    keys.slice(0, -1).reduce((node, key) => node[key], drifted)[keys.at(-1)] = value;
    assert.throws(() => assertBenchmarkUnit(drifted), /FIXED_FACTOR_DRIFT/, path);
  }
});

test('units must be preregistered by their experiment', () => {
  assert.throws(() => createBenchmarkUnit(unitInput('UNIT-Z'), { registration }), /UNREGISTERED_UNIT/);
  assert.throws(() => createBenchmarkUnit(unitInput('UNIT-A', { experimentId: 'EXP-OTHER' }), { registration }), /belongs to EXP-OTHER/);
  assert.throws(() => createBenchmarkUnit({ ...unitInput('UNIT-A'), fixedFactorDigest: sha('x') }, { registration }), /computed/);
});
