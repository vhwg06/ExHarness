// EXPERIMENT_REGISTRATION_V1: immutable, digest-bound experiment identity.
import {
  CONTRACT_KINDS, fail, seal, verifySeal, clone, requireExactKeys, requireId, requireString, requireDigest,
  requireTimestamp, requireObject
} from './contracts.js';

const FIELDS = ['kind', 'experimentId', 'protocol', 'sourceIdentity', 'workloadManifest', 'environmentIdentity', 'producerProfile',
  'resourceBudget', 'artifactPolicy', 'evaluatorIdentity', 'resetPolicy', 'unitIds', 'createdAt'];

function validateBody(value) {
  requireExactKeys(value, 'registration', [...FIELDS, 'registrationDigest'].filter(key => key !== 'registrationDigest'), ['registrationDigest']);
  if (value.kind !== CONTRACT_KINDS.EXPERIMENT_REGISTRATION) fail('SCHEMA', `registration.kind must be ${CONTRACT_KINDS.EXPERIMENT_REGISTRATION}`);
  requireId(value.experimentId, 'registration.experimentId');
  requireExactKeys(value.protocol, 'registration.protocol', ['id', 'version', 'hash']);
  requireId(value.protocol.id, 'registration.protocol.id');
  requireString(value.protocol.version, 'registration.protocol.version');
  requireDigest(value.protocol.hash, 'registration.protocol.hash');
  requireString(value.sourceIdentity, 'registration.sourceIdentity');
  requireExactKeys(value.workloadManifest, 'registration.workloadManifest', ['ref', 'digest']);
  requireString(value.workloadManifest.ref, 'registration.workloadManifest.ref');
  requireDigest(value.workloadManifest.digest, 'registration.workloadManifest.digest');
  requireString(value.environmentIdentity, 'registration.environmentIdentity');
  requireExactKeys(value.producerProfile, 'registration.producerProfile', ['id', 'hash']);
  requireId(value.producerProfile.id, 'registration.producerProfile.id');
  requireDigest(value.producerProfile.hash, 'registration.producerProfile.hash');
  requireExactKeys(value.resourceBudget, 'registration.resourceBudget', ['id', 'hash']);
  requireId(value.resourceBudget.id, 'registration.resourceBudget.id');
  requireDigest(value.resourceBudget.hash, 'registration.resourceBudget.hash');
  requireObject(value.artifactPolicy, 'registration.artifactPolicy');
  requireString(value.evaluatorIdentity, 'registration.evaluatorIdentity');
  requireObject(value.resetPolicy, 'registration.resetPolicy');
  if (!Array.isArray(value.unitIds) || value.unitIds.length === 0) fail('SCHEMA', 'registration.unitIds must be a non-empty array');
  value.unitIds.forEach((id, index) => requireId(id, `registration.unitIds[${index}]`));
  if (new Set(value.unitIds).size !== value.unitIds.length) fail('IDENTITY', 'registration.unitIds must be unique');
  requireTimestamp(value.createdAt, 'registration.createdAt');
}

export function createExperimentRegistration(input) {
  const body = { kind: CONTRACT_KINDS.EXPERIMENT_REGISTRATION, ...clone(input) };
  if ('registrationDigest' in body) fail('IDENTITY', 'registrationDigest is computed, not supplied');
  validateBody(body);
  return seal(body, 'registrationDigest');
}

export function assertExperimentRegistration(value) {
  validateBody(value);
  requireDigest(value.registrationDigest, 'registration.registrationDigest');
  verifySeal(value, 'registrationDigest', 'IDENTITY_DRIFT');
  return value;
}
