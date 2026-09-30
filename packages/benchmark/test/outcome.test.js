import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOutcome } from '@exharness/benchmark';
import { outcomeInput, EVALUATOR } from './fixtures.js';

const NOT_RUN = { verdict: 'NOT_RUN', identity: EVALUATOR, evidenceRef: null };
const pick = o => [o.quality.verdict, o.termination, o.providerStatus, o.infrastructureStatus];

test('producer SUCCESS with verifier FAIL is REJECTED/COMPLETED', () => {
  assert.deepEqual(pick(normalizeOutcome(outcomeInput({ evaluator: { verdict: 'FAIL', identity: EVALUATOR, evidenceRef: 'verifier/reward.txt' } }))), ['REJECTED', 'COMPLETED', 'NONE', 'NONE']);
});

test('a verified artifact after budget exhaustion is ACCEPTED with BUDGET_EXHAUSTED', () => {
  assert.deepEqual(pick(normalizeOutcome(outcomeInput({ producerStatus: 'BUDGET_STOP', termination: 'BUDGET_EXHAUSTED' }))), ['ACCEPTED', 'BUDGET_EXHAUSTED', 'NONE', 'NONE']);
});

test('provider timeout without an artifact is NOT_EVALUATED and can never be judged', () => {
  const base = { producerStatus: 'ERROR', termination: 'AGENT_ERROR', providerStatus: 'PROVIDER_TIMEOUT', candidate: { extractionStatus: 'NOT_PRODUCED', evaluable: false } };
  assert.deepEqual(pick(normalizeOutcome(outcomeInput({ ...base, evaluator: NOT_RUN }))), ['NOT_EVALUATED', 'AGENT_ERROR', 'PROVIDER_TIMEOUT', 'NONE']);
  assert.throws(() => normalizeOutcome(outcomeInput({ ...base, evaluator: { verdict: 'FAIL', identity: EVALUATOR, evidenceRef: 'v' } })), /OUTCOME_CONFLICT/);
  assert.throws(() => normalizeOutcome(outcomeInput({ ...base, candidate: { extractionStatus: 'NOT_PRODUCED', evaluable: true }, evaluator: { verdict: 'FAIL', identity: EVALUATOR, evidenceRef: 'v' } })), /PROVIDER_TIMEOUT without an evaluable artifact/);
  for (const status of ['RATE_LIMITED', 'PROVIDER_5XX']) assert.equal(normalizeOutcome(outcomeInput({ ...base, providerStatus: status, evaluator: NOT_RUN })).quality.verdict, 'NOT_EVALUATED');
});

test('verifier crash is NOT_EVALUATED + VERIFIER_ERROR, never REJECTED', () => {
  const outcome = normalizeOutcome(outcomeInput({ evaluator: { verdict: 'ERROR', identity: EVALUATOR, evidenceRef: 'verifier/stdout.txt' } }));
  assert.deepEqual(pick(outcome), ['NOT_EVALUATED', 'COMPLETED', 'NONE', 'VERIFIER_ERROR']);
  assert.throws(() => normalizeOutcome(outcomeInput({ infrastructureStatus: 'VERIFIER_ERROR' })), /VERIFIER_ERROR requires/);
});

test('artifact extraction failure is NOT_EVALUATED + ARTIFACT_EXTRACTION', () => {
  const outcome = normalizeOutcome(outcomeInput({ infrastructureStatus: 'ARTIFACT_EXTRACTION', candidate: { extractionStatus: 'FAILED', evaluable: false }, evaluator: NOT_RUN }));
  assert.deepEqual(pick(outcome), ['NOT_EVALUATED', 'COMPLETED', 'NONE', 'ARTIFACT_EXTRACTION']);
  assert.throws(() => normalizeOutcome(outcomeInput({ candidate: { extractionStatus: 'FAILED', evaluable: false }, evaluator: NOT_RUN })), /ARTIFACT_EXTRACTION/);
});

test('producer status and termination never synthesize quality', () => {
  for (const producerStatus of ['SUCCESS', 'ERROR', 'BUDGET_STOP', 'TIMEOUT']) {
    for (const termination of ['COMPLETED', 'BUDGET_EXHAUSTED', 'AGENT_TIMEOUT', 'AGENT_ERROR']) {
      assert.equal(normalizeOutcome(outcomeInput({ producerStatus, termination })).quality.verdict, 'ACCEPTED');
      assert.equal(normalizeOutcome(outcomeInput({ producerStatus, termination, evaluator: { verdict: 'FAIL', identity: EVALUATOR, evidenceRef: 'v' } })).quality.verdict, 'REJECTED');
    }
  }
  assert.throws(() => normalizeOutcome({ ...outcomeInput(), quality: 'ACCEPTED' }), /not part of the contract/);
  assert.throws(() => normalizeOutcome(outcomeInput({ termination: 'SUCCESS' })), /termination must be one of/);
});

test('an agent timeout with an evaluable workspace keeps verifier quality orthogonal', () => {
  assert.deepEqual(pick(normalizeOutcome(outcomeInput({ producerStatus: 'TIMEOUT', termination: 'AGENT_TIMEOUT', candidate: { extractionStatus: 'NOT_DECLARED', evaluable: true }, evaluator: { verdict: 'FAIL', identity: EVALUATOR, evidenceRef: 'v' } }))), ['REJECTED', 'AGENT_TIMEOUT', 'NONE', 'NONE']);
});
