import { invariant, requireText } from "./contracts.js";
import { SemanticMemoryStatus } from "./semantic-memory.js";

export const SemanticMemoryRetrievalMode = Object.freeze({
  RECALL: "RECALL",
  SEARCH: "SEARCH"
});

export const SemanticMemoryRetrievalSemantics = "RELEVANCE_ONLY";

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function normalizeTags(tags = []) {
  invariant(Array.isArray(tags), "semantic memory retrieval tags must be an array");
  return Object.freeze([...new Set(tags.map((tag) => requireText(tag, "semantic memory retrieval tag")))]);
}

function normalizeReasons(reasons = []) {
  invariant(Array.isArray(reasons), "semantic memory retrieval reasons must be an array");
  return Object.freeze(reasons.map((reason) => requireText(reason, "semantic memory retrieval reason")));
}

function normalizeProviderHit(hit) {
  invariant(hit && typeof hit === "object", "semantic memory retrieval hit is required");
  const score = hit.score ?? null;
  if (score != null) invariant(Number.isFinite(score), "semantic memory retrieval score must be finite");
  return Object.freeze({
    memoryId: requireText(hit.memoryId, "semantic memory retrieval memoryId"),
    score,
    reasons: normalizeReasons(hit.reasons)
  });
}

export function defineSemanticMemoryRetrievalPolicy({
  maxItems = 8,
  maxSerializedChars = 4096
} = {}) {
  invariant(Number.isInteger(maxItems) && maxItems > 0, "semantic memory retrieval maxItems must be positive");
  invariant(
    Number.isInteger(maxSerializedChars) && maxSerializedChars > 0,
    "semantic memory retrieval maxSerializedChars must be positive"
  );
  return Object.freeze({ maxItems, maxSerializedChars });
}

export function defineSemanticMemoryRetriever(definition) {
  invariant(definition && typeof definition === "object", "semantic memory retriever is required");
  invariant(typeof definition.retrieve === "function", "semantic memory retriever requires retrieve()");
  return Object.freeze({
    name: requireText(definition.name, "semantic memory retriever name"),
    version: definition.version == null
      ? null
      : requireText(definition.version, "semantic memory retriever version"),
    retrieve: definition.retrieve
  });
}

export function createSemanticMemoryRetrievalPort({
  memory,
  retriever,
  policy = {}
} = {}) {
  invariant(memory && typeof memory.get === "function", "semantic memory retrieval requires memory.get()");
  const resolvedRetriever = defineSemanticMemoryRetriever(retriever);
  const resolvedPolicy = defineSemanticMemoryRetrievalPolicy(policy);

  async function retrieve(mode, {
    query,
    tags = [],
    limit = resolvedPolicy.maxItems
  } = {}) {
    invariant(Object.values(SemanticMemoryRetrievalMode).includes(mode), "semantic memory retrieval mode is invalid");
    const normalizedQuery = requireText(query, "semantic memory retrieval query");
    const normalizedTags = normalizeTags(tags);
    invariant(Number.isInteger(limit) && limit > 0, "semantic memory retrieval limit must be positive");
    const requestedLimit = Math.min(limit, resolvedPolicy.maxItems);

    const providerOutput = await resolvedRetriever.retrieve(Object.freeze({
      mode,
      query: normalizedQuery,
      tags: clone(normalizedTags),
      limit: requestedLimit
    }));
    invariant(Array.isArray(providerOutput), "semantic memory retriever retrieve() must return an array");

    const providerHits = providerOutput.map(normalizeProviderHit);
    const seen = new Set();
    for (const hit of providerHits) {
      invariant(!seen.has(hit.memoryId), `semantic memory retriever returned duplicate id: ${hit.memoryId}`);
      seen.add(hit.memoryId);
    }

    const hits = [];
    let usedChars = 0;
    let droppedArchived = 0;
    let droppedTagMismatch = 0;
    let truncatedByItems = false;
    let truncatedByChars = false;

    for (let index = 0; index < providerHits.length; index += 1) {
      const providerHit = providerHits[index];
      const record = await memory.get(providerHit.memoryId, { includeArchived: true });
      invariant(record, `semantic memory retriever returned unknown id: ${providerHit.memoryId}`);

      if (record.status === SemanticMemoryStatus.ARCHIVED) {
        droppedArchived += 1;
        continue;
      }
      invariant(record.status === SemanticMemoryStatus.ACTIVE, "semantic memory retrieval record status is invalid");

      if (normalizedTags.length > 0) {
        const recordTags = new Set(record.tags ?? []);
        const matches = normalizedTags.every((tag) => recordTags.has(tag));
        if (!matches) {
          droppedTagMismatch += 1;
          continue;
        }
      }

      if (hits.length >= requestedLimit) {
        truncatedByItems = true;
        break;
      }

      const candidate = Object.freeze({
        rank: index + 1,
        memory: clone(record),
        relevance: Object.freeze({
          score: providerHit.score,
          reasons: clone(providerHit.reasons)
        })
      });
      const serializedChars = JSON.stringify(candidate).length;
      if (usedChars + serializedChars > resolvedPolicy.maxSerializedChars) {
        truncatedByChars = true;
        break;
      }

      usedChars += serializedChars;
      hits.push(candidate);
    }

    return Object.freeze({
      semantics: SemanticMemoryRetrievalSemantics,
      mode,
      query: normalizedQuery,
      tags: clone(normalizedTags),
      retriever: Object.freeze({
        name: resolvedRetriever.name,
        version: resolvedRetriever.version
      }),
      hits: Object.freeze(clone(hits)),
      ranking: Object.freeze({
        providerHits: providerHits.length,
        droppedArchived,
        droppedTagMismatch
      }),
      budget: Object.freeze({
        requestedLimit: limit,
        effectiveMaxItems: requestedLimit,
        maxSerializedChars: resolvedPolicy.maxSerializedChars,
        usedItems: hits.length,
        usedChars,
        truncatedByItems,
        truncatedByChars
      })
    });
  }

  return Object.freeze({
    policy() {
      return clone(resolvedPolicy);
    },

    recall(options = {}) {
      return retrieve(SemanticMemoryRetrievalMode.RECALL, options);
    },

    search(options = {}) {
      return retrieve(SemanticMemoryRetrievalMode.SEARCH, options);
    }
  });
}
