import assert from "node:assert/strict";
import test from "node:test";

import {
  ContextBlockTrust,
  ExHarnessErrorCode,
  SemanticMemoryContextBlockName,
  SpontaneousRecallCadence,
  createAgentRuntime,
  createInMemorySemanticMemoryProvider,
  createPredictStrategy,
  createSemanticMemoryPort,
  createSemanticMemoryRetrievalPort,
  createSpontaneousRecallContextBlock,
  defineJudgment,
  defineSemanticMemoryRetriever
} from "../src/index.js";

function sequenceModel(outputs, seen = [], onGenerate = null) {
  let index = 0;
  return {
    name: "memory-sequence-model",
    async generate(request) {
      seen.push(request);
      onGenerate?.(request, index);
      if (index >= outputs.length) throw new Error("unexpected model turn");
      return outputs[index++];
    }
  };
}

async function memoryFixture(contents = ["topic-a", "topic-b"]) {
  let id = 0;
  let tick = 0;
  const memory = createSemanticMemoryPort({
    provider: createInMemorySemanticMemoryProvider(),
    idFactory: () => `memory-${++id}`,
    clock: () => `2026-09-12T19:00:${String(tick++).padStart(2, "0")}Z`
  });
  const records = new Map();
  for (const content of contents) {
    const record = await memory.remember({
      content,
      tags: ["runtime"],
      provenance: { source: "fixture" }
    });
    records.set(content, record);
  }
  return { memory, records };
}

function retrievalFixture(memory, records, calls) {
  return createSemanticMemoryRetrievalPort({
    memory,
    retriever: defineSemanticMemoryRetriever({
      name: "topic-index",
      version: "v1",
      async retrieve({ query }) {
        calls.push(query);
        const record = records.get(query);
        return record == null
          ? []
          : [{ memoryId: record.id, score: 1, reasons: ["fixture-exact"] }];
      }
    }),
    policy: { maxItems: 4, maxSerializedChars: 12_000 }
  });
}

function memoryBlock({ retrieval, cadence, deriveQuery }) {
  return createSpontaneousRecallContextBlock({
    retrieval,
    deriveQuery,
    policy: { cadence, limit: 2, tags: ["runtime"] }
  });
}

function recalledBlock(request) {
  return request.promptContext.blocks.find((block) => block.name === SemanticMemoryContextBlockName);
}

test("SELF_GATED recalls again only when the derived query changes across model turns", async () => {
  const { memory, records } = await memoryFixture();
  const calls = [];
  const retrieval = retrievalFixture(memory, records, calls);
  let query = "topic-a";
  const seen = [];
  const runtime = createAgentRuntime({
    contextBlocks: [memoryBlock({
      retrieval,
      cadence: SpontaneousRecallCadence.SELF_GATED,
      deriveQuery() { return query; }
    })],
    judgments: [
      defineJudgment({
        name: "answer",
        context: { blocks: [SemanticMemoryContextBlockName] },
        parseOutput(value) {
          if (typeof value !== "string") throw new TypeError("answer must be string");
          return value;
        },
        strategy: createPredictStrategy({
          model: sequenceModel([42, "ok"], seen, (_request, index) => {
            if (index === 0) query = "topic-b";
          }),
          maxAttempts: 2
        })
      })
    ],
    strategy: { async run() { return null; } }
  });

  assert.equal(await runtime.invokeJudgment("answer", null), "ok");
  assert.deepEqual(calls, ["topic-a", "topic-b"]);
  assert.deepEqual(
    seen.map((request) => recalledBlock(request).value.retrieval.hits[0].memory.content),
    ["topic-a", "topic-b"]
  );
  assert.deepEqual(
    seen.map((request) => recalledBlock(request).value.sourceTurn),
    [1, 2]
  );
  assert.equal(recalledBlock(seen[0]).trust, ContextBlockTrust.UNTRUSTED);
});

