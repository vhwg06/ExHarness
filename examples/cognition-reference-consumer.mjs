import {
  AVOCapability,
  ContextBlockTrust,
  EvaluationValidity,
  EvaluationVerdict,
  ExHarnessErrorCode,
  JavaScriptSessionFeature,
  SemanticMemoryEvolutionKind,
  SemanticMemoryKind,
  SemanticMemoryRelationDirection,
  SemanticMemorySourceRefKind,
  TraceSpanKind,
  createAVOHarness,
  createAgentEventStore,
  createAgentRuntime,
  createInMemorySemanticMemoryProvider,
  createInMemorySessionStore,
  createJavaScriptCodeActStrategy,
  createSemanticMemoryEvolutionPort,
  createSemanticMemoryGraph,
  createSemanticMemoryIntelligencePort,
  createSemanticMemoryPort,
  createSemanticMemoryRetrievalPort,
  createTraceRecorder,
  createTracedSemanticMemoryEvolutionPort,
  createTracedSemanticMemoryIntelligencePort,
  createTracedSemanticMemoryPort,
  defineCapability,
  defineSemanticMemoryRetriever,
  instrumentCognitionContextBlocks
} from "exharness";
import { createReferenceJavaScriptExecutor } from "./reference-executor.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function quietSupervisor() {
  return { async inspect() { return null; } };
}

function nullProjector() {
  return { async project() { return null; } };
}

function disabledDosage() {
  return {
    async decide() {
      return { enabled: false, reason: "cognition reference workload uses explicit runtime boundaries" };
    }
  };
}

let phase = "initial";
let memoryId = 0;
let memoryTick = 0;
let relationId = 0;
let proposalId = 0;
let traceId = 0;
let traceTick = 0;
let eventId = 0;
const tracer = createTraceRecorder({
  idFactory: () => `trace-${++traceId}`,
  clock: () => traceTick++
});
const rawMemory = createSemanticMemoryPort({
  provider: createInMemorySemanticMemoryProvider(),
  idFactory: () => `memory-${++memoryId}`,
  clock: () => `2026-09-13T10:00:${String(memoryTick++).padStart(2, "0")}Z`
});
const memory = createTracedSemanticMemoryPort(rawMemory, tracer);
const graph = createSemanticMemoryGraph({
  memory,
  idFactory: () => `relation-${++relationId}`,
  clock: () => `2026-09-13T10:10:${String(relationId).padStart(2, "0")}Z`
});

let retrievalCalls = 0;
const rawRetrieval = createSemanticMemoryRetrievalPort({
  memory,
  retriever: defineSemanticMemoryRetriever({
    name: "cognition-reference-index",
    version: "v1",
    async retrieve({ query }) {
      retrievalCalls += 1;
      const active = await memory.list({ limit: 16 });
      if (query !== "delivery-state") return [];
      const episodes = active.filter((record) => record.kind === SemanticMemoryKind.EPISODIC);
      if (episodes.length === 0) return [];
      return [{ memoryId: episodes[0].id, score: 1, reasons: ["anchor-episode"] }];
    }
  }),
  policy: { maxItems: 8, maxSerializedChars: 12_000 }
});
const intelligence = createTracedSemanticMemoryIntelligencePort(
  createSemanticMemoryIntelligencePort({
    memory,
    retrieval: rawRetrieval,
    graph,
    policy: {
      graphDepth: 1,
      maxGraphCandidates: 8,
      resultLimit: 8,
      candidateLimit: 8,
      weights: { provider: 0.5, importance: 0.1, confidence: 0.1, recency: 0.1, graph: 0.2 }
    },
    clock: () => "2026-09-13T12:00:00Z"
  }),
  tracer
);
const evolution = createTracedSemanticMemoryEvolutionPort(
  createSemanticMemoryEvolutionPort({
    memory,
    graph,
    idFactory: () => `proposal-${++proposalId}`,
    clock: () => `2026-09-13T11:00:${String(proposalId).padStart(2, "0")}Z`
  }),
  tracer
);

