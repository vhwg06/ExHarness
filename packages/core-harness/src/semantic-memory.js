import { randomUUID } from "node:crypto";

import { invariant, requireText } from "./contracts.js";
import { ExHarnessError, ExHarnessErrorCode } from "./errors.js";

const GroundedSemanticActivationPermitBrand = Symbol("exharness.grounded-semantic-activation-permit");

export const SemanticMemoryStatus = Object.freeze({
  PENDING_GROUNDING: "PENDING_GROUNDING",
  ACTIVE: "ACTIVE",
  ARCHIVED: "ARCHIVED"
});

export const SemanticMemoryKind = Object.freeze({
  EPISODIC: "EPISODIC",
  SEMANTIC: "SEMANTIC",
  PROCEDURAL: "PROCEDURAL",
  REFLECTION: "REFLECTION",
  INTENT: "INTENT"
});

export const SemanticMemorySourceRefKind = Object.freeze({
  MEMORY: "MEMORY",
  OBSERVATION: "OBSERVATION",
  AGENT_EVENT: "AGENT_EVENT",
  VERIFICATION: "VERIFICATION",
  EVALUATION: "EVALUATION",
  EXTERNAL: "EXTERNAL"
});

export const SemanticMemoryKindSemantics = Object.freeze({
  [SemanticMemoryKind.EPISODIC]: Object.freeze({ role: "EXPERIENCE", evolution: "RECONSOLIDATABLE" }),
  [SemanticMemoryKind.SEMANTIC]: Object.freeze({ role: "KNOWLEDGE", evolution: "REVISIONED" }),
  [SemanticMemoryKind.PROCEDURAL]: Object.freeze({ role: "PROCEDURE", evolution: "REVISIONED" }),
  [SemanticMemoryKind.REFLECTION]: Object.freeze({ role: "DERIVED", evolution: "REVISIONED" }),
  [SemanticMemoryKind.INTENT]: Object.freeze({ role: "GOAL", evolution: "REVISIONED" })
});

