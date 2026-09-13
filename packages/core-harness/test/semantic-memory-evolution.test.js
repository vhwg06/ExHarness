import assert from "node:assert/strict";
import test from "node:test";

import {
  ExHarnessErrorCode,
  SemanticMemoryEvolutionAtomicity,
  SemanticMemoryEvolutionKind,
  SemanticMemoryEvolutionPartialCommitError,
  SemanticMemoryEvolutionStatus,
  SemanticMemoryKind,
  SemanticMemoryRelationType,
  SemanticMemoryStatus,
  createInMemorySemanticMemoryProvider,
  createSemanticMemoryEvolutionPort,
  createSemanticMemoryGraph,
  createSemanticMemoryPort
} from "../src/index.js";

function fixture({ graphOverride = null } = {}) {
  let memoryId = 0;
  let relationId = 0;
  let proposalId = 0;
  let tick = 0;
  const memory = createSemanticMemoryPort({
    provider: createInMemorySemanticMemoryProvider(),
    idFactory: () => `memory-${++memoryId}`,
    clock: () => `2026-09-13T07:00:${String(tick++).padStart(2, "0")}Z`
  });
  const graph = graphOverride ?? createSemanticMemoryGraph({
    memory,
    idFactory: () => `relation-${++relationId}`,
    clock: () => `2026-09-13T08:00:${String(tick++).padStart(2, "0")}Z`
  });
  const evolution = createSemanticMemoryEvolutionPort({
    memory,
    graph,
    idFactory: () => `proposal-${++proposalId}`,
    clock: () => `2026-09-13T09:00:${String(tick++).padStart(2, "0")}Z`
  });
  return { memory, graph, evolution };
}

function provenance(source = "reflection") {
  return { source };
}

async function remember(memory, content, kind = SemanticMemoryKind.SEMANTIC) {
  return memory.remember({ content, kind, provenance: provenance("seed") });
}

function source(record) {
  return { memoryId: record.id, expectedRevision: record.revision };
}

test("validation is read-only and stale validated proposals fail before mutation", async () => {
  const { memory, evolution } = fixture();
  const first = await remember(memory, "first");
  const second = await remember(memory, "second");
  const validated = await evolution.validate({
    kind: SemanticMemoryEvolutionKind.MERGE,
    sources: [source(first), source(second)],
    output: { content: "merged" },
    provenance: provenance()
  });

  assert.equal(validated.status, SemanticMemoryEvolutionStatus.VALIDATED);
  assert.equal(validated.atomicity, SemanticMemoryEvolutionAtomicity);
  assert.deepEqual((await memory.list()).map((record) => record.content), ["first", "second"]);

  await memory.update(first.id, {
    content: "changed concurrently",
    expectedRevision: 1,
    provenance: provenance("concurrent")
  });

  await assert.rejects(
    () => evolution.commit(validated),
    /source revision is stale/
  );
  assert.deepEqual((await memory.list()).map((record) => record.content), ["changed concurrently", "second"]);
});

test("ABSTRACT creates a REFLECTION linked by DERIVED_FROM while preserving source memories", async () => {
  const { memory, graph, evolution } = fixture();
  const one = await remember(memory, "episode one", SemanticMemoryKind.EPISODIC);
  const two = await remember(memory, "episode two", SemanticMemoryKind.EPISODIC);

  const result = await evolution.execute({
    kind: SemanticMemoryEvolutionKind.ABSTRACT,
    sources: [source(one), source(two)],
    output: { content: "both episodes share one retry pattern", kind: SemanticMemoryKind.SEMANTIC },
    provenance: provenance()
  });

  assert.equal(result.status, SemanticMemoryEvolutionStatus.COMMITTED);
  assert.equal(result.resultMemory.kind, SemanticMemoryKind.REFLECTION);
  assert.deepEqual(result.resultMemory.sourceRefs.map((ref) => ref.id), [one.id, two.id]);
  assert.deepEqual(result.archivedMemoryIds, []);
  assert.equal((await memory.get(one.id)).status, SemanticMemoryStatus.ACTIVE);
  assert.equal((await memory.get(two.id)).status, SemanticMemoryStatus.ACTIVE);
  const relations = await graph.relationsFor(result.resultMemory.id);
  assert.deepEqual(relations.map((relation) => relation.type), [
    SemanticMemoryRelationType.DERIVED_FROM,
    SemanticMemoryRelationType.DERIVED_FROM
  ]);
});

