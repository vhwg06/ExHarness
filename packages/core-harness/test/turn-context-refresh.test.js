import assert from "node:assert/strict";
import test from "node:test";

import {
  CodeActExecutionTarget,
  ContextBlockTrust,
  ExHarnessErrorCode,
  JavaScriptSessionFeature,
  TurnEventKind,
  TurnOutcome,
  createAgentRuntime,
  createCodeActStrategy,
  createJavaScriptCodeActStrategy,
  createPredictStrategy,
  defineCapability,
  defineContextBlock,
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

function noopJavaScriptExecutor() {
  return {
    async open() {
      return {
        features: [JavaScriptSessionFeature.CELL_ABORT],
        async execute() {
          return { stdout: "", stderr: "", value: null, terminated: false };
        },
        async close() {}
      };
    }
  };
}

test("Predict resolves dynamic context once per model turn and receives runtime turn identity", async () => {
  const seen = [];
  const resolverTurns = [];
  let revision = 0;
  const runtime = createAgentRuntime({
    contextBlocks: [
      defineContextBlock({
        name: "state",
        trust: ContextBlockTrust.TRUSTED,
        resolve({ turn }) {
          resolverTurns.push(turn);
          revision += 1;
          return { revision, turn };
        }
      })
    ],
    judgments: [
      defineJudgment({
        name: "answer",
        context: { blocks: ["state"] },
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
  assert.deepEqual(resolverTurns, [1, 2]);
  assert.deepEqual(
    seen.map((request) => request.promptContext.blocks[0].value),
    [{ revision: 1, turn: 1 }, { revision: 2, turn: 2 }]
  );
  assert.deepEqual(runtime.turnEvents().map((event) => event.type), [
    TurnEventKind.BEFORE_TURN,
    TurnEventKind.AFTER_TURN,
    TurnEventKind.BEFORE_TURN,
    TurnEventKind.AFTER_TURN
  ]);
});

test("CodeAct next turn observes trusted state changed by the previous turn action", async () => {
  const seen = [];
  let state = 0;
  const runtime = createAgentRuntime({
    contextBlocks: [
      defineContextBlock({
        name: "state",
        resolve({ turn }) {
          return { state, turn };
        }
      })
    ],
    capabilities: [
      defineCapability({
        name: "bump",
        async execute() {
          state += 1;
          return { state };
        }
      })
    ],
    strategy: createCodeActStrategy({
      model: sequenceModel([
        {
          type: "execute",
          target: CodeActExecutionTarget.CAPABILITY,
          name: "bump",
          input: null
        },
        { type: "return_result", value: "done" }
      ], seen),
      executor: unusedExecutor(),
      maxTurns: 2
    })
  });

  assert.equal(await runtime.run({ contextSelection: { blocks: ["state"] } }), "done");
  assert.deepEqual(
    seen.map((request) => request.promptContext.blocks[0].value),
    [{ state: 0, turn: 1 }, { state: 1, turn: 2 }]
  );
});

test("JavaScript CodeAct consumes a fresh prompt projection for every generated cell turn", async () => {
  const seen = [];
  let revision = 0;
  const runtime = createAgentRuntime({
    contextBlocks: [
      defineContextBlock({
        name: "runtime-state",
        resolve({ turn }) {
          revision += 1;
          return { revision, turn };
        }
      })
    ],
    strategy: createJavaScriptCodeActStrategy({
      model: sequenceModel([
        { type: "execute_javascript", code: "const first = 1;" },
        { type: "execute_javascript", code: "const second = 2;" }
      ], seen),
      executor: noopJavaScriptExecutor(),
      maxTurns: 2,
      maxCells: 2
    })
  });

  await assert.rejects(
    () => runtime.run({ contextSelection: { blocks: ["runtime-state"] } }),
    (error) => error.code === ExHarnessErrorCode.CODEACT_TURN_LIMIT_EXCEEDED
  );

  assert.deepEqual(
    seen.map((request) => request.promptContext.blocks[0].value),
    [{ revision: 1, turn: 1 }, { revision: 2, turn: 2 }]
  );
});

test("turn-two context overflow fails before a second model generation and closes the prepared turn", async () => {
  const seen = [];
  const resolverTurns = [];
  const runtime = createAgentRuntime({
    contextBlocks: [
      defineContextBlock({
        name: "growing",
        resolve({ turn }) {
          resolverTurns.push(turn);
          return turn === 1 ? "ok" : "x".repeat(2_000);
        }
      })
    ],
    contextPolicy: { maxSerializedChars: 512 },
    strategy: createCodeActStrategy({
      model: sequenceModel(["retry"], seen),
      executor: unusedExecutor(),
      maxTurns: 2
    })
  });

  await assert.rejects(
    () => runtime.run({ contextSelection: { blocks: ["growing"] } }),
    (error) => error.code === ExHarnessErrorCode.CONTEXT_LIMIT_EXCEEDED
  );

  assert.equal(seen.length, 1, "turn-two context must fail before model generation");
  assert.deepEqual(resolverTurns, [1, 2]);
  const turns = runtime.turnEvents();
  assert.deepEqual(turns.map((event) => event.turn), [1, 1, 2, 2]);
  assert.equal(turns[1].payload.outcome, TurnOutcome.CONTINUE);
  assert.equal(turns[3].payload.outcome, TurnOutcome.ERROR);
  assert.equal(turns[3].payload.final, true);
  assert.equal(turns[3].payload.detail.stage, "CONTEXT_RENDER");
});

test("single-turn Predict does not pay an extra eager dynamic-context resolution", async () => {
  let resolutions = 0;
  const seen = [];
  const runtime = createAgentRuntime({
    contextBlocks: [
      defineContextBlock({
        name: "state",
        resolve() {
          resolutions += 1;
          return { resolutions };
        }
      })
    ],
    strategy: createPredictStrategy({
      model: sequenceModel(["ok"], seen),
      maxAttempts: 1
    })
  });

  assert.equal(await runtime.run({ contextSelection: { blocks: ["state"] } }), "ok");
  assert.equal(resolutions, 1);
  assert.equal(seen[0].promptContext.blocks[0].value.resolutions, 1);
});
