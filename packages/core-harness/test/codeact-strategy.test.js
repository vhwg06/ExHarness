import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentEventKind,
  CapabilityBudgetExceededError,
  CodeActExecutionTarget,
  CodeActRecovery,
  ExecutionStatus,
  ExHarnessErrorCode,
  ResourceLifetime,
  createAgentRuntime,
  createCodeActStrategy,
  defineCapability,
  defineJudgment,
  defineResource
} from "../src/index.js";

function sequenceModel(outputs, requests = []) {
  let index = 0;
  return {
    name: "sequence-model",
    async generate(request) {
      requests.push(request);
      if (index >= outputs.length) throw new Error("unexpected model turn");
      return outputs[index++];
    }
  };
}

function echoExecutor(calls = []) {
  return {
    async execute(request) {
      calls.push(request);
      return {
        status: ExecutionStatus.SUCCESS,
        output: { echoed: request.request },
        artifacts: [],
        metadata: null,
        error: null
      };
    }
  };
}

function codeActRuntime({ outputs, requests = [], executor = echoExecutor(), ...strategyOptions } = {}) {
  return createAgentRuntime({
    strategy: createCodeActStrategy({
      model: sequenceModel(outputs, requests),
      executor,
      ...strategyOptions
    })
  });
}

test("CodeAct executes, observes, then returns a terminal result", async () => {
  const requests = [];
  const executions = [];
  const runtime = codeActRuntime({
    requests,
    executor: echoExecutor(executions),
    outputs: [
      { type: "execute", target: CodeActExecutionTarget.EXECUTOR, request: { command: "inspect" } },
      { type: "return_result", value: { answer: "done" } }
    ]
  });

  assert.deepEqual(await runtime.run({ input: { task: "work" } }), { answer: "done" });
  assert.equal(executions.length, 1);
  assert.deepEqual(requests[1].observations[0].output.output, { echoed: { command: "inspect" } });
  assert.deepEqual(
    runtime.agentEvents().map((event) => event.type),
    [AgentEventKind.TASK, AgentEventKind.MODEL_OUTPUT, AgentEventKind.ACTION_OUTPUT, AgentEventKind.MODEL_OUTPUT, AgentEventKind.RESULT]
  );
});

test("CodeAct can invoke declared capabilities through runtime authority", async () => {
  const requests = [];
  const runtime = createAgentRuntime({
    capabilities: [defineCapability({
      name: "lookup",
      async execute(input) {
        return { value: input.key.toUpperCase() };
      }
    })],
    strategy: createCodeActStrategy({
      model: sequenceModel([
        { type: "execute", target: "CAPABILITY", name: "lookup", input: { key: "a" } },
        { type: "return_result", value: "A" }
      ], requests),
      executor: echoExecutor()
    })
  });

  assert.equal(await runtime.run(), "A");
  assert.deepEqual(requests[1].observations[0].output, { value: "A" });
});

test("CodeAct resource access stays behind opaque ResourceRef operations", async () => {
  const requests = [];
  const live = { secret: "never serialize", files: new Map([["README.md", "hello"]]) };
  let ref = null;
  let turn = 0;
  const model = {
    name: "resource-model",
    async generate(request) {
      requests.push(request);
      turn += 1;
      if (turn === 1) return { type: "execute", target: "RESOURCE_DESCRIBE", ref };
      if (turn === 2) return { type: "execute", target: "RESOURCE", ref, operation: "read", input: { path: "README.md" } };
      return { type: "return_result", value: "hello" };
    }
  };
  const runtime = createAgentRuntime({
    resources: [defineResource({
      name: "repo",
      lifetime: ResourceLifetime.AGENT,
      value: live,
      metadata: { kind: "repository" },
      operations: [{ name: "read", async execute(resource, input) { return { content: resource.files.get(input.path) }; } }]
    })],
    strategy: createCodeActStrategy({ model, executor: echoExecutor() })
  });
  ref = runtime.resourceRefs()[0];

  assert.equal(await runtime.run(), "hello");
  const visible = JSON.stringify(requests);
  assert.equal(visible.includes("never serialize"), false);
  assert.equal(requests[1].observations[0].output.metadata.kind, "repository");
  assert.equal(requests[2].observations[1].output.content, "hello");
});

test("invalid typed terminal output re-enters bounded correction", async () => {
  const requests = [];
  const runtime = createAgentRuntime({
    judgments: [defineJudgment({
      name: "answer",
      parseOutput(value) {
        if (typeof value !== "string") throw new TypeError("answer must be string");
        return value;
      },
      strategy: createCodeActStrategy({
        model: sequenceModel([
          { type: "return_result", value: 42 },
          { type: "return_result", value: "fixed" }
        ], requests),
        executor: echoExecutor()
      })
    })],
    strategy: { async run() { return null; } }
  });

  assert.equal(await runtime.invokeJudgment("answer", null), "fixed");
  assert.equal(requests[1].observations[0].kind, "RETURN_VALIDATION_ERROR");
  assert(runtime.agentEvents().some((event) => event.type === AgentEventKind.VALIDATION_ERROR));
});

