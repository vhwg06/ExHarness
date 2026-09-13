import assert from "node:assert/strict";
import test from "node:test";

import {
  ExHarnessErrorCode,
  SemanticMemoryKind,
  SemanticMemoryRelationChangeKind,
  SemanticMemoryRelationConflictError,
  SemanticMemoryRelationDirection,
  SemanticMemoryRelationStatus,
  SemanticMemoryRelationType,
  createInMemorySemanticMemoryProvider,
  createSemanticMemoryGraph,
  createSemanticMemoryPort
} from "../src/index.js";

function fixture() {
  let memoryId = 0;
  let relationId = 0;
  let tick = 0;
  const memory = createSemanticMemoryPort({
    provider: createInMemorySemanticMemoryProvider(),
    idFactory: () => `memory-${++memoryId}`,
    clock: () => `2026-09-13T05:00:${String(tick++).padStart(2, "0")}Z`
  });
  const graph = createSemanticMemoryGraph({
    memory,
    idFactory: () => `relation-${++relationId}`,
    clock: () => `2026-09-13T06:00:${String(tick++).padStart(2, "0")}Z`
  });
  return { memory, graph };
}

function provenance(source = "agent") {
  return { source };
}

async function remember(memory, content, kind = SemanticMemoryKind.SEMANTIC) {
  return memory.remember({ content, kind, provenance: provenance() });
}

test("memory graph stores typed directed relations outside memory record revisions", async () => {
  const { memory, graph } = fixture();
  const episode = await remember(memory, "deploy failed", SemanticMemoryKind.EPISODIC);
  const reflection = await remember(memory, "migration ordering caused the failure", SemanticMemoryKind.REFLECTION);

  const relation = await graph.relate({
    fromMemoryId: reflection.id,
    toMemoryId: episode.id,
    type: SemanticMemoryRelationType.DERIVED_FROM,
    provenance: provenance("reflection")
  });

  assert.equal(relation.status, SemanticMemoryRelationStatus.ACTIVE);
  assert.equal(relation.revision, 1);
  assert.equal(relation.fromMemoryId, reflection.id);
  assert.equal(relation.toMemoryId, episode.id);
  assert.equal(relation.type, SemanticMemoryRelationType.DERIVED_FROM);
  assert.equal(relation.provenance[0].kind, SemanticMemoryRelationChangeKind.CREATED);
  assert.equal((await memory.get(reflection.id)).revision, 1);
  assert.equal((await memory.get(episode.id)).revision, 1);
  assert.equal("relations" in (await memory.get(reflection.id)), false);
});

test("graph queries preserve direction and type semantics without doing multi-hop retrieval", async () => {
  const { memory, graph } = fixture();
  const a = await remember(memory, "a");
  const b = await remember(memory, "b");
  const c = await remember(memory, "c");

  await graph.relate({
    fromMemoryId: a.id,
    toMemoryId: b.id,
    type: SemanticMemoryRelationType.SUPPORTS,
    provenance: provenance()
  });
  await graph.relate({
    fromMemoryId: c.id,
    toMemoryId: a.id,
    type: SemanticMemoryRelationType.CONTRADICTS,
    provenance: provenance()
  });

  const outgoing = await graph.relationsFor(a.id, {
    direction: SemanticMemoryRelationDirection.OUTGOING
  });
  const incoming = await graph.relationsFor(a.id, {
    direction: SemanticMemoryRelationDirection.INCOMING
  });
  const supports = await graph.relationsFor(a.id, {
    direction: SemanticMemoryRelationDirection.BOTH,
    types: [SemanticMemoryRelationType.SUPPORTS]
  });

  assert.deepEqual(outgoing.map((item) => item.toMemoryId), [b.id]);
  assert.deepEqual(incoming.map((item) => item.fromMemoryId), [c.id]);
  assert.deepEqual(supports.map((item) => item.type), [SemanticMemoryRelationType.SUPPORTS]);
  assert.equal("traverse" in graph, false);
  assert.equal("spread" in graph, false);
  assert.equal("score" in graph, false);
});

