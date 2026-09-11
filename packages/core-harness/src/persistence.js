import { invariant } from "./contracts.js";
import { SchemaUnsupportedError } from "./errors.js";

export const CURRENT_STATE_SCHEMA_VERSION = 1;

export function normalizePersistentState(state) {
  invariant(state && typeof state === "object", "persistent state is required");
  const schemaVersion = state.schemaVersion ?? CURRENT_STATE_SCHEMA_VERSION;
  const revision = state.revision ?? 0;

  if (schemaVersion > CURRENT_STATE_SCHEMA_VERSION) {
    throw new SchemaUnsupportedError({
      sessionId: state.id ?? null,
      schemaVersion,
      supportedVersion: CURRENT_STATE_SCHEMA_VERSION
    });
  }

  invariant(Number.isInteger(schemaVersion) && schemaVersion > 0, "state schemaVersion must be a positive integer");
  invariant(Number.isInteger(revision) && revision >= 0, "state revision must be a non-negative integer");

  const normalized = structuredClone(state);
  normalized.schemaVersion = schemaVersion;
  normalized.revision = revision;
  normalized.persistentMemory ??= {};
  normalized.persistentMemory.implementations ??= [];
  normalized.persistentMemory.observations ??= [];
  normalized.persistentMemory.verifications ??= [];
  normalized.persistentMemory.evaluations ??= [];
  normalized.persistentMemory.knowledge ??= [];
  normalized.persistentMemory.lineage ??= [];
  normalized.persistentMemory.variations ??= [];
  normalized.trajectory ??= [];
  normalized.supervision ??= {
    inspections: 0,
    skipped: 0,
    interventions: [],
    lastInspectedEventId: null,
    lastDecision: null
  };

  return normalized;
}

export function assertPersistedRevision(result, expectedRevision) {
  if (result == null) return expectedRevision + 1;
  invariant(
    Number.isInteger(result.revision) && result.revision === expectedRevision + 1,
    "session store save() must advance revision exactly once"
  );
  return result.revision;
}
