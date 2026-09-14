import {
  TrustBoundary,
  createDecisionArtifact,
  policyRefFromValue,
  subjectFromValue
} from "../../core-harness/src/index.js";
import {
  BackendEvidenceClaim,
  BackendWorkResultSchema,
  BackendWorkStatus
} from "./contracts.js";
import {
  buildEvidenceClaimState,
  validateApplicationEvidenceArtifact
} from "./evidence.js";

function invariant(condition, message) {
  if (!condition) throw new TypeError(message);
}

export const BackendCompletionAction = Object.freeze({
  ACCEPT: "ACCEPT",
  CONTINUE: "CONTINUE",
  BLOCK: "BLOCK",
  FAIL: "FAIL"
});

export const BackendCompletionReason = Object.freeze({
  ACCEPTED: "ACCEPTED",
  RESULT_BLOCKED: "RESULT_BLOCKED",
  RESULT_FAILED: "RESULT_FAILED",
  MISSING_ARTIFACTS: "MISSING_ARTIFACTS",
  INVALID_EVIDENCE: "INVALID_EVIDENCE",
  MISSING_EVIDENCE: "MISSING_EVIDENCE",
  FAILED_EVIDENCE: "FAILED_EVIDENCE",
  INCONCLUSIVE_EVIDENCE: "INCONCLUSIVE_EVIDENCE",
  UNRESOLVED_GAPS: "UNRESOLVED_GAPS"
});

const DEFAULT_REQUIRED_CLAIMS = Object.freeze([
  BackendEvidenceClaim.MUTATION,
  BackendEvidenceClaim.TYPECHECK,
  BackendEvidenceClaim.TESTS
]);

export function defineBackendCompletionPolicy({
  requiredEvidenceClaims = DEFAULT_REQUIRED_CLAIMS,
  requireArtifacts = true
} = {}) {
  invariant(Array.isArray(requiredEvidenceClaims), "BackendCompletionPolicy.requiredEvidenceClaims must be an array");
  const claims = [...new Set(requiredEvidenceClaims.map((claim) => {
    invariant(typeof claim === "string" && claim.length > 0, "BackendCompletionPolicy evidence claim must be a non-empty string");
    return claim;
  }))];
  return Object.freeze({
    requiredEvidenceClaims: Object.freeze(claims),
    requireArtifacts: requireArtifacts !== false
  });
}

function completionSubject(result) {
  return subjectFromValue({
    status: result.status,
    revision: result.revision,
    artifacts: result.artifacts.map((artifact) => artifact.ref)
  }, {
    type: "backend-work-result",
    producer: {
      identity: "backend-worker",
      roles: ["producer"]
    }
  });
}

export function assessBackendCompletion(rawResult, { policy = defineBackendCompletionPolicy(), generatedAt = new Date().toISOString() } = {}) {
  const result = BackendWorkResultSchema.parse(rawResult);
  const resolvedPolicy = defineBackendCompletionPolicy(policy);
  let evidence = [];
  let invalidEvidence = null;

  try {
    evidence = result.evidence.map((artifact) => validateApplicationEvidenceArtifact(artifact, { label: "Backend evidence" }));
  } catch (error) {
    invalidEvidence = error;
  }

  const state = invalidEvidence
    ? Object.freeze({ missing: [], failed: [], inconclusive: [], claims: [] })
    : buildEvidenceClaimState(evidence, resolvedPolicy.requiredEvidenceClaims);

  let action;
  const reasons = [];

  if (result.status === BackendWorkStatus.BLOCKED) {
    action = BackendCompletionAction.BLOCK;
    reasons.push(BackendCompletionReason.RESULT_BLOCKED);
  } else if (result.status === BackendWorkStatus.FAILED) {
    action = BackendCompletionAction.FAIL;
    reasons.push(BackendCompletionReason.RESULT_FAILED);
  } else if (invalidEvidence) {
    action = BackendCompletionAction.FAIL;
    reasons.push(BackendCompletionReason.INVALID_EVIDENCE);
  } else if (resolvedPolicy.requireArtifacts && result.artifacts.length === 0) {
    action = BackendCompletionAction.CONTINUE;
    reasons.push(BackendCompletionReason.MISSING_ARTIFACTS);
  } else if (state.failed.length > 0) {
    action = BackendCompletionAction.FAIL;
    reasons.push(BackendCompletionReason.FAILED_EVIDENCE);
  } else if (state.missing.length > 0) {
    action = BackendCompletionAction.CONTINUE;
    reasons.push(BackendCompletionReason.MISSING_EVIDENCE);
  } else if (state.inconclusive.length > 0) {
    action = BackendCompletionAction.CONTINUE;
    reasons.push(BackendCompletionReason.INCONCLUSIVE_EVIDENCE);
  } else if (result.gaps.length > 0) {
    action = BackendCompletionAction.CONTINUE;
    reasons.push(BackendCompletionReason.UNRESOLVED_GAPS);
  } else {
    action = BackendCompletionAction.ACCEPT;
    reasons.push(BackendCompletionReason.ACCEPTED);
  }

  const subject = completionSubject(result);
  const decision = createDecisionArtifact({
    subject,
    boundary: TrustBoundary.ACCEPTANCE,
    policy: policyRefFromValue("backend-completion-policy", resolvedPolicy, { version: "1" }),
    evaluator: {
      identity: "backend-completion-policy",
      version: "1",
      roles: ["evaluator"]
    },
    evidence,
    claims: state.claims,
    unresolved: [
      ...state.missing.map((claim) => ({ type: "MISSING_EVIDENCE", claim })),
      ...state.inconclusive.map((claim) => ({ type: "INCONCLUSIVE_EVIDENCE", claim })),
      ...result.gaps.map((gap) => ({ type: "BACKEND_GAP", gapId: gap.id, summary: gap.summary }))
    ],
    verdict: action,
    generatedAt,
    metadata: {
      backendStatus: result.status,
      reasons
    }
  });

  return Object.freeze({
    action,
    reasons: Object.freeze(reasons),
    missingEvidenceClaims: state.missing,
    failedEvidenceClaims: state.failed,
    inconclusiveEvidenceClaims: state.inconclusive,
    invalidEvidence: invalidEvidence?.message ?? null,
    decision
  });
}
