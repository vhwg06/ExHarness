import assert from "node:assert/strict";
import test from "node:test";

import {
  ExHarnessErrorCode,
  SemanticMemoryChangeKind,
  SemanticMemoryConflictError,
  SemanticMemoryStatus,
  createInMemorySemanticMemoryProvider,
  createSemanticMemoryPort
} from "../src/index.js";

function fixture() {
  let id = 0;
  let tick = 0;
  const provider = createInMemorySemanticMemoryProvider();
  const memory = createSemanticMemoryPort({
    provider,
    idFactory: () => `memory-${++id}`,
    clock: () => `2026-09-12T17:00:${String(tick++).padStart(2, "0")}Z`
  });
  return { provider, memory };
}

function provenance(source, extra = {}) {
  return { source, ...extra };
}

test("semantic memory is a separate lifecycle store with explicit creation provenance", async () => {
  const { memory } = fixture();
  const stored = await memory.remember({
    content: "Kafka retries can duplicate an external side effect",
    tags: ["kafka", "idempotency", "kafka"],
    importance: 0.8,
    provenance: provenance("agent", { callId: "call-1", turn: 2 })
  });

  assert.equal(stored.id, "memory-1");
  assert.equal(stored.status, SemanticMemoryStatus.ACTIVE);
  assert.equal(stored.revision, 1);
  assert.deepEqual(stored.tags, ["kafka", "idempotency"]);
  assert.deepEqual(stored.provenance, [{
    kind: SemanticMemoryChangeKind.CREATED,
    revision: 1,
    at: "2026-09-12T17:00:00Z",
    source: "agent",
    sourceId: null,
    callId: "call-1",
    turn: 2
  }]);
  assert.equal("candidate" in stored, false);
  assert.equal("kind" in stored, false, "semantic memory must not impersonate AVO KnowledgeKind records");
});

test("updates append provenance instead of rewriting origin", async () => {
  const { memory } = fixture();
  const created = await memory.remember({
    content: "first",
    tags: ["runtime"],
    provenance: provenance("user")
  });

  const updated = await memory.update(created.id, {
    content: "corrected",
    tags: ["runtime", "context"],
    importance: 0.9,
    expectedRevision: 1,
    provenance: provenance("oracle", { sourceId: "resolution-7" })
  });

  assert.equal(updated.revision, 2);
  assert.equal(updated.content, "corrected");
  assert.equal(updated.importance, 0.9);
  assert.deepEqual(updated.tags, ["runtime", "context"]);
  assert.deepEqual(updated.provenance.map((entry) => entry.kind), [
    SemanticMemoryChangeKind.CREATED,
    SemanticMemoryChangeKind.UPDATED
  ]);
  assert.equal(updated.provenance[0].source, "user");
  assert.equal(updated.provenance[1].source, "oracle");
  assert.equal(updated.provenance[1].sourceId, "resolution-7");
});

test("archive is a lifecycle state change rather than silent physical deletion", async () => {
  const { memory } = fixture();
  const created = await memory.remember({
    content: "stale hypothesis",
    provenance: provenance("agent")
  });

  const archived = await memory.archive(created.id, {
    expectedRevision: 1,
    provenance: provenance("reviewer", { sourceId: "review-3" })
  });

  assert.equal(archived.status, SemanticMemoryStatus.ARCHIVED);
  assert.equal(archived.revision, 2);
  assert.equal(await memory.get(created.id), null);
  assert.equal((await memory.get(created.id, { includeArchived: true })).status, SemanticMemoryStatus.ARCHIVED);
  assert.deepEqual((await memory.list()).map((record) => record.id), []);
  assert.deepEqual((await memory.list({ includeArchived: true })).map((record) => record.id), [created.id]);
  assert.equal(archived.provenance.at(-1).kind, SemanticMemoryChangeKind.ARCHIVED);
});

test("compare-and-swap revision conflicts fail closed without overwriting stored memory", async () => {
  const { memory } = fixture();
  const created = await memory.remember({
    content: "v1",
    provenance: provenance("agent")
  });
  await memory.update(created.id, {
    content: "v2",
    expectedRevision: 1,
    provenance: provenance("agent")
  });

  await assert.rejects(
    () => memory.update(created.id, {
      content: "stale-v3",
      expectedRevision: 1,
      provenance: provenance("agent")
    }),
    (error) => {
      assert.ok(error instanceof SemanticMemoryConflictError);
      assert.equal(error.code, ExHarnessErrorCode.SEMANTIC_MEMORY_CONFLICT);
      assert.deepEqual(error.details, {
        memoryId: created.id,
        expectedRevision: 1,
        actualRevision: 2
      });
      return true;
    }
  );

  const current = await memory.get(created.id);
  assert.equal(current.content, "v2");
  assert.equal(current.revision, 2);
});

test("provider copies prevent callers from mutating persisted memory out of band", async () => {
  const { provider, memory } = fixture();
  const created = await memory.remember({
    content: "immutable through transport",
    tags: ["safe"],
    provenance: provenance("agent")
  });

  const direct = await provider.read(created.id);
  direct.content = "tampered";
  direct.tags.push("poisoned");
  const listed = await provider.list();
  listed[0].provenance[0].source = "attacker";

  const current = await memory.get(created.id);
  assert.equal(current.content, "immutable through transport");
  assert.deepEqual(current.tags, ["safe"]);
  assert.equal(current.provenance[0].source, "agent");
});

test("metadata listing is deterministic and bounded but does not pretend to be semantic recall", async () => {
  const { memory } = fixture();
  await memory.remember({ content: "one", tags: ["a"], provenance: provenance("agent") });
  await memory.remember({ content: "two", tags: ["a", "b"], provenance: provenance("agent") });
  await memory.remember({ content: "three", tags: ["b"], provenance: provenance("agent") });

  const tagged = await memory.list({ tags: ["b"], limit: 1 });
  assert.deepEqual(tagged.map((record) => record.content), ["three"]);
  assert.equal("recall" in memory, false, "G4 must not consume G5 associative recall scope");
  assert.equal("search" in memory, false, "G4 must not consume G5 search/ranking scope");
});

test("semantic-memory provenance rejects invalid turn identity", async () => {
  const { memory } = fixture();
  await assert.rejects(
    () => memory.remember({
      content: "bad turn",
      provenance: provenance("agent", { turn: 0 })
    }),
    /semantic memory provenance turn must be a positive integer/
  );
});
