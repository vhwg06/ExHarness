import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentEventKind,
  ExHarnessErrorCode,
  JavaScriptHostRequestType,
  TraceSpanKind,
  createAgentRuntime,
  createJavaScriptCodeActStrategy,
  createTraceRecorder,
  defineLiveObjectSurface
} from "../src/index.js";

function sequenceModel(outputs) {
  let index = 0;
  return {
    name: "javascript-codeact-test",
    version: "1",
    async generate() {
      if (index >= outputs.length) throw new Error("unexpected model call");
      return outputs[index++];
    }
  };
}

function scriptedExecutor(handlers) {
  const metrics = { opens: 0, closes: 0, executes: 0, codes: [], locals: new Map() };
  return {
    metrics,
    async open({ host }) {
      metrics.opens += 1;
      return {
        async execute(request) {
          metrics.executes += 1;
          metrics.codes.push(request.code);
          const handler = handlers[request.code];
          if (!handler) throw new SyntaxError(`unknown fake cell: ${request.code}`);
          return handler({ host, locals: metrics.locals, request });
        },
        async close() { metrics.closes += 1; }
      };
    }
  };
}

function nodeSurface() {
  return defineLiveObjectSurface({
    id: "js-codeact.node",
    type: "Node",
    methods: [{ name: "rename", mutates: true }],
    properties: [{ name: "name", read: (node) => node.name }]
  });
}

test("JavaScript CodeAct keeps one persistent session and terminates only through in-session return_result", async () => {
  const node = { name: "before", rename(name) { this.name = name; return this.name; } };
  const executor = scriptedExecutor({
    "cell-one": async ({ host, locals }) => {
      const ref = locals.get("root");
      const doc = await host.request({ type: JavaScriptHostRequestType.DOC_LIVE, ref, mode: "FULL" });
      assert.ok(doc.document.members.some((member) => member.name === "rename"));
      await host.request({ type: JavaScriptHostRequestType.INVOKE_LIVE, ref, name: "rename", args: ["after"] });
      locals.set("observed", await host.request({ type: JavaScriptHostRequestType.READ_LIVE, ref, name: "name" }));
      return { stdout: "first", stderr: "", value: null };
    },
    "cell-two": async ({ host, locals }) => {
      assert.equal(locals.get("observed"), "after");
      await host.request({ type: JavaScriptHostRequestType.RETURN_RESULT, value: locals.get("observed") });
      return { stdout: "second", stderr: "", value: 2 };
    }
  });
  const strategy = createJavaScriptCodeActStrategy({
    model: sequenceModel([
      { type: "execute_javascript", code: "cell-one" },
      { type: "execute_javascript", code: "cell-two" }
    ]),
    executor
  });
  const runtime = createAgentRuntime({
    strategy,
    liveObjects: [{ name: "root", value: node, surface: nodeSurface() }]
  });
  executor.metrics.locals.set("root", runtime.liveObjects()[0].ref);

  assert.equal(await runtime.run(), "after");
  assert.equal(node.name, "after");
  assert.deepEqual(executor.metrics.codes, ["cell-one", "cell-two"]);
  assert.equal(executor.metrics.opens, 1);
  assert.equal(executor.metrics.closes, 1);
});

test("typed terminal validation feeds correction back into the bounded JavaScript loop", async () => {
  const executor = scriptedExecutor({
    invalid: async ({ host }) => {
      await host.request({ type: JavaScriptHostRequestType.RETURN_RESULT, value: "bad" });
      return { stdout: "", stderr: "", value: null };
    },
    valid: async ({ host }) => {
      await host.request({ type: JavaScriptHostRequestType.RETURN_RESULT, value: 7 });
      return { stdout: "", stderr: "", value: null };
    }
  });
  const strategy = createJavaScriptCodeActStrategy({
    model: sequenceModel([
      { type: "execute_javascript", code: "invalid" },
      { type: "execute_javascript", code: "valid" }
    ]),
    executor
  });
  const runtime = createAgentRuntime({
    strategy: { async run() { return null; } },
    judgments: [{
      name: "answer",
      strategy,
      parseOutput(value) {
        if (!Number.isInteger(value)) throw new TypeError("integer required");
        return value;
      }
    }]
  });

  assert.equal(await runtime.invokeJudgment("answer", null), 7);
  assert.equal(runtime.agentEvents().filter((event) => event.type === AgentEventKind.VALIDATION_ERROR).length, 1);
  assert.equal(executor.metrics.executes, 2);
});

