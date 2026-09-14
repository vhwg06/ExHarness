import assert from "node:assert/strict";
import test from "node:test";

import {
  GroundingVerdict,
  IntentReflectionAlignmentStatus,
  alignmentToKnowledgeDraft,
  createGroundedCognitionPort,
  defineGroundingVerifier,
  defineIntentReflectionAligner,
  semanticDivergenceSignals
} from "../src/cognition.js";
import {
  SemanticMemoryKind,
  SemanticMemorySourceRefKind,
  createInMemorySemanticMemoryProvider,
  createSemanticMemoryPort
} from "../src/index.js";
import {
  createDeterministicClock,
  createDeterministicIdFactory,
  verifyReflectionGroundingContract
} from "../src/testing.js";

function evaluation(id, candidate, observationIds, verificationIds = []) {
  return {
    id,
    candidate,
    metadata: {
      inputSnapshot: { observationIds, verificationIds }
    }
  };
}

function stateFixture() {
  const candidate = { id: "candidate", version: "v0" };
  let state = {
    id: "session-1",
    revision: 1,
    currentCandidate: candidate,
    persistentMemory: {
      observations: [{ id: "observation-0", candidate }],
      verifications: [],
      evaluations: [evaluation("evaluation-0", candidate, ["observation-0"])]
    }
  };
  return {
    load: async (id) => id === state.id ? structuredClone(state) : null,
    replace(next) {
      state = structuredClone(next);
    },
    read() {
      return structuredClone(state);
    }
  };
}

function cognitionFixture() {
  const state = stateFixture();
  const memory = createSemanticMemoryPort({
    provider: createInMemorySemanticMemoryProvider(),
    clock: createDeterministicClock(),
    idFactory: createDeterministicIdFactory("memory")
  });
  const port = createGroundedCognitionPort({
    memory,
    sessionStore: { load: state.load },
    groundingVerifier: defineGroundingVerifier({
      name: "evidence-grounder",
      revision: "1",
      async verify({ proposal }) {
        return {
          verdict: proposal.sourceRefs.length > 0 ? GroundingVerdict.GROUNDED : GroundingVerdict.REJECTED,
          reason: "fixture sources support the bounded semantic proposal",
          confidence: 1
        };
      }
    }),
    aligner: defineIntentReflectionAligner({
      name: "intent-reflection-aligner",
      revision: "1",
      async compare({ intent, reflection }) {
        const missed = intent.content.includes("fix bug X") && reflection.content.includes("bug X is still failing");
        return {
          status: missed ? IntentReflectionAlignmentStatus.DIVERGED : IntentReflectionAlignmentStatus.ALIGNED,
          divergence: missed ? 0.9 : 0.1,
          reason: missed ? "grounded outcome contradicts intended fix" : "grounded outcome matches intent"
        };
      }
    }),
    clock: createDeterministicClock({ start: "2026-02-01T00:00:00.000Z" }),
    idFactory: createDeterministicIdFactory("cognition")
  });
  return { state, memory, port };
}

test("reflection grounding contract requires a fresh persisted evaluation", async () => {
  const result = await verifyReflectionGroundingContract();
  assert.equal(result.passed, true);
  assert.deepEqual(result.checks, [
    "missing-evaluation-rejected",
    "stale-evaluation-rejected",
    "fresh-evaluation-required",
    "evaluation-source-retained"
  ]);
});

test("grounded intent and post-evaluation reflection produce semantic divergence signal", async () => {
  const { state, port } = cognitionFixture();
  const intentResult = await port.deriveIntent({
    sessionId: "session-1",
    content: "fix bug X in this variation",
    tags: ["bug-x"],
    confidence: 0.9,
    sourceRefs: [{ kind: SemanticMemorySourceRefKind.EVALUATION, id: "evaluation-0" }],
    provenance: { source: "planner", sourceId: "intent-0" }
  });
  assert.equal(intentResult.memory.kind, SemanticMemoryKind.INTENT);

  const next = state.read();
  next.revision += 1;
  next.currentCandidate = { id: "candidate", version: "v1" };
  next.persistentMemory.observations.push({ id: "observation-1", candidate: next.currentCandidate });
  next.persistentMemory.evaluations.push(evaluation(
    "evaluation-1",
    next.currentCandidate,
    ["observation-1"]
  ));
  state.replace(next);

  const reflectionResult = await port.deriveReflection({
    sessionId: "session-1",
    content: "bug X is still failing after the attempted fix",
    tags: ["bug-x"],
    confidence: 1,
    sourceRefs: [
      { kind: SemanticMemorySourceRefKind.MEMORY, id: intentResult.memory.id },
      { kind: SemanticMemorySourceRefKind.EVALUATION, id: "evaluation-1" }
    ],
    provenance: { source: "post-evaluation-reflection", sourceId: "reflection-1" }
  });
  assert.equal(reflectionResult.memory.kind, SemanticMemoryKind.REFLECTION);
  assert.ok(reflectionResult.memory.sourceRefs.some(
    (ref) => ref.kind === SemanticMemorySourceRefKind.EVALUATION && ref.id === "evaluation-1"
  ));

  const alignment = await port.alignIntentReflection({
    intentId: intentResult.memory.id,
    reflectionId: reflectionResult.memory.id
  });
  assert.equal(alignment.status, IntentReflectionAlignmentStatus.DIVERGED);
  assert.equal(alignment.divergence, 0.9);
  assert.equal(alignment.intentRef.revision, intentResult.memory.revision);
  assert.equal(alignment.reflectionRef.revision, reflectionResult.memory.revision);
  assert.deepEqual(alignment.evaluationRefs, [
    { kind: SemanticMemorySourceRefKind.EVALUATION, id: "evaluation-1" }
  ]);

  const knowledge = {
    id: "knowledge-1",
    ...alignmentToKnowledgeDraft(alignment)
  };
  const signals = semanticDivergenceSignals({ groundedKnowledge: [knowledge] });
  assert.equal(signals.length, 1);
  assert.equal(signals[0].knowledgeId, "knowledge-1");
  assert.equal(signals[0].divergence, 0.9);
});

test("rejected semantic derivation never enters memory", async () => {
  const state = stateFixture();
  const memory = createSemanticMemoryPort({
    provider: createInMemorySemanticMemoryProvider(),
    idFactory: createDeterministicIdFactory("memory")
  });
  const port = createGroundedCognitionPort({
    memory,
    sessionStore: { load: state.load },
    groundingVerifier: {
      name: "reject-all",
      revision: "1",
      async verify() {
        return {
          verdict: GroundingVerdict.REJECTED,
          reason: "claim is not supported by persisted evidence"
        };
      }
    }
  });

  await assert.rejects(
    port.deriveIntent({
      sessionId: "session-1",
      content: "unsupported intent",
      sourceRefs: [{ kind: SemanticMemorySourceRefKind.EVALUATION, id: "evaluation-0" }],
      provenance: { source: "test", sourceId: "rejected" }
    }),
    /not supported/
  );
  assert.deepEqual(await memory.list({ kinds: [SemanticMemoryKind.INTENT] }), []);
});
