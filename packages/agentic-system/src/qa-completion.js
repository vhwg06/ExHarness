import {
  TrustBoundary,
  createDecisionArtifact,
  policyRefFromValue,
  subjectFromValue
} from "../../core-harness/src/index.js";
import {
  buildEvidenceClaimState,
  validateApplicationEvidenceArtifact
} from "./evidence.js";
import {
  QaEvidenceClaim,
  QaWorkResultSchema,
  QaWorkStatus
} from "./qa-contracts.js";

function invariant(condition, message) {
  if (!condition) throw new TypeError(message);
}

export const QaCompletionAction = Object.freeze({
  ACCEPT: "ACCEPT",
  CONTINUE: "CONTINUE",
  BLOCK: "BLOCK",
  FAIL: "FAIL"
});

export const QaCompletionReason = Object.freeze({
  ACCEPTED: "ACCEPTED",
  ISSUES_FOUND: "ISSUES_FOUND",
  RESULT_BLOCKED: "RESULT_BLOCKED",
  RESULT_FAILED: "RESULT_FAILED",
  INVALID_EVIDENCE: "INVALID_EVIDENCE",
  MISSING_EVIDENCE: "MISSING_EVIDENCE",
  FAILED_EVIDENCE: "FAILED_EVIDENCE",
  INCONCLUSIVE_EVIDENCE: "INCONCLUSIVE_EVIDENCE"
});

const DEFAULT_REQUIRED_CLAIMS = Object.freeze([
  QaEvidenceClaim.BEHAVIOR,
  QaEvidenceClaim.REGRESSION
]);

export function defineQaCompletionPolicy({ requiredEvidenceClaims = DEFAULT_REQUIRED_CLAIMS } = {}) {
  invariant(Array.isArray(requiredEvidenceClaims), "QaCompletionPolicy.requiredEvidenceClaims must be an array");
  const claims = [...new Set(requiredEvidenceClaims.map((claim) => {
    invariant(typeof claim === "string" && claim.length > 0, "QaCompletionPolicy evidence claim must be a non-empty string");
    return claim;
  }))];
  return Object.freeze({ requiredEvidenceClaims: Object.freeze(claims) });
}

function completionSubject(result) {
  return subjectFromValue({
    status: result.status,
    verifiedRevision: result.verifiedRevision,
    inspectedArtifacts: result.inspectedArtifacts.map((artifact) => artifact.ref),
    issues: result.issues
  }, {
    type: "qa-work-result",
    producer: {
      identity: "qa-worker",
      roles: ["producer"]
    }
  });
}

export function assessQaCompletion(rawResult, { policy = defineQaCompletionPolicy(), generatedAt = new Date().toISOString() } = {}) {
  const result = QaWorkResultSchema.parse(rawResult);
  const resolvedPolicy = defineQaCompletionPolicy(policy);
  let evidence = [];
  let invalidEvidence = null;

  try {
    evidence = result.evidence.map((artifact) => validateApplicationEvidenceArtifact(artifact, { label: "QA evidence" }));
  } catch (error) {
    invalidEvidence = error;
  }

  const state = invalidEvidence
    ? Object.freeze({ missing: [], failed: [], inconclusive: [], claims: [] })
    : buildEvidenceClaimState(evidence, resolvedPolicy.requiredEvidenceClaims);

  let action;
  const reasons = [];

  if (result.status === QaWorkStatus.BLOCKED) {
    action = QaCompletionAction.BLOCK;
    reasons.push(QaCompletionReason.RESULT_BLOCKED);
  } else if (result.status === QaWorkStatus.FAILED) {
    action = QaCompletionAction.FAIL;
    reasons.push(QaCompletionReason.RESULT_FAILED);
  } else if (invalidEvidence) {
    action = QaCompletionAction.FAIL;
    reasons.push(QaCompletionReason.INVALID_EVIDENCE);
  } else if (result.status === QaWorkStatus.ISSUES_FOUND) {
    action = QaCompletionAction.CONTINUE;
    reasons.push(QaCompletionReason.ISSUES_FOUND);
  } else if (state.failed.length > 0) {
    action = QaCompletionAction.FAIL;
    reasons.push(QaCompletionReason.FAILED_EVIDENCE);
  } else if (state.missing.length > 0) {
    action = QaCompletionAction.CONTINUE;
    reasons.push(QaCompletionReason.MISSING_EVIDENCE);
  } else if (state.inconclusive.length > 0) {
    action = QaCompletionAction.CONTINUE;
    reasons.push(QaCompletionReason.INCONCLUSIVE_EVIDENCE);
  } else {
    action = QaCompletionAction.ACCEPT;
    reasons.push(QaCompletionReason.ACCEPTED);
  }

  const decision = createDecisionArtifact({
    subject: completionSubject(result),
    boundary: TrustBoundary.ACCEPTANCE,
    policy: policyRefFromValue("qa-completion-policy", resolvedPolicy, { version: "1" }),
    evaluator: {
      identity: "qa-completion-policy",
      version: "1",
      roles: ["evaluator"]
    },
    evidence,
    claims: state.claims,
    unresolved: [
      ...state.missing.map((claim) => ({ type: "MISSING_EVIDENCE", claim })),
      ...state.inconclusive.map((claim) => ({ type: "INCONCLUSIVE_EVIDENCE", claim })),
      ...result.issues.map((issue) => ({ type: "QA_ISSUE", issue }))
    ],
    verdict: action,
    generatedAt,
    metadata: {
      qaStatus: result.status,
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
