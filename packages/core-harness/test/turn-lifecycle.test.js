import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentEventKind,
  CodeActExecutionTarget,
  ExecutionStatus,
  createAgentRuntime,
  createCodeActStrategy,
  createPredictStrategy,
  defineJudgment
} from "../src/index.js";
import { TurnEventKind, TurnOutcome } from "../src/turn-events.js";

function sequenceModel(outputs) {
  let index = 0;
  return {
    name: "sequence-model",
    async generate() {
      if (index >= outputs.length) throw new Error("unexpected model turn");
      const output = outputs[index++];
      if (output instanceof Error) throw output;
      return output;
    }
  };
}

function echoExecutor() {
  return {
    async execute(request) {
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

function assertTwoTurnLifecycle(events) {
  assert.deepEqual(events.map((event) => event.type), [
    TurnEventKind.BEFORE_TURN,
    TurnEventKind.AFTER_TURN,
    TurnEventKind.BEFORE_TURN,
    TurnEventKind.AFTER_TURN
  ]);
  assert.deepEqual(events.map((event) => event.turn), [1, 1, 2, 2]);
  assert.equal(events[0].callId, events[1].callId);
  assert.equal(events[1].callId, events[2].callId);
  assert.equal(events[2].callId, events[3].callId);
  assert.equal(events[1].payload.outcome, TurnOutcome.CONTINUE);
  assert.equal(events[1].payload.final, false);
  assert.equal(events[3].payload.outcome, TurnOutcome.RESULT);
  assert.equal(events[3].payload.final, true);
}

test("Predict emits exact runtime-only turn lifecycle across validation retry", async () => {
  const runtime = createAgentRuntime({
    strategy: { async run() { return null; } },
    judgments: [defineJudgment({
      name: "answer",
      parseOutput(value) {
        if (typeof value !== "string") throw new TypeError("answer must be string");
        return value;
      },
      strategy: createPredictStrategy({
        model: sequenceModel([42, "fixed"]),
        maxAttempts: 2
      })
    })]
  });

  assert.equal(await runtime.invokeJudgment("answer", null), "fixed");
  assertTwoTurnLifecycle(runtime.turnEvents());

  const canonicalTypes = runtime.agentEvents().map((event) => event.type);
  assert(canonicalTypes.includes(AgentEventKind.VALIDATION_ERROR));
  assert.equal(canonicalTypes.includes(TurnEventKind.BEFORE_TURN), false);
  assert.equal(canonicalTypes.includes(TurnEventKind.AFTER_TURN), false);
});

test("CodeAct closes a turn only after its action phase before opening the next model turn", async () => {
  const runtime = createAgentRuntime({
    strategy: createCodeActStrategy({
      model: sequenceModel([
        {
          type: "execute",
          target: CodeActExecutionTarget.EXECUTOR,
          request: { command: "inspect" }
        },
        { type: "return_result", value: "done" }
      ]),
      executor: echoExecutor()
    })
  });

  assert.equal(await runtime.run(), "done");
  assertTwoTurnLifecycle(runtime.turnEvents());
  assert(runtime.agentEvents().some((event) => event.type === AgentEventKind.ACTION_OUTPUT));
});

test("model failure closes the active turn exactly once as terminal ERROR", async () => {
  const runtime = createAgentRuntime({
    strategy: createPredictStrategy({
      model: sequenceModel([new Error("provider failed")]),
      maxAttempts: 1
    })
  });

  await assert.rejects(runtime.run(), /provider failed/);

  const events = runtime.turnEvents();
  assert.deepEqual(events.map((event) => event.type), [
    TurnEventKind.BEFORE_TURN,
    TurnEventKind.AFTER_TURN
  ]);
  assert.equal(events[0].turn, 1);
  assert.equal(events[1].turn, 1);
  assert.equal(events[1].payload.outcome, TurnOutcome.ERROR);
  assert.equal(events[1].payload.final, true);
  assert.equal(events[1].payload.error.message, "provider failed");
});
