import assert from "node:assert/strict";
import test from "node:test";

import {
  ExHarnessErrorCode,
  ModelRouteError,
  createAgentRuntime,
  createPredictStrategy
} from "../src/index.js";

test("unknown scoped model route fails as a stable ModelRouteError contract violation", async () => {
  const runtime = createAgentRuntime({
    strategy: createPredictStrategy({ maxAttempts: 1 }),
    model: "missing"
  });

  await assert.rejects(
    runtime.run(),
    (error) => error instanceof ModelRouteError &&
      error.code === ExHarnessErrorCode.CONTRACT_VIOLATION &&
      /model not registered: missing/.test(error.message)
  );
});
