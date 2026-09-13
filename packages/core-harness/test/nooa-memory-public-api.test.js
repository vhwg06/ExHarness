import assert from "node:assert/strict";
import test from "node:test";

import { createNooaMemoryRetriever, defineNooaRetrievalConfig } from "../src/index.js";

test("NOOA retrieval is exported from the core package", () => {
  assert.equal(typeof createNooaMemoryRetriever, "function");
  assert.equal(defineNooaRetrievalConfig().topK, 5);
});
