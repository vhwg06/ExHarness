import assert from "node:assert/strict";
import test from "node:test";

import {
  ExHarnessErrorCode,
  SemanticMemoryChangeKind,
  SemanticMemoryConflictError,
  SemanticMemoryKind,
  SemanticMemoryKindSemantics,
  SemanticMemorySourceRefKind,
  SemanticMemoryStatus,
  createInMemorySemanticMemoryProvider,
  createSemanticMemoryPort
} from "../src/index.js";

function fixture(options = {}) {
  let id = 0;
  let tick = 0;
  const provider = createInMemorySemanticMemoryProvider(options);
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
  assert.equal(stored.kind, SemanticMemoryKind.SEMANTIC);
  assert.equal(stored.status, SemanticMemoryStatus.ACTIVE);
  assert.equal(stored.revision, 1);
  assert.equal(stored.confidence, null);
  assert.deepEqual(stored.temporal, { validFrom: null, validTo: null });
  assert.deepEqual(stored.sourceRefs, []);
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
  assert.notEqual(stored.kind, "KNOWLEDGE", "semantic memory kind remains separate from AVO KnowledgeKind");
});

test("rich memory semantics distinguish cognition roles without granting authority", async () => {
  const { memory } = fixture();
  const observationRef = { kind: SemanticMemorySourceRefKind.OBSERVATION, id: "observation-7" };
  const stored = await memory.remember({
    kind: SemanticMemoryKind.EPISODIC,
    content: "The deploy failed after the migration step",
    confidence: 0.85,
    temporal: {
      validFrom: "2026-09-12T16:00:00Z",
      validTo: "2026-09-12T18:00:00Z"
    },
    sourceRefs: [observationRef],
    provenance: provenance("runtime", { callId: "call-9", turn: 3 })
  });

  assert.equal(stored.kind, SemanticMemoryKind.EPISODIC);
  assert.equal(stored.confidence, 0.85);
  assert.deepEqual(stored.sourceRefs, [observationRef]);
  assert.deepEqual(stored.temporal, {
    validFrom: "2026-09-12T16:00:00Z",
    validTo: "2026-09-12T18:00:00Z"
  });
  assert.equal(SemanticMemoryKindSemantics[stored.kind].role, "EXPERIENCE");
  assert.equal("verdict" in stored, false);
  assert.equal("trust" in stored, false);
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
    confidence: 0.75,
    temporal: { validFrom: "2026-09-12T17:00:00Z" },
    expectedRevision: 1,
    provenance: provenance("oracle", { sourceId: "resolution-7" })
  });

  assert.equal(updated.revision, 2);
  assert.equal(updated.content, "corrected");
  assert.equal(updated.importance, 0.9);
  assert.equal(updated.confidence, 0.75);
  assert.deepEqual(updated.temporal, { validFrom: "2026-09-12T17:00:00Z", validTo: null });
  assert.deepEqual(updated.tags, ["runtime", "context"]);
  assert.deepEqual(updated.provenance.map((entry) => entry.kind), [
    SemanticMemoryChangeKind.CREATED,
    SemanticMemoryChangeKind.UPDATED
  ]);
  assert.equal(updated.provenance[0].source, "user");
  assert.equal(updated.provenance[1].source, "oracle");
  assert.equal(updated.provenance[1].sourceId, "resolution-7");
});

