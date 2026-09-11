import assert from "node:assert/strict";
import test from "node:test";

import {
  CodeActExecutionTarget,
  ExHarnessErrorCode,
  ResourceLifetime,
  TraceSpanKind,
  TraceSpanStatus,
  createAgentRuntime,
  createCodeActStrategy,
  createEventBus,
  createPredictStrategy,
  createTraceRecorder,
  defineCapability,
  defineJudgment,
  defineResource,
  instrumentAgentRuntime
} from "../src/index.js";

function deterministicTracer(options = {}) {
  let tick = 0;
  let id = 0;
  return createTraceRecorder({
    clock: () => ++tick,
    idFactory: () => `span-${++id}`,
    ...options
  });
}

function parentOf(spans, child) {
  return spans.find((span) => span.spanId === child.parentSpanId) ?? null;
}

test("Predict judgment produces one causal trace tree correlated to the AgentEvent call", async () => {
  const tracer = deterministicTracer();
  const runtime = createAgentRuntime({
    tracer,
    strategy: createPredictStrategy({
      model: {
        name: "predict-model",
        async generate() {
          return "ok";
        }
      }
    }),
    judgments: [defineJudgment({
      name: "answer",
      parseOutput(value) {
        if (typeof value !== "string") throw new TypeError("string required");
        return value;
      }
    })]
  });

  const report = await runtime.invokeJudgmentWithReport("answer", null);
  assert.equal(report.result, "ok");

  const spans = runtime.traces();
  const root = spans.find((span) => span.kind === TraceSpanKind.JUDGMENT);
  const strategy = spans.find((span) => span.kind === TraceSpanKind.STRATEGY);
  const attempt = spans.find((span) => span.kind === TraceSpanKind.PREDICT_ATTEMPT);
  const model = spans.find((span) => span.kind === TraceSpanKind.MODEL);

  assert(root);
  assert(strategy);
  assert(attempt);
  assert(model);
  assert.equal(root.parentSpanId, null);
  assert.equal(strategy.parentSpanId, root.spanId);
  assert.equal(attempt.parentSpanId, strategy.spanId);
  assert.equal(model.parentSpanId, attempt.spanId);
  assert(spans.every((span) => span.traceId === root.traceId));
  assert(spans.every((span) => span.callId === report.callId));
  assert.equal(root.status, TraceSpanStatus.OK);
});

test("CodeAct nests execution, capability and resource spans under action authority", async () => {
  const tracer = deterministicTracer();
  let turn = 0;
  const runtime = createAgentRuntime({
    tracer,
    capabilities: [defineCapability({
      name: "lookup",
      async execute(input) {
        return { value: input.key.toUpperCase() };
      }
    })],
    resources: [defineResource({
      name: "repo",
      lifetime: ResourceLifetime.AGENT,
      value: { files: new Map([["README.md", "hello"]]) },
      operations: [{
        name: "read",
        async execute(resource, input) {
          return { content: resource.files.get(input.path) };
        }
      }]
    })],
    strategy: createCodeActStrategy({
      executor: {
        async execute(request) {
          return {
            status: "SUCCESS",
            output: { request: request.request },
            artifacts: [],
            metadata: null,
            error: null
          };
        }
      },
      model: {
        name: "codeact-model",
        async generate(request) {
          turn += 1;
          if (turn === 1) {
            return { type: "execute", target: CodeActExecutionTarget.EXECUTOR, request: { command: "inspect" } };
          }
          if (turn === 2) {
            return { type: "execute", target: CodeActExecutionTarget.CAPABILITY, name: "lookup", input: { key: "a" } };
          }
          if (turn === 3) {
            return {
              type: "execute",
              target: CodeActExecutionTarget.RESOURCE,
              ref: request.resources[0],
              operation: "read",
              input: { path: "README.md" }
            };
          }
          return { type: "return_result", value: "done" };
        }
      }
    })
  });

  assert.equal(await runtime.run(), "done");
  const spans = runtime.traces();
  const root = spans.find((span) => span.kind === TraceSpanKind.AGENT_RUN);
  const strategy = spans.find((span) => span.kind === TraceSpanKind.STRATEGY);
  const actions = spans.filter((span) => span.kind === TraceSpanKind.ACTION);
  const execution = spans.find((span) => span.kind === TraceSpanKind.EXECUTION);
  const capability = spans.find((span) => span.kind === TraceSpanKind.CAPABILITY);
  const resource = spans.find((span) => span.kind === TraceSpanKind.RESOURCE);
  const models = spans.filter((span) => span.kind === TraceSpanKind.MODEL);

  assert.equal(strategy.parentSpanId, root.spanId);
  assert.equal(actions.length, 3);
  assert.equal(models.length, 4);
  assert.equal(execution.parentSpanId, actions[0].spanId);
  assert.equal(capability.parentSpanId, actions[1].spanId);
  assert.equal(resource.parentSpanId, actions[2].spanId);
  assert.equal(new Set(actions.map((span) => span.spanId)).size, actions.length);
  assert(spans.every((span) => span.traceId === root.traceId));
});

