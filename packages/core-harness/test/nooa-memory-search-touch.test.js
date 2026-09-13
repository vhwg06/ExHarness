import assert from "node:assert/strict";
import test from "node:test";

import { createNooaMemoryRetriever } from "../src/index.js";

test("selected retrievals record recalled access without self-reinforcing injection", async () => {
  const touches = [];
  const retriever = createNooaMemoryRetriever({
    store: {
      async dense() { return [{ memoryId: "m", score: 0.9 }]; },
      async sparse() { return []; },
      async get() { return { id: "m", content: "memory", importance: 5, accessLog: [] }; },
      async touch(id, access) { touches.push({ id, access }); }
    },
    now: () => 1234,
    config: { hops: 0 }
  });
  await retriever.retrieve({ mode: "RECALL", query: "memory", limit: 1 });
  assert.equal(touches.length, 1);
  assert.equal(touches[0].access.channel, "recalled");
  assert.equal(touches[0].access.ts, 1234);
});