const memoryCapabilities = [
  defineCapability({
    name: "memory.encodeObservation",
    mutatesCandidate: false,
    async execute(input, runtime) {
      const observation = input?.observation;
      assert(observation?.id, "encodeObservation requires observation artifact");
      return memory.remember({
        kind: SemanticMemoryKind.EPISODIC,
        content: `candidate=${observation.value?.version ?? observation.candidate?.version ?? "unknown"};phase=${observation.value?.phase ?? phase}`,
        tags: ["delivery"],
        importance: 0.8,
        confidence: 1,
        sourceRefs: [{ kind: SemanticMemorySourceRefKind.OBSERVATION, id: observation.id }],
        provenance: {
          source: "observation-encoder",
          sourceId: observation.id,
          callId: runtime.callId,
          turn: runtime.turn
        }
      });
    }
  }),
  defineCapability({
    name: "memory.recall",
    mutatesCandidate: false,
    execute(input) {
      return intelligence.recall({
        query: input?.query ?? "delivery-state",
        tags: ["delivery"]
      });
    }
  }),
  defineCapability({
    name: "memory.abstract",
    mutatesCandidate: false,
    async execute(input, runtime) {
      const ids = input?.memoryIds ?? [];
      const records = [];
      for (const id of ids) {
        const record = await memory.get(id);
        assert(record, `memory not found for abstraction: ${id}`);
        records.push(record);
      }
      return evolution.execute({
        kind: SemanticMemoryEvolutionKind.ABSTRACT,
        sources: records.map((record) => ({ memoryId: record.id, expectedRevision: record.revision })),
        output: {
          content: "candidate changed from v0 to v1 and was re-observed before evaluation",
          tags: ["delivery"],
          importance: 0.95,
          confidence: 1
        },
        provenance: {
          source: "reflection",
          sourceId: "cognition-reference",
          callId: runtime.callId,
          turn: runtime.turn
        }
      });
    }
  })
];

const outputs = [
  {
    type: "execute_javascript",
    code: `
baseline = await self["${AVOCapability.OBSERVE}"]({ kind: "baseline" });
episode0 = await self["memory.encodeObservation"]({ observation: baseline });
initialRecall = await self["memory.recall"]({ query: "delivery-state" });
earlyPromoteRejected = false;
try {
  await self["${AVOCapability.PROMOTE}"]();
} catch (error) {
  earlyPromoteRejected = true;
}
if (!earlyPromoteRejected) throw new Error("unsafe early promotion was accepted");
await self["${AVOCapability.ACT}"]({ mutate: true, nextVersion: "v1" });
`
  },
  {
    type: "execute_javascript",
    code: `
post = await self["${AVOCapability.OBSERVE}"]({ kind: "post-mutation" });
episode1 = await self["memory.encodeObservation"]({ observation: post });
evolutionResult = await self["memory.abstract"]({ memoryIds: [episode0.id, episode1.id] });
`
  },
  {
    type: "execute_javascript",
    code: `
finalRecall = await self["memory.recall"]({ query: "delivery-state" });
evaluation = await self["${AVOCapability.EVALUATE}"]();
if (!evaluation || evaluation.verdict !== "PASS") throw new Error("candidate did not pass evaluation");
promotion = await self["${AVOCapability.PROMOTE}"]();
await return_result({
  status: "COMMITTED",
  earlyPromoteRejected,
  baselineObservationId: baseline.id,
  postObservationId: post.id,
  episodeIds: [episode0.id, episode1.id],
  reflectionId: evolutionResult.resultMemory.id,
  finalRecallIds: finalRecall.hits.map((hit) => hit.memory.id),
  evaluationVerdict: evaluation.verdict,
  promotedVersion: promotion.candidate.version
});
`
  }
];
let modelTurns = 0;
const phaseByTurn = [];
const historyEventsByTurn = [];
const model = {
  name: "cognition-reference-model",
  version: "v1",
  async generate(request) {
    const phaseBlock = request.promptContext.blocks.find((block) => block.name === "phase");
    assert(phaseBlock, "phase context block missing");
    phaseByTurn.push(phaseBlock.value.phase);
    historyEventsByTurn.push(request.promptContext.history.events.length);
    const output = outputs[modelTurns];
    if (!output) throw new Error(`unexpected model turn ${modelTurns + 1}`);
    modelTurns += 1;
    return output;
  }
};

