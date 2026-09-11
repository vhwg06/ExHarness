import assert from "node:assert/strict";
import test from "node:test";

import {
  ExHarnessErrorCode,
  PredictValidationError,
  createAgentRuntime,
  createPredictStrategy,
  defineJudgment
} from "../src/index.js";

test("Predict retries validation failures and feeds the failure back to the model adapter", async () => {
  const requests = [];
  let outputParses = 0;
  const outputs = [
    { category: "INVALID" },
    { category: "A" }
  ];

  const predict = createPredictStrategy({
    maxAttempts: 3,
    model: {
      name: "fake-model",
      version: "1",
      async generate(request) {
        requests.push(request);
        return outputs.shift();
      }
    }
  });

  const runtime = createAgentRuntime({
    strategy: { async run() { throw new Error("default strategy should not run"); } },
    judgments: [
      defineJudgment({
        name: "classify",
        strategy: predict,
        parseOutput(value) {
          outputParses += 1;
          if (!value || !["A", "B"].includes(value.category)) {
            throw new Error("category must be A or B");
          }
          return Object.freeze({ category: value.category });
        }
      })
    ]
  });

  assert.deepEqual(await runtime.invokeJudgment("classify", "alpha"), { category: "A" });
  assert.equal(requests.length, 2);
  assert.equal(outputParses, 2, "successful output is not parsed a third time after Predict validation");
  assert.equal(requests[0].attempt, 1);
  assert.deepEqual(requests[0].validationFeedback, []);
  assert.equal(requests[1].attempt, 2);
  assert.equal(requests[1].validationFeedback.length, 1);
  assert.deepEqual(requests[1].validationFeedback[0].rejectedOutput, { category: "INVALID" });
  assert.equal(requests[1].validationFeedback[0].error.message, "category must be A or B");
  assert.equal(requests[1].judgment.name, "classify");
});

test("Predict fails with a stable operational error after the bounded validation budget", async () => {
  let calls = 0;
  const predict = createPredictStrategy({
    maxAttempts: 2,
    model: {
      async generate() {
        calls += 1;
        return { value: "bad" };
      }
    }
  });
  const runtime = createAgentRuntime({
    strategy: predict,
    judgments: [
      defineJudgment({
        name: "number",
        parseOutput(value) {
          if (typeof value !== "number") throw new Error("number required");
          return value;
        }
      })
    ]
  });

  await assert.rejects(
    runtime.invokeJudgment("number", null),
    (error) => {
      assert.ok(error instanceof PredictValidationError);
      assert.equal(error.code, ExHarnessErrorCode.PREDICT_VALIDATION_EXHAUSTED);
      assert.equal(error.details.attempts, 2);
      assert.equal(error.details.lastValidationError.message, "number required");
      return true;
    }
  );
  assert.equal(calls, 2);
});

test("Predict does not retry model/provider failures as if they were validation failures", async () => {
  let calls = 0;
  const providerError = new Error("provider unavailable");
  const predict = createPredictStrategy({
    maxAttempts: 5,
    model: {
      async generate() {
        calls += 1;
        throw providerError;
      }
    }
  });
  const runtime = createAgentRuntime({
    strategy: predict,
    judgments: [defineJudgment({ name: "classify" })]
  });

  await assert.rejects(runtime.invokeJudgment("classify", "x"), (error) => error === providerError);
  assert.equal(calls, 1);
});

test("Predict model request contains structured call data but no capability invocation surface", async () => {
  let seen = null;
  const predict = createPredictStrategy({
    model: {
      async generate(request) {
        seen = request;
        return "ok";
      }
    }
  });
  const runtime = createAgentRuntime({
    strategy: predict,
    capabilities: [
      {
        name: "dangerous-tool",
        execute() {
          throw new Error("must not run");
        }
      }
    ],
    judgments: [defineJudgment({ name: "predict-only" })]
  });

  assert.equal(await runtime.invokeJudgment("predict-only", "hello", {
    context: { policy: "bounded" },
    events: [{ type: "prior", content: "x" }]
  }), "ok");

  assert.equal(seen.mode, "PREDICT");
  assert.equal(seen.input, "hello");
  assert.deepEqual(seen.context, { policy: "bounded" });
  assert.deepEqual(seen.events, [{ type: "prior", content: "x" }]);
  assert.equal("invoke" in seen, false);
  assert.equal("capabilities" in seen, false);
});

test("Predict without a typed output boundary performs one focused model attempt", async () => {
  let calls = 0;
  const predict = createPredictStrategy({
    maxAttempts: 4,
    model: {
      async generate(request) {
        calls += 1;
        assert.deepEqual(request.validationFeedback, []);
        return { freeform: true };
      }
    }
  });
  const runtime = createAgentRuntime({
    strategy: predict,
    judgments: [defineJudgment({ name: "freeform" })]
  });

  assert.deepEqual(await runtime.invokeJudgment("freeform", null), { freeform: true });
  assert.equal(calls, 1);
});
