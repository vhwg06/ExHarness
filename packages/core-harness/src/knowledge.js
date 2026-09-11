import {
  KnowledgeKind,
  candidateKey,
  invariant,
  requireText,
  sameCandidate
} from "./contracts.js";

export const KnowledgeScope = Object.freeze({
  CANDIDATE: "CANDIDATE",
  LINEAGE: "LINEAGE",
  SESSION: "SESSION"
});

export const KnowledgeRelationType = Object.freeze({
  SUPPORTS: "SUPPORTS",
  CONTRADICTS: "CONTRADICTS",
  DERIVED_FROM: "DERIVED_FROM",
  SUPERSEDES: "SUPERSEDES"
});

function normalizeRelation(relation) {
  invariant(relation && typeof relation === "object", "knowledge relation is required");
  invariant(
    Object.values(KnowledgeRelationType).includes(relation.type),
    "knowledge relation type is invalid"
  );
  return Object.freeze({
    type: relation.type,
    targetId: requireText(relation.targetId, "knowledge relation targetId")
  });
}

export function normalizeKnowledgeDraft(record) {
  invariant(record && typeof record === "object", "knowledge record is required");
  invariant(Object.values(KnowledgeKind).includes(record.kind), "knowledge kind is invalid");

  const statement = requireText(record.statement, "knowledge.statement");
  const scope = record.scope ?? KnowledgeScope.CANDIDATE;
  invariant(Object.values(KnowledgeScope).includes(scope), "knowledge scope is invalid");

  const evidence = Object.freeze([...(record.evidence ?? [])]);
  const feedbackRefs = Object.freeze(
    [...(record.feedbackRefs ?? [])].map((value) => requireText(value, "knowledge feedbackRef"))
  );
  const relations = Object.freeze([...(record.relations ?? [])].map(normalizeRelation));
  const tags = Object.freeze(
    [...new Set((record.tags ?? []).map((value) => requireText(value, "knowledge tag")))]
  );

  if (record.kind === KnowledgeKind.FINDING || record.kind === KnowledgeKind.FAILED_DIRECTION) {
    invariant(
      evidence.length > 0 || feedbackRefs.length > 0,
      `${record.kind.toLowerCase()} requires evidence or feedbackRefs`
    );
  }

  return Object.freeze({
    kind: record.kind,
    statement,
    scope,
    evidence,
    feedbackRefs,
    relations,
    tags
  });
}

function sameScopeAnchor(left, right) {
  if (left.scope !== right.scope) return false;
  if (left.scope === KnowledgeScope.SESSION) return true;
  if (left.scope === KnowledgeScope.LINEAGE) return true;
  if (left.scope === KnowledgeScope.CANDIDATE) {
    return sameCandidate(left.candidate, right.candidate);
  }
  return false;
}

export function validateKnowledgeLinks({ item, records, feedbackIds }) {
  const byId = new Map(records.map((record) => [record.id, record]));

  for (const feedbackRef of item.feedbackRefs) {
    invariant(feedbackIds.has(feedbackRef), `knowledge feedback reference not found: ${feedbackRef}`);
  }

  for (const relation of item.relations) {
    invariant(relation.targetId !== item.id, "knowledge cannot relate to itself");
    const target = byId.get(relation.targetId);
    invariant(target, `knowledge relation target not found: ${relation.targetId}`);

    if (relation.type === KnowledgeRelationType.SUPERSEDES) {
      invariant(
        sameScopeAnchor(item, target),
        "superseding knowledge must use the same scope as its target"
      );
    }
  }
}

function scopeApplies(record, state) {
  if (record.scope === KnowledgeScope.SESSION) return true;
  if (record.scope === KnowledgeScope.CANDIDATE) {
    return sameCandidate(record.candidate, state.currentCandidate);
  }

  if (record.scope === KnowledgeScope.LINEAGE) {
    if (record.lineageBase == null) return true;
    const key = candidateKey(record.lineageBase);
    return state.persistentMemory.lineage.some((entry) => candidateKey(entry.candidate) === key);
  }

  return false;
}

function conflictKey(leftId, rightId) {
  return [leftId, rightId].sort().join("::");
}

export function buildKnowledgeView(state) {
  const applicable = state.persistentMemory.knowledge.filter((record) => scopeApplies(record, state));
  const superseded = new Set();

  for (const record of applicable) {
    for (const relation of record.relations ?? []) {
      if (relation.type === KnowledgeRelationType.SUPERSEDES) superseded.add(relation.targetId);
    }
  }

  const active = applicable.filter((record) => !superseded.has(record.id));
  const activeIds = new Set(active.map((record) => record.id));
  const conflicts = [];
  const seenConflicts = new Set();

  for (const record of active) {
    for (const relation of record.relations ?? []) {
      if (relation.type !== KnowledgeRelationType.CONTRADICTS) continue;
      if (!activeIds.has(relation.targetId)) continue;
      const key = conflictKey(record.id, relation.targetId);
      if (seenConflicts.has(key)) continue;
      seenConflicts.add(key);
      conflicts.push(Object.freeze({ leftId: record.id, rightId: relation.targetId }));
    }
  }

  return Object.freeze({
    active: Object.freeze(structuredClone(active)),
    conflicts: Object.freeze(conflicts),
    supersededIds: Object.freeze([...superseded]),
    counts: Object.freeze({
      history: state.persistentMemory.knowledge.length,
      applicable: applicable.length,
      active: active.length,
      conflicts: conflicts.length,
      superseded: superseded.size
    })
  });
}

export function queryKnowledge(state, {
  kinds = null,
  tags = null,
  limit = 50
} = {}) {
  invariant(Number.isInteger(limit) && limit > 0, "knowledge limit must be a positive integer");
  const view = buildKnowledgeView(state);
  const allowedKinds = kinds == null
    ? null
    : new Set(kinds.map((kind) => {
        invariant(Object.values(KnowledgeKind).includes(kind), `knowledge kind is invalid: ${kind}`);
        return kind;
      }));
  const requiredTags = tags == null
    ? null
    : new Set(tags.map((tag) => requireText(tag, "knowledge query tag")));

  let active = [...view.active];
  if (allowedKinds) active = active.filter((record) => allowedKinds.has(record.kind));
  if (requiredTags) {
    active = active.filter((record) => {
      const recordTags = new Set(record.tags ?? []);
      return [...requiredTags].every((tag) => recordTags.has(tag));
    });
  }
  if (active.length > limit) active = active.slice(active.length - limit);

  const visibleIds = new Set(active.map((record) => record.id));
  const conflicts = view.conflicts.filter(
    (conflict) => visibleIds.has(conflict.leftId) && visibleIds.has(conflict.rightId)
  );

  return Object.freeze({
    active: Object.freeze(structuredClone(active)),
    conflicts: Object.freeze(structuredClone(conflicts)),
    counts: view.counts
  });
}
