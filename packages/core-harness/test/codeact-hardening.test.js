import assert from "node:assert/strict";
import test from "node:test";

import {
  CodeActExecutionTarget,
  ExHarnessErrorCode,
  ExecutionStatus,
  createAgentRuntime,
  createCodeActStrategy,
  defineCapability
} from "../src/index.js";

function sequenceModel(outputs) {
  let index = 0;
  return {
    name: "sequence-model",
    async generate() {
      if (index >= outputs.length) throw new Error("unexpected model turn");
      return outputs[index++];
    }
  };
}

function echoExecutor(output) {
  return {
    async execute() {
      return {
        status: ExecutionStatus.SUCCESS,
        output,
        artifacts: [],
        metadata: null,
        error: null
      };
    }
  };
}

test("CodeAct observation replay fails closed before oversized action output reaches another model turn", async () => {
  let modelCalls = 0;
  const runtime = createAgentRuntime({
    strategy: createCodeActStrategy({
      model: {
        name: "oversize-model",
        async generate() {
          modelCalls += 1;
          if (modelCalls === 1) {
            return {
              type: "execute",
              target: CodeActExecutionTarget.EXECUTOR,
              request: { command: "large-output" }
            };
          }
          throw new Error("oversized observation must not reach another model turn");
        }
      },
      executor: echoExecutor({ payload: "x".repeat(2_000) }),
      maxObservationChars: 256
    })
  });

  await assert.rejects(
    runtime.run(),
    (error) => error.code === ExHarnessErrorCode.CODEACT_OBSERVATION_LIMIT_EXCEEDED
  );
  assert.equal(modelCalls, 1);
});

test("CodeAct maxDurationMs bounds a non-returning model call at the orchestration boundary", async () => {
  const runtime = createAgentRuntime({
    strategy: createCodeActStrategy({
      model: {
        name: "hung-model",
        async generate() {
          return new Promise(() => {});
        }
      },
      executor: echoExecutor(null),
      maxDurationMs: 25
    })
  });

  await assert.rejects(
    runtime.run(),
    (error) => error.code === ExHarnessErrorCode.CODEACT_TIME_BUDGET_EXCEEDED
  );
});

test("CodeAct maxDurationMs also bounds a non-returning capability action", async () => {
  const runtime = createAgentRuntime({
    capabilities: [defineCapability({
      name: "hang",
      async execute() {
        return new Promise(() => {});
      }
    })],
    strategy: createCodeActStrategy({
      model: sequenceModel([
        { type: "execute", target: CodeActExecutionTarget.CAPABILITY, name: "hang" }
      ]),
      executor: echoExecutor(null),
      maxDurationMs: 25
    })
  });

  await assert.rejects(
    runtime.run(),
    (error) => error.code === ExHarnessErrorCode.CODEACT_TIME_BUDGET_EXCEEDED
  );
});
