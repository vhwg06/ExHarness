import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentEventKind,
  CodeActExecutionTarget,
  TurnOutcome,
  createAgentRuntime,
  createCodeActStrategy,
  createPredictStrategy,
  defineCapability,
  defineJudgment
} from "../src/index.js";

function sequenceModel(outputs, seen = []) {
  let index = 0;
  return {
    name: "sequence-model",
    async generate(request) {
      seen.push(request);
      if (index >= outputs.length) throw new Error("unexpected model turn");
      return outputs[index++];
    }
  };
}

function unusedExecutor() {
  return {
    async execute() {
      throw new Error("executor should not be used");
    }
  };
}

function actionThenResult(seen) {
  return createCodeActStrategy({
    model: sequenceModel([
      {
        type: "execute",
        target: CodeActExecutionTarget.CAPABILITY,
        name: "step",
        input: null
      },
      { type: "return_result", value: "done" }
    ], seen),
    executor: unusedExecutor(),
    maxTurns: 2
  });
}

function stepCapability() {
  return defineCapability({
    name: "step",
    async execute() {
      return { stepped: true };
    }
  });
}

test("CodeAct turn two sees completed turn-one model/action events but not the current TASK", async () => {
  const seen = [];
  const runtime = createAgentRuntime({
    capabilities: [stepCapability()],
    strategy: actionThenResult(seen)
  });

  assert.equal(await runtime.run({ contextSelection: { history: true } }), "done");

  assert.equal(seen[0].history.mode, "EVENTS");
  assert.deepEqual(seen[0].history.events, []);
  assert.deepEqual(
    seen[1].history.events.map((event) => event.type),
    [AgentEventKind.MODEL_OUTPUT, AgentEventKind.ACTION_OUTPUT]
  );
  assert.equal(
    seen[1].history.events.some((event) => event.type === AgentEventKind.TASK),
    false
  );
  assert.deepEqual(
    seen[1].history.sourceEventIds,
    seen[1].history.events.map((event) => event.id)
  );
});

test("Predict retry history includes the previous model output and validation failure", async () => {
  const seen = [];
  const runtime = createAgentRuntime({
    judgments: [
      defineJudgment({
        name: "answer",
        context: { history: true },
        parseOutput(value) {
          if (typeof value !== "string") throw new TypeError("answer must be string");
          return value;
        },
        strategy: createPredictStrategy({
          model: sequenceModel([42, "ok"], seen),
          maxAttempts: 2
        })
      })
    ],
    strategy: { async run() { return null; } }
  });

  assert.equal(await runtime.invokeJudgment("answer", null), "ok");
  assert.deepEqual(seen[0].history.events, []);
  assert.deepEqual(
    seen[1].history.events.map((event) => event.type),
    [AgentEventKind.MODEL_OUTPUT, AgentEventKind.VALIDATION_ERROR]
  );
});

test("per-turn reduction evolves from canonical events without rewriting them", async () => {
  const seen = [];
  const reducerTurns = [];
  const runtime = createAgentRuntime({
    capabilities: [stepCapability()],
    strategy: actionThenResult(seen)
  });

  assert.equal(await runtime.run({
    contextSelection: {
      history: true,
      reduceHistory(events, { turn }) {
        reducerTurns.push(turn);
        if (events[0]) events[0].payload.output = "tampered-reducer-input";
        return {
          turn,
          count: events.length,
          types: events.map((event) => event.type)
        };
      }
    }
  }), "done");

  assert.deepEqual(reducerTurns, [1, 2]);
  assert.equal(seen[0].history.mode, "REDUCED");
  assert.deepEqual(seen[0].history.summary, { turn: 1, count: 0, types: [] });
  assert.deepEqual(seen[1].history.summary, {
    turn: 2,
    count: 2,
    types: [AgentEventKind.MODEL_OUTPUT, AgentEventKind.ACTION_OUTPUT]
  });
  assert.equal(seen[1].agentEvents.length, 0);
  assert.equal(seen[1].history.sourceEventIds.length, 2);

  const canonicalModelOutput = runtime.agentEvents().find(
    (event) => event.type === AgentEventKind.MODEL_OUTPUT
  );
  assert.notEqual(canonicalModelOutput.payload.output, "tampered-reducer-input");
});

test("turn-aware selector cannot fabricate history provenance", async () => {
  const seen = [];
  const runtime = createAgentRuntime({
    capabilities: [stepCapability()],
    strategy: actionThenResult(seen)
  });

  await assert.rejects(
    () => runtime.run({
      contextSelection: {
        history: true,
        selectHistory(events, { turn }) {
          if (turn === 1) return [];
          assert(events.some((event) => event.type === AgentEventKind.ACTION_OUTPUT));
          return [{ id: "fabricated-turn-event" }];
        }
      }
    }),
    /context history selector cannot fabricate event: fabricated-turn-event/
  );

  assert.equal(seen.length, 1, "fabricated turn-two history must fail before model generation");
  const turns = runtime.turnEvents();
  assert.equal(turns.at(-1).payload.outcome, TurnOutcome.ERROR);
  assert.equal(turns.at(-1).payload.detail.stage, "CONTEXT_RENDER");
});

test("history event bounds are re-applied to the evolved turn projection", async () => {
  const seen = [];
  const runtime = createAgentRuntime({
    capabilities: [stepCapability()],
    contextPolicy: { maxHistoryEvents: 1 },
    strategy: actionThenResult(seen)
  });

  assert.equal(await runtime.run({ contextSelection: { history: true } }), "done");
  assert.deepEqual(
    seen[1].history.events.map((event) => event.type),
    [AgentEventKind.ACTION_OUTPUT]
  );
  assert.equal(
    runtime.agentEvents().filter((event) =>
      event.type === AgentEventKind.MODEL_OUTPUT || event.type === AgentEventKind.ACTION_OUTPUT
    ).length >= 3,
    true,
    "canonical history remains larger than the bounded prompt projection"
  );
});
