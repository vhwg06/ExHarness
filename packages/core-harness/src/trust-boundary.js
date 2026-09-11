import { defineTrustPolicy, evaluateAttestationTrust } from "./trust.js";

export const BoundaryTrustReasonCode = Object.freeze({
  UNVERIFIED_EVALUATOR_AUTHORITY: "UNVERIFIED_EVALUATOR_AUTHORITY",
  UNVERIFIED_EVIDENCE_AUTHORITY: "UNVERIFIED_EVIDENCE_AUTHORITY"
});

function evaluatorAuthorityRequired(policy) {
  return policy.acceptedEvaluators.length > 0 || policy.requiredEvaluatorRoles.length > 0;
}

function evidenceAuthorityRequired(policy) {
  return policy.acceptedEvidenceProducers.length > 0 ||
    policy.acceptedEvidenceEnvironmentDigests.length > 0 ||
    policy.requiredEvidenceProducerRoles.length > 0 ||
    policy.requireIndependentEvidenceProducers;
}

export async function evaluateTrustBoundary({
  attestation,
  decision = null,
  evidence = [],
  currentSubject,
  policy = {},
  verifySignature = null,
  verifyEvaluatorAuthority = null,
  verifyEvidenceAuthority = null,
  now
}) {
  const resolvedPolicy = defineTrustPolicy(policy);
  const local = await evaluateAttestationTrust({
    attestation,
    decision,
    evidence,
    currentSubject,
    policy: resolvedPolicy,
    verifySignature,
    now
  });
  const reasons = [...local.reasons];

  if (evaluatorAuthorityRequired(resolvedPolicy)) {
    let verified = false;
    if (decision && typeof verifyEvaluatorAuthority === "function") {
      verified = await verifyEvaluatorAuthority({
        evaluator: decision.evaluator,
        decision,
        attestation,
        currentSubject,
        policy: resolvedPolicy
      }) === true;
    }
    if (!verified) {
      reasons.push(Object.freeze({
        code: BoundaryTrustReasonCode.UNVERIFIED_EVALUATOR_AUTHORITY,
        evaluator: decision?.evaluator?.identity ?? null,
        detail: typeof verifyEvaluatorAuthority === "function"
          ? "evaluator authority verification failed"
          : "evaluator authority verifier unavailable"
      }));
    }
  }

  if (evidenceAuthorityRequired(resolvedPolicy)) {
    for (const artifact of evidence) {
      let verified = false;
      if (typeof verifyEvidenceAuthority === "function") {
        verified = await verifyEvidenceAuthority({
          producer: artifact.producer,
          environment: artifact.environment,
          evidence: artifact,
          attestation,
          currentSubject,
          policy: resolvedPolicy
        }) === true;
      }
      if (!verified) {
        reasons.push(Object.freeze({
          code: BoundaryTrustReasonCode.UNVERIFIED_EVIDENCE_AUTHORITY,
          evidenceId: artifact.id ?? null,
          producer: artifact.producer?.identity ?? null,
          detail: typeof verifyEvidenceAuthority === "function"
            ? "evidence authority verification failed"
            : "evidence authority verifier unavailable"
        }));
      }
    }
  }

  return Object.freeze({
    trusted: reasons.length === 0,
    reasons: Object.freeze(reasons),
    local,
    attestation: Object.freeze({
      id: attestation.id,
      digest: attestation.digest,
      boundary: attestation.boundary
    }),
    boundary: attestation.boundary,
    subject: local.subject,
    issuer: local.issuer,
    decision: local.decision
  });
}
