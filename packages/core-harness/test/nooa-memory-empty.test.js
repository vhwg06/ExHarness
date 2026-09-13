import assert from "node:assert/strict";
import test from "node:test";

import { createNooaMemoryRetriever } from "../src/nooa-memory-retrieval.js";

test("empty candidate pools return no memories", async () => {
  const retriever = createNooaMemoryRetriever({ store: { async dense() { return []; }, async sparse() { return []; }, async get() { throw new Error("should not read"); } } });
  assert.deepEqual(await retriever.retrieve({ mode: "RECALL", query: "none" }), []);
});
