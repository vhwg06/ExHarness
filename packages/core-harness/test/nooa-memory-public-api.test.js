import assert from "node:assert/strict";
import test from "node:test";

import { createNooaMemoryRetriever, defineNooaRetrievalConfig } from "../src/nooa-memory-retrieval.js";

test("NOOA retrieval exposes its public adapter surface", () => {
  assert.equal(typeof createNooaMemoryRetriever, "function");
  assert.equal(defineNooaRetrievalConfig().topK, 5);
});
