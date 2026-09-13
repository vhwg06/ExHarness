import assert from "node:assert/strict";
import test from "node:test";

import {
  ContextBlockTrust,
  ExHarnessErrorCode,
  SemanticMemoryEvolutionKind,
  SemanticMemoryKind,
  SemanticMemoryRelationType,
  TraceSpanKind,
  TraceSpanStatus,
  createInMemorySemanticMemoryProvider,
  createSemanticMemoryEvolutionPort,
  createSemanticMemoryGraph,
  createSemanticMemoryIntelligencePort,
  createSemanticMemoryPort,
  createSemanticMemoryRetrievalPort,
  createTraceRecorder,
  createTracedSemanticMemoryEvolutionPort,
  createTracedSemanticMemoryIntelligencePort,
  createTracedSemanticMemoryPort,
  createTracedSemanticMemoryRetrievalPort,
  defineSemanticMemoryRetriever,
  instrumentCognitionContextBlocks
} from "../src/index.js";

function provenance(source = "agent") {
  return { source };
}

function buildMemoryStack(tracer) {
  let memoryId = 0;
  let relationId = 0;
  let proposalId = 0;
  const rawMemory = createSemanticMemoryPort({
    provider: createInMemorySemanticMemoryProvider(),
    idFactory: () => `memory-${++memoryId}`,
    clock: () => "2026-09-13T10:00:00Z"
  });
  const memory = createTracedSemanticMemoryPort(rawMemory, tracer);
  const graph = createSemanticMemoryGraph({
    memory,
    idFactory: () => `relation-${++relationId}`,
    clock: () => "2026-09-13T10:00:00Z"
  });
  const retrieval = createSemanticMemoryRetrievalPort({
    memory,
    retriever: defineSemanticMemoryRetriever({
      name: "fixture",
      version: "1",
      async retrieve({ query }) {
        const records = await memory.list();
        return records
          .filter((record) => record.content.includes(query))
          .map((record) => ({ memoryId: record.id, score: 1, reasons: ["fixture"] }));
      }
    })
  });
  const tracedRetrieval = createTracedSemanticMemoryRetrievalPort(retrieval, tracer);
  const intelligence = createSemanticMemoryIntelligencePort({
    memory,
    retrieval,
    graph,
    policy: { graphDepth: 1 },
    clock: () => "2026-09-13T12:00:00Z"
  });
  const tracedIntelligence = createTracedSemanticMemoryIntelligencePort(intelligence, tracer);
  const evolution = createTracedSemanticMemoryEvolutionPort(
    createSemanticMemoryEvolutionPort({
      memory,
      graph,
      idFactory: () => `proposal-${++proposalId}`,
      clock: () => "2026-09-13T12:00:00Z"
    }),
    tracer
  );
  return { memory, graph, retrieval: tracedRetrieval, intelligence: tracedIntelligence, evolution };
}

test("context, recall and evolution compose into one causal trace tree", async () => {
  let id = 0;
  const tracer = createTraceRecorder({
    idFactory: () => `span-${++id}`,
    clock: (() => {
      let tick = 0;
      return () => tick++;
    })()
  });
  const { memory, intelligence, evolution } = buildMemoryStack(tracer);
  const blocks = instrumentCognitionContextBlocks([
    {
      name: "runtime-state",
      trust: ContextBlockTrust.TRUSTED,
      async resolve({ turn }) {
        return { turn };
      }
    }
  ], tracer);

  await tracer.runSpan(TraceSpanKind.AGENT_RUN, "agent.run", async () => {
    const episode = await memory.remember({
      kind: SemanticMemoryKind.EPISODIC,
      content: "retry failure",
      provenance: provenance("observe")
    });
    await blocks[0].resolve({ callId: "call-1", turn: 1, judgment: null });
    const recalled = await intelligence.recall({ query: "retry" });
    assert.equal(recalled.hits[0].memory.id, episode.id);
    await evolution.execute({
      kind: SemanticMemoryEvolutionKind.ABSTRACT,
      sources: [{ memoryId: episode.id, expectedRevision: 1 }],
      output: { content: "retry failures should be treated as one pattern" },
      provenance: provenance("reflection")
    });
  }, { callId: "call-1" });

  const spans = tracer.spans();
  const root = spans.find((span) => span.kind === TraceSpanKind.AGENT_RUN);
  assert(root);
  const context = spans.find((span) => span.kind === TraceSpanKind.CONTEXT_RESOLVE);
  const recall = spans.find((span) => span.kind === TraceSpanKind.MEMORY_RECALL && span.attributes?.source === "INTELLIGENCE");
  const evolutionSpan = spans.find((span) => span.kind === TraceSpanKind.MEMORY_EVOLUTION && span.attributes?.operation === "EXECUTE");
  assert(context);
  assert(recall);
  assert(evolutionSpan);
  assert.equal(context.traceId, root.traceId);
  assert.equal(recall.traceId, root.traceId);
  assert.equal(evolutionSpan.traceId, root.traceId);
  assert.equal(context.callId, "call-1");
  assert.equal(recall.callId, "call-1");
  assert.equal(evolutionSpan.callId, "call-1");

  const evolutionResult = spans.find(
    (span) => span.kind === TraceSpanKind.MEMORY_RESULT && span.parentSpanId === evolutionSpan.spanId
  );
  assert(evolutionResult);
  assert.equal(evolutionResult.attributes.evolutionKind, SemanticMemoryEvolutionKind.ABSTRACT);
  assert.equal(evolutionResult.attributes.resultMemoryId, "memory-2");
  assert.deepEqual(evolutionResult.attributes.relationIds, ["relation-1"]);
});

