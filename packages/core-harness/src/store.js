import { invariant } from "./contracts.js";
import { StoreConflictError } from "./errors.js";
import { normalizePersistentState } from "./persistence.js";

function clone(value) {
  return structuredClone(value);
}

export function createInMemorySessionStore() {
  const sessions = new Map();

  return Object.freeze({
    supportsRevisions: true,

    async load(sessionId) {
      const value = sessions.get(sessionId);
      return value == null ? null : clone(value);
    },

    async save(session, { expectedRevision = session?.revision ?? 0 } = {}) {
      invariant(session && session.id, "session store requires a session with id");
      invariant(Number.isInteger(expectedRevision) && expectedRevision >= 0, "expectedRevision must be a non-negative integer");

      const current = sessions.get(session.id) ?? null;
      const actualRevision = current?.revision ?? 0;
      if (actualRevision !== expectedRevision) {
        throw new StoreConflictError({
          sessionId: session.id,
          expectedRevision,
          actualRevision
        });
      }

      const next = normalizePersistentState(session);
      next.revision = expectedRevision + 1;
      session.schemaVersion = next.schemaVersion;
      session.revision = next.revision;
      sessions.set(session.id, clone(next));
      return Object.freeze({ revision: next.revision });
    }
  });
}