const contextBlocks = instrumentCognitionContextBlocks([
  {
    name: "phase",
    trust: ContextBlockTrust.TRUSTED,
    async resolve({ turn }) {
      return { phase, turn };
    }
  }
], tracer);
const executor = createReferenceJavaScriptExecutor("./worker.mjs", {
  abortedCode: ExHarnessErrorCode.EXECUTION_ABORTED,
  terminalFeature: JavaScriptSessionFeature.CELL_ABORT
});
const runtime = createAgentRuntime({
  strategy: createJavaScriptCodeActStrategy({
    model,
    executor,
    maxTurns: 3,
    maxCells: 3,
    maxHostCalls: 24,
    maxDurationMs: 3_000
  }),
  capabilities: memoryCapabilities,
  contextBlocks,
  contextPolicy: {
    maxBlocks: 2,
    maxHistoryEvents: 20,
    maxSerializedChars: 24_000
  },
  agentEventStore: createAgentEventStore({
    idFactory: () => `agent-${++eventId}`,
    clock: () => `2026-09-13T12:30:${String(eventId).padStart(2, "0")}Z`
  }),
  tracer
});

let harnessId = 0;
let harnessTick = 0;
const harness = createAVOHarness({
  agent: runtime,
  environment: {
    async observe({ candidate, request }) {
      return { version: candidate.version, phase, request };
    },
    async act({ candidate, action }) {
      if (!action?.mutate) return { mutated: false, candidate, result: null };
      phase = "mutated";
      return {
        mutated: true,
        candidate: { id: candidate.id, version: action.nextVersion },
        result: { from: candidate.version, to: action.nextVersion, phase }
      };
    }
  },
  objective: {
    async evaluate({ candidate, observations }) {
      const post = observations.find((observation) => observation.request?.kind === "post-mutation");
      return {
        validity: EvaluationValidity.VALID,
        verdict: candidate.version === "v1" && post?.value?.version === "v1"
          ? EvaluationVerdict.PASS
          : EvaluationVerdict.GAP
      };
    }
  },
  sessionStore: createInMemorySessionStore(),
  contextProjector: nullProjector(),
  supervisor: quietSupervisor(),
  dosagePolicy: disabledDosage(),
  contextSelection: { blocks: ["phase"], history: true },
  clock: () => `2026-09-13T13:00:${String(++harnessTick).padStart(2, "0")}Z`,
  idFactory: () => `cognition-${++harnessId}`
});

await harness.start({
  sessionId: "cognition-reference",
  work: { objective: "observe, remember, mutate, re-observe, learn, verify and commit" },
  seedCandidate: { id: "candidate", version: "v0" }
});
const variation = await harness.vary("cognition-reference", { problem: "repair delivery state safely" });
const observations = await harness.observations("cognition-reference");
const lineage = await harness.lineage("cognition-reference");
const memories = await memory.list({ includeArchived: true, limit: 16 });
const reflection = memories.find((record) => record.kind === SemanticMemoryKind.REFLECTION);
const relations = reflection
  ? await graph.relationsFor(reflection.id, { direction: SemanticMemoryRelationDirection.OUTGOING })
  : [];
const spans = tracer.spans();
const agentRun = spans.find((span) => span.kind === TraceSpanKind.AGENT_RUN);
const capabilitySpans = spans.filter((span) => span.kind === TraceSpanKind.CAPABILITY);
const recallSpans = spans.filter((span) => span.kind === TraceSpanKind.MEMORY_RECALL);
const evolutionSpans = spans.filter((span) => span.kind === TraceSpanKind.MEMORY_EVOLUTION);
const contextSpans = spans.filter((span) => span.kind === TraceSpanKind.CONTEXT_RESOLVE);