test("memory tracing emits identity metadata without leaking memory content", async () => {
  const tracer = createTraceRecorder({ clock: () => 1 });
  const { memory } = buildMemoryStack(tracer);
  const secret = "SECRET-MEMORY-CONTENT-DO-NOT-TRACE";

  const stored = await memory.remember({
    content: secret,
    provenance: provenance()
  });
  await memory.get(stored.id);

  const serialized = JSON.stringify(tracer.spans());
  assert.equal(serialized.includes(secret), false);
  const writeResult = tracer.spans().find(
    (span) => span.kind === TraceSpanKind.MEMORY_RESULT && span.attributes?.operation === "REMEMBER"
  );
  assert(writeResult);
  assert.equal(writeResult.attributes.memoryId, stored.id);
  assert.equal(writeResult.attributes.revision, 1);
});

test("retrieval query tracing is bounded and reports original size", async () => {
  const tracer = createTraceRecorder({ clock: () => 1 });
  const { memory, retrieval } = buildMemoryStack(tracer);
  await memory.remember({ content: "needle", provenance: provenance() });
  const query = "q".repeat(400);

  await retrieval.recall({ query });

  const span = tracer.spans().find(
    (item) => item.kind === TraceSpanKind.MEMORY_RECALL && item.attributes?.source === "RETRIEVAL"
  );
  assert(span);
  assert.equal(span.attributes.query.length, 256);
  assert.equal(span.attributes.queryChars, 400);
  assert.equal(span.attributes.queryTruncated, true);
});

test("partial evolution keeps the engineering failure visible on the cognition span", async () => {
  const tracer = createTraceRecorder({ clock: () => 1 });
  let memoryId = 0;
  const rawMemory = createSemanticMemoryPort({
    provider: createInMemorySemanticMemoryProvider(),
    idFactory: () => `memory-${++memoryId}`,
    clock: () => "2026-09-13T10:00:00Z"
  });
  const memory = createTracedSemanticMemoryPort(rawMemory, tracer);
  const first = await memory.remember({ content: "one", provenance: provenance() });
  const second = await memory.remember({ content: "two", provenance: provenance() });
  const evolution = createTracedSemanticMemoryEvolutionPort(
    createSemanticMemoryEvolutionPort({
      memory,
      graph: {
        async relate() {
          throw new Error("graph unavailable");
        }
      },
      idFactory: () => "proposal-partial",
      clock: () => "2026-09-13T10:00:00Z"
    }),
    tracer
  );

  await assert.rejects(
    () => evolution.execute({
      kind: SemanticMemoryEvolutionKind.MERGE,
      sources: [
        { memoryId: first.id, expectedRevision: 1 },
        { memoryId: second.id, expectedRevision: 1 }
      ],
      output: { content: "merged" },
      provenance: provenance()
    }),
    (error) => error.code === ExHarnessErrorCode.SEMANTIC_MEMORY_EVOLUTION_PARTIAL
  );

  const span = tracer.spans().find(
    (item) => item.kind === TraceSpanKind.MEMORY_EVOLUTION && item.attributes?.operation === "EXECUTE"
  );
  assert(span);
  assert.equal(span.status, TraceSpanStatus.ERROR);
  assert.equal(span.error.code, ExHarnessErrorCode.SEMANTIC_MEMORY_EVOLUTION_PARTIAL);
  assert.equal(
    tracer.spans().some((item) => item.kind === TraceSpanKind.MEMORY_RESULT && item.parentSpanId === span.spanId),
    false
  );
});

test("graph relation remains semantic structure while tracing only references resulting IDs", async () => {
  const tracer = createTraceRecorder({ clock: () => 1 });
  const { memory, graph } = buildMemoryStack(tracer);
  const a = await memory.remember({ content: "a", provenance: provenance() });
  const b = await memory.remember({ content: "b", provenance: provenance() });
  const relation = await graph.relate({
    fromMemoryId: a.id,
    toMemoryId: b.id,
    type: SemanticMemoryRelationType.RELATED,
    provenance: provenance()
  });

  assert.equal(relation.type, SemanticMemoryRelationType.RELATED);
  assert.equal(JSON.stringify(tracer.spans()).includes("\"content\":\"a\""), false);
  assert.equal(JSON.stringify(tracer.spans()).includes("\"content\":\"b\""), false);
});
