import { invariant, requireText } from "./contracts.js";
import { SemanticMemoryRelationDirection } from "./semantic-memory-graph.js";
import { SemanticMemoryRetrievalSemantics } from "./semantic-memory-retrieval.js";

export const SemanticMemoryRankingModel = "WEIGHTED_FUSION_V1";

export const SemanticMemoryRankingSignal = Object.freeze({
  PROVIDER: "PROVIDER",
  IMPORTANCE: "IMPORTANCE",
  CONFIDENCE: "CONFIDENCE",
  RECENCY: "RECENCY",
  GRAPH: "GRAPH"
});

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function normalizeWeight(value, label) {
  invariant(Number.isFinite(value) && value >= 0, `${label} must be a non-negative finite number`);
  return value;
}

export function defineSemanticMemoryIntelligencePolicy({
  candidateLimit = 16,
  resultLimit = 8,
  maxSerializedChars = 8192,
  graphDepth = 1,
  maxGraphCandidates = 16,
  graphDecay = 0.6,
  recencyHalfLifeMs = 7 * 24 * 60 * 60 * 1000,
  weights = {}
} = {}) {
  invariant(Number.isInteger(candidateLimit) && candidateLimit > 0, "semantic memory intelligence candidateLimit must be positive");
  invariant(Number.isInteger(resultLimit) && resultLimit > 0 && resultLimit <= candidateLimit, "semantic memory intelligence resultLimit must be positive and <= candidateLimit");
  invariant(Number.isInteger(maxSerializedChars) && maxSerializedChars > 0, "semantic memory intelligence maxSerializedChars must be positive");
  invariant(Number.isInteger(graphDepth) && graphDepth >= 0 && graphDepth <= 4, "semantic memory intelligence graphDepth must be between 0 and 4");
  invariant(Number.isInteger(maxGraphCandidates) && maxGraphCandidates >= 0, "semantic memory intelligence maxGraphCandidates must be non-negative");
  invariant(Number.isFinite(graphDecay) && graphDecay >= 0 && graphDecay <= 1, "semantic memory intelligence graphDecay must be between 0 and 1");
  invariant(Number.isFinite(recencyHalfLifeMs) && recencyHalfLifeMs > 0, "semantic memory intelligence recencyHalfLifeMs must be positive");

  const resolvedWeights = Object.freeze({
    provider: normalizeWeight(weights.provider ?? 0.55, "semantic memory intelligence provider weight"),
    importance: normalizeWeight(weights.importance ?? 0.15, "semantic memory intelligence importance weight"),
    confidence: normalizeWeight(weights.confidence ?? 0.10, "semantic memory intelligence confidence weight"),
    recency: normalizeWeight(weights.recency ?? 0.10, "semantic memory intelligence recency weight"),
    graph: normalizeWeight(weights.graph ?? 0.10, "semantic memory intelligence graph weight")
  });
  invariant(Object.values(resolvedWeights).some((weight) => weight > 0), "semantic memory intelligence requires at least one positive weight");

  return Object.freeze({
    candidateLimit,
    resultLimit,
    maxSerializedChars,
    graphDepth,
    maxGraphCandidates,
    graphDecay,
    recencyHalfLifeMs,
    weights: resolvedWeights
  });
}

function minMaxScores(hits) {
  const values = hits.map((hit) => hit.relevance?.score).filter(Number.isFinite);
  if (values.length === 0) return new Map();
  const min = Math.min(...values);
  const max = Math.max(...values);
  const result = new Map();
  for (const hit of hits) {
    const raw = hit.relevance?.score;
    if (!Number.isFinite(raw)) continue;
    result.set(hit.memory.id, max === min ? 1 : (raw - min) / (max - min));
  }
  return result;
}

function recencyScore(record, nowMs, halfLifeMs) {
  const updatedAt = Date.parse(record.updatedAt);
  if (!Number.isFinite(updatedAt)) return null;
  const age = Math.max(0, nowMs - updatedAt);
  return Math.pow(0.5, age / halfLifeMs);
}