test("direct model terminal actions are protocol errors and never bypass the JavaScript session", async () => {
  const executor = scriptedExecutor({});
  const strategy = createJavaScriptCodeActStrategy({
    model: sequenceModel([{ type: "return_result", value: "smuggled" }]),
    executor,
    maxTurns: 1
  });
  const runtime = createAgentRuntime({ strategy });
  await assert.rejects(
    runtime.run(),
    (error) => error.code === ExHarnessErrorCode.CODEACT_TURN_LIMIT_EXCEEDED
  );
  assert.equal(executor.metrics.executes, 0);
  assert.equal(executor.metrics.closes, 1);
});

test("host bridge preserves live-object authority and lets execution recover from forbidden calls", async () => {
  const target = { safe() { return "safe"; }, forbidden() { return "bad"; } };
  const surface = defineLiveObjectSurface({
    id: "js-codeact.authority",
    methods: [{ name: "safe" }]
  });
  let ref;
  const executor = scriptedExecutor({
    forbidden: async ({ host }) => {
      await host.request({ type: JavaScriptHostRequestType.INVOKE_LIVE, ref, name: "forbidden", args: [] });
      return { stdout: "", stderr: "", value: null };
    },
    recover: async ({ host }) => {
      const value = await host.request({ type: JavaScriptHostRequestType.INVOKE_LIVE, ref, name: "safe", args: [] });
      await host.request({ type: JavaScriptHostRequestType.RETURN_RESULT, value });
      return { stdout: "", stderr: "", value: null };
    }
  });
  const strategy = createJavaScriptCodeActStrategy({
    model: sequenceModel([
      { type: "execute_javascript", code: "forbidden" },
      { type: "execute_javascript", code: "recover" }
    ]),
    executor
  });
  const runtime = createAgentRuntime({
    strategy,
    liveObjects: [{ name: "target", value: target, surface }]
  });
  ref = runtime.liveObjects()[0].ref;

  assert.equal(await runtime.run(), "safe");
  const actionErrors = runtime.agentEvents().filter((event) => event.type === AgentEventKind.ACTION_ERROR);
  assert.equal(actionErrors.length, 1);
  assert.equal(actionErrors[0].payload.error.code, ExHarnessErrorCode.LIVE_OBJECT_MEMBER_NOT_ALLOWED);
});

test("stdout is deterministically bounded before becoming a model-visible observation", async () => {
  const executor = scriptedExecutor({
    loud: async ({ host }) => {
      await host.request({ type: JavaScriptHostRequestType.RETURN_RESULT, value: "ok" });
      return { stdout: "x".repeat(100), stderr: "", value: null };
    }
  });
  const runtime = createAgentRuntime({
    strategy: createJavaScriptCodeActStrategy({
      model: sequenceModel([{ type: "execute_javascript", code: "loud" }]),
      executor,
      maxOutputChars: 8
    })
  });
  assert.equal(await runtime.run(), "ok");
  const action = runtime.agentEvents().find((event) => event.type === AgentEventKind.ACTION_OUTPUT);
  assert.equal(action.payload.stdout, "xxxxxxxx");
  assert.equal(action.payload.stdoutTruncated, true);
});

