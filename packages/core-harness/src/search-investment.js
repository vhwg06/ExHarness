import { candidateKey, invariant, requireText } from "./contracts.js";
import { SearchInvestmentBoundaryError } from "./errors.js";

export const SearchInvestmentAction = Object.freeze({
  CONTINUE: "CONTINUE",
  STOP: "STOP",
  ESCALATE: "ESCALATE"
});

export const SearchInvestmentState = Object.freeze({
  WARMUP: "WARMUP",
  IN_RANGE: "IN_RANGE",
  DIMINISHING_RETURNS: "DIMINISHING_RETURNS",
  ANOMALOUS: "ANOMALOUS",
  INSUFFICIENT_DATA: "INSUFFICIENT_DATA"
});

function freezeClone(value) {
  return Object.freeze(structuredClone(value));
}

function currentLineageHead(state) {
  return state.persistentMemory.lineage.at(-1) ?? null;
}

function groundedKnowledge(state) {
  return state.persistentMemory.knowledge.filter((item) =>
    (item.evidence?.length ?? 0) > 0 || (item.feedbackRefs?.length ?? 0) > 0
  );
}

function completedVariations(state) {
  return state.persistentMemory.variations.filter((item) => item.status === "COMPLETED");
}

export function searchInvestmentInputSnapshot(state) {
  return Object.freeze({
    candidateKey: candidateKey(state.currentCandidate),
    lineageHeadKey: currentLineageHead(state)?.candidate
      ? candidateKey(currentLineageHead(state).candidate)
      : null,
    observationIds: Object.freeze(state.persistentMemory.observations.map((item) => item.id)),
    verificationIds: Object.freeze(state.persistentMemory.verifications.map((item) => item.id)),
    evaluationIds: Object.freeze(state.persistentMemory.evaluations.map((item) => item.id)),
    variationIds: Object.freeze(completedVariations(state).map((item) => item.id)),
    groundedKnowledgeIds: Object.freeze(groundedKnowledge(state).map((item) => item.id)),
    supervisorInterventionIds: Object.freeze(state.supervision.interventions.map((item) => item.id))
  });
}

export function searchInvestmentHistory(state) {
  return Object.freeze({
    evaluations: freezeClone(state.persistentMemory.evaluations),
    verifications: freezeClone(state.persistentMemory.verifications),
    variations: freezeClone(completedVariations(state)),
    groundedKnowledge: freezeClone(groundedKnowledge(state)),
    supervisorInterventions: freezeClone(state.supervision.interventions),
    lineage: freezeClone(state.persistentMemory.lineage)
  });
}

function snapshotsEqual(left, right) {
  if (!left || !right) return false;
  if (left.candidateKey !== right.candidateKey) return false;
  if (left.lineageHeadKey !== right.lineageHeadKey) return false;
  for (const key of [
    "observationIds",
    "verificationIds",
    "evaluationIds",
    "variationIds",
    "groundedKnowledgeIds",
    "supervisorInterventionIds"
  ]) {
    const a = left[key] ?? [];
    const b = right[key] ?? [];
    if (a.length !== b.length) return false;
    if (!a.every((value, index) => value === b[index])) return false;
  }
  return true;
}

export function isSearchInvestmentDecisionFresh(state, decision) {
  return Boolean(decision && snapshotsEqual(decision.inputSnapshot, searchInvestmentInputSnapshot(state)));
}

export function validateSearchInvestmentDecision(value) {
  invariant(value && typeof value === "object", "search investment decision is required");
  invariant(Object.values(SearchInvestmentState).includes(value.state), "search investment state is invalid");
  invariant(Object.values(SearchInvestmentAction).includes(value.action), "search investment action is invalid");
  return Object.freeze({
    state: value.state,
    action: value.action,
    rationale: requireText(value.rationale, "search investment rationale"),
    metrics: structuredClone(value.metrics ?? null)
  });
}

export function defineSearchInvestmentPolicy({
  name = "custom",
  minEvaluations = 3,
  decide
} = {}) {
  requireText(name, "search investment policy name");
  invariant(Number.isInteger(minEvaluations) && minEvaluations > 0, "search investment policy minEvaluations must be a positive integer");
  invariant(typeof decide === "function", "search investment policy requires decide()");
  return Object.freeze({ name, minEvaluations, decide });
}

