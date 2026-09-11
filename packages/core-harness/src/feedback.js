import { candidateKey, invariant, requireText } from "./contracts.js";

export const FeedbackKind = Object.freeze({
  ACTION_RESULT: "ACTION_RESULT",
  OBSERVATION: "OBSERVATION",
  VERIFICATION: "VERIFICATION",
  EVALUATION: "EVALUATION",
  VARIATION_RESULT: "VARIATION_RESULT"
});

function feedbackId(kind, sourceId) {
  return `${kind.toLowerCase()}:${sourceId}`;
}

function freezeFeedback({ kind, sourceId, at, candidate, value }) {
  return Object.freeze({
    id: feedbackId(kind, sourceId),
    kind,
    sourceId,
    at,
    candidate: structuredClone(candidate ?? null),
    value: structuredClone(value ?? null)
  });
}

export function collectFeedback(state) {
  const feedback = [];

  for (const observation of state.persistentMemory.observations) {
    feedback.push(freezeFeedback({
      kind: FeedbackKind.OBSERVATION,
      sourceId: observation.id,
      at: observation.at,
      candidate: observation.candidate,
      value: {
        request: observation.request,
        observation: observation.value
      }
    }));
  }

  for (const verification of state.persistentMemory.verifications ?? []) {
    feedback.push(freezeFeedback({
      kind: FeedbackKind.VERIFICATION,
      sourceId: verification.id,
      at: verification.at,
      candidate: verification.candidate,
      value: {
        claim: verification.claim,
        status: verification.status,
        source: verification.source,
        evidence: verification.evidence
      }
    }));
  }

  for (const evaluation of state.persistentMemory.evaluations) {
    feedback.push(freezeFeedback({
      kind: FeedbackKind.EVALUATION,
      sourceId: evaluation.id,
      at: evaluation.at,
      candidate: evaluation.candidate,
      value: {
        validity: evaluation.validity,
        verdict: evaluation.verdict,
        findings: evaluation.findings,
        evidence: evaluation.evidence,
        metadata: evaluation.metadata
      }
    }));
  }

  for (const variation of state.persistentMemory.variations ?? []) {
    if (variation.status !== "COMPLETED") continue;
    feedback.push(freezeFeedback({
      kind: FeedbackKind.VARIATION_RESULT,
      sourceId: variation.id,
      at: variation.completedAt,
      candidate: variation.endSnapshot?.candidate ?? variation.baseCandidate,
      value: {
        outcome: variation.outcome,
        termination: variation.termination,
        activity: variation.activity,
        failure: variation.failure
      }
    }));
  }

  for (const item of state.trajectory) {
    if (item.type !== "ACTED") continue;
    feedback.push(freezeFeedback({
      kind: FeedbackKind.ACTION_RESULT,
      sourceId: item.id,
      at: item.at,
      candidate: item.after ?? item.candidate,
      value: {
        mutated: item.mutated,
        before: item.before,
        after: item.after,
        result: item.result
      }
    }));
  }

  feedback.sort((left, right) => {
    const time = String(left.at).localeCompare(String(right.at));
    if (time !== 0) return time;
    return left.id.localeCompare(right.id);
  });

  return Object.freeze(feedback);
}

export function queryFeedback(state, {
  currentCandidateOnly = false,
  kinds = null,
  afterFeedbackId = null,
  limit = 50
} = {}) {
  invariant(Number.isInteger(limit) && limit > 0, "feedback limit must be a positive integer");
  const allowedKinds = kinds == null
    ? null
    : new Set(kinds.map((kind) => {
        invariant(Object.values(FeedbackKind).includes(kind), `feedback kind is invalid: ${kind}`);
        return kind;
      }));

  let items = [...collectFeedback(state)];

  if (currentCandidateOnly) {
    const key = candidateKey(state.currentCandidate);
    items = items.filter((item) => item.candidate && candidateKey(item.candidate) === key);
  }

  if (allowedKinds) items = items.filter((item) => allowedKinds.has(item.kind));

  if (afterFeedbackId != null) {
    requireText(afterFeedbackId, "afterFeedbackId");
    const index = items.findIndex((item) => item.id === afterFeedbackId);
    invariant(index >= 0, `feedback item not found in query scope: ${afterFeedbackId}`);
    items = items.slice(index + 1);
  }

  if (items.length > limit) items = items.slice(items.length - limit);

  return Object.freeze(items.map((item) => structuredClone(item)));
}
