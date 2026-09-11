import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentEventKind,
  EvaluationValidity,
  EvaluationVerdict,
  ModelRouteScope,
  createAgentRuntime,
  createCodeActStrategy,
  createHarness,
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
  assert.equal(runtimeReport.modelUsage.adapter.name, "runtime");
  assert.equal(runtimeReport.modelUsage.calls, 1);

  const judgmentReport = await runtime.invokeJudgmentWithReport("choose", null);
  assert.equal(judgmentReport.result, "judgment");
  assert.equal(judgmentReport.modelRoute.scope, ModelRouteScope.JUDGMENT);
  assert.equal(judgmentReport.modelRoute.adapter.name, "judgment");
  assert.equal(judgmentReport.modelUsage.adapter.name, "judgment");
  assert.equal(judgmentReport.modelUsage.calls, 1);

  const invocationReport = await runtime.invokeJudgmentWithReport("choose", null, { model: "invocation" });
  assert.equal(invocationReport.result, "invocation");
  assert.equal(invocationReport.modelRoute.scope, ModelRouteScope.INVOCATION);
  assert.equal(invocationReport.modelRoute.adapter.name, "invocation");
  assert.equal(invocationReport.modelUsage.adapter.name, "invocation");
  assert.equal(invocationReport.modelUsage.calls, 1);

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

  const a = await runtime.runWithReport({ model: "a" });
  const b = await runtime.runWithReport({ model: "b" });
  assert.equal(a.result, "A");
  assert.equal(b.result, "B");
  assert.equal(a.modelUsage.calls, 1);
  assert.equal(b.modelUsage.calls, 1);
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
  assert.equal(report.modelUsage.adapter.name, "code");
  assert.equal(report.modelUsage.calls, 1);
});

test("legacy constructor-bound strategy model remains a fallback with route provenance but no runtime-owned usage proof", async () => {
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
  assert.equal(report.modelUsage, null);
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

test("model-aware custom strategy can resolve a route without using the model, and usage stays zero", async () => {
  const runtime = createAgentRuntime({
    strategy: {
      acceptsRoutedModel: true,
      async run({ model, modelRoute }) {
        assert.equal(model.name, "x");
        assert.equal(modelRoute.adapter.name, "x");
        return "no-model-call";
      }
    },
    models: [lazyModel("x", "unused-output", {})],
    model: "x"
  });

  const report = await runtime.runWithReport();
  assert.equal(report.result, "no-model-call");
  assert.equal(report.modelRoute.adapter.name, "x");
  assert.equal(report.modelUsage.adapter.name, "x");
  assert.equal(report.modelUsage.calls, 0);
});

test("model resolution failure is journaled as TASK then ERROR", async () => {
  const runtime = createAgentRuntime({
    strategy: createPredictStrategy({ maxAttempts: 1 }),
    model: "missing"
  });

  await assert.rejects(runtime.run(), /model not registered: missing/);
  assert.deepEqual(runtime.agentEvents().map((event) => event.type), [
    AgentEventKind.TASK,
    AgentEventKind.ERROR
  ]);
});

test("production createHarness composes routed model provenance through a variation", async () => {
  const loads = {};
  const harness = createHarness({
    strategy: createPredictStrategy({ maxAttempts: 1 }),
    models: [lazyModel("runtime", "done", loads)],
    model: "runtime",
    environment: {
      async observe({ request }) { return { request }; },
      async act({ candidate }) { return { mutated: false, candidate, result: null }; }
    },
    objective: {
      async evaluate() {
        return { validity: EvaluationValidity.VALID, verdict: EvaluationVerdict.PASS };
      }
    }
  });

  await harness.start({
    sessionId: "routing-facade",
    work: { objective: "prove routing composition" },
    seedCandidate: { id: "candidate", version: "v0" }
  });
  await harness.vary("routing-facade");

  assert.equal(loads.runtime, 1);
  assert.deepEqual(harness.modelRouting().default, { name: "runtime" });
  const completed = harness.events().filter((event) => event.type === "AGENT_RUN_COMPLETED").at(-1);
  assert.equal(completed.payload.modelRoute.scope, ModelRouteScope.RUNTIME);
  assert.equal(completed.payload.modelRoute.adapter.name, "runtime");
  assert.equal(completed.payload.modelUsage.adapter.name, "runtime");
  assert.equal(completed.payload.modelUsage.calls, 1);
});