test("RECONCILE creates an explicit replacement and archives contradictory sources", async () => {
  const { memory, graph, evolution } = fixture();
  const oldA = await remember(memory, "timeout is 10s");
  const oldB = await remember(memory, "timeout is 20s");

  const result = await evolution.execute({
    kind: SemanticMemoryEvolutionKind.RECONCILE,
    sources: [source(oldA), source(oldB)],
    output: { content: "timeout is 15s", confidence: 0.9 },
    provenance: provenance("reconciler")
  });

  assert.deepEqual(result.archivedMemoryIds, [oldA.id, oldB.id]);
  assert.equal(await memory.get(oldA.id), null);
  assert.equal(await memory.get(oldB.id), null);
  assert.equal(result.resultMemory.content, "timeout is 15s");
  const relations = await graph.relationsFor(result.resultMemory.id);
  assert.deepEqual(relations.map((relation) => relation.type), [
    SemanticMemoryRelationType.SUPERSEDES,
    SemanticMemoryRelationType.SUPERSEDES
  ]);
});

test("REINFORCE only revisions importance/confidence and cannot rewrite memory content", async () => {
  const { memory, evolution } = fixture();
  const record = await remember(memory, "stable procedure", SemanticMemoryKind.PROCEDURAL);

  const result = await evolution.execute({
    kind: SemanticMemoryEvolutionKind.REINFORCE,
    sources: [source(record)],
    patch: { importance: 0.95, confidence: 0.8 },
    provenance: provenance("usage")
  });

  assert.equal(result.resultMemory.revision, 2);
  assert.equal(result.resultMemory.content, "stable procedure");
  assert.equal(result.resultMemory.importance, 0.95);
  assert.equal(result.resultMemory.confidence, 0.8);

  await assert.rejects(
    () => evolution.execute({
      kind: SemanticMemoryEvolutionKind.REINFORCE,
      sources: [{ memoryId: record.id, expectedRevision: 2 }],
      patch: { content: "silent rewrite", importance: 1 },
      provenance: provenance()
    }),
    /may only change importance\/confidence/
  );
});

test("FORGET archives rather than physically deleting memory", async () => {
  const { memory, evolution } = fixture();
  const record = await remember(memory, "obsolete detail");

  const result = await evolution.execute({
    kind: SemanticMemoryEvolutionKind.FORGET,
    sources: [source(record)],
    provenance: provenance("forgetting-policy")
  });

  assert.equal(result.resultMemory, null);
  assert.deepEqual(result.archivedMemoryIds, [record.id]);
  assert.equal(await memory.get(record.id), null);
  assert.equal((await memory.get(record.id, { includeArchived: true })).status, SemanticMemoryStatus.ARCHIVED);
});

test("multi-step infrastructure failure is surfaced as explicit partial commit with applied steps", async () => {
  let memoryId = 0;
  const memory = createSemanticMemoryPort({
    provider: createInMemorySemanticMemoryProvider(),
    idFactory: () => `memory-${++memoryId}`,
    clock: () => "2026-09-13T10:00:00Z"
  });
  const first = await remember(memory, "first");
  const second = await remember(memory, "second");
  const evolution = createSemanticMemoryEvolutionPort({
    memory,
    graph: {
      async relate() {
        throw new Error("graph unavailable");
      }
    },
    idFactory: () => "proposal-partial",
    clock: () => "2026-09-13T10:00:01Z"
  });

  await assert.rejects(
    () => evolution.execute({
      kind: SemanticMemoryEvolutionKind.MERGE,
      sources: [source(first), source(second)],
      output: { content: "merged" },
      provenance: provenance()
    }),
    (error) => {
      assert.ok(error instanceof SemanticMemoryEvolutionPartialCommitError);
      assert.equal(error.code, ExHarnessErrorCode.SEMANTIC_MEMORY_EVOLUTION_PARTIAL);
      assert.equal(error.details.proposalId, "proposal-partial");
      assert.deepEqual(error.details.appliedSteps, [
        { kind: "MEMORY_CREATED", memoryId: "memory-3", revision: 1 }
      ]);
      return true;
    }
  );

  const records = await memory.list({ includeArchived: true });
  assert.deepEqual(records.map((record) => record.content), ["first", "second", "merged"]);
  assert.equal((await memory.get(first.id)).status, SemanticMemoryStatus.ACTIVE);
  assert.equal((await memory.get(second.id)).status, SemanticMemoryStatus.ACTIVE);
});

test("proposal shape encodes operation semantics instead of accepting arbitrary reflection writes", async () => {
  const { memory, evolution } = fixture();
  const one = await remember(memory, "one");
  const two = await remember(memory, "two");

  await assert.rejects(
    () => evolution.validate({
      kind: SemanticMemoryEvolutionKind.MERGE,
      sources: [source(one)],
      output: { content: "invalid merge" },
      provenance: provenance()
    }),
    /source count is invalid/
  );
  await assert.rejects(
    () => evolution.validate({
      kind: SemanticMemoryEvolutionKind.ABSTRACT,
      sources: [source(one), source(two)],
      archiveSources: true,
      output: { content: "abstract" },
      provenance: provenance()
    }),
    /ABSTRACT cannot archive source memories/
  );
});
