import assert from "node:assert/strict";
import test from "node:test";

import {
  SemanticMemoryKind,
  SemanticMemoryRankingModel,
  SemanticMemoryRankingSignal,
  SemanticMemoryRelationType,
  SemanticMemoryRetrievalSemantics,
  createInMemorySemanticMemoryProvider,
  createSemanticMemoryGraph,
  createSemanticMemoryIntelligencePort,
  createSemanticMemoryPort,
  createSemanticMemoryRetrievalPort,
  defineSemanticMemoryRetriever
} from "../src/index.js";

function fixture({ retrievalHits = [], policy = {}, clock = () => "2026-09-13T12:00:00Z" } = {}) {
  let memoryId = 0;
  let relationId = 0;
  let tick = 0;
  const memory = createSemanticMemoryPort({
    provider: createInMemorySemanticMemoryProvider(),
    idFactory: () => `memory-${++memoryId}`,
    clock: () => `2026-09-13T00:00:${String(tick++).padStart(2, "0")}Z`
  });
  const graph = createSemanticMemoryGraph({
    memory,
    idFactory: () => `relation-${++relationId}`,
    clock: () => `2026-09-13T01:00:${String(tick++).padStart(2, "0")}Z`
  });
  const retrieval = createSemanticMemoryRetrievalPort({
    memory,
    retriever: defineSemanticMemoryRetriever({
      name: "fixture",
      version: "1",
      async retrieve() {
        return retrievalHits();
      }
    }),
    policy: { maxItems: 32, maxSerializedChars: 32_768 }
  });
  const intelligence = createSemanticMemoryIntelligencePort({ memory, retrieval, graph, policy, clock });
  return { memory, graph, intelligence };
}

function provenance(source = "agent") {
  return { source };
}

async function remember(memory, content, options = {}) {
  return memory.remember({
    content,
    kind: options.kind ?? SemanticMemoryKind.SEMANTIC,
    tags: options.tags ?? [],
    importance: options.importance ?? 0.5,
    confidence: options.confidence ?? null,
    temporal: options.temporal ?? {},
    provenance: provenance(options.source ?? "agent")
  });
}

test("intelligence reranks authoritative retrieval candidates with explicit relevance-only signal fusion", async () => {
  let hits = [];
  const { memory, intelligence } = fixture({
    retrievalHits: () => hits,
    policy: {
      weights: { provider: 0.4, importance: 0.4, confidence: 0.2, recency: 0, graph: 0 }
    }
  });
  const lowProviderHighQuality = await remember(memory, "high-quality", { importance: 1, confidence: 1 });
  const highProviderLowQuality = await remember(memory, "provider-favorite", { importance: 0, confidence: 0 });
  hits = [
    { memoryId: highProviderLowQuality.id, score: 100, reasons: ["dense"] },
    { memoryId: lowProviderHighQuality.id, score: 10, reasons: ["sparse"] }
  ];

  const result = await intelligence.recall({ query: "failure mode" });

  assert.equal(result.semantics, SemanticMemoryRetrievalSemantics);
  assert.equal(result.rankingModel, SemanticMemoryRankingModel);
  assert.deepEqual(result.hits.map((hit) => hit.memory.id), [lowProviderHighQuality.id, highProviderLowQuality.id]);
  assert.equal(result.hits[0].relevance.score > result.hits[1].relevance.score, true);
  assert.equal(result.hits[0].relevance.model, SemanticMemoryRankingModel);
  assert.equal(result.hits[0].relevance.signals.some((signal) => signal.kind === SemanticMemoryRankingSignal.IMPORTANCE), true);
  assert.equal("verdict" in result.hits[0].relevance, false);
  assert.equal("trust" in result.hits[0].relevance, false);
});

test("bounded graph expansion can surface related active memory without pretending it was provider-retrieved", async () => {
  let hits = [];
  const { memory, graph, intelligence } = fixture({
    retrievalHits: () => hits,
    policy: {
      graphDepth: 1,
      graphDecay: 0.8,
      weights: { provider: 0, importance: 0, confidence: 0, recency: 0, graph: 1 }
    }
  });
  const seed = await remember(memory, "seed");
  const related = await remember(memory, "related");
  hits = [{ memoryId: seed.id, score: 1, reasons: ["exact"] }];
  await graph.relate({
    fromMemoryId: seed.id,
    toMemoryId: related.id,
    type: SemanticMemoryRelationType.SUPPORTS,
    provenance: provenance()
  });

  const result = await intelligence.recall({ query: "seed" });

  assert.equal(result.hits[0].memory.id, related.id);
  assert.equal(result.hits[0].relevance.source, "GRAPH");
  assert.equal(result.hits[0].relevance.signals[0].kind, SemanticMemoryRankingSignal.GRAPH);
  assert.equal(result.ranking.graphCandidates, 1);
  assert.equal(result.budget.graphDepth, 1);
});

