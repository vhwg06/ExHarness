import test from 'node:test';
import assert from 'node:assert/strict';
import { createExperimentRegistration, assertExperimentRegistration } from '@exharness/benchmark';
import { registrationInput, sha } from './fixtures.js';

test('registration is digest-bound, deterministic and deeply frozen', () => {
  const a = createExperimentRegistration(registrationInput());
  const b = createExperimentRegistration(registrationInput());
  assert.equal(a.kind, 'EXPERIMENT_REGISTRATION_V1');
  assert.match(a.registrationDigest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(a.registrationDigest, b.registrationDigest);
  assert.ok(Object.isFrozen(a) && Object.isFrozen(a.protocol) && Object.isFrozen(a.unitIds));
  assert.throws(() => { a.protocol.hash = sha('other'); });
  assert.equal(assertExperimentRegistration(a), a);
});

test('any change to a bound registration field changes identity and fails assertion', () => {
  const a = createExperimentRegistration(registrationInput());
  const drifted = { ...JSON.parse(JSON.stringify(a)), evaluatorIdentity: 'other-verifier@2' };
  assert.throws(() => assertExperimentRegistration(drifted), /IDENTITY_DRIFT/);
  assert.notEqual(createExperimentRegistration(registrationInput({ evaluatorIdentity: 'other-verifier@2' })).registrationDigest, a.registrationDigest);
});

test('registration rejects missing, extra, duplicate and supplied-digest fields', () => {
  const { resetPolicy, ...missing } = registrationInput();
  assert.throws(() => createExperimentRegistration(missing), /resetPolicy is required/);
  assert.throws(() => createExperimentRegistration({ ...registrationInput(), winner: 'A' }), /winner is not part of the contract/);
  assert.throws(() => createExperimentRegistration(registrationInput({ unitIds: ['U', 'U'] })), /unique/);
  assert.throws(() => createExperimentRegistration({ ...registrationInput(), registrationDigest: sha('x') }), /computed/);
  assert.throws(() => createExperimentRegistration(registrationInput({ protocol: { id: 'P', version: '1', hash: 'md5:x' } })), /sha256/);
});
