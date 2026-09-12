import assert from "node:assert/strict";
import test from "node:test";

import {
  SemanticMemoryRetrievalMode,
  SemanticMemoryRetrievalSemantics,
  createInMemorySemanticMemoryProvider,
  createSemanticMemoryPort,
  createSemanticMemoryRetrievalPort,
  defineSemanticMemoryRetriever
} from "../src/index.js";

function memoryFixture() {
  let id = 0;
  let tick = 0;
  const memory = createSemanticMemoryPort({
    provider: createInMemorySemanticMemoryProvider(),
    idFactory: () => `memory-${++id}`,
    clock: () => `2026-09-12T18:00:${String(tick++).padStart(2, "0")}Z`
  });
  return memory;
}

async function remember(memory, content, tags = []) {
  return memory.remember({
    content,
    tags,
    provenance: { source: "fixture" }
  });
}

function retriever(hits, observed = null) {
  return defineSemanticMemoryRetriever({
    name: "reference-retriever",
    version: "v1",
    async retrieve(request) {
      observed?.push(request);
      return structuredClone(hits);
    }
  });
}

test("recall materializes authoritative memory records and preserves ranking provenance", async () => {
  const memory = memoryFixture();
  const first = await remember(memory, "use an idempotency key for external side effects", ["kafka"]);
  const second = await remember(memory, "outbox couples state change and publication", ["postgres", "kafka"]);
  const observed = [];
  const recall = createSemanticMemoryRetrievalPort({
    memory,
    retriever: retriever([
      {
        memoryId: second.id,
        score: 0.93,
        reasons: ["semantic", "keyword"],
        content: "provider must not be allowed to override stored content"
      },
      { memoryId: first.id, score: 0.81, reasons: ["semantic"] }
    ], observed),
    policy: { maxItems: 4, maxSerializedChars: 10000 }
  });

  const result = await recall.recall({ query: "duplicate Kafka delivery" });

  assert.equal(result.semantics, SemanticMemoryRetrievalSemantics);
  assert.equal(result.semantics, "RELEVANCE_ONLY");
  assert.equal(result.mode, SemanticMemoryRetrievalMode.RECALL);
  assert.deepEqual(result.retriever, { name: "reference-retriever", version: "v1" });
  assert.deepEqual(result.hits.map((hit) => hit.memory.id), [second.id, first.id]);
  assert.equal(result.hits[0].memory.content, "outbox couples state change and publication");
  assert.deepEqual(result.hits[0].relevance, {
    score: 0.93,
    reasons: ["semantic", "keyword"]
  });
  assert.deepEqual(result.hits.map((hit) => hit.rank), [1, 2]);
  assert.equal(result.budget.usedItems, 2);
  assert.ok(result.budget.usedChars > 0);
  assert.deepEqual(observed, [{
    mode: SemanticMemoryRetrievalMode.RECALL,
    query: "duplicate Kafka delivery",
    tags: [],
    limit: 4
  }]);
});

test("search uses the same bounded contract with an explicit provider mode", async () => {
  const memory = memoryFixture();
  const stored = await remember(memory, "transactional outbox", ["postgres"]);
  const observed = [];
  const retrieval = createSemanticMemoryRetrievalPort({
    memory,
    retriever: retriever([{ memoryId: stored.id, score: 1, reasons: ["exact"] }], observed)
  });

  const result = await retrieval.search({ query: "outbox", limit: 2 });

  assert.equal(result.mode, SemanticMemoryRetrievalMode.SEARCH);
  assert.equal(observed[0].mode, SemanticMemoryRetrievalMode.SEARCH);
  assert.equal(result.hits[0].memory.id, stored.id);
});

test("archived and tag-mismatched memories cannot leak through a stale retrieval index", async () => {
  const memory = memoryFixture();
  const archived = await remember(memory, "old conclusion", ["kafka"]);
  const wrongTag = await remember(memory, "redis note", ["redis"]);
  const valid = await remember(memory, "kafka note", ["kafka"]);
  await memory.archive(archived.id, { provenance: { source: "review" } });

  const retrieval = createSemanticMemoryRetrievalPort({
    memory,
    retriever: retriever([
      { memoryId: archived.id, score: 1, reasons: ["stale-index"] },
      { memoryId: wrongTag.id, score: 0.9, reasons: ["semantic"] },
      { memoryId: valid.id, score: 0.8, reasons: ["semantic"] }
    ])
  });

  const result = await retrieval.recall({ query: "kafka", tags: ["kafka"] });

  assert.deepEqual(result.hits.map((hit) => hit.memory.id), [valid.id]);
  assert.equal(result.ranking.droppedArchived, 1);
  assert.equal(result.ranking.droppedTagMismatch, 1);
});

test("retriever cannot fabricate memory IDs or duplicate ranking provenance", async () => {
  const memory = memoryFixture();
  const stored = await remember(memory, "known");

  const unknown = createSemanticMemoryRetrievalPort({
    memory,
    retriever: retriever([{ memoryId: "missing", score: 1 }])
  });
  await assert.rejects(
    () => unknown.recall({ query: "known" }),
    /semantic memory retriever returned unknown id: missing/
  );

  const duplicate = createSemanticMemoryRetrievalPort({
    memory,
    retriever: retriever([
      { memoryId: stored.id, score: 1 },
      { memoryId: stored.id, score: 0.5 }
    ])
  });
  await assert.rejects(
    () => duplicate.recall({ query: "known" }),
    /semantic memory retriever returned duplicate id/
  );
});

test("kernel-owned item and serialized-character budgets bound recall output", async () => {
  const memory = memoryFixture();
  const one = await remember(memory, "one");
  const two = await remember(memory, "two");
  const hits = [
    { memoryId: one.id, score: 1 },
    { memoryId: two.id, score: 0.9 }
  ];

  const itemBound = createSemanticMemoryRetrievalPort({
    memory,
    retriever: retriever(hits),
    policy: { maxItems: 1, maxSerializedChars: 10000 }
  });
  const oneItem = await itemBound.recall({ query: "anything", limit: 99 });
  assert.equal(oneItem.budget.effectiveMaxItems, 1);
  assert.equal(oneItem.budget.usedItems, 1);
  assert.equal(oneItem.budget.truncatedByItems, true);

  const charBound = createSemanticMemoryRetrievalPort({
    memory,
    retriever: retriever(hits),
    policy: { maxItems: 4, maxSerializedChars: 1 }
  });
  const noItems = await charBound.recall({ query: "anything" });
  assert.equal(noItems.hits.length, 0);
  assert.equal(noItems.budget.usedChars, 0);
  assert.equal(noItems.budget.truncatedByChars, true);
});

test("retrieval results are detached views and never become truth or correctness evidence", async () => {
  const memory = memoryFixture();
  const stored = await remember(memory, "advisory memory");
  const retrieval = createSemanticMemoryRetrievalPort({
    memory,
    retriever: retriever([{ memoryId: stored.id, score: 0.7, reasons: ["similar"] }])
  });

  const result = await retrieval.recall({ query: "advisory" });
  result.hits[0].memory.content = "caller mutation";

  assert.equal((await memory.get(stored.id)).content, "advisory memory");
  assert.equal("verdict" in result, false);
  assert.equal("trusted" in result, false);
  assert.equal(result.semantics, "RELEVANCE_ONLY");
});
