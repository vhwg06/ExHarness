import {
  ResearchContinuationKind,
  ResearchEvidenceFreshness,
  ResearchEvidenceStatus,
  ResearchExperimentStatus,
  assessResearchEvidenceFreshness,
  createResearchContinuationController as createBaseResearchContinuationController,
  defineResearchContinuationManifest,
  defineResearchEvidenceLedger,
  defineResearchExperimentState
} from "./research-continuation-base.js";
import {
  BlackboardStatus,
  ReviewRequirementSource
} from "./blackboard-orchestrator.js";
import { sessionHandoffFromBlackboard } from "./session-handoff.js";

export {
  ResearchContinuationKind,
  ResearchEvidenceFreshness,
  ResearchEvidenceStatus,
  ResearchExperimentStatus,
  assessResearchEvidenceFreshness,
  defineResearchContinuationManifest,
  defineResearchEvidenceLedger,
  defineResearchExperimentState
};

function invariant(condition, message) {
  if (!condition) throw new TypeError(message);
}

function requireText(value, name) {
  invariant(typeof value === "string" && value.trim().length > 0, `${name} must be a non-empty string`);
  return value;
}

function requirePositiveInteger(value, name) {
  invariant(Number.isInteger(value) && value > 0, `${name} must be a positive integer`);
  return value;
}

function uniqueTextArray(value, name) {
  invariant(Array.isArray(value ?? []), `${name} must be an array`);
  const result = (value ?? []).map((entry, index) => requireText(entry, `${name}[${index}]`));
  invariant(new Set(result).size === result.length, `${name} must not contain duplicates`);
  return result;
}

function freezeClone(value) {
  return Object.freeze(structuredClone(value));
}

function workFromSession(session, itemId) {
  const item = session.workGraph.find((candidate) => candidate.id === itemId);
  invariant(item, `research continuation item not found: ${itemId}`);
  return item;
}

function requiredManifestArtifactRefs(manifest) {
  return [
    manifest.questionRef,
    manifest.planRef,
    ...manifest.experimentRefs,
    manifest.evidenceLedgerRef
  ];
}

export function createResearchContinuationController({ orchestrator, projectId, artifactReader }) {
  invariant(
    orchestrator &&
      typeof orchestrator.readBlackboard === "function" &&
      typeof orchestrator.submitWithRequiredReviews === "function",
    "research continuation requires an ApplicationOrchestrator with atomic submitWithRequiredReviews()"
  );
  const expectedProjectId = requireText(projectId, "projectId");
  const base = createBaseResearchContinuationController({ orchestrator, projectId: expectedProjectId, artifactReader });

  async function submitProposal({
    itemId,
    owner,
    generation,
    resultRef,
    currentRevision,
    changedSourceScopes = null,
    changedPolicyScopes = null,
    resolvedWork = [],
    reviewKey = "research-workflow",
    reviewReason
  }) {
    const normalizedItemId = requireText(itemId, "itemId");
    const normalizedOwner = requireText(owner, "owner");
    const normalizedGeneration = requirePositiveInteger(generation, "generation");
    const normalizedResultRef = requireText(resultRef, "resultRef");
    const key = requireText(reviewKey, "reviewKey");
    const reason = requireText(reviewReason, "reviewReason");

    const continuation = await base.resume({
      itemId: normalizedItemId,
      currentRevision,
      changedSourceScopes,
      changedPolicyScopes
    });
    invariant(continuation.resumeExperiment == null, "research continuation cannot submit while an experiment remains active");
    invariant(
      continuation.reassessmentEvidenceIds.length === 0,
      `research continuation cannot submit with evidence awaiting freshness reassessment: ${continuation.reassessmentEvidenceIds.join(", ")}`
    );
    invariant(!continuation.revisionChanged, "research continuation must persist the current source/policy revision before submission");

    const artifactRefs = [...new Set([
      ...requiredManifestArtifactRefs(continuation.manifest),
      normalizedResultRef
    ])];

    const submitted = await orchestrator.submitWithRequiredReviews({
      itemId: normalizedItemId,
      owner: normalizedOwner,
      generation: normalizedGeneration,
      submission: {
        resultRef: normalizedResultRef,
        artifactRefs,
        evidenceRefs: [continuation.manifest.evidenceLedgerRef],
        decisionStatus: "PROPOSED",
        researchId: continuation.manifest.researchId,
        sourceRevision: continuation.manifest.sourceRevision,
        policyRevision: continuation.manifest.policyRevision
      },
      resolvedWork: uniqueTextArray(resolvedWork, "resolvedWork"),
      reviewRequirements: [{
        key,
        source: ReviewRequirementSource.PM,
        reason
      }]
    });

    const session = sessionHandoffFromBlackboard(await orchestrator.readBlackboard(), {
      projectId: expectedProjectId
    });
    const finalItem = workFromSession(session, normalizedItemId);
    invariant(finalItem.status === BlackboardStatus.PENDING_REVIEW, "research proposal must remain PENDING_REVIEW after submission");
    const requirement = finalItem.reviewRequirements.find((candidate) => candidate.key === key) ?? null;
    invariant(requirement != null, `research proposal must atomically persist review requirement ${key}`);
    invariant(requirement.source === ReviewRequirementSource.PM, `research review requirement ${key} must be PM-sourced`);
    invariant(requirement.reason === reason, `research review requirement ${key} reason changed`);

    return freezeClone({ submitted: submitted.result, item: finalItem });
  }

  return Object.freeze({
    ...base,
    submitProposal
  });
}