test("plain text follows configured RETRY recovery", async () => {
  const requests = [];
  const runtime = codeActRuntime({
    requests,
    outputs: ["I think it is done", { type: "return_result", value: "done" }]
  });

  assert.equal(await runtime.run(), "done");
  assert.equal(requests[1].observations[0].kind, "TEXT_RESPONSE");
  assert(runtime.agentEvents().some((event) => event.type === AgentEventKind.ACTION_ERROR));
});

test("plain text can fail closed instead of being silently accepted", async () => {
  const runtime = codeActRuntime({
    outputs: ["done"],
    textResponseRecovery: CodeActRecovery.FAIL
  });

  await assert.rejects(
    runtime.run(),
    (error) => error.code === ExHarnessErrorCode.CODEACT_TEXT_RESPONSE
  );
});

test("malformed model actions stay bounded and exhaust turns", async () => {
  const runtime = codeActRuntime({
    outputs: [{ nope: true }, { still: "bad" }],
    maxTurns: 2
  });

  await assert.rejects(
    runtime.run(),
    (error) => error.code === ExHarnessErrorCode.CODEACT_TURN_LIMIT_EXCEEDED
  );
});

test("action budget is owned outside the model loop", async () => {
  const calls = [];
  const runtime = codeActRuntime({
    executor: echoExecutor(calls),
    maxActionCalls: 1,
    outputs: [
      { type: "execute", target: "EXECUTOR", request: { n: 1 } },
      { type: "execute", target: "EXECUTOR", request: { n: 2 } },
      { type: "return_result", value: "should-not-run" }
    ]
  });

  await assert.rejects(
    runtime.run(),
    (error) => error.code === ExHarnessErrorCode.CODEACT_ACTION_BUDGET_EXCEEDED
  );
  assert.equal(calls.length, 1);
});

test("runtime capability budget cannot be caught and hidden by CodeAct", async () => {
  const runtime = createAgentRuntime({
    capabilities: [defineCapability({ name: "ping", async execute() { return { ok: true }; } })],
    strategy: createCodeActStrategy({
      model: sequenceModel([
        { type: "execute", target: "CAPABILITY", name: "ping" },
        { type: "execute", target: "CAPABILITY", name: "ping" },
        { type: "return_result", value: "hidden" }
      ]),
      executor: echoExecutor()
    })
  });

  await assert.rejects(
    () => runtime.run({ budget: { maxCapabilityCalls: 1 } }),
    (error) => error instanceof CapabilityBudgetExceededError
  );
});

test("terminal return closes later model and executor activity", async () => {
  const requests = [];
  const executions = [];
  const runtime = codeActRuntime({
    requests,
    executor: echoExecutor(executions),
    outputs: [
      { type: "return_result", value: "terminal" },
      { type: "execute", target: "EXECUTOR", request: { forbidden: true } }
    ]
  });

  assert.equal(await runtime.run(), "terminal");
  assert.equal(requests.length, 1);
  assert.equal(executions.length, 0);
});

test("executor failures become model-visible action errors without becoming model failures", async () => {
  const requests = [];
  let calls = 0;
  const executor = {
    async execute() {
      calls += 1;
      return {
        status: ExecutionStatus.FAILED,
        output: null,
        artifacts: [],
        metadata: null,
        error: { message: "boom" }
      };
    }
  };
  const runtime = codeActRuntime({
    requests,
    executor,
    outputs: [
      { type: "execute", target: "EXECUTOR", request: { fail: true } },
      { type: "return_result", value: "recovered" }
    ]
  });

  assert.equal(await runtime.run(), "recovered");
  assert.equal(calls, 1);
  assert.equal(requests[1].observations[0].status, "ERROR");
  assert.equal(requests[1].observations[0].error.code, ExHarnessErrorCode.EXECUTION_FAILED);
});

test("model/provider failure remains distinct from executor/action failure", async () => {
  const runtime = createAgentRuntime({
    strategy: createCodeActStrategy({
      model: { name: "broken", async generate() { throw new Error("provider down"); } },
      executor: echoExecutor()
    })
  });

  await assert.rejects(runtime.run(), /provider down/);
  assert.equal(runtime.agentEvents().some((event) => event.type === AgentEventKind.ACTION_ERROR), false);
  assert.equal(runtime.agentEvents().at(-1).type, AgentEventKind.ERROR);
});

test("CodeAct rejects live/non-JSON action outputs before returning them to the model", async () => {
  const requests = [];
  const runtime = createAgentRuntime({
    capabilities: [defineCapability({
      name: "live",
      async execute() { return new Map([["secret", 1]]); }
    })],
    strategy: createCodeActStrategy({
      model: sequenceModel([
        { type: "execute", target: "CAPABILITY", name: "live" },
        { type: "return_result", value: "safe" }
      ], requests),
      executor: echoExecutor()
    })
  });

  assert.equal(await runtime.run(), "safe");
  assert.equal(requests[1].observations[0].status, "ERROR");
  assert.match(requests[1].observations[0].error.message, /plain objects and arrays/);
});