assert(variation.failure == null, `variation failed: ${JSON.stringify(variation.failure)}`);
assert(variation.result?.status === "COMMITTED", "cognition workload did not commit");
assert(variation.result.earlyPromoteRejected === true, "unsafe early promotion was accepted");
assert(variation.result.evaluationVerdict === EvaluationVerdict.PASS, "final evaluation did not pass");
assert(variation.after.version === "v1", "candidate did not reach v1");
assert(variation.lineage.advanced === true, "lineage did not advance");
assert(observations.length === 2, "expected baseline and post-mutation observations");
assert(memories.length === 3, "expected two episodes plus one reflection");
assert(reflection, "reflection memory missing");
assert(relations.length === 2, "reflection lineage relations missing");
assert(retrievalCalls === 2, "expected two explicit recalls");
assert(phaseByTurn.join(",") === "initial,mutated,mutated", "turn context did not evolve");
assert(agentRun, "agent run trace missing");
assert(recallSpans.length === 2, "memory recall trace count mismatch");
assert(evolutionSpans.some((span) => span.attributes?.operation === "EXECUTE"), "memory evolution trace missing");
assert(contextSpans.length === 3, "context resolution trace count mismatch");
assert(recallSpans.every((span) => span.traceId === agentRun.traceId), "recall left agent causal trace");
assert(evolutionSpans.every((span) => span.traceId === agentRun.traceId), "evolution left agent causal trace");
assert(observations.every((observation) => capabilitySpans.some((span) => span.spanId === observation.provenance.runtime.trace.spanId)), "observation trace provenance does not resolve to capability span");
assert(memories.filter((record) => record.kind === SemanticMemoryKind.EPISODIC).every((record) => record.sourceRefs.some((ref) => ref.kind === SemanticMemorySourceRefKind.OBSERVATION)), "episodic memory lost observation origin");

const finalRecallGraphHit = variation.result.finalRecallIds.includes(reflection.id) ? 1 : 0;
const result = {
  schemaVersion: 1,
  reference: "observe-memory-act-v1",
  success: true,
  metrics: {
    taskSuccess: 1,
    modelTurns,
    javascriptCells: executor.metrics.cells,
    hostCalls: executor.metrics.hostCalls,
    observations: observations.length,
    episodicMemories: memories.filter((record) => record.kind === SemanticMemoryKind.EPISODIC).length,
    reflectionMemories: memories.filter((record) => record.kind === SemanticMemoryKind.REFLECTION).length,
    retrievalCalls,
    graphRelations: relations.length,
    finalRecallGraphHit,
    evolutionCommits: evolutionSpans.filter((span) => span.attributes?.operation === "EXECUTE" && span.status === "OK").length,
    contextResolutions: contextSpans.length,
    recallTraceSpans: recallSpans.length,
    observationTraceLinks: observations.filter((observation) => capabilitySpans.some((span) => span.spanId === observation.provenance.runtime.trace.spanId)).length,
    observationMemoryLinks: memories.filter((record) => record.kind === SemanticMemoryKind.EPISODIC && record.sourceRefs.some((ref) => ref.kind === SemanticMemorySourceRefKind.OBSERVATION)).length,
    earlyPromoteRejected: variation.result.earlyPromoteRejected ? 1 : 0,
    evaluationPass: variation.result.evaluationVerdict === EvaluationVerdict.PASS ? 1 : 0,
    lineageAdvanced: variation.lineage.advanced ? 1 : 0,
    falseSuccessCount: variation.result.status === "COMMITTED" && variation.result.evaluationVerdict !== EvaluationVerdict.PASS ? 1 : 0,
    unsafeAcceptCount: variation.result.status === "COMMITTED" && variation.result.earlyPromoteRejected !== true ? 1 : 0,
    phaseByTurn,
    historyEventsByTurn
  },
  provenance: {
    retriever: { name: "cognition-reference-index", version: "v1" },
    retrievalSemantics: "RELEVANCE_ONLY",
    rankingModel: "WEIGHTED_FUSION_V1",
    evolutionAtomicity: "CAS_GUARDED_MULTI_STEP",
    observationIds: observations.map((observation) => observation.id),
    memoryIds: memories.map((record) => record.id),
    reflectionId: reflection.id,
    relationIds: relations.map((relation) => relation.id),
    finalCandidate: variation.after,
    lineageHead: lineage.at(-1)?.candidate ?? null
  }
};

console.log(JSON.stringify(result));
