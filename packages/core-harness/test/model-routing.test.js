import assert from "node:assert/strict";
import test from "node:test";

import {
  ModelRouteScope,
  createAgentRuntime,
  createCodeActStrategy,
  createModelRegistry,
  createPredictStrategy
} from "../src/index.js";

function lazyModel(name, output, loads) {
  return {
    name,
    async load() {
      loads[name] = (loads[name] ?? 0) + 1;
      return {
        name,
        version: "1",
        async generate(request) {
          if (request.mode === "CODEACT") {
            return { type: "return_result", value: output };
          }
          return output;
        }
      };
    }
  };
}

test("model routing precedence is invocation > judgment > runtime and leaves defaults unchanged", async () => {
  const loads = {};
  const strategy = createPredictStrategy({ maxAttempts: 1 });
  const runtime = createAgentRuntime({
    strategy,
    models: [
      lazyModel("runtime", "runtime", loads),
      lazyModel("judgment", "judgment", loads),
      lazyModel("invocation", "invocation", loads),
      lazyModel("unused", "unused", loads)
    ],
    model: "runtime",
    judgments: [{ name: "choose", model: "judgment" }]
  });

  const runtimeReport = await runtime.runWithReport();
  assert.equal(runtimeReport.result, "runtime");
  assert.equal(runtimeReport.modelRoute.scope, ModelRouteScope.RUNTIME);
  assert.equal(runtimeReport.modelRoute.adapter.name, "runtime");

  const judgmentReport = await runtime.invokeJudgmentWithReport("choose", null);
  assert.equal(judgmentReport.result, "judgment");
  assert.equal(judgmentReport.modelRoute.scope, ModelRouteScope.JUDGMENT);
  assert.equal(judgmentReport.modelRoute.adapter.name, "judgment");

  const invocationReport = await runtime.invokeJudgmentWithReport("choose", null, { model: "invocation" });
  assert.equal(invocationReport.result, "invocation");
  assert.equal(invocationReport.modelRoute.scope, ModelRouteScope.INVOCATION);
  assert.equal(invocationReport.modelRoute.adapter.name, "invocation");

  assert.deepEqual(runtime.modelRouting().default, { name: "runtime" });
  assert.equal(loads.runtime, 1);
  assert.equal(loads.judgment, 1);
  assert.equal(loads.invocation, 1);
  assert.equal(loads.unused, undefined);
  assert.deepEqual(runtime.modelRouting().loaded.map((item) => item.name).sort(), ["invocation", "judgment", "runtime"]);
});

test("same Predict strategy can run against different routed models", async () => {
  const loads = {};
  const strategy = createPredictStrategy({ maxAttempts: 1 });
  const runtime = createAgentRuntime({
    strategy,
    models: [lazyModel("a", "A", loads), lazyModel("b", "B", loads)]
  });

  assert.equal(await runtime.run({ model: "a" }), "A");
  assert.equal(await runtime.run({ model: "b" }), "B");
  assert.equal(loads.a, 1);
  assert.equal(loads.b, 1);
});

test("same CodeAct strategy consumes runtime-routed model", async () => {
  const loads = {};
  const strategy = createCodeActStrategy({
    executor: { async execute() { return { status: "SUCCESS", output: null }; } },
    maxTurns: 1
  });
  const runtime = createAgentRuntime({
    strategy,
    models: [lazyModel("code", { done: true }, loads)],
    model: "code"
  });

  const report = await runtime.runWithReport();
  assert.deepEqual(report.result, { done: true });
  assert.equal(report.modelRoute.scope, ModelRouteScope.RUNTIME);
  assert.equal(report.modelRoute.adapter.name, "code");
});

test("legacy constructor-bound strategy model remains a fallback with provenance", async () => {
  const strategy = createPredictStrategy({
    model: {
      name: "legacy",
      version: "1",
      async generate() { return "legacy"; }
    },
    maxAttempts: 1
  });
  const runtime = createAgentRuntime({ strategy });
  const report = await runtime.runWithReport();

  assert.equal(report.result, "legacy");
  assert.equal(report.modelRoute.scope, ModelRouteScope.STRATEGY);
  assert.equal(report.modelRoute.adapter.name, "legacy");
});

test("unused lazy adapters are not instantiated and concurrent resolution loads once", async () => {
  let loads = 0;
  const registry = createModelRegistry({
    models: [{
      name: "shared",
      async load() {
        loads += 1;
        await Promise.resolve();
        return { name: "shared", async generate() { return null; } };
      }
    }]
  });

  const [a, b] = await Promise.all([registry.resolve("shared"), registry.resolve("shared")]);
  assert.equal(a, b);
  assert.equal(loads, 1);
});

test("routing cannot be silently ignored by a strategy that does not opt in", async () => {
  let calls = 0;
  const runtime = createAgentRuntime({
    strategy: {
      async run() {
        calls += 1;
        return "should-not-run";
      }
    },
    models: [lazyModel("x", "x", {})],
    model: "x"
  });

  await assert.rejects(runtime.run(), /does not support model routing/);
  assert.equal(calls, 0);
});
