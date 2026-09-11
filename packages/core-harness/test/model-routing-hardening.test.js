import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentEventKind,
  createAgentRuntime,
  createModelRegistry,
  createPredictStrategy
} from "../src/index.js";

test("custom registry cannot launder a different adapter identity through a requested route", async () => {
  const runtime = createAgentRuntime({
    strategy: createPredictStrategy({ maxAttempts: 1 }),
    model: "trusted-name",
    modelRegistry: {
      async resolve() {
        return {
          name: "different-model",
          version: "1",
          async generate() { return "wrong"; },
          secret: "must-not-cross-runtime-boundary"
        };
      },
      registrations() { return ["trusted-name"]; },
      loaded() { return []; }
    }
  });

  await assert.rejects(runtime.run(), /model route trusted-name resolved adapter different-model/);
  assert.deepEqual(runtime.agentEvents().map((event) => event.type), [
    AgentEventKind.TASK,
    AgentEventKind.ERROR
  ]);
});

test("failed lazy model load is not cached as a permanent failure", async () => {
  let attempts = 0;
  const registry = createModelRegistry({
    models: [{
      name: "retryable",
      async load() {
        attempts += 1;
        if (attempts === 1) throw new Error("temporary provider failure");
        return {
          name: "retryable",
          version: "2",
          async generate() { return "ok"; }
        };
      }
    }]
  });

  await assert.rejects(registry.resolve("retryable"), /temporary provider failure/);
  const adapter = await registry.resolve("retryable");
  assert.equal(adapter.name, "retryable");
  assert.equal(adapter.version, "2");
  assert.equal(attempts, 2);
});
