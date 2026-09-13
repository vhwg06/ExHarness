import assert from "node:assert/strict";
import test from "node:test";
import { createNooaMemoryRetriever } from "../src/nooa-memory-retrieval.js";

test("candidate present in dense and sparse pools is marked both", async () => {
  const retriever = createNooaMemoryRetriever({ store: { async dense() { return [{ memoryId: "m", score: 0.9 }]; }, async sparse() { return ["m"]; }, async get() { return { id: "m", content: "memory", importance: 5, accessLog: [] }; } }, config: { hops: 0 } });
  const rows = await retriever.explain("memory", { hops: 0 });
  assert.equal(rows[0].diagnostics.source, "both");
});
