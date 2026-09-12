import { invariant, requireText } from "./contracts.js";

export const SpontaneousRecallCadence = Object.freeze({
  SELF_GATED: "SELF_GATED",
  PER_TASK: "PER_TASK",
  EVERY_TURN: "EVERY_TURN"
});

export const SemanticMemoryContextBlockName = "__semantic_memory__";

function clone(value) {
  return value == null ? value : structuredClone(value);
}

export function defineSpontaneousRecallPolicy({
  cadence = SpontaneousRecallCadence.SELF_GATED,
  blockName = SemanticMemoryContextBlockName,
  limit = null,
  tags = []
} = {}) {
  invariant(Object.values(SpontaneousRecallCadence).includes(cadence), "spontaneous recall cadence is invalid");
  const resolvedBlockName = requireText(blockName, "spontaneous recall blockName");
  invariant(
    resolvedBlockName === SemanticMemoryContextBlockName,
    `spontaneous recall blockName is reserved as ${SemanticMemoryContextBlockName}`
  );
  if (limit != null) invariant(Number.isInteger(limit) && limit > 0, "spontaneous recall limit must be positive");
  invariant(Array.isArray(tags), "spontaneous recall tags must be an array");
  const normalizedTags = tags.map((tag) => requireText(tag, "spontaneous recall tag"));
  invariant(new Set(normalizedTags).size === normalizedTags.length, "spontaneous recall tags cannot contain duplicates");

  return Object.freeze({
    cadence,
    blockName: resolvedBlockName,
    limit,
    tags: Object.freeze(normalizedTags)
  });
}

export function defineSpontaneousRecall(definition) {
  invariant(definition && typeof definition === "object", "spontaneous recall definition is required");
  invariant(definition.retrieval && typeof definition.retrieval.recall === "function", "spontaneous recall requires retrieval.recall()");
  invariant(typeof definition.deriveQuery === "function", "spontaneous recall requires deriveQuery()");
  return Object.freeze({
    retrieval: definition.retrieval,
    deriveQuery: definition.deriveQuery,
    policy: defineSpontaneousRecallPolicy(definition.policy)
  });
}

export function createSpontaneousRecallController(definition) {
  const resolved = defineSpontaneousRecall(definition);
  let cachedQuery = null;
  let cachedRecall = null;
  let sourceTurn = null;
  let retrievalCalls = 0;

  async function deriveQuery(state) {
    const value = await resolved.deriveQuery(Object.freeze(clone(state)));
    return requireText(value, "spontaneous recall derived query");
  }

  async function perform(query, turn) {
    const options = {
      query,
      tags: clone(resolved.policy.tags)
    };
    if (resolved.policy.limit != null) options.limit = resolved.policy.limit;
    cachedRecall = await resolved.retrieval.recall(Object.freeze(options));
    invariant(
      cachedRecall && cachedRecall.semantics === "RELEVANCE_ONLY",
      "spontaneous recall retrieval result must use RELEVANCE_ONLY semantics"
    );
    cachedQuery = query;
    sourceTurn = turn;
    retrievalCalls += 1;
    return { recalled: true, reused: false };
  }

  return Object.freeze({
    async prepare(state) {
      invariant(state && typeof state === "object", "spontaneous recall turn state is required");
      invariant(Number.isInteger(state.turn) && state.turn > 0, "spontaneous recall turn must be positive");

      let recalled = false;
      let reused = false;
      let query = cachedQuery;

      if (resolved.policy.cadence === SpontaneousRecallCadence.PER_TASK) {
        if (cachedRecall == null) {
          query = await deriveQuery(state);
          ({ recalled, reused } = await perform(query, state.turn));
        } else {
          reused = true;
        }
      } else if (resolved.policy.cadence === SpontaneousRecallCadence.EVERY_TURN) {
        query = await deriveQuery(state);
        ({ recalled, reused } = await perform(query, state.turn));
      } else {
        query = await deriveQuery(state);
        if (cachedRecall == null || query !== cachedQuery) {
          ({ recalled, reused } = await perform(query, state.turn));
        } else {
          reused = true;
        }
      }

      const recall = clone(cachedRecall);
      return Object.freeze({
        blockName: resolved.policy.blockName,
        inject: (recall?.hits?.length ?? 0) > 0,
        value: Object.freeze({
          semantics: "RELEVANCE_ONLY",
          cadence: resolved.policy.cadence,
          query,
          sourceTurn,
          currentTurn: state.turn,
          recalled,
          reused,
          retrieval: recall
        }),
        metrics: Object.freeze({ retrievalCalls })
      });
    },

    policy() {
      return clone(resolved.policy);
    },

    metrics() {
      return Object.freeze({ retrievalCalls });
    }
  });
}