test("active relation identity is unique but archived history remains inspectable and may be replaced by a fresh edge", async () => {
  const { memory, graph } = fixture();
  const left = await remember(memory, "left");
  const right = await remember(memory, "right");
  const draft = {
    fromMemoryId: left.id,
    toMemoryId: right.id,
    type: SemanticMemoryRelationType.REFINES,
    provenance: provenance()
  };

  const first = await graph.relate(draft);
  await assert.rejects(() => graph.relate(draft), /active semantic memory relation already exists/);

  const archived = await graph.archive(first.id, {
    expectedRevision: 1,
    provenance: provenance("reviewer")
  });
  assert.equal(archived.status, SemanticMemoryRelationStatus.ARCHIVED);
  assert.equal(archived.revision, 2);
  assert.equal(await graph.get(first.id), null);
  assert.equal((await graph.get(first.id, { includeArchived: true })).status, SemanticMemoryRelationStatus.ARCHIVED);

  const second = await graph.relate(draft);
  assert.notEqual(second.id, first.id);
  assert.deepEqual(
    (await graph.relationsFor(left.id)).map((item) => item.id),
    [second.id]
  );
  assert.deepEqual(
    (await graph.relationsFor(left.id, { includeArchived: true })).map((item) => item.id),
    [first.id, second.id]
  );
});

test("stale relation archive fails with a relation-specific CAS conflict", async () => {
  const { memory, graph } = fixture();
  const left = await remember(memory, "left");
  const right = await remember(memory, "right");
  const relation = await graph.relate({
    fromMemoryId: left.id,
    toMemoryId: right.id,
    type: SemanticMemoryRelationType.RELATED,
    provenance: provenance()
  });

  await assert.rejects(
    () => graph.archive(relation.id, {
      expectedRevision: 2,
      provenance: provenance("stale-writer")
    }),
    (error) => {
      assert.ok(error instanceof SemanticMemoryRelationConflictError);
      assert.equal(error.code, ExHarnessErrorCode.SEMANTIC_MEMORY_RELATION_CONFLICT);
      assert.deepEqual(error.details, {
        relationId: relation.id,
        expectedRevision: 2,
        actualRevision: 1
      });
      return true;
    }
  );
  assert.equal((await graph.get(relation.id)).revision, 1);
});

test("graph creation fails closed for self edges and unknown endpoints", async () => {
  const { memory, graph } = fixture();
  const known = await remember(memory, "known");

  await assert.rejects(
    () => graph.relate({
      fromMemoryId: known.id,
      toMemoryId: known.id,
      type: SemanticMemoryRelationType.RELATED,
      provenance: provenance()
    }),
    /cannot target the same memory/
  );

  await assert.rejects(
    () => graph.relate({
      fromMemoryId: known.id,
      toMemoryId: "missing-memory",
      type: SemanticMemoryRelationType.SUPPORTS,
      provenance: provenance()
    }),
    /endpoint not found/
  );
});

test("archiving a memory does not erase graph provenance or silently deactivate relations", async () => {
  const { memory, graph } = fixture();
  const old = await remember(memory, "old claim");
  const replacement = await remember(memory, "new claim");
  const relation = await graph.relate({
    fromMemoryId: replacement.id,
    toMemoryId: old.id,
    type: SemanticMemoryRelationType.SUPERSEDES,
    provenance: provenance("reconciler")
  });

  await memory.archive(old.id, { provenance: provenance("reconciler") });

  const stillActive = await graph.get(relation.id);
  assert.equal(stillActive.status, SemanticMemoryRelationStatus.ACTIVE);
  assert.equal(stillActive.toMemoryId, old.id);
  assert.equal(await memory.get(old.id), null);
  assert.equal((await memory.get(old.id, { includeArchived: true })).status, "ARCHIVED");
});
