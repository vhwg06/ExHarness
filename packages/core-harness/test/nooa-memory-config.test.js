import assert from "node:assert/strict";
import test from "node:test";

import { defineNooaRetrievalConfig } from "../src/nooa-memory-retrieval.js";

test("NOOA retrieval configuration preserves explicit scoring weights", () => {
  const config = defineNooaRetrievalConfig({ relevance: 0.5, recency: 0.3, importance: 0.2 });
  assert.deepEqual(config.weights, { relevance: 0.5, recency: 0.3, importance: 0.2 });
});
