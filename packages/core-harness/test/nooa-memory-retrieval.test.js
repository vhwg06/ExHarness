import assert from "node:assert/strict";
import test from "node:test";

import { baseLevelActivation, createNooaMemoryRetriever } from "../src/nooa-memory-retrieval.js";

function memory(id, content, { importance = 5, accessLog = [], tags = [] } = {}) {
  return { id, title: id, content, importance, accessLog, tags };
}

function storeFixture() {
  const memories = new Map([
    ["dense", memory("dense", "gpu scheduling kubernetes", { importance: 4, accessLog: [{ ts: 900, channel: "recalled" }] })],
    ["sparse", memory("sparse", "kubernetes scheduling policy", { importance: 9, accessLog: [{ ts: 990, channel: "recalled" }] })],
    ["assoc", memory("assoc", "MIG placement constraint", { importance: 5 })]
  ]);
  const touches = [];
  return {
    touches,
    async dense() { return [{ memoryId: "dense", score: 0.95 }]; },
    async sparse() { return [{ memoryId: "sparse", score: 0.3 }]; },
    async get(id) { return memories.get(id) ?? null; },
    async neighbors(id) {
      return id === "dense" ? [{ targetId: "assoc", weight: 1, causal: true }] : [];
    },
    async touch(id, access) { touches.push({ id, access }); }
  };
}

test("ACT-R base level ignores injected observations", () => {
  const withInjected = baseLevelActivation([
    { ts: 990, channel: "recalled" },
    { ts: 999, channel: "injected" }
  ], 1000, 0.5);
  const recalledOnly = baseLevelActivation([{ ts: 990, channel: "recalled" }], 1000, 0.5);
  assert.equal(withInjected, recalledOnly);
});

test("NOOA recall combines hybrid candidates and associative graph spread", async () => {
  const store = storeFixture();
  const retriever = createNooaMemoryRetriever({
    store,
    now: () => 1000,
    config: { topK: 3, hops: 1, spreadGamma: 1, perHopDecay: 1 }
  });

  const hits = await retriever.retrieve({ mode: "RECALL", query: "gpu kubernetes", limit: 3 });
  assert.ok(hits.some((hit) => hit.memoryId === "dense"));
  assert.ok(hits.some((hit) => hit.memoryId === "sparse"));
  assert.ok(hits.some((hit) => hit.memoryId === "assoc"));
  assert.ok(hits.find((hit) => hit.memoryId === "assoc").reasons.some((reason) => reason.startsWith("spread:")));
  assert.equal(store.touches.length, 3);
});

test("NOOA search disables graph hop", async () => {
  const store = storeFixture();
  const retriever = createNooaMemoryRetriever({ store, now: () => 1000, config: { topK: 3, hops: 1 } });
  const hits = await retriever.retrieve({ mode: "SEARCH", query: "gpu kubernetes", limit: 3 });
  assert.deepEqual(new Set(hits.map((hit) => hit.memoryId)), new Set(["dense", "sparse"]));
});

test("recent and important memories participate in NOOA base ranking", async () => {
  const store = storeFixture();
  const retriever = createNooaMemoryRetriever({ store, now: () => 1000, config: { hops: 0, topK: 2 } });
  const rows = await retriever.explain("kubernetes scheduling", { hops: 0 });
  const sparse = rows.find((row) => row.memoryId === "sparse");
  const dense = rows.find((row) => row.memoryId === "dense");
  assert.ok(sparse.diagnostics.rec > dense.diagnostics.rec);
  assert.ok(sparse.diagnostics.imp > dense.diagnostics.imp);
});
