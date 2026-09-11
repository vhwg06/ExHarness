import assert from "node:assert/strict";
import test from "node:test";

import {
  ExHarnessErrorCode,
  createAgentRuntime,
  createPredictStrategy
} from "../src/index.js";

test("unknown scoped model route fails with a stable operational code", async () => {
  const runtime = createAgentRuntime({
    strategy: createPredictStrategy({ maxAttempts: 1 }),
    model: "missing"
  });

  await assert.rejects(
    runtime.run(),
    (error) => error.code === ExHarnessErrorCode.MODEL_ROUTE_INVALID && /model not registered: missing/.test(error.message)
  );
});
