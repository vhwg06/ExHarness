import { invariant } from "./contracts.js";
import { SchemaUnsupportedError } from "./errors.js";

export const CURRENT_STATE_SCHEMA_VERSION = 2;

function requireVersion(value, label) {
  invariant(Number.isInteger(value) && value > 0, `${label} must be a positive integer`);
  return value;
}

export function defineStateMigration({ fromVersion, migrate }) {
  const from = requireVersion(fromVersion, "migration fromVersion");
  invariant(typeof migrate === "function", "state migration requires migrate()");
  return Object.freeze({
    fromVersion: from,
    toVersion: from + 1,
    migrate
  });
}

export const BUILT_IN_STATE_MIGRATIONS = Object.freeze([
  defineStateMigration({
    fromVersion: 1,
    migrate(state) {
      const next = structuredClone(state);
      next.schemaVersion = 2;
      next.persistentMemory ??= {};
      next.persistentMemory.evidenceArtifacts ??= [];
      next.persistentMemory.decisionArtifacts ??= [];
      next.persistentMemory.attestations ??= [];
      next.persistentMemory.searchInvestmentDecisions ??= [];
      return next;
    }
  })
]);

export function createStateMigrator({
  targetVersion = CURRENT_STATE_SCHEMA_VERSION,
  migrations = null
} = {}) {
  const target = requireVersion(targetVersion, "migration targetVersion");
  const definitions = migrations == null ? BUILT_IN_STATE_MIGRATIONS : migrations;
  invariant(Array.isArray(definitions), "state migrations must be an array");
  const byVersion = new Map();
  for (const definition of definitions) {
    const migration = defineStateMigration(definition);
    invariant(!byVersion.has(migration.fromVersion), `duplicate migration from version ${migration.fromVersion}`);
    byVersion.set(migration.fromVersion, migration);
  }

  return Object.freeze({
    targetVersion: target,

    async migrate(state) {
      invariant(state && typeof state === "object", "persistent state is required");
      const initialVersion = state.schemaVersion ?? 1;
      requireVersion(initialVersion, "state schemaVersion");
      if (initialVersion > target) {
        throw new SchemaUnsupportedError({
          sessionId: state.id ?? null,
          schemaVersion: initialVersion,
          supportedVersion: target
        });
      }

      let current = structuredClone(state);
      current.schemaVersion = initialVersion;
      while (current.schemaVersion < target) {
        const migration = byVersion.get(current.schemaVersion);
        invariant(migration, `missing state migration from version ${current.schemaVersion}`);
        const next = await migration.migrate(structuredClone(current));
        invariant(next && typeof next === "object", `migration from version ${current.schemaVersion} must return state`);
        invariant(
          next.schemaVersion === migration.toVersion,
          `migration from version ${migration.fromVersion} must produce schemaVersion ${migration.toVersion}`
        );
        current = structuredClone(next);
      }
      return current;
    }
  });
}

export function normalizePersistentState(state) {
  invariant(state && typeof state === "object", "persistent state is required");
  const schemaVersion = state.schemaVersion ?? 1;
  const revision = state.revision ?? 0;

  if (schemaVersion > CURRENT_STATE_SCHEMA_VERSION) {
    throw new SchemaUnsupportedError({
      sessionId: state.id ?? null,
      schemaVersion,
      supportedVersion: CURRENT_STATE_SCHEMA_VERSION
    });
  }

  requireVersion(schemaVersion, "state schemaVersion");
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
  normalized.persistentMemory.searchInvestmentDecisions ??= [];
  normalized.persistentMemory.evidenceArtifacts ??= [];
  normalized.persistentMemory.decisionArtifacts ??= [];
  normalized.persistentMemory.attestations ??= [];
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

export function assertPersistedRevision(result, expectedRevision, { required = false } = {}) {
  if (result == null) {
    invariant(!required, "revision-aware session store save() must return the persisted revision");
    return expectedRevision + 1;
  }
  invariant(
    Number.isInteger(result.revision) && result.revision === expectedRevision + 1,
    "session store save() must advance revision exactly once"
  );
  return result.revision;
}

export function createValidatedSessionStore(store, {
  migrator = createStateMigrator()
} = {}) {
  invariant(store && typeof store.load === "function", "session store requires load()");
  invariant(store && typeof store.save === "function", "session store requires save()");
  invariant(migrator && typeof migrator.migrate === "function", "session store migrator requires migrate()");

  return Object.freeze({
    supportsRevisions: store.supportsRevisions === true,

    async load(sessionId) {
      const state = await store.load(sessionId);
      if (state == null) return null;
      const migrated = await migrator.migrate(state);
      return normalizePersistentState(migrated);
    },

    async save(session, options = undefined) {
      const normalized = normalizePersistentState(session);
      const expectedRevision = normalized.revision;
      const result = await store.save(normalized, options ?? { expectedRevision });
      const persistedRevision = assertPersistedRevision(result, expectedRevision, {
        required: store.supportsRevisions === true
      });
      session.schemaVersion = normalized.schemaVersion;
      session.revision = persistedRevision;
      return Object.freeze({ revision: persistedRevision });
    }
  });
}
