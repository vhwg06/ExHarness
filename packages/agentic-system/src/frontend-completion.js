import { FrontendEvidenceClaim, FrontendWorkResultSchema, FrontendWorkStatus } from "./frontend-contracts.js";
import { buildEvidenceClaimState, validateApplicationEvidenceArtifact } from "./evidence.js";

// Frontend completion: acceptance requires grounded frontend.mutation, frontend.typecheck
// and frontend.tests evidence. It reads no Backend completion or session state.
function invariant(condition, message) { if (!condition) throw new TypeError(message); }

export const FrontendCompletionAction = Object.freeze({ ACCEPT: "ACCEPT", CONTINUE: "CONTINUE", BLOCK: "BLOCK", FAIL: "FAIL" });
export const FrontendCompletionReason = Object.freeze({
  ACCEPTED: "ACCEPTED", RESULT_BLOCKED: "RESULT_BLOCKED", RESULT_FAILED: "RESULT_FAILED", MISSING_ARTIFACTS: "MISSING_ARTIFACTS",
  INVALID_EVIDENCE: "INVALID_EVIDENCE", MISSING_EVIDENCE: "MISSING_EVIDENCE", FAILED_EVIDENCE: "FAILED_EVIDENCE",
  INCONCLUSIVE_EVIDENCE: "INCONCLUSIVE_EVIDENCE", UNRESOLVED_GAPS: "UNRESOLVED_GAPS"
});
export const FRONTEND_REQUIRED_EVIDENCE_CLAIMS = Object.freeze([FrontendEvidenceClaim.MUTATION, FrontendEvidenceClaim.TYPECHECK, FrontendEvidenceClaim.TESTS]);

export function defineFrontendCompletionPolicy({ requiredEvidenceClaims = FRONTEND_REQUIRED_EVIDENCE_CLAIMS, requireArtifacts = true } = {}) {
  invariant(Array.isArray(requiredEvidenceClaims), "FrontendCompletionPolicy.requiredEvidenceClaims must be an array");
  const claims = [...new Set(requiredEvidenceClaims.map((claim) => { invariant(typeof claim === "string" && claim.length > 0, "Frontend evidence claim must be a non-empty string"); return claim; }))];
  for (const required of FRONTEND_REQUIRED_EVIDENCE_CLAIMS) invariant(claims.includes(required), `FrontendCompletionPolicy must require ${required}`);
  return Object.freeze({ requiredEvidenceClaims: Object.freeze(claims), requireArtifacts: requireArtifacts !== false });
}

export function assessFrontendCompletion(rawResult, { policy = defineFrontendCompletionPolicy() } = {}) {
  const result = FrontendWorkResultSchema.parse(rawResult);
  const resolved = defineFrontendCompletionPolicy(policy);
  let evidence = [], invalidEvidence = null;
  try { evidence = result.evidence.map((artifact) => validateApplicationEvidenceArtifact(artifact, { label: "Frontend evidence" })); }
  catch (error) { invalidEvidence = error; }
  const state = invalidEvidence ? { missing: [], failed: [], inconclusive: [], claims: [] } : buildEvidenceClaimState(evidence, resolved.requiredEvidenceClaims);
  let action; const reasons = [];
  if (result.status === FrontendWorkStatus.BLOCKED) { action = FrontendCompletionAction.BLOCK; reasons.push(FrontendCompletionReason.RESULT_BLOCKED); }
  else if (result.status === FrontendWorkStatus.FAILED) { action = FrontendCompletionAction.FAIL; reasons.push(FrontendCompletionReason.RESULT_FAILED); }
  else if (invalidEvidence) { action = FrontendCompletionAction.FAIL; reasons.push(FrontendCompletionReason.INVALID_EVIDENCE); }
  else if (resolved.requireArtifacts && result.artifacts.length === 0) { action = FrontendCompletionAction.CONTINUE; reasons.push(FrontendCompletionReason.MISSING_ARTIFACTS); }
  else if (state.failed.length > 0) { action = FrontendCompletionAction.FAIL; reasons.push(FrontendCompletionReason.FAILED_EVIDENCE); }
  else if (state.missing.length > 0) { action = FrontendCompletionAction.CONTINUE; reasons.push(FrontendCompletionReason.MISSING_EVIDENCE); }
  else if (state.inconclusive.length > 0) { action = FrontendCompletionAction.CONTINUE; reasons.push(FrontendCompletionReason.INCONCLUSIVE_EVIDENCE); }
  else if (result.gaps.length > 0) { action = FrontendCompletionAction.CONTINUE; reasons.push(FrontendCompletionReason.UNRESOLVED_GAPS); }
  else { action = FrontendCompletionAction.ACCEPT; reasons.push(FrontendCompletionReason.ACCEPTED); }
  return Object.freeze({
    action,
    reasons: Object.freeze(reasons),
    missingEvidenceClaims: Object.freeze([...state.missing]),
    failedEvidenceClaims: Object.freeze([...state.failed]),
    inconclusiveEvidenceClaims: Object.freeze([...state.inconclusive]),
    evidenceIds: Object.freeze(evidence.map((artifact) => artifact.id)),
    invalidEvidence: invalidEvidence?.message ?? null
  });
}