function activeAt(record, atMs) {
  const from = record.temporal?.validFrom == null ? null : Date.parse(record.temporal.validFrom);
  const to = record.temporal?.validTo == null ? null : Date.parse(record.temporal.validTo);
  return (from == null || from <= atMs) && (to == null || atMs <= to);
}

function fuse(signals, weights) {
  const entries = [
    [SemanticMemoryRankingSignal.PROVIDER, signals.provider, weights.provider],
    [SemanticMemoryRankingSignal.IMPORTANCE, signals.importance, weights.importance],
    [SemanticMemoryRankingSignal.CONFIDENCE, signals.confidence, weights.confidence],
    [SemanticMemoryRankingSignal.RECENCY, signals.recency, weights.recency],
    [SemanticMemoryRankingSignal.GRAPH, signals.graph, weights.graph]
  ];
  let numerator = 0;
  let denominator = 0;
  const used = [];
  for (const [kind, value, weight] of entries) {
    if (value == null || weight === 0) continue;
    invariant(Number.isFinite(value) && value >= 0 && value <= 1, `semantic memory ranking ${kind} signal must be between 0 and 1`);
    numerator += value * weight;
    denominator += weight;
    used.push(Object.freeze({ kind, value, weight }));
  }
  return Object.freeze({
    score: denominator === 0 ? 0 : numerator / denominator,
    signals: Object.freeze(used)
  });
}

