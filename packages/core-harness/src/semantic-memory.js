import { randomUUID } from "node:crypto";

import { invariant, requireText } from "./contracts.js";
import { ExHarnessError, ExHarnessErrorCode } from "./errors.js";

export const SemanticMemoryStatus = Object.freeze({
  ACTIVE: "ACTIVE",
  ARCHIVED: "ARCHIVED"
});

export const SemanticMemoryChangeKind = Object.freeze({
  CREATED: "CREATED",
  UPDATED: "UPDATED",
  ARCHIVED: "ARCHIVED"
});

export class SemanticMemoryConflictError extends ExHarnessError {
  constructor({ memoryId, expectedRevision, actualRevision }) {
    super(
      ExHarnessErrorCode.SEMANTIC_MEMORY_CONFLICT,
      `semantic memory revision conflict: ${memoryId}`,
      { details: { memoryId, expectedRevision, actualRevision } }
    );
    this.name = "SemanticMemoryConflictError";
  }
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function normalizeTags(tags = []) {
  invariant(Array.isArray(tags), "semantic memory tags must be an array");
  return Object.freeze([...new Set(tags.map((tag) => requireText(tag, "semantic memory tag")))]);
}

function normalizeImportance(value = 0.5) {
  invariant(Number.isFinite(value), "semantic memory importance must be finite");
  invariant(value >= 0 && value <= 1, "semantic memory importance must be between 0 and 1");
  return value;
}

function normalizeTurn(turn) {
  if (turn == null) return null;
  invariant(Number.isInteger(turn) && turn > 0, "semantic memory provenance turn must be a positive integer");
  return turn;
}

export function defineSemanticMemoryProvenance(provenance) {
  invariant(provenance && typeof provenance === "object", "semantic memory provenance is required");
  return Object.freeze({
    source: requireText(provenance.source, "semantic memory provenance source"),
    sourceId: provenance.sourceId == null
      ? null
      : requireText(provenance.sourceId, "semantic memory provenance sourceId"),
    callId: provenance.callId == null
      ? null
      : requireText(provenance.callId, "semantic memory provenance callId"),
    turn: normalizeTurn(provenance.turn)
  });
}

export function defineSemanticMemoryDraft(draft) {
  invariant(draft && typeof draft === "object", "semantic memory draft is required");
  return Object.freeze({
    content: requireText(draft.content, "semantic memory content"),
    tags: normalizeTags(draft.tags),
    importance: normalizeImportance(draft.importance),
    provenance: defineSemanticMemoryProvenance(draft.provenance)
  });
}

function lifecycleEntry({ kind, provenance, revision, at }) {
  invariant(Object.values(SemanticMemoryChangeKind).includes(kind), "semantic memory change kind is invalid");
  return Object.freeze({
    kind,
    revision,
    at,
    ...clone(defineSemanticMemoryProvenance(provenance))
  });
}

function validateStoredRecord(record) {
  invariant(record && typeof record === "object", "semantic memory record is required");
  requireText(record.id, "semantic memory id");
  requireText(record.content, "semantic memory content");
  invariant(Object.values(SemanticMemoryStatus).includes(record.status), "semantic memory status is invalid");
  invariant(Number.isInteger(record.revision) && record.revision > 0, "semantic memory revision must be positive");
  requireText(record.createdAt, "semantic memory createdAt");
  requireText(record.updatedAt, "semantic memory updatedAt");
  normalizeTags(record.tags);
  normalizeImportance(record.importance);
  invariant(Array.isArray(record.provenance) && record.provenance.length > 0, "semantic memory provenance history is required");
  return record;
}

function validateProvider(provider) {
  invariant(provider && typeof provider === "object", "semantic memory provider is required");
  for (const method of ["create", "read", "replace", "list"]) {
    invariant(typeof provider[method] === "function", `semantic memory provider requires ${method}()`);
  }
  return provider;
}

export function createInMemorySemanticMemoryProvider({ records = [] } = {}) {
  const stored = new Map();

  for (const record of records) {
    const normalized = clone(validateStoredRecord(record));
    invariant(!stored.has(normalized.id), `duplicate semantic memory id: ${normalized.id}`);
    stored.set(normalized.id, normalized);
  }

  return Object.freeze({
    async create(record) {
      const next = clone(validateStoredRecord(record));
      invariant(!stored.has(next.id), `semantic memory already exists: ${next.id}`);
      stored.set(next.id, next);
      return clone(next);
    },

    async read(id) {
      requireText(id, "semantic memory id");
      return clone(stored.get(id) ?? null);
    },

    async replace(record, { expectedRevision } = {}) {
      const next = clone(validateStoredRecord(record));
      invariant(Number.isInteger(expectedRevision) && expectedRevision > 0, "semantic memory expectedRevision must be positive");
      const current = stored.get(next.id) ?? null;
      const actualRevision = current?.revision ?? null;
      if (actualRevision !== expectedRevision) {
        throw new SemanticMemoryConflictError({
          memoryId: next.id,
          expectedRevision,
          actualRevision
        });
      }
      stored.set(next.id, next);
      return clone(next);
    },

    async list() {
      return clone([...stored.values()]);
    }
  });
}

export function createSemanticMemoryPort({
  provider,
  clock = () => new Date().toISOString(),
  idFactory = () => randomUUID()
} = {}) {
  const resolvedProvider = validateProvider(provider);
  invariant(typeof clock === "function", "semantic memory clock must be a function");
  invariant(typeof idFactory === "function", "semantic memory idFactory must be a function");

  async function requireRecord(id) {
    const record = await resolvedProvider.read(requireText(id, "semantic memory id"));
    invariant(record, `semantic memory not found: ${id}`);
    return validateStoredRecord(record);
  }

  return Object.freeze({
    async remember(input) {
      const draft = defineSemanticMemoryDraft(input);
      const id = requireText(idFactory(), "semantic memory generated id");
      const at = requireText(clock(), "semantic memory clock value");
      const record = Object.freeze({
        id,
        content: draft.content,
        tags: draft.tags,
        importance: draft.importance,
        status: SemanticMemoryStatus.ACTIVE,
        revision: 1,
        createdAt: at,
        updatedAt: at,
        provenance: Object.freeze([
          lifecycleEntry({
            kind: SemanticMemoryChangeKind.CREATED,
            provenance: draft.provenance,
            revision: 1,
            at
          })
        ])
      });
      return clone(await resolvedProvider.create(record));
    },

    async get(id, { includeArchived = false } = {}) {
      invariant(typeof includeArchived === "boolean", "semantic memory includeArchived must be boolean");
      const record = await resolvedProvider.read(requireText(id, "semantic memory id"));
      if (record == null) return null;
      validateStoredRecord(record);
      if (!includeArchived && record.status === SemanticMemoryStatus.ARCHIVED) return null;
      return clone(record);
    },

    async list({ includeArchived = false, tags = null, limit = 100 } = {}) {
      invariant(typeof includeArchived === "boolean", "semantic memory includeArchived must be boolean");
      invariant(Number.isInteger(limit) && limit > 0, "semantic memory list limit must be positive");
      const requiredTags = tags == null ? null : new Set(normalizeTags(tags));
      let records = await resolvedProvider.list();
      invariant(Array.isArray(records), "semantic memory provider list() must return an array");
      records = records.map((record) => clone(validateStoredRecord(record)));
      if (!includeArchived) records = records.filter((record) => record.status === SemanticMemoryStatus.ACTIVE);
      if (requiredTags) {
        records = records.filter((record) => {
          const recordTags = new Set(record.tags);
          return [...requiredTags].every((tag) => recordTags.has(tag));
        });
      }
      records.sort((left, right) => {
        const byTime = left.createdAt.localeCompare(right.createdAt);
        return byTime === 0 ? left.id.localeCompare(right.id) : byTime;
      });
      if (records.length > limit) records = records.slice(records.length - limit);
      return Object.freeze(records.map((record) => Object.freeze(clone(record))));
    },

    async update(id, patch) {
      invariant(patch && typeof patch === "object", "semantic memory update patch is required");
      const current = await requireRecord(id);
      invariant(current.status === SemanticMemoryStatus.ACTIVE, "archived semantic memory cannot be updated");
      const expectedRevision = patch.expectedRevision ?? current.revision;
      invariant(Number.isInteger(expectedRevision) && expectedRevision > 0, "semantic memory expectedRevision must be positive");
      if (expectedRevision !== current.revision) {
        throw new SemanticMemoryConflictError({
          memoryId: current.id,
          expectedRevision,
          actualRevision: current.revision
        });
      }
      const provenance = defineSemanticMemoryProvenance(patch.provenance);
      const nextRevision = current.revision + 1;
      const at = requireText(clock(), "semantic memory clock value");
      const next = Object.freeze({
        ...clone(current),
        content: patch.content == null ? current.content : requireText(patch.content, "semantic memory content"),
        tags: patch.tags == null ? Object.freeze(clone(current.tags)) : normalizeTags(patch.tags),
        importance: patch.importance == null ? current.importance : normalizeImportance(patch.importance),
        revision: nextRevision,
        updatedAt: at,
        provenance: Object.freeze([
          ...clone(current.provenance),
          lifecycleEntry({
            kind: SemanticMemoryChangeKind.UPDATED,
            provenance,
            revision: nextRevision,
            at
          })
        ])
      });
      return clone(await resolvedProvider.replace(next, { expectedRevision: current.revision }));
    },

    async archive(id, { provenance, expectedRevision = null } = {}) {
      const current = await requireRecord(id);
      invariant(current.status === SemanticMemoryStatus.ACTIVE, "semantic memory is already archived");
      const expected = expectedRevision ?? current.revision;
      invariant(Number.isInteger(expected) && expected > 0, "semantic memory expectedRevision must be positive");
      if (expected !== current.revision) {
        throw new SemanticMemoryConflictError({
          memoryId: current.id,
          expectedRevision: expected,
          actualRevision: current.revision
        });
      }
      const normalizedProvenance = defineSemanticMemoryProvenance(provenance);
      const nextRevision = current.revision + 1;
      const at = requireText(clock(), "semantic memory clock value");
      const next = Object.freeze({
        ...clone(current),
        status: SemanticMemoryStatus.ARCHIVED,
        revision: nextRevision,
        updatedAt: at,
        provenance: Object.freeze([
          ...clone(current.provenance),
          lifecycleEntry({
            kind: SemanticMemoryChangeKind.ARCHIVED,
            provenance: normalizedProvenance,
            revision: nextRevision,
            at
          })
        ])
      });
      return clone(await resolvedProvider.replace(next, { expectedRevision: current.revision }));
    }
  });
}