test("memory kind and source origin are immutable across revision updates", async () => {
  const { memory } = fixture();
  const created = await memory.remember({
    kind: SemanticMemoryKind.REFLECTION,
    content: "Retries cluster around one failure mode",
    sourceRefs: [{ kind: SemanticMemorySourceRefKind.MEMORY, id: "memory-source" }],
    provenance: provenance("reflection")
  });

  await assert.rejects(
    () => memory.update(created.id, {
      kind: SemanticMemoryKind.PROCEDURAL,
      expectedRevision: 1,
      provenance: provenance("agent")
    }),
    /kind is immutable/
  );
  await assert.rejects(
    () => memory.update(created.id, {
      sourceRefs: [],
      expectedRevision: 1,
      provenance: provenance("agent")
    }),
    /sourceRefs are immutable/
  );
  assert.equal((await memory.get(created.id)).revision, 1);
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

test("metadata listing supports typed kind and temporal filters without pretending to be recall", async () => {
  const { memory } = fixture();
  await memory.remember({
    kind: SemanticMemoryKind.SEMANTIC,
    content: "one",
    tags: ["a"],
    provenance: provenance("agent")
  });
  await memory.remember({
    kind: SemanticMemoryKind.PROCEDURAL,
    content: "two",
    tags: ["a", "b"],
    temporal: { validFrom: "2026-09-13T00:00:00Z", validTo: "2026-09-14T00:00:00Z" },
    provenance: provenance("agent")
  });
  await memory.remember({
    kind: SemanticMemoryKind.PROCEDURAL,
    content: "three",
    tags: ["b"],
    temporal: { validTo: "2026-09-11T00:00:00Z" },
    provenance: provenance("agent")
  });
  const pendingIntent = await memory.remember({
    kind: SemanticMemoryKind.INTENT,
    content: "pending goal",
    tags: ["b"],
    provenance: provenance("agent")
  });

  const filtered = await memory.list({
    tags: ["b"],
    kinds: [SemanticMemoryKind.PROCEDURAL],
    validAt: "2026-09-13T12:00:00Z",
    limit: 10
  });
  assert.deepEqual(filtered.map((record) => record.content), ["two"]);
  assert.equal(pendingIntent.status, SemanticMemoryStatus.PENDING_GROUNDING);
  assert.deepEqual(await memory.list({ kinds: [SemanticMemoryKind.INTENT] }), []);
  assert.equal("recall" in memory, false, "H3 must not consume H5 associative retrieval scope");
  assert.equal("search" in memory, false, "H3 must not consume H5 search/ranking scope");
});

test("legacy stored records normalize into the rich model without inventing confidence or source lineage", async () => {
  const legacy = {
    id: "legacy-1",
    content: "legacy fact",
    tags: ["legacy"],
    importance: 0.5,
    status: SemanticMemoryStatus.ACTIVE,
    revision: 1,
    createdAt: "2026-09-12T00:00:00Z",
    updatedAt: "2026-09-12T00:00:00Z",
    provenance: [{
      kind: SemanticMemoryChangeKind.CREATED,
      revision: 1,
      at: "2026-09-12T00:00:00Z",
      source: "legacy",
      sourceId: null,
      callId: null,
      turn: null
    }]
  };
  const { memory } = fixture({ records: [legacy] });
  const normalized = await memory.get("legacy-1");

  assert.equal(normalized.kind, SemanticMemoryKind.SEMANTIC);
  assert.equal(normalized.confidence, null);
  assert.deepEqual(normalized.temporal, { validFrom: null, validTo: null });
  assert.deepEqual(normalized.sourceRefs, []);
});

test("rich semantic fields fail closed on invalid confidence, temporal interval, and duplicate source identity", async () => {
  const { memory } = fixture();
  await assert.rejects(
    () => memory.remember({
      content: "bad confidence",
      confidence: 1.1,
      provenance: provenance("agent")
    }),
    /confidence must be between 0 and 1/
  );
  await assert.rejects(
    () => memory.remember({
      content: "bad interval",
      temporal: { validFrom: "2026-09-13T01:00:00Z", validTo: "2026-09-13T00:00:00Z" },
      provenance: provenance("agent")
    }),
    /validFrom must not be after validTo/
  );
  await assert.rejects(
    () => memory.remember({
      content: "duplicate source",
      sourceRefs: [
        { kind: SemanticMemorySourceRefKind.OBSERVATION, id: "obs-1" },
        { kind: SemanticMemorySourceRefKind.OBSERVATION, id: "obs-1" }
      ],
      provenance: provenance("agent")
    }),
    /duplicate semantic memory source ref/
  );
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
