import assert from "node:assert/strict";
import test from "node:test";

import {
  ResourceLifetime,
  createAgentRuntime,
  createTraceRecorder,
  defineResource
} from "../src/index.js";

test("N7 preserves the pre-existing direct ResourceRef describe API shape", async () => {
  const runtime = createAgentRuntime({
    strategy: { async run() { return null; } },
    resources: [defineResource({
      name: "repo",
      lifetime: ResourceLifetime.AGENT,
      value: {},
      metadata: { kind: "repository" },
      operations: []
    })]
  });

  const ref = runtime.resourceRefs()[0];
  const descriptionPromise = runtime.describeResource(ref);
  assert.equal(typeof descriptionPromise?.then, "function");
  const description = await descriptionPromise;
  assert.equal(description.metadata.kind, "repository");
});

test("default runtime does not retain hidden trace history when tracing is not configured", async () => {
  const runtime = createAgentRuntime({
    strategy: { async run() { return "ok"; } }
  });

  assert.equal(await runtime.run(), "ok");
  assert.deepEqual(runtime.traces(), []);
  assert.deepEqual(runtime.traceFailures(), []);
});

test("strict trace sink failure never replaces an already-existing engineering error", async () => {
  const tracer = createTraceRecorder({
    sinks: [{ name: "broken", async write() { throw new Error("trace sink down"); } }],
    strict: true
  });
  const runtime = createAgentRuntime({
    tracer,
    strategy: {
      async run() {
        throw new Error("engineering failure");
      }
    }
  });

  await assert.rejects(runtime.run(), /engineering failure/);
  assert(runtime.traceFailures().length > 0);
});