test("recoverable JavaScript execution errors remain observations while sandbox infrastructure failures propagate", async () => {
  const recovering = scriptedExecutor({
    broken: async () => { throw new SyntaxError("bad syntax"); },
    finish: async ({ host }) => {
      await host.request({ type: JavaScriptHostRequestType.RETURN_RESULT, value: true });
      return { stdout: "", stderr: "", value: null };
    }
  });
  const runtime = createAgentRuntime({
    strategy: createJavaScriptCodeActStrategy({
      model: sequenceModel([
        { type: "execute_javascript", code: "broken" },
        { type: "execute_javascript", code: "finish" }
      ]),
      executor: recovering
    })
  });
  assert.equal(await runtime.run(), true);
  assert.equal(runtime.agentEvents().filter((event) => event.type === AgentEventKind.ACTION_ERROR).length, 1);

  const crashing = scriptedExecutor({
    crash: async () => {
      const error = new Error("sandbox process died");
      error.code = ExHarnessErrorCode.EXECUTION_ABORTED;
      throw error;
    }
  });
  const crashed = createAgentRuntime({
    strategy: createJavaScriptCodeActStrategy({
      model: sequenceModel([{ type: "execute_javascript", code: "crash" }]),
      executor: crashing
    })
  });
  await assert.rejects(crashed.run(), (error) => error.code === ExHarnessErrorCode.EXECUTION_ABORTED);
  assert.equal(crashing.metrics.closes, 1);
});

test("host-call budget is kernel-owned and terminal closes host authority within the same cell", async () => {
  let ref;
  const target = { read() { return 1; } };
  const surface = defineLiveObjectSurface({ id: "js-codeact.budget", methods: [{ name: "read" }] });
  const executor = scriptedExecutor({
    over: async ({ host }) => {
      await host.request({ type: JavaScriptHostRequestType.INVOKE_LIVE, ref, name: "read", args: [] });
      await host.request({ type: JavaScriptHostRequestType.INVOKE_LIVE, ref, name: "read", args: [] });
      return { stdout: "", stderr: "", value: null };
    }
  });
  const runtime = createAgentRuntime({
    strategy: createJavaScriptCodeActStrategy({
      model: sequenceModel([{ type: "execute_javascript", code: "over" }]),
      executor,
      maxHostCalls: 1
    }),
    liveObjects: [{ name: "target", value: target, surface }]
  });
  ref = runtime.liveObjects()[0].ref;
  await assert.rejects(runtime.run(), (error) => error.code === ExHarnessErrorCode.CODEACT_ACTION_BUDGET_EXCEEDED);

  const terminalExecutor = scriptedExecutor({
    terminal: async ({ host }) => {
      await host.request({ type: JavaScriptHostRequestType.RETURN_RESULT, value: "done" });
      await host.request({ type: JavaScriptHostRequestType.CALL_CAPABILITY, name: "never", input: null });
      return { stdout: "", stderr: "", value: null };
    }
  });
  const terminalRuntime = createAgentRuntime({
    strategy: createJavaScriptCodeActStrategy({
      model: sequenceModel([{ type: "execute_javascript", code: "terminal" }]),
      executor: terminalExecutor,
      maxTurns: 1
    })
  });
  await assert.rejects(terminalRuntime.run(), (error) => error.code === ExHarnessErrorCode.CODEACT_TURN_LIMIT_EXCEEDED);
});

test("session execution participates in the existing causal trace tree", async () => {
  const tracer = createTraceRecorder();
  const executor = scriptedExecutor({
    finish: async ({ host }) => {
      await host.request({ type: JavaScriptHostRequestType.RETURN_RESULT, value: true });
      return { stdout: "", stderr: "", value: null };
    }
  });
  const runtime = createAgentRuntime({
    tracer,
    strategy: createJavaScriptCodeActStrategy({
      model: sequenceModel([{ type: "execute_javascript", code: "finish" }]),
      executor
    })
  });
  assert.equal(await runtime.run(), true);
  const spans = runtime.traces();
  assert.ok(spans.some((span) => span.kind === TraceSpanKind.MODEL));
  assert.ok(spans.some((span) => span.kind === TraceSpanKind.EXECUTION && span.name === "javascript.session.execute"));
});