export const SemanticMemoryChangeKind = Object.freeze({
  CREATED: "CREATED",
  ACTIVATED: "ACTIVATED",
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

function normalizeConfidence(value = null) {
  if (value == null) return null;
  invariant(Number.isFinite(value), "semantic memory confidence must be finite or null");
  invariant(value >= 0 && value <= 1, "semantic memory confidence must be between 0 and 1");
  return value;
}

function normalizeKind(value = SemanticMemoryKind.SEMANTIC) {
  invariant(Object.values(SemanticMemoryKind).includes(value), "semantic memory kind is invalid");
  return value;
}

function normalizeTimestamp(value, label) {
  if (value == null) return null;
  const text = requireText(value, label);
  invariant(Number.isFinite(Date.parse(text)), `${label} must be a valid timestamp`);
  return text;
}

function normalizeTemporal(temporal = {}) {
  invariant(temporal && typeof temporal === "object" && !Array.isArray(temporal), "semantic memory temporal validity must be an object");
  const validFrom = normalizeTimestamp(temporal.validFrom ?? null, "semantic memory validFrom");
  const validTo = normalizeTimestamp(temporal.validTo ?? null, "semantic memory validTo");
  if (validFrom != null && validTo != null) {
    invariant(Date.parse(validFrom) <= Date.parse(validTo), "semantic memory validFrom must not be after validTo");
  }
  return Object.freeze({ validFrom, validTo });
}

function normalizeSourceRefs(sourceRefs = []) {
  invariant(Array.isArray(sourceRefs), "semantic memory sourceRefs must be an array");
  const seen = new Set();
  return Object.freeze(sourceRefs.map((ref) => {
    invariant(ref && typeof ref === "object" && !Array.isArray(ref), "semantic memory source ref must be an object");
    invariant(Object.values(SemanticMemorySourceRefKind).includes(ref.kind), "semantic memory source ref kind is invalid");
    const normalized = Object.freeze({
      kind: ref.kind,
      id: requireText(ref.id, "semantic memory source ref id")
    });
    const key = `${normalized.kind}:${normalized.id}`;
    invariant(!seen.has(key), `duplicate semantic memory source ref: ${key}`);
    seen.add(key);
    return normalized;
  }));
}

function sourceRefsKey(sourceRefs) {
  return JSON.stringify(normalizeSourceRefs(sourceRefs));
}

export function _createGroundedSemanticActivationPermit({
  kind,
  content,
  sourceRefs,
  evaluationId = null,
  groundingArtifactId
} = {}) {
  const resolvedKind = normalizeKind(kind);
  invariant(
    resolvedKind === SemanticMemoryKind.REFLECTION || resolvedKind === SemanticMemoryKind.INTENT,
    "grounded semantic activation permit only supports REFLECTION or INTENT"
  );
  const normalizedRefs = normalizeSourceRefs(sourceRefs);
  let resolvedEvaluationId = null;
  if (resolvedKind === SemanticMemoryKind.REFLECTION) {
    resolvedEvaluationId = requireText(evaluationId, "reflection activation evaluationId");
    invariant(
      normalizedRefs.some(
        (ref) => ref.kind === SemanticMemorySourceRefKind.EVALUATION && ref.id === resolvedEvaluationId
      ),
      "reflection activation permit requires its evaluation source ref"
    );
  } else if (evaluationId != null) {
    resolvedEvaluationId = requireText(evaluationId, "intent activation evaluationId");
    invariant(
      normalizedRefs.some(
        (ref) => ref.kind === SemanticMemorySourceRefKind.EVALUATION && ref.id === resolvedEvaluationId
      ),
      "intent activation evaluationId must reference an intent source"
    );
  }
  return Object.freeze({
    [GroundedSemanticActivationPermitBrand]: true,
    kind: resolvedKind,
    content: requireText(content, "grounded semantic activation content"),
    sourceRefsKey: sourceRefsKey(normalizedRefs),
    evaluationId: resolvedEvaluationId,
    groundingArtifactId: requireText(groundingArtifactId, "grounded semantic activation groundingArtifactId")
  });
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
    kind: normalizeKind(draft.kind),
    content: requireText(draft.content, "semantic memory content"),
    tags: normalizeTags(draft.tags),
    importance: normalizeImportance(draft.importance),
    confidence: normalizeConfidence(draft.confidence),
    temporal: normalizeTemporal(draft.temporal),
    sourceRefs: normalizeSourceRefs(draft.sourceRefs),
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

function normalizeStoredRecord(record) {
  invariant(record && typeof record === "object", "semantic memory record is required");
  const normalized = {
    ...clone(record),
    id: requireText(record.id, "semantic memory id"),
    kind: normalizeKind(record.kind),
    content: requireText(record.content, "semantic memory content"),
    tags: normalizeTags(record.tags),
    importance: normalizeImportance(record.importance),
    confidence: normalizeConfidence(record.confidence),
    temporal: normalizeTemporal(record.temporal),
    sourceRefs: normalizeSourceRefs(record.sourceRefs)
  };
  invariant(Object.values(SemanticMemoryStatus).includes(record.status), "semantic memory status is invalid");
  invariant(Number.isInteger(record.revision) && record.revision > 0, "semantic memory revision must be positive");
  normalized.status = record.status;
  normalized.revision = record.revision;
  normalized.createdAt = requireText(record.createdAt, "semantic memory createdAt");
  normalized.updatedAt = requireText(record.updatedAt, "semantic memory updatedAt");
  invariant(Array.isArray(record.provenance) && record.provenance.length > 0, "semantic memory provenance history is required");
  normalized.provenance = Object.freeze(record.provenance.map((entry) => {
    invariant(entry && typeof entry === "object", "semantic memory provenance entry is required");
    invariant(Object.values(SemanticMemoryChangeKind).includes(entry.kind), "semantic memory change kind is invalid");
    invariant(Number.isInteger(entry.revision) && entry.revision > 0, "semantic memory provenance revision must be positive");
    return lifecycleEntry({
      kind: entry.kind,
      revision: entry.revision,
      at: requireText(entry.at, "semantic memory provenance at"),
      provenance: entry
    });
  }));
  return Object.freeze(normalized);
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
    const normalized = clone(normalizeStoredRecord(record));
    invariant(!stored.has(normalized.id), `duplicate semantic memory id: ${normalized.id}`);
    stored.set(normalized.id, normalized);
  }

  return Object.freeze({
    async create(record) {
      const next = clone(normalizeStoredRecord(record));
      invariant(!stored.has(next.id), `semantic memory already exists: ${next.id}`);
      stored.set(next.id, next);
      return clone(next);
    },

    async read(id) {
      requireText(id, "semantic memory id");
      return clone(stored.get(id) ?? null);
    },

    async replace(record, { expectedRevision } = {}) {
      const next = clone(normalizeStoredRecord(record));
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

function requiresGroundedActivation(kind) {
  return kind === SemanticMemoryKind.REFLECTION || kind === SemanticMemoryKind.INTENT;
}

export function createSemanticMemoryPort({
  provider,
  clock = () => new Date().toISOString(),
  idFactory = () => randomUUID()
} = {}) {
  const resolvedProvider = validateProvider(provider);
  invariant(typeof clock === "function", "semantic memory clock must be a function");
  invariant(typeof idFactory === "function", "semantic memory idFactory must be a function");
  const consumedGroundingPermits = new WeakSet();

  async function requireRecord(id) {
    const record = await resolvedProvider.read(requireText(id, "semantic memory id"));
    invariant(record, `semantic memory not found: ${id}`);
    return normalizeStoredRecord(record);
  }

  async function activateGroundedMemory(id, { permit, provenance, expectedRevision = null } = {}) {
    const current = await requireRecord(id);
    invariant(requiresGroundedActivation(current.kind), "semantic memory kind does not require grounded activation");
    invariant(current.status === SemanticMemoryStatus.PENDING_GROUNDING, "semantic memory is not pending grounding");
    invariant(
      permit && permit[GroundedSemanticActivationPermitBrand] === true,
      "semantic memory activation requires grounded cognition permit"
    );
    invariant(!consumedGroundingPermits.has(permit), "semantic grounding permit was already consumed");
    invariant(permit.kind === current.kind, "semantic grounding permit kind mismatch");
    invariant(permit.content === current.content, "semantic grounding permit content mismatch");
    invariant(permit.sourceRefsKey === sourceRefsKey(current.sourceRefs), "semantic grounding permit source snapshot mismatch");
    invariant(
      current.sourceRefs.some(
        (ref) => ref.kind === SemanticMemorySourceRefKind.EXTERNAL && ref.id === `grounding:${permit.groundingArtifactId}`
      ),
      "semantic activation requires the grounding artifact source ref"
    );
    if (current.kind === SemanticMemoryKind.REFLECTION) {
      invariant(permit.evaluationId != null, "reflection activation requires grounded evaluation identity");
      invariant(
        current.sourceRefs.some(
          (ref) => ref.kind === SemanticMemorySourceRefKind.EVALUATION && ref.id === permit.evaluationId
        ),
        "reflection activation requires the grounded evaluation source ref"
      );
    }
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
      status: SemanticMemoryStatus.ACTIVE,
      revision: nextRevision,
      updatedAt: at,
      provenance: Object.freeze([
        ...clone(current.provenance),
        lifecycleEntry({
          kind: SemanticMemoryChangeKind.ACTIVATED,
          provenance: normalizedProvenance,
          revision: nextRevision,
          at
        })
      ])
    });
    consumedGroundingPermits.add(permit);
    return clone(await resolvedProvider.replace(next, { expectedRevision: current.revision }));
  }

  return Object.freeze({
    async remember(input) {
      const draft = defineSemanticMemoryDraft(input);
      const id = requireText(idFactory(), "semantic memory generated id");
      const at = requireText(clock(), "semantic memory clock value");
      const record = Object.freeze({
        id,
        kind: draft.kind,
        content: draft.content,
        tags: draft.tags,
        importance: draft.importance,
        confidence: draft.confidence,
        temporal: draft.temporal,
        sourceRefs: draft.sourceRefs,
        status: requiresGroundedActivation(draft.kind)
          ? SemanticMemoryStatus.PENDING_GROUNDING
          : SemanticMemoryStatus.ACTIVE,
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

    activateGrounded: activateGroundedMemory,

    async activateReflection(id, options = {}) {
      const current = await requireRecord(id);
      invariant(current.kind === SemanticMemoryKind.REFLECTION, "activateReflection requires REFLECTION memory");
      return activateGroundedMemory(id, options);
    },

    async activateIntent(id, options = {}) {
      const current = await requireRecord(id);
      invariant(current.kind === SemanticMemoryKind.INTENT, "activateIntent requires INTENT memory");
      return activateGroundedMemory(id, options);
    },

    async get(id, { includeArchived = false } = {}) {
      invariant(typeof includeArchived === "boolean", "semantic memory includeArchived must be boolean");
      const record = await resolvedProvider.read(requireText(id, "semantic memory id"));
      if (record == null) return null;
      const normalized = normalizeStoredRecord(record);
      if (!includeArchived && normalized.status === SemanticMemoryStatus.ARCHIVED) return null;
      return clone(normalized);
    },

    async list({ includeArchived = false, tags = null, kinds = null, validAt = null, limit = 100 } = {}) {
      invariant(typeof includeArchived === "boolean", "semantic memory includeArchived must be boolean");
      invariant(Number.isInteger(limit) && limit > 0, "semantic memory list limit must be positive");
      const requiredTags = tags == null ? null : new Set(normalizeTags(tags));
      const requiredKinds = kinds == null
        ? null
        : new Set((() => {
          invariant(Array.isArray(kinds), "semantic memory list kinds must be an array");
          return kinds.map(normalizeKind);
        })());
      const validAtText = normalizeTimestamp(validAt, "semantic memory list validAt");
      const validAtMillis = validAtText == null ? null : Date.parse(validAtText);
      let records = await resolvedProvider.list();
      invariant(Array.isArray(records), "semantic memory provider list() must return an array");
      records = records.map((record) => clone(normalizeStoredRecord(record)));
      if (!includeArchived) records = records.filter((record) => record.status === SemanticMemoryStatus.ACTIVE);
      if (requiredTags) {
        records = records.filter((record) => {
          const recordTags = new Set(record.tags);
          return [...requiredTags].every((tag) => recordTags.has(tag));
        });
      }
      if (requiredKinds) records = records.filter((record) => requiredKinds.has(record.kind));
      if (validAtMillis != null) {
        records = records.filter((record) => {
          const from = record.temporal.validFrom == null ? null : Date.parse(record.temporal.validFrom);
          const to = record.temporal.validTo == null ? null : Date.parse(record.temporal.validTo);
          return (from == null || from <= validAtMillis) && (to == null || validAtMillis <= to);
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
      invariant(current.status !== SemanticMemoryStatus.ARCHIVED, "archived semantic memory cannot be updated");
      invariant(patch.kind == null || patch.kind === current.kind, "semantic memory kind is immutable after creation");
      invariant(patch.sourceRefs == null, "semantic memory sourceRefs are immutable after creation; create a derived memory instead");
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
        confidence: patch.confidence === undefined ? current.confidence : normalizeConfidence(patch.confidence),
        temporal: patch.temporal == null ? Object.freeze(clone(current.temporal)) : normalizeTemporal(patch.temporal),
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
      invariant(current.status !== SemanticMemoryStatus.ARCHIVED, "semantic memory is already archived");
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
