import { KnowledgeKind, invariant } from "./contracts.js";
import { buildKnowledgeView } from "./knowledge.js";
import { VariationOutcome, VariationTermination } from "./variation.js";

export const SearchSignalKind = Object.freeze({
  NO_CHANGE_STREAK: "NO_CHANGE_STREAK",
  BUDGET_EXHAUSTION: "BUDGET_EXHAUSTION",
  FAILED_VARIATIONS: "FAILED_VARIATIONS",
  REPEATED_FAILED_DIRECTION: "REPEATED_FAILED_DIRECTION",
  KNOWLEDGE_CONFLICT: "KNOWLEDGE_CONFLICT"
});

export function defineSupervisionPolicy({
  variationWindow = 6,
  noChangeThreshold = 2,
  budgetExhaustionThreshold = 2,
  failedVariationThreshold = 2,
  repeatedFailedDirectionThreshold = 2
} = {}) {
  for (const [name, value] of Object.entries({
    variationWindow,
    noChangeThreshold,
    budgetExhaustionThreshold,
    failedVariationThreshold,
    repeatedFailedDirectionThreshold
  })) {
    invariant(Number.isInteger(value) && value > 0, `${name} must be a positive integer`);
  }

  return Object.freeze({
    variationWindow,
    noChangeThreshold,
    budgetExhaustionThreshold,
    failedVariationThreshold,
    repeatedFailedDirectionThreshold
  });
}

function normalizeDirection(statement) {
  return String(statement ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

export function buildSearchHealth(progress, policy = {}) {
  const resolved = defineSupervisionPolicy(policy);
  const memory = progress.persistentMemory ?? {};
  const completed = [...(memory.variations ?? [])]
    .filter((item) => item.status === "COMPLETED")
    .slice(-resolved.variationWindow);

  let noChangeStreak = 0;
  for (const variation of [...completed].reverse()) {
    if (variation.outcome !== VariationOutcome.NO_CHANGE) break;
    noChangeStreak += 1;
  }

  const budgetExhaustions = completed.filter(
    (item) => item.termination === VariationTermination.BUDGET_EXHAUSTED
  ).length;
  const failedVariations = completed.filter(
    (item) => item.termination === VariationTermination.FAILED || item.termination === VariationTermination.INTERRUPTED
  ).length;

  const failedDirections = [...(memory.knowledge ?? [])]
    .filter((item) => item.kind === KnowledgeKind.FAILED_DIRECTION)
    .slice(-resolved.variationWindow * 2);
  const directionCounts = new Map();
  for (const item of failedDirections) {
    const key = normalizeDirection(item.statement);
    if (!key) continue;
    directionCounts.set(key, (directionCounts.get(key) ?? 0) + 1);
  }
  const repeatedDirections = [...directionCounts.entries()]
    .filter(([, count]) => count >= resolved.repeatedFailedDirectionThreshold)
    .map(([statement, count]) => Object.freeze({ statement, count }));

  let knowledgeConflicts = [];
  try {
    knowledgeConflicts = buildKnowledgeView(progress).conflicts;
  } catch {
    knowledgeConflicts = [];
  }

  const signals = [];
  if (noChangeStreak >= resolved.noChangeThreshold) {
    signals.push(Object.freeze({
      kind: SearchSignalKind.NO_CHANGE_STREAK,
      count: noChangeStreak
    }));
  }
  if (budgetExhaustions >= resolved.budgetExhaustionThreshold) {
    signals.push(Object.freeze({
      kind: SearchSignalKind.BUDGET_EXHAUSTION,
      count: budgetExhaustions
    }));
  }
  if (failedVariations >= resolved.failedVariationThreshold) {
    signals.push(Object.freeze({
      kind: SearchSignalKind.FAILED_VARIATIONS,
      count: failedVariations
    }));
  }
  for (const repeated of repeatedDirections) {
    signals.push(Object.freeze({
      kind: SearchSignalKind.REPEATED_FAILED_DIRECTION,
      ...repeated
    }));
  }
  if (knowledgeConflicts.length > 0) {
    signals.push(Object.freeze({
      kind: SearchSignalKind.KNOWLEDGE_CONFLICT,
      count: knowledgeConflicts.length
    }));
  }

  return Object.freeze({
    window: completed.length,
    noChangeStreak,
    budgetExhaustions,
    failedVariations,
    repeatedDirections: Object.freeze(repeatedDirections),
    knowledgeConflictCount: knowledgeConflicts.length,
    signals: Object.freeze(signals),
    attentionSuggested: signals.length > 0
  });
}

function latest(memory, key) {
  return memory?.[key]?.at(-1) ?? null;
}

function defaultProjection({ consumer, problem, progress, dose, searchHealth }) {
  const memory = progress.persistentMemory ?? {};
  if (consumer === "SUPERVISOR") {
    const maxRecent = Number.isInteger(dose?.maxRecent) && dose.maxRecent > 0 ? dose.maxRecent : 6;
    return Object.freeze({
      problem,
      currentCandidate: structuredClone(progress.currentCandidate),
      lineageHead: structuredClone(memory.lineage?.at(-1) ?? null),
      latestEvaluation: structuredClone(latest(memory, "evaluations")),
      latestVariation: structuredClone(latest(memory, "variations")),
      recentVariations: structuredClone((memory.variations ?? []).slice(-maxRecent)),
      recentFailedDirections: structuredClone(
        (memory.knowledge ?? [])
          .filter((item) => item.kind === KnowledgeKind.FAILED_DIRECTION)
          .slice(-maxRecent)
      ),
      searchHealth: structuredClone(searchHealth)
    });
  }

  return Object.freeze({
    problem,
    currentCandidate: structuredClone(progress.currentCandidate),
    lineageHead: structuredClone(memory.lineage?.at(-1) ?? null),
    latestEvaluation: structuredClone(latest(memory, "evaluations")),
    latestVariation: structuredClone(latest(memory, "variations")),
    latestIntervention: structuredClone(progress.supervision?.interventions?.at(-1) ?? null),
    counts: Object.freeze({
      observations: memory.observations?.length ?? 0,
      verifications: memory.verifications?.length ?? 0,
      evaluations: memory.evaluations?.length ?? 0,
      knowledge: memory.knowledge?.length ?? 0,
      variations: memory.variations?.length ?? 0,
      lineage: memory.lineage?.length ?? 0
    })
  });
}

export function createTrajectoryContextProjector({ projector = null, supervisionPolicy = {} } = {}) {
  if (projector != null) {
    invariant(typeof projector.project === "function", "context projector requires project()");
  }
  const resolvedPolicy = defineSupervisionPolicy(supervisionPolicy);

  return Object.freeze({
    async project(input) {
      const searchHealth = input.consumer === "SUPERVISOR"
        ? buildSearchHealth(input.progress, resolvedPolicy)
        : null;

      if (projector) {
        return projector.project(Object.freeze({
          ...input,
          searchHealth: structuredClone(searchHealth)
        }));
      }

      return defaultProjection({ ...input, searchHealth });
    }
  });
}