export function createMarginalImprovementPolicy({
  name = "marginal-improvement",
  selectQuality,
  minEvaluations = 3,
  window = 2,
  minimumImprovement = 0,
  anomalyImprovement = null
} = {}) {
  invariant(typeof selectQuality === "function", "marginal improvement policy requires selectQuality()");
  invariant(Number.isInteger(window) && window > 0, "marginal improvement policy window must be a positive integer");
  invariant(Number.isFinite(minimumImprovement), "marginal improvement policy minimumImprovement must be finite");
  invariant(anomalyImprovement == null || Number.isFinite(anomalyImprovement), "marginal improvement policy anomalyImprovement must be finite when supplied");

  return defineSearchInvestmentPolicy({
    name,
    minEvaluations: Math.max(minEvaluations, window + 1),
    async decide({ history }) {
      const samples = [];
      for (const evaluation of history.evaluations) {
        const quality = await selectQuality(structuredClone(evaluation));
        if (!Number.isFinite(quality)) {
          return {
            state: SearchInvestmentState.INSUFFICIENT_DATA,
            action: SearchInvestmentAction.CONTINUE,
            rationale: `evaluation ${evaluation.id ?? "unknown"} has no finite quality sample`,
            metrics: { missingEvaluationId: evaluation.id ?? null }
          };
        }
        samples.push({ evaluationId: evaluation.id, quality });
      }

      const deltas = samples.slice(1).map((sample, index) => ({
        fromEvaluationId: samples[index].evaluationId,
        toEvaluationId: sample.evaluationId,
        delta: sample.quality - samples[index].quality
      }));
      const latest = deltas.at(-1) ?? null;
      const recent = deltas.slice(-window);

      if (anomalyImprovement != null && latest && latest.delta >= anomalyImprovement) {
        return {
          state: SearchInvestmentState.ANOMALOUS,
          action: SearchInvestmentAction.ESCALATE,
          rationale: "latest grounded quality jump exceeds the configured anomaly threshold",
          metrics: { samples, deltas, window, anomalyImprovement }
        };
      }

      if (recent.length === window && recent.every((item) => item.delta <= minimumImprovement)) {
        return {
          state: SearchInvestmentState.DIMINISHING_RETURNS,
          action: SearchInvestmentAction.STOP,
          rationale: "recent grounded quality deltas are below the configured useful-improvement threshold",
          metrics: { samples, deltas, window, minimumImprovement }
        };
      }

      return {
        state: SearchInvestmentState.IN_RANGE,
        action: SearchInvestmentAction.CONTINUE,
        rationale: "grounded quality history remains inside the configured useful search range",
        metrics: { samples, deltas, window, minimumImprovement, anomalyImprovement }
      };
    }
  });
}

export function createSearchInvestmentController({
  policy = null,
  sessionStore,
  clock = () => new Date().toISOString(),
  idFactory
}) {
  invariant(sessionStore && typeof sessionStore.load === "function" && typeof sessionStore.save === "function", "search investment controller requires sessionStore load/save");
  invariant(typeof idFactory === "function", "search investment controller requires idFactory()");
  const resolvedPolicy = policy == null ? null : defineSearchInvestmentPolicy(policy);

  async function load(sessionId) {
    const state = await sessionStore.load(sessionId);
    invariant(state, `session not found: ${sessionId}`);
    state.persistentMemory.searchInvestmentDecisions ??= [];
    return state;
  }

  async function assess(sessionId) {
    if (!resolvedPolicy) return null;
    const state = await load(sessionId);
    const history = searchInvestmentHistory(state);
    const inputSnapshot = searchInvestmentInputSnapshot(state);
    let raw;

    if (history.evaluations.length < resolvedPolicy.minEvaluations) {
      raw = {
        state: SearchInvestmentState.WARMUP,
        action: SearchInvestmentAction.CONTINUE,
        rationale: `need ${resolvedPolicy.minEvaluations} grounded evaluations before trend-based search control`,
        metrics: {
          observedEvaluations: history.evaluations.length,
          minEvaluations: resolvedPolicy.minEvaluations
        }
      };
    } else {
      raw = await resolvedPolicy.decide({
        sessionId: state.id,
        work: structuredClone(state.work),
        candidate: structuredClone(state.currentCandidate),
        lineageHead: structuredClone(currentLineageHead(state)),
        history,
        inputSnapshot: structuredClone(inputSnapshot)
      });
    }

    const normalized = validateSearchInvestmentDecision(raw);
    const decision = Object.freeze({
      id: idFactory(),
      at: clock(),
      candidate: structuredClone(state.currentCandidate),
      lineageHead: structuredClone(currentLineageHead(state)?.candidate ?? null),
      policy: Object.freeze({
        name: resolvedPolicy.name,
        minEvaluations: resolvedPolicy.minEvaluations
      }),
      inputSnapshot,
      ...normalized
    });

    state.persistentMemory.searchInvestmentDecisions.push(structuredClone(decision));
    state.trajectory.push({
      id: idFactory(),
      type: "SEARCH_INVESTMENT_DECIDED",
      at: clock(),
      candidate: structuredClone(state.currentCandidate),
      decisionId: decision.id,
      state: decision.state,
      action: decision.action,
      policy: decision.policy.name
    });
    await sessionStore.save(state);
    return decision;
  }

  async function current(sessionId, { refreshIfStale = true } = {}) {
    if (!resolvedPolicy) return null;
    const state = await load(sessionId);
    const latest = state.persistentMemory.searchInvestmentDecisions.at(-1) ?? null;
    if (latest && isSearchInvestmentDecisionFresh(state, latest)) return freezeClone(latest);
    if (!refreshIfStale) return null;
    return assess(sessionId);
  }

  async function assertCanContinue(sessionId) {
    const decision = await current(sessionId);
    if (!decision || decision.action === SearchInvestmentAction.CONTINUE) return decision;
    throw new SearchInvestmentBoundaryError({ sessionId, decision });
  }

  return Object.freeze({
    enabled: resolvedPolicy != null,
    policy: resolvedPolicy
      ? Object.freeze({ name: resolvedPolicy.name, minEvaluations: resolvedPolicy.minEvaluations })
      : null,
    assess,
    current,
    assertCanContinue
  });
}