test("SELF_GATED reuses recall when the derived query remains stable", async () => {
  const { memory, records } = await memoryFixture(["topic-a"]);
  const calls = [];
  const seen = [];
  const runtime = createAgentRuntime({
    contextBlocks: [memoryBlock({
      retrieval: retrievalFixture(memory, records, calls),
      cadence: SpontaneousRecallCadence.SELF_GATED,
      deriveQuery() { return "topic-a"; }
    })],
    judgments: [
      defineJudgment({
        name: "answer",
        context: { blocks: [SemanticMemoryContextBlockName] },
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
  assert.deepEqual(calls, ["topic-a"]);
  assert.equal(recalledBlock(seen[0]).value.recalled, true);
  assert.equal(recalledBlock(seen[0]).value.reused, false);
  assert.equal(recalledBlock(seen[1]).value.recalled, false);
  assert.equal(recalledBlock(seen[1]).value.reused, true);
  assert.equal(recalledBlock(seen[1]).value.sourceTurn, 1);
  assert.equal(recalledBlock(seen[1]).value.currentTurn, 2);
});

test("PER_TASK recalls once per invocation even when the query source changes", async () => {
  const { memory, records } = await memoryFixture();
  const calls = [];
  let query = "topic-a";
  const seen = [];
  const runtime = createAgentRuntime({
    contextBlocks: [memoryBlock({
      retrieval: retrievalFixture(memory, records, calls),
      cadence: SpontaneousRecallCadence.PER_TASK,
      deriveQuery() { return query; }
    })],
    judgments: [
      defineJudgment({
        name: "answer",
        context: { blocks: [SemanticMemoryContextBlockName] },
        parseOutput(value) {
          if (typeof value !== "string") throw new TypeError("answer must be string");
          return value;
        },
        strategy: createPredictStrategy({
          model: sequenceModel([42, "ok"], seen, (_request, index) => {
            if (index === 0) query = "topic-b";
          }),
          maxAttempts: 2
        })
      })
    ],
    strategy: { async run() { return null; } }
  });

  assert.equal(await runtime.invokeJudgment("answer", null), "ok");
  assert.deepEqual(calls, ["topic-a"]);
  assert.deepEqual(
    seen.map((request) => recalledBlock(request).value.retrieval.hits[0].memory.content),
    ["topic-a", "topic-a"]
  );
});

test("EVERY_TURN recalls on every model turn even when the query is unchanged", async () => {
  const { memory, records } = await memoryFixture(["topic-a"]);
  const calls = [];
  const seen = [];
  const runtime = createAgentRuntime({
    contextBlocks: [memoryBlock({
      retrieval: retrievalFixture(memory, records, calls),
      cadence: SpontaneousRecallCadence.EVERY_TURN,
      deriveQuery() { return "topic-a"; }
    })],
    judgments: [
      defineJudgment({
        name: "answer",
        context: { blocks: [SemanticMemoryContextBlockName] },
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
  assert.deepEqual(calls, ["topic-a", "topic-a"]);
  assert.deepEqual(
    seen.map((request) => recalledBlock(request).value.sourceTurn),
    [1, 2]
  );
});

test("available semantic memory is not visible unless the judgment explicitly selects the block", async () => {
  const { memory, records } = await memoryFixture(["topic-a"]);
  const calls = [];
  const seen = [];
  const runtime = createAgentRuntime({
    contextBlocks: [memoryBlock({
      retrieval: retrievalFixture(memory, records, calls),
      cadence: SpontaneousRecallCadence.EVERY_TURN,
      deriveQuery() { return "topic-a"; }
    })],
    judgments: [
      defineJudgment({
        name: "isolated",
        strategy: createPredictStrategy({ model: sequenceModel(["ok"], seen) })
      })
    ],
    strategy: { async run() { return null; } }
  });

  assert.equal(await runtime.invokeJudgment("isolated", null), "ok");
  assert.deepEqual(calls, []);
  assert.deepEqual(seen[0].promptContext.blocks, []);
});

test("recalled memory stays under existing context serialized bounds and fails before model generation", async () => {
  const huge = "x".repeat(4_000);
  const { memory, records } = await memoryFixture([huge]);
  const calls = [];
  const seen = [];
  const runtime = createAgentRuntime({
    contextBlocks: [memoryBlock({
      retrieval: retrievalFixture(memory, records, calls),
      cadence: SpontaneousRecallCadence.PER_TASK,
      deriveQuery() { return huge; }
    })],
    contextPolicy: { maxSerializedChars: 512 },
    judgments: [
      defineJudgment({
        name: "bounded",
        context: { blocks: [SemanticMemoryContextBlockName] },
        strategy: createPredictStrategy({ model: sequenceModel(["should-not-run"], seen) })
      })
    ],
    strategy: { async run() { return null; } }
  });

  await assert.rejects(
    () => runtime.invokeJudgment("bounded", null),
    (error) => error.code === ExHarnessErrorCode.CONTEXT_LIMIT_EXCEEDED
  );
  assert.equal(calls.length, 1);
  assert.equal(seen.length, 0, "context bound must fail before model generation");
});
