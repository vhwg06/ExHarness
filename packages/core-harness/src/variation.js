import { invariant } from "./contracts.js";

export const VariationStatus = Object.freeze({
  RUNNING: "RUNNING",
  COMPLETED: "COMPLETED"
});

export const VariationOutcome = Object.freeze({
  COMMITTED: "COMMITTED",
  CANDIDATE_CHANGED: "CANDIDATE_CHANGED",
  EVIDENCE_ADDED: "EVIDENCE_ADDED",
  NO_CHANGE: "NO_CHANGE"
});

export const VariationTermination = Object.freeze({
  RETURNED: "RETURNED",
  BUDGET_EXHAUSTED: "BUDGET_EXHAUSTED",
  FAILED: "FAILED"
});

export const AgentRunErrorCode = Object.freeze({
  CAPABILITY_BUDGET_EXHAUSTED: "CAPABILITY_BUDGET_EXHAUSTED"
});

export class CapabilityBudgetExceededError extends Error {
  constructor({ maxCapabilityCalls, attemptedCapability }) {
    super(`variation capability budget exhausted after ${maxCapabilityCalls} calls`);
    this.name = "CapabilityBudgetExceededError";
    this.code = AgentRunErrorCode.CAPABILITY_BUDGET_EXHAUSTED;
    this.maxCapabilityCalls = maxCapabilityCalls;
    this.attemptedCapability = attemptedCapability ?? null;
  }
}

export function defineVariationPolicy({ maxCapabilityCalls = 64 } = {}) {
  invariant(
    Number.isInteger(maxCapabilityCalls) && maxCapabilityCalls > 0,
    "variation policy maxCapabilityCalls must be a positive integer"
  );

  return Object.freeze({ maxCapabilityCalls });
}

export function variationActivitySnapshot(state) {
  const memory = state.persistentMemory;
  return Object.freeze({
    candidate: structuredClone(state.currentCandidate),
    lineageCount: memory.lineage.length,
    implementationCount: memory.implementations.length,
    observationCount: memory.observations.length,
    verificationCount: memory.verifications.length,
    evaluationCount: memory.evaluations.length,
    knowledgeCount: memory.knowledge.length,
    failedDirectionCount: memory.knowledge.filter((item) => item.kind === "FAILED_DIRECTION").length,
    supervisorInterventionCount: state.supervision.interventions.length,
    trajectoryEventCount: state.trajectory.length
  });
}

export function variationActivityDelta(before, after) {
  return Object.freeze({
    candidateChanged:
      before.candidate.id !== after.candidate.id || before.candidate.version !== after.candidate.version,
    lineageAdvanced: after.lineageCount > before.lineageCount,
    implementationsAdded: after.implementationCount - before.implementationCount,
    observationsAdded: after.observationCount - before.observationCount,
    verificationsAdded: after.verificationCount - before.verificationCount,
    evaluationsAdded: after.evaluationCount - before.evaluationCount,
    knowledgeAdded: after.knowledgeCount - before.knowledgeCount,
    failedDirectionsAdded: after.failedDirectionCount - before.failedDirectionCount,
    supervisorInterventionsAdded: after.supervisorInterventionCount - before.supervisorInterventionCount,
    trajectoryEventsAdded: after.trajectoryEventCount - before.trajectoryEventCount
  });
}

export function classifyVariationOutcome(activity) {
  if (activity.lineageAdvanced) return VariationOutcome.COMMITTED;
  if (activity.candidateChanged) return VariationOutcome.CANDIDATE_CHANGED;

  const evidenceAdded =
    activity.observationsAdded > 0 ||
    activity.verificationsAdded > 0 ||
    activity.evaluationsAdded > 0 ||
    activity.knowledgeAdded > 0 ||
    activity.supervisorInterventionsAdded > 0;

  return evidenceAdded ? VariationOutcome.EVIDENCE_ADDED : VariationOutcome.NO_CHANGE;
}
