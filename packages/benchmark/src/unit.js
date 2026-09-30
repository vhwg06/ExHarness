// BENCHMARK_UNIT_V1: the preregistered comparison atom with an immutable fixed-factor digest.
import {
  CONTRACT_KINDS, fail, seal, verifySeal, clone, digestOf, requireExactKeys, requireId, requireString, requireDigest
} from './contracts.js';
import { assertExperimentRegistration } from './experiment.js';

const FIXED_FACTORS = ['experimentId', 'task', 'environmentIdentity', 'instructionDigest', 'producerProfile', 'repeatIndex', 'arm', 'budgetProfileHash'];

function validateBody(value) {
  requireExactKeys(value, 'unit', ['kind', 'unitId', ...FIXED_FACTORS, 'fixedFactorDigest'], ['unitDigest']);
  if (value.kind !== CONTRACT_KINDS.BENCHMARK_UNIT) fail('SCHEMA', `unit.kind must be ${CONTRACT_KINDS.BENCHMARK_UNIT}`);
  requireId(value.unitId, 'unit.unitId');
  requireId(value.experimentId, 'unit.experimentId');
  requireExactKeys(value.task, 'unit.task', ['id', 'bundleDigest']);
  requireString(value.task.id, 'unit.task.id');
  requireDigest(value.task.bundleDigest, 'unit.task.bundleDigest');
  requireString(value.environmentIdentity, 'unit.environmentIdentity');
  requireDigest(value.instructionDigest, 'unit.instructionDigest');
  requireId(value.producerProfile, 'unit.producerProfile');
  if (!Number.isInteger(value.repeatIndex) || value.repeatIndex < 0) fail('SCHEMA', 'unit.repeatIndex must be a non-negative integer');
  requireId(value.arm, 'unit.arm');
  requireDigest(value.budgetProfileHash, 'unit.budgetProfileHash');
  const expected = fixedFactorDigest(value);
  if (value.fixedFactorDigest !== expected) fail('FIXED_FACTOR_DRIFT', `unit ${value.unitId} fixed factors changed after registration`);
}

export function fixedFactorDigest(unit) {
  return digestOf(Object.fromEntries(FIXED_FACTORS.map(key => [key, unit[key]])));
}

export function createBenchmarkUnit(input, { registration } = {}) {
  assertExperimentRegistration(registration);
  const body = { kind: CONTRACT_KINDS.BENCHMARK_UNIT, ...clone(input) };
  if ('unitDigest' in body || 'fixedFactorDigest' in body) fail('IDENTITY', 'unit digests are computed, not supplied');
  body.fixedFactorDigest = fixedFactorDigest(body);
  validateBody(body);
  if (body.experimentId !== registration.experimentId) fail('IDENTITY', `unit ${body.unitId} belongs to ${body.experimentId}, not ${registration.experimentId}`);
  if (!registration.unitIds.includes(body.unitId)) fail('UNREGISTERED_UNIT', `unit ${body.unitId} is not preregistered by ${registration.experimentId}`);
  return seal(body, 'unitDigest');
}

export function assertBenchmarkUnit(value, { registration } = {}) {
  validateBody(value);
  requireDigest(value.unitDigest, 'unit.unitDigest');
  verifySeal(value, 'unitDigest', 'IDENTITY_DRIFT');
  if (registration) {
    assertExperimentRegistration(registration);
    if (value.experimentId !== registration.experimentId || !registration.unitIds.includes(value.unitId))
      fail('UNREGISTERED_UNIT', `unit ${value.unitId} is not preregistered by ${registration.experimentId}`);
  }
  return value;
}
