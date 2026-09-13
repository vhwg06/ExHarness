import { randomUUID } from "node:crypto";

import { invariant, requireText } from "./contracts.js";
import { SemanticMemoryRelationConflictError } from "./errors.js";
import { defineSemanticMemoryProvenance } from "./semantic-memory.js";

export const SemanticMemoryRelationType = Object.freeze({
  DERIVED_FROM: "DERIVED_FROM",
  CAUSES: "CAUSES",
  REFINES: "REFINES",
  SUPPORTS: "SUPPORTS",
  CONTRADICTS: "CONTRADICTS",
  RELATED: "RELATED",
  PRECEDES: "PRECEDES",
  PART_OF: "PART_OF",
  TRIGGERS: "TRIGGERS",
  SUPERSEDES: "SUPERSEDES"
});

export const SemanticMemoryRelationStatus = Object.freeze({
  ACTIVE: "ACTIVE",
  ARCHIVED: "ARCHIVED"
});

export const SemanticMemoryRelationChangeKind = Object.freeze({
  CREATED: "CREATED",
  ARCHIVED: "ARCHIVED"
});

export const SemanticMemoryRelationDirection = Object.freeze({
  OUTGOING: "OUTGOING",
  INCOMING: "INCOMING",
  BOTH: "BOTH"
});

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function normalizeType(type) {
  invariant(Object.values(SemanticMemoryRelationType).includes(type), "semantic memory relation type is invalid");
  return type;
}

function relationKey({ fromMemoryId, type, toMemoryId }) {
  return `${fromMemoryId}\u0000${type}\u0000${toMemoryId}`;
}

function lifecycleEntry({ kind, provenance, revision, at }) {
  invariant(Object.values(SemanticMemoryRelationChangeKind).includes(kind), "semantic memory relation change kind is invalid");
  invariant(Number.isInteger(revision) && revision > 0, "semantic memory relation lifecycle revision must be positive");
  return Object.freeze({
    kind,
    revision,
    at: requireText(at, "semantic memory relation lifecycle at"),
    ...clone(defineSemanticMemoryProvenance(provenance))
  });
}

export function defineSemanticMemoryRelationDraft(draft) {
  invariant(draft && typeof draft === "object", "semantic memory relation draft is required");
  const fromMemoryId = requireText(draft.fromMemoryId, "semantic memory relation fromMemoryId");
  const toMemoryId = requireText(draft.toMemoryId, "semantic memory relation toMemoryId");
  invariant(fromMemoryId !== toMemoryId, "semantic memory relation cannot target the same memory");
  return Object.freeze({
    fromMemoryId,
    toMemoryId,
    type: normalizeType(draft.type),
    provenance: defineSemanticMemoryProvenance(draft.provenance)
  });
}

function normalizeStoredRelation(record) {
  invariant(record && typeof record === "object", "semantic memory relation record is required");
  const id = requireText(record.id, "semantic memory relation id");
  const fromMemoryId = requireText(record.fromMemoryId, "semantic memory relation fromMemoryId");
  const toMemoryId = requireText(record.toMemoryId, "semantic memory relation toMemoryId");
  invariant(fromMemoryId !== toMemoryId, "semantic memory relation cannot target the same memory");
  const type = normalizeType(record.type);
  invariant(Object.values(SemanticMemoryRelationStatus).includes(record.status), "semantic memory relation status is invalid");
  invariant(Number.isInteger(record.revision) && record.revision > 0, "semantic memory relation revision must be positive");
  const createdAt = requireText(record.createdAt, "semantic memory relation createdAt");
  const updatedAt = requireText(record.updatedAt, "semantic memory relation updatedAt");
  invariant(Array.isArray(record.provenance) && record.provenance.length > 0, "semantic memory relation provenance history is required");
  const provenance = Object.freeze(record.provenance.map((entry) => lifecycleEntry({
    kind: entry.kind,
    provenance: entry,
    revision: entry.revision,
    at: entry.at
  })));
  return Object.freeze({
    id,
    fromMemoryId,
    toMemoryId,
    type,
    status: record.status,
    revision: record.revision,
    createdAt,
    updatedAt,
    provenance
  });
}

function validateProvider(provider) {
  invariant(provider && typeof provider === "object", "semantic memory relation provider is required");
  for (const method of ["create", "read", "replace", "list"]) {
    invariant(typeof provider[method] === "function", `semantic memory relation provider requires ${method}()`);
  }
  return provider;
}

