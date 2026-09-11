import { invariant } from "./contracts.js";

function clone(value) {
  return structuredClone(value);
}

export function createInMemorySessionStore() {
  const sessions = new Map();

  return Object.freeze({
    async load(sessionId) {
      const value = sessions.get(sessionId);
      return value == null ? null : clone(value);
    },

    async save(session) {
      invariant(session && session.id, "session store requires a session with id");
      sessions.set(session.id, clone(session));
    }
  });
}
