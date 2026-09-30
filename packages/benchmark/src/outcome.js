// Orthogonal outcome normalization. Quality comes only from the independent evaluator verdict;
// termination, provider and infrastructure state are recorded beside it and never synthesize quality.
import { OUTCOME_ENUMS, PROVIDER_FAILURES, fail, requireExactKeys, requireEnum, requireString, requireNullableString } from './contracts.js';

const QUALITY_BY_VERDICT = Object.freeze({ PASS: 'ACCEPTED', FAIL: 'REJECTED', ERROR: 'NOT_EVALUATED', NOT_RUN: 'NOT_EVALUATED' });

export function normalizeOutcome(input) {
  requireExactKeys(input, 'outcome', ['producerStatus', 'termination', 'providerStatus', 'infrastructureStatus', 'candidate', 'evaluator']);
  requireString(input.producerStatus, 'outcome.producerStatus');
  const termination = requireEnum(input.termination, 'outcome.termination', OUTCOME_ENUMS.termination);
  const providerStatus = requireEnum(input.providerStatus, 'outcome.providerStatus', OUTCOME_ENUMS.providerStatus);
  let infrastructureStatus = requireEnum(input.infrastructureStatus, 'outcome.infrastructureStatus', OUTCOME_ENUMS.infrastructureStatus);
  requireExactKeys(input.candidate, 'outcome.candidate', ['extractionStatus', 'evaluable']);
  const extractionStatus = requireEnum(input.candidate.extractionStatus, 'outcome.candidate.extractionStatus', OUTCOME_ENUMS.extractionStatus);
  if (typeof input.candidate.evaluable !== 'boolean') fail('SCHEMA', 'outcome.candidate.evaluable must be boolean');
  requireExactKeys(input.evaluator, 'outcome.evaluator', ['verdict', 'identity', 'evidenceRef']);
  const verdict = requireEnum(input.evaluator.verdict, 'outcome.evaluator.verdict', OUTCOME_ENUMS.evaluatorVerdict);
  requireString(input.evaluator.identity, 'outcome.evaluator.identity');
  requireNullableString(input.evaluator.evidenceRef, 'outcome.evaluator.evidenceRef');

  if (extractionStatus === 'FAILED') {
    if (infrastructureStatus !== 'ARTIFACT_EXTRACTION') fail('OUTCOME_CONFLICT', 'a failed artifact extraction must be reported as ARTIFACT_EXTRACTION');
    if (input.candidate.evaluable) fail('OUTCOME_CONFLICT', 'a candidate whose extraction failed is not evaluable');
  }
  if (PROVIDER_FAILURES.includes(providerStatus) && extractionStatus !== 'EXTRACTED' && extractionStatus !== 'NOT_DECLARED' && input.candidate.evaluable)
    fail('OUTCOME_CONFLICT', `${providerStatus} without an evaluable artifact cannot be evaluated`);
  if (!input.candidate.evaluable && verdict !== 'NOT_RUN') fail('OUTCOME_CONFLICT', 'the evaluator cannot judge a candidate that is not evaluable');
  if ((verdict === 'PASS' || verdict === 'FAIL') && input.evaluator.evidenceRef === null) fail('OUTCOME_CONFLICT', 'an evaluator verdict needs its evidence ref');
  if (verdict === 'ERROR') {
    if (infrastructureStatus !== 'NONE' && infrastructureStatus !== 'VERIFIER_ERROR') fail('OUTCOME_CONFLICT', `verifier error conflicts with ${infrastructureStatus}`);
    infrastructureStatus = 'VERIFIER_ERROR';
  } else if (infrastructureStatus === 'VERIFIER_ERROR') {
    fail('OUTCOME_CONFLICT', 'VERIFIER_ERROR requires evaluator verdict ERROR');
  }
  return Object.freeze({
    quality: Object.freeze({ verdict: QUALITY_BY_VERDICT[verdict], evaluatorIdentity: input.evaluator.identity, evidenceRef: input.evaluator.evidenceRef }),
    termination,
    providerStatus,
    infrastructureStatus
  });
}