test("concurrent runtime calls keep distinct trace roots and correlation IDs", async () => {
  const tracer = deterministicTracer();
  const runtime = createAgentRuntime({
    tracer,
    strategy: {
      kind: "CUSTOM",
      async run({ input }) {
        await new Promise((resolve) => setTimeout(resolve, input.delay));
        return input.name;
      }
    }
  });

  const [a, b] = await Promise.all([
    runtime.runWithReport({ input: { name: "a", delay: 5 } }),
    runtime.runWithReport({ input: { name: "b", delay: 1 } })
  ]);
  assert.equal(a.result, "a");
  assert.equal(b.result, "b");
  assert.notEqual(a.callId, b.callId);

  const roots = runtime.traces().filter((span) => span.kind === TraceSpanKind.AGENT_RUN);
  assert.equal(roots.length, 2);
  assert.notEqual(roots[0].traceId, roots[1].traceId);
  assert.deepEqual(new Set(roots.map((span) => span.callId)), new Set([a.callId, b.callId]));
});

test("a recoverable capability failure remains an error child span while the CodeAct root can succeed", async () => {
  const tracer = deterministicTracer();
  let turn = 0;
  const runtime = createAgentRuntime({
    tracer,
    capabilities: [defineCapability({
      name: "flaky",
      async execute() {
        throw new Error("temporary");
      }
    })],
    strategy: createCodeActStrategy({
      executor: { async execute() { throw new Error("unused"); } },
      model: {
        name: "model",
        async generate() {
          turn += 1;
          return turn === 1
            ? { type: "execute", target: CodeActExecutionTarget.CAPABILITY, name: "flaky" }
            : { type: "return_result", value: "recovered" };
        }
      }
    })
  });

  assert.equal(await runtime.run(), "recovered");
  const spans = runtime.traces();
  const capability = spans.find((span) => span.kind === TraceSpanKind.CAPABILITY);
  const action = parentOf(spans, capability);
  const root = spans.find((span) => span.kind === TraceSpanKind.AGENT_RUN);
  assert.equal(capability.status, TraceSpanStatus.ERROR);
  assert.equal(action.kind, TraceSpanKind.ACTION);
  assert.equal(action.status, TraceSpanStatus.ERROR);
  assert.equal(root.status, TraceSpanStatus.OK);
});

test("non-strict trace sink failure is observable without changing runtime result", async () => {
  const tracer = deterministicTracer({
    sinks: [{ name: "broken", async write() { throw new Error("sink down"); } }],
    strict: false
  });
  const runtime = createAgentRuntime({
    tracer,
    strategy: { async run() { return "ok"; } }
  });

  assert.equal(await runtime.run(), "ok");
  assert(runtime.traceFailures().length > 0);
  assert(runtime.traces().length > 0);
});

test("strict trace sink failure propagates and cannot be repaired by CodeAct", async () => {
  const tracer = deterministicTracer({
    sinks: [{ name: "required", async write() { throw new Error("sink down"); } }],
    strict: true
  });
  const runtime = createAgentRuntime({
    tracer,
    strategy: createCodeActStrategy({
      executor: {
        async execute() {
          return { status: "SUCCESS", output: { ok: true }, artifacts: [], metadata: null, error: null };
        }
      },
      model: {
        name: "model",
        async generate() {
          return { type: "execute", target: CodeActExecutionTarget.EXECUTOR, request: { ok: true } };
        }
      }
    })
  });

  await assert.rejects(
    runtime.run(),
    (error) => error.code === ExHarnessErrorCode.TRACE_SINK_FAILED
  );
});

test("judgment parse failure marks the judgment root ERROR instead of leaving a false successful trace", async () => {
  const tracer = deterministicTracer();
  const runtime = createAgentRuntime({
    tracer,
    strategy: {
      kind: "CUSTOM",
      async run() {
        return 42;
      }
    },
    judgments: [defineJudgment({
      name: "typed",
      parseOutput(value) {
        if (typeof value !== "string") throw new TypeError("string required");
        return value;
      }
    })]
  });

  await assert.rejects(runtime.invokeJudgment("typed", null), /string required/);
  const root = runtime.traces().find((span) => span.kind === TraceSpanKind.JUDGMENT);
  assert.equal(root.status, TraceSpanStatus.ERROR);
  assert.equal(root.error.name, "TypeError");
});

test("flat observability instrumentation preserves the independent trace surface", async () => {
  const tracer = deterministicTracer();
  const runtime = instrumentAgentRuntime(
    createAgentRuntime({ tracer, strategy: { async run() { return "ok"; } } }),
    createEventBus()
  );

  assert.equal(await runtime.run(), "ok");
  assert.equal(typeof runtime.traces, "function");
  assert.equal(typeof runtime.traceFailures, "function");
  assert(runtime.traces().length > 0);
});
