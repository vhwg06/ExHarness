import { candidateKey, invariant } from "./contracts.js";

function sameArtifactSnapshot(evaluatedIds, currentIds) {
  if (evaluatedIds.length !== currentIds.length) return false;
  return evaluatedIds.every((id, index) => id === currentIds[index]);
}

export function currentEvaluationForState(state) {
  const key = candidateKey(state.currentCandidate);
  return [...state.persistentMemory.evaluations]
    .reverse()
    .find((item) => candidateKey(item.candidate) === key) ?? null;
}

export function evaluationInputState(state) {
  const key = candidateKey(state.currentCandidate);
  return Object.freeze({
    observationIds: Object.freeze(
      state.persistentMemory.observations
        .filter((item) => candidateKey(item.candidate) === key)
        .map((item) => item.id)
    ),
    verificationIds: Object.freeze(
      state.persistentMemory.verifications
        .filter((item) => candidateKey(item.candidate) === key)
        .map((item) => item.id)
    )
  });
}

export function assertEvaluationInputsFresh(
  state,
  evaluation = currentEvaluationForState(state),
  { purpose = "relying on evaluation" } = {}
) {
  invariant(evaluation, "current candidate has not been evaluated");
  const evaluated = evaluation.metadata?.inputSnapshot ?? {
    observationIds: [],
    verificationIds: evaluation.verificationIds ?? []
  };
  const current = evaluationInputState(state);

  invariant(
    sameArtifactSnapshot([...(evaluated.observationIds ?? [])], current.observationIds),
    `observations changed since evaluation; re-evaluate before ${purpose}`
  );
  invariant(
    sameArtifactSnapshot([...(evaluated.verificationIds ?? [])], current.verificationIds),
    `verification artifacts changed since evaluation; re-evaluate before ${purpose}`
  );
  return evaluation;
}
