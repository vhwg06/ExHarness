import assert from "node:assert/strict";
import test from "node:test";

import {
  createNooaMemoryRetriever,
  createSemanticMemoryRetrievalPort
} from "../src/index.js";

test("NOOA retriever composes behind ExHarness authority boundary", async () => {
  const records = new Map([
    ["m1", { id: "m1", status: "ACTIVE", revision: 1, content: "gpu scheduling", tags: ["gpu"], importance: 5, accessLog: [] }]
  ]);
  const retriever = createNooaMemoryRetriever({
    store: {
      async dense() { return [{ memoryId: "m1", score: 0.9 }]; },
      async sparse() { return []; },
      async get(id) { return records.get(id) ?? null; },
      async neighbors() { return []; }
    },
    config: { hops: 0 }
  });
  const port = createSemanticMemoryRetrievalPort({
    memory: {
      async get(id) { return records.get(id) ?? null; }
    },
    retriever
  });

  const result = await port.recall({ query: "gpu", tags: ["gpu"] });
  assert.equal(result.hits.length, 1);
  assert.equal(result.hits[0].memory.id, "m1");
  assert.equal(result.retriever.name, "nooa-memory-retrieval");
});