test("graph expansion cannot traverse through archived memory to resurrect downstream memory", async () => {
  let hits = [];
  const { memory, graph, intelligence } = fixture({
    retrievalHits: () => hits,
    policy: { graphDepth: 2, maxGraphCandidates: 8 }
  });
  const seed = await remember(memory, "seed");
  const archivedBridge = await remember(memory, "stale bridge");
  const downstream = await remember(memory, "downstream");
  hits = [{ memoryId: seed.id, score: 1, reasons: ["seed"] }];
  await graph.relate({
    fromMemoryId: seed.id,
    toMemoryId: archivedBridge.id,
    type: SemanticMemoryRelationType.RELATED,
    provenance: provenance()
  });
  await graph.relate({
    fromMemoryId: archivedBridge.id,
    toMemoryId: downstream.id,
    type: SemanticMemoryRelationType.RELATED,
    provenance: provenance()
  });
  await memory.archive(archivedBridge.id, { provenance: provenance("reconciler") });

  const result = await intelligence.recall({ query: "seed" });

  assert.deepEqual(result.hits.map((hit) => hit.memory.id), [seed.id]);
  assert.equal(result.ranking.graphCandidates, 0);
});

test("graph-expanded candidates must satisfy the same tags, kinds and temporal admission filters", async () => {
  let hits = [];
  const { memory, graph, intelligence } = fixture({ retrievalHits: () => hits, policy: { graphDepth: 1 } });
  const seed = await remember(memory, "seed", {
    tags: ["runtime"],
    kind: SemanticMemoryKind.SEMANTIC
  });
  const wrongTag = await remember(memory, "wrong-tag", {
    tags: ["other"],
    kind: SemanticMemoryKind.SEMANTIC
  });
  const wrongKind = await remember(memory, "wrong-kind", {
    tags: ["runtime"],
    kind: SemanticMemoryKind.INTENT
  });
  const expired = await remember(memory, "expired", {
    tags: ["runtime"],
    kind: SemanticMemoryKind.SEMANTIC,
    temporal: { validTo: "2026-09-12T00:00:00Z" }
  });
  hits = [{ memoryId: seed.id, score: 1 }];
  for (const target of [wrongTag, wrongKind, expired]) {
    await graph.relate({
      fromMemoryId: seed.id,
      toMemoryId: target.id,
      type: SemanticMemoryRelationType.RELATED,
      provenance: provenance()
    });
  }

  const result = await intelligence.recall({
    query: "runtime",
    tags: ["runtime"],
    kinds: [SemanticMemoryKind.SEMANTIC],
    validAt: "2026-09-13T12:00:00Z"
  });

  assert.deepEqual(result.hits.map((hit) => hit.memory.id), [seed.id]);
  assert.equal(result.ranking.graphCandidates, 0);
});

test("serialized result budget is kernel-owned after fusion", async () => {
  let hits = [];
  const { memory, intelligence } = fixture({
    retrievalHits: () => hits,
    policy: { resultLimit: 4, candidateLimit: 4, maxSerializedChars: 700, graphDepth: 0 }
  });
  const one = await remember(memory, "x".repeat(200));
  const two = await remember(memory, "y".repeat(200));
  hits = [
    { memoryId: one.id, score: 1 },
    { memoryId: two.id, score: 0.9 }
  ];

  const result = await intelligence.search({ query: "bounded" });

  assert.equal(result.budget.usedItems < 2, true);
  assert.equal(result.budget.truncatedByChars, true);
  assert.equal(result.budget.usedChars <= result.budget.maxSerializedChars, true);
});

test("unknown memory kind filter fails closed instead of silently producing no matches", async () => {
  const { intelligence } = fixture({ retrievalHits: () => [] });
  await assert.rejects(
    () => intelligence.recall({ query: "x", kinds: ["UNKNOWN"] }),
    /kind is invalid/
  );
});