export function createInMemorySemanticMemoryRelationProvider({ relations = [] } = {}) {
  const stored = new Map();

  for (const relation of relations) {
    const normalized = clone(normalizeStoredRelation(relation));
    invariant(!stored.has(normalized.id), `duplicate semantic memory relation id: ${normalized.id}`);
    stored.set(normalized.id, normalized);
  }

  return Object.freeze({
    async create(record) {
      const next = clone(normalizeStoredRelation(record));
      invariant(!stored.has(next.id), `semantic memory relation already exists: ${next.id}`);
      stored.set(next.id, next);
      return clone(next);
    },

    async read(id) {
      return clone(stored.get(requireText(id, "semantic memory relation id")) ?? null);
    },

    async replace(record, { expectedRevision } = {}) {
      const next = clone(normalizeStoredRelation(record));
      invariant(Number.isInteger(expectedRevision) && expectedRevision > 0, "semantic memory relation expectedRevision must be positive");
      const current = stored.get(next.id) ?? null;
      const actualRevision = current?.revision ?? null;
      if (actualRevision !== expectedRevision) {
        throw new SemanticMemoryRelationConflictError({
          relationId: next.id,
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

export function createSemanticMemoryGraph({
  memory,
  provider = createInMemorySemanticMemoryRelationProvider(),
  clock = () => new Date().toISOString(),
  idFactory = () => randomUUID()
} = {}) {
  invariant(memory && typeof memory.get === "function", "semantic memory graph requires memory.get()");
  const resolvedProvider = validateProvider(provider);
  invariant(typeof clock === "function", "semantic memory graph clock must be a function");
  invariant(typeof idFactory === "function", "semantic memory graph idFactory must be a function");

  async function requireMemory(id) {
    const record = await memory.get(requireText(id, "semantic memory graph memory id"), { includeArchived: true });
    invariant(record, `semantic memory graph endpoint not found: ${id}`);
    return record;
  }

  async function requireRelation(id) {
    const record = await resolvedProvider.read(requireText(id, "semantic memory relation id"));
    invariant(record, `semantic memory relation not found: ${id}`);
    return normalizeStoredRelation(record);
  }

  return Object.freeze({
    async relate(input) {
      const draft = defineSemanticMemoryRelationDraft(input);
      await requireMemory(draft.fromMemoryId);
      await requireMemory(draft.toMemoryId);

      const all = await resolvedProvider.list();
      invariant(Array.isArray(all), "semantic memory relation provider list() must return an array");
      const key = relationKey(draft);
      const duplicate = all
        .map(normalizeStoredRelation)
        .find((relation) => relation.status === SemanticMemoryRelationStatus.ACTIVE && relationKey(relation) === key);
      invariant(!duplicate, `active semantic memory relation already exists: ${duplicate?.id ?? key}`);

      const id = requireText(idFactory(), "semantic memory relation generated id");
      const at = requireText(clock(), "semantic memory relation clock value");
      const record = Object.freeze({
        id,
        fromMemoryId: draft.fromMemoryId,
        toMemoryId: draft.toMemoryId,
        type: draft.type,
        status: SemanticMemoryRelationStatus.ACTIVE,
        revision: 1,
        createdAt: at,
        updatedAt: at,
        provenance: Object.freeze([
          lifecycleEntry({
            kind: SemanticMemoryRelationChangeKind.CREATED,
            provenance: draft.provenance,
            revision: 1,
            at
          })
        ])
      });
      return clone(await resolvedProvider.create(record));
    },

    async get(id, { includeArchived = false } = {}) {
      invariant(typeof includeArchived === "boolean", "semantic memory relation includeArchived must be boolean");
      const raw = await resolvedProvider.read(requireText(id, "semantic memory relation id"));
      if (raw == null) return null;
      const relation = normalizeStoredRelation(raw);
      if (!includeArchived && relation.status === SemanticMemoryRelationStatus.ARCHIVED) return null;
      return clone(relation);
    },

    async relationsFor(memoryId, {
      direction = SemanticMemoryRelationDirection.BOTH,
      types = null,
      includeArchived = false,
      limit = 100
    } = {}) {
      const resolvedMemoryId = requireText(memoryId, "semantic memory graph memory id");
      await requireMemory(resolvedMemoryId);
      invariant(Object.values(SemanticMemoryRelationDirection).includes(direction), "semantic memory relation direction is invalid");
      invariant(typeof includeArchived === "boolean", "semantic memory relation includeArchived must be boolean");
      invariant(Number.isInteger(limit) && limit > 0, "semantic memory relation list limit must be positive");
      const typeSet = types == null
        ? null
        : new Set((() => {
          invariant(Array.isArray(types), "semantic memory relation types must be an array");
          return types.map(normalizeType);
        })());

      let relations = await resolvedProvider.list();
      invariant(Array.isArray(relations), "semantic memory relation provider list() must return an array");
      relations = relations.map(normalizeStoredRelation);
      if (!includeArchived) {
        relations = relations.filter((relation) => relation.status === SemanticMemoryRelationStatus.ACTIVE);
      }
      relations = relations.filter((relation) => {
        if (direction === SemanticMemoryRelationDirection.OUTGOING) return relation.fromMemoryId === resolvedMemoryId;
        if (direction === SemanticMemoryRelationDirection.INCOMING) return relation.toMemoryId === resolvedMemoryId;
        return relation.fromMemoryId === resolvedMemoryId || relation.toMemoryId === resolvedMemoryId;
      });
      if (typeSet) relations = relations.filter((relation) => typeSet.has(relation.type));
      relations.sort((left, right) => {
        const byTime = left.createdAt.localeCompare(right.createdAt);
        return byTime === 0 ? left.id.localeCompare(right.id) : byTime;
      });
      if (relations.length > limit) relations = relations.slice(0, limit);
      return Object.freeze(relations.map((relation) => Object.freeze(clone(relation))));
    },

    async archive(id, { expectedRevision = null, provenance } = {}) {
      const current = await requireRelation(id);
      invariant(current.status === SemanticMemoryRelationStatus.ACTIVE, "semantic memory relation is already archived");
      const expected = expectedRevision ?? current.revision;
      invariant(Number.isInteger(expected) && expected > 0, "semantic memory relation expectedRevision must be positive");
      if (expected !== current.revision) {
        throw new SemanticMemoryRelationConflictError({
          relationId: current.id,
          expectedRevision: expected,
          actualRevision: current.revision
        });
      }
      const normalizedProvenance = defineSemanticMemoryProvenance(provenance);
      const nextRevision = current.revision + 1;
      const at = requireText(clock(), "semantic memory relation clock value");
      const next = Object.freeze({
        ...clone(current),
        status: SemanticMemoryRelationStatus.ARCHIVED,
        revision: nextRevision,
        updatedAt: at,
        provenance: Object.freeze([
          ...clone(current.provenance),
          lifecycleEntry({
            kind: SemanticMemoryRelationChangeKind.ARCHIVED,
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
