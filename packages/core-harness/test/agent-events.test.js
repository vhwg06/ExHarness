import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentEventKind,
  createAgentEventStore,
  createAgentRuntime,
  createEventBus,
  createPredictStrategy,
  defineJudgment,
  instrumentAgentRuntime
} from "../src/index.js";

function deterministicEventStore() {
  let id = 0;
  let tick = 0;
  return createAgentEventStore({
    idFactory: () => `agent-${++id}`,
    clock: () => `2026-09-11T00:00:${String(tick++).padStart(2, "0")}.000Z`
  });
}

test("Predict records chronological working history separately from telemetry", async () => {
  const eventStore = deterministicEventStore();
  const outputs = [{ category: "INVALID" }, { category: "A" }];
  const predict = createPredictStrategy({
    maxAttempts: 3,
    model: {
      name: "fake-model",
      version: "1",
      async generate() {
        return outputs.shift();
      }
    }
  });
  const runtime = createAgentRuntime({
    strategy: predict,
    agentEventStore: eventStore,
    judgments: [
      defineJudgment({
        name: "classify",
        parseOutput(value) {
          if (!value || value.category !== "A") throw new Error("category must be A");
          return { category: value.category };
        }
      })
    ]
  });

  const report = await runtime.invokeJudgmentWithReport("classify", "alpha");
  assert.deepEqual(report.result, { category: "A" });

  const events = runtime.agentEvents();
  assert.deepEqual(events.map((event) => event.type), [
    AgentEventKind.TASK,
    AgentEventKind.MODEL_OUTPUT,
    AgentEventKind.VALIDATION_ERROR,
    AgentEventKind.MODEL_OUTPUT,
    AgentEventKind.RESULT
  ]);
  assert.ok(events.every((event) => event.callId === report.callId));
  assert.equal(events[0].judgment.name, "classify");
  assert.deepEqual(events[0].payload.input, "alpha");
  assert.equal(events[1].payload.attempt, 1);
  assert.deepEqual(events[2].payload.rejectedOutput, { category: "INVALID" });
  assert.equal(events[3].payload.attempt, 2);
  assert.deepEqual(events[4].payload.result, { category: "A" });
});

test("provider failure records ERROR and never fabricates RESULT", async () => {
  const providerError = new Error("provider unavailable");
  const runtime = createAgentRuntime({
    agentEventStore: deterministicEventStore(),
    strategy: createPredictStrategy({
      model: {
        async generate() {
          throw providerError;
        }
      }
    }),
    judgments: [defineJudgment({ name: "classify" })]
  });

  await assert.rejects(runtime.invokeJudgment("classify", "x"), (error) => error === providerError);

  const events = runtime.agentEvents();
  assert.deepEqual(events.map((event) => event.type), [
    AgentEventKind.TASK,
    AgentEventKind.ERROR
  ]);
  assert.equal(events[1].payload.error.message, "provider unavailable");
  assert.equal(events.some((event) => event.type === AgentEventKind.RESULT), false);
});

test("typed output failure outside Predict records ERROR instead of a false RESULT", async () => {
  const runtime = createAgentRuntime({
    agentEventStore: deterministicEventStore(),
    strategy: {
      async run() {
        return { category: "INVALID" };
      }
    },
    judgments: [
      defineJudgment({
        name: "classify",
        parseOutput(value) {
          if (value?.category !== "A") throw new Error("invalid category");
          return value;
        }
      })
    ]
  });

  await assert.rejects(runtime.invokeJudgment("classify", null), /invalid category/);
  assert.deepEqual(runtime.agentEvents().map((event) => event.type), [
    AgentEventKind.TASK,
    AgentEventKind.ERROR
  ]);
});

test("each invocation receives a distinct call ID while history remains chronological", async () => {
  const runtime = createAgentRuntime({
    agentEventStore: deterministicEventStore(),
    strategy: {
      async run({ input, recordAgentEvent }) {
        recordAgentEvent(AgentEventKind.MODEL_OUTPUT, { output: input });
        return input;
      }
    }
  });

  const first = await runtime.runWithReport({ input: "a" });
  const second = await runtime.runWithReport({ input: "b" });

  assert.notEqual(first.callId, second.callId);
  assert.deepEqual(runtime.agentEvents().map((event) => event.type), [
    AgentEventKind.TASK,
    AgentEventKind.MODEL_OUTPUT,
    AgentEventKind.RESULT,
    AgentEventKind.TASK,
    AgentEventKind.MODEL_OUTPUT,
    AgentEventKind.RESULT
  ]);
  assert.deepEqual(
    [...new Set(runtime.agentEvents().slice(0, 3).map((event) => event.callId))],
    [first.callId]
  );
  assert.deepEqual(
    [...new Set(runtime.agentEvents().slice(3).map((event) => event.callId))],
    [second.callId]
  );
});

test("strategy working-event API cannot fabricate terminal RESULT authority", async () => {
  const runtime = createAgentRuntime({
    agentEventStore: deterministicEventStore(),
    strategy: {
      async run({ recordAgentEvent }) {
        recordAgentEvent(AgentEventKind.RESULT, { result: "fake" });
        return "unreachable";
      }
    }
  });

  await assert.rejects(runtime.run({ input: "x" }), /strategy may only record MODEL_OUTPUT or VALIDATION_ERROR/);
  assert.deepEqual(runtime.agentEvents().map((event) => event.type), [
    AgentEventKind.TASK,
    AgentEventKind.ERROR
  ]);
});

test("telemetry sink failure does not erase or mutate AgentEvent history", async () => {
  const eventBus = createEventBus({
    strict: false,
    sinks: [{
      name: "broken-sink",
      async write() {
        throw new Error("telemetry unavailable");
      }
    }]
  });
  const baseRuntime = createAgentRuntime({
    agentEventStore: deterministicEventStore(),
    strategy: {
      async run({ input, recordAgentEvent }) {
        recordAgentEvent(AgentEventKind.MODEL_OUTPUT, { output: input });
        return input;
      }
    }
  });
  const runtime = instrumentAgentRuntime(baseRuntime, eventBus);

  assert.equal(await runtime.run({ input: "hello" }), "hello");
  assert.deepEqual(runtime.agentEvents().map((event) => event.type), [
    AgentEventKind.TASK,
    AgentEventKind.MODEL_OUTPUT,
    AgentEventKind.RESULT
  ]);
  assert.ok(eventBus.failures().length >= 2, "telemetry failures are recorded independently");
});