export function createSemanticMemoryIntelligencePort({
  memory,
  retrieval,
  graph = null,
  policy = {},
  clock = () => new Date().toISOString()
} = {}) {
  invariant(memory && typeof memory.get === "function", "semantic memory intelligence requires memory.get()");
  invariant(retrieval && typeof retrieval.recall === "function" && typeof retrieval.search === "function", "semantic memory intelligence requires retrieval recall/search");
  if (graph != null) invariant(typeof graph.relationsFor === "function", "semantic memory intelligence graph requires relationsFor()");
  invariant(typeof clock === "function", "semantic memory intelligence clock must be a function");
  const resolvedPolicy = defineSemanticMemoryIntelligencePolicy(policy);

  async function rank(mode, { query, tags = [], kinds = null, validAt = null } = {}) {
    const normalizedQuery = requireText(query, "semantic memory intelligence query");
    const raw = await retrieval[mode]({
      query: normalizedQuery,
      tags,
      limit: resolvedPolicy.candidateLimit
    });
    invariant(raw?.semantics === SemanticMemoryRetrievalSemantics, "semantic memory intelligence requires relevance-only retrieval input");
    invariant(Array.isArray(raw.hits), "semantic memory intelligence retrieval hits must be an array");

    const nowText = validAt ?? clock();
    const nowMs = Date.parse(requireText(nowText, "semantic memory intelligence ranking time"));
    invariant(Number.isFinite(nowMs), "semantic memory intelligence ranking time must be a valid timestamp");
    const kindSet = kinds == null ? null : new Set((() => {
      invariant(Array.isArray(kinds), "semantic memory intelligence kinds must be an array");
      return kinds;
    })());
    const providerScores = minMaxScores(raw.hits);
    const candidates = new Map();

    for (const hit of raw.hits) {
      const record = await memory.get(hit.memory.id);
      if (record == null || !activeAt(record, nowMs) || (kindSet && !kindSet.has(record.kind))) continue;
      candidates.set(record.id, {
        memory: clone(record),
        provider: providerScores.get(record.id) ?? null,
        graph: null,
        reasons: clone(hit.relevance?.reasons ?? []),
        source: "RETRIEVAL"
      });
    }

    let graphCandidates = 0;
    if (graph != null && resolvedPolicy.graphDepth > 0 && resolvedPolicy.maxGraphCandidates > 0) {
      const frontier = [...candidates.keys()].map((memoryId) => ({ memoryId, depth: 0, strength: 1 }));
      const visited = new Set(frontier.map((item) => item.memoryId));
      while (frontier.length > 0 && graphCandidates < resolvedPolicy.maxGraphCandidates) {
        const current = frontier.shift();
        if (current.depth >= resolvedPolicy.graphDepth) continue;
        const relations = await graph.relationsFor(current.memoryId, {
          direction: SemanticMemoryRelationDirection.BOTH,
          limit: resolvedPolicy.maxGraphCandidates
        });
        for (const relation of relations) {
          if (graphCandidates >= resolvedPolicy.maxGraphCandidates) break;
          const neighborId = relation.fromMemoryId === current.memoryId
            ? relation.toMemoryId
            : relation.fromMemoryId;
          const strength = current.strength * resolvedPolicy.graphDecay;
          const existing = candidates.get(neighborId);
          if (existing) {
            existing.graph = Math.max(existing.graph ?? 0, strength);
          } else {
            const record = await memory.get(neighborId);
            if (record != null && activeAt(record, nowMs) && (!kindSet || kindSet.has(record.kind))) {
              candidates.set(neighborId, {
                memory: clone(record),
                provider: null,
                graph: strength,
                reasons: [`graph:${relation.type}:${relation.id}`],
                source: "GRAPH"
              });
              graphCandidates += 1;
            }
          }
          if (!visited.has(neighborId)) {
            visited.add(neighborId);
            frontier.push({ memoryId: neighborId, depth: current.depth + 1, strength });
          }
        }
      }
    }

    const ranked = [...candidates.values()].map((candidate) => {
      const signals = {
        provider: candidate.provider,
        importance: candidate.memory.importance ?? null,
        confidence: candidate.memory.confidence ?? null,
        recency: recencyScore(candidate.memory, nowMs, resolvedPolicy.recencyHalfLifeMs),
        graph: candidate.graph
      };
      const fusion = fuse(signals, resolvedPolicy.weights);
      return {
        memory: candidate.memory,
        relevance: {
          score: fusion.score,
          model: SemanticMemoryRankingModel,
          signals: fusion.signals,
          reasons: candidate.reasons,
          source: candidate.source
        }
      };
    });
    ranked.sort((left, right) => {
      const byScore = right.relevance.score - left.relevance.score;
      return byScore === 0 ? left.memory.id.localeCompare(right.memory.id) : byScore;
    });

    const hits = [];
    let usedChars = 0;
    let truncatedByChars = false;
    for (const candidate of ranked.slice(0, resolvedPolicy.resultLimit)) {
      const hit = Object.freeze({
        rank: hits.length + 1,
        memory: clone(candidate.memory),
        relevance: Object.freeze(clone(candidate.relevance))
      });
      const chars = JSON.stringify(hit).length;
      if (usedChars + chars > resolvedPolicy.maxSerializedChars) {
        truncatedByChars = true;
        break;
      }
      usedChars += chars;
      hits.push(hit);
    }

    return Object.freeze({
      semantics: SemanticMemoryRetrievalSemantics,
      rankingModel: SemanticMemoryRankingModel,
      mode: mode.toUpperCase(),
      query: normalizedQuery,
      tags: clone(tags),
      hits: Object.freeze(clone(hits)),
      ranking: Object.freeze({
        retrievalCandidates: raw.hits.length,
        graphCandidates,
        fusedCandidates: candidates.size,
        weights: clone(resolvedPolicy.weights)
      }),
      budget: Object.freeze({
        candidateLimit: resolvedPolicy.candidateLimit,
        resultLimit: resolvedPolicy.resultLimit,
        graphDepth: resolvedPolicy.graphDepth,
        maxGraphCandidates: resolvedPolicy.maxGraphCandidates,
        maxSerializedChars: resolvedPolicy.maxSerializedChars,
        usedItems: hits.length,
        usedChars,
        truncatedByChars
      })
    });
  }

  return Object.freeze({
    policy() {
      return clone(resolvedPolicy);
    },
    recall(options = {}) {
      return rank("recall", options);
    },
    search(options = {}) {
      return rank("search", options);
    }
  });
}
