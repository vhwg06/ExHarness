import assert from "node:assert/strict";
import test from "node:test";

import { createNooaMemoryRetriever } from "../src/index.js";

test("equal ranking channels contribute zero after NOOA min-max normalization", async () => {
  const memories = new Map([
    ["a", { id: "a", content: "same", importance: 5, accessLog: [] }],
    ["b", { id: "b", content: "same", importance: 5, accessLog: [] }]
  ]);
  const retriever = createNooaMemoryRetriever({
    store: {
      async dense() { return [{ memoryId: "a", score: 0.5 }, { memoryId: "b", score: 0.5 }]; },
      async sparse() { return []; },
      async get(id) { return memories.get(id); }
    },
    config: { hops: 0 }
  });
  const rows = await retriever.explain("same", { hops: 0 });
  assert.equal(rows[0].score, 0);
  assert.equal(rows[1].score, 0);
});
