import { randomUUID } from "node:crypto";
import { promises as nodeFs } from "node:fs";
import { join } from "node:path";
import {
  StoreConflictError,
  normalizePersistentState
} from "../../core-harness/src/index.js";

function invariant(condition, message) {
  if (!condition) throw new TypeError(message);
}

function requireText(value, name) {
  invariant(typeof value === "string" && value.trim().length > 0, `${name} must be a non-empty string`);
  return value;
}

function clone(value) {
  return structuredClone(value);
}

function sessionPrefix(directory, sessionId) {
  return join(directory, encodeURIComponent(requireText(sessionId, "Backend sessionId")));
}

function commitPath(directory, sessionId, baseRevision) {
  return `${sessionPrefix(directory, sessionId)}.commit-${baseRevision}`;
}

function defineCommitRecord(raw, source) {
  invariant(raw && typeof raw === "object" && !Array.isArray(raw), `Backend session commit record is invalid at ${source}`);
  invariant(raw.version === 1, `Backend session commit record version is invalid at ${source}`);
  const sessionId = requireText(raw.sessionId, `Backend session commit sessionId at ${source}`);
  invariant(Number.isInteger(raw.baseRevision) && raw.baseRevision >= 0, `Backend session commit baseRevision is invalid at ${source}`);
  invariant(raw.nextRevision === raw.baseRevision + 1, `Backend session commit nextRevision is invalid at ${source}`);
  const state = normalizePersistentState(raw.state);
  invariant(state.id === sessionId, `Backend session commit state id does not match at ${source}`);
  invariant(state.revision === raw.nextRevision, `Backend session commit state revision does not match at ${source}`);
  return Object.freeze({
    version: 1,
    sessionId,
    baseRevision: raw.baseRevision,
    nextRevision: raw.nextRevision,
    state: clone(state)
  });
}

function parseCommitRecord(raw, source) {
  try {
    return defineCommitRecord(JSON.parse(raw), source);
  } catch (error) {
    if (error?.message?.includes(source)) throw error;
    const wrapped = new Error(`Backend session store contains invalid commit record at ${source}`);
    wrapped.cause = error;
    throw wrapped;
  }
}

function serializeCommitRecord(record) {
  return `${JSON.stringify(record, null, 2)}\n`;
}

export function createJsonBackendSessionStore({
  directory,
  fs = nodeFs,
  lockStaleMs = 300_000
}) {
  requireText(directory, "Backend session store directory");
  invariant(Number.isInteger(lockStaleMs) && lockStaleMs > 0, "Backend session store lockStaleMs must be a positive integer");
  invariant(
    fs &&
      typeof fs.readFile === "function" &&
      typeof fs.writeFile === "function" &&
      typeof fs.mkdir === "function" &&
      typeof fs.link === "function" &&
      typeof fs.unlink === "function",
    "Backend session store requires filesystem read/write/hard-link capability"
  );

  async function readCommit(sessionId, baseRevision) {
    const source = commitPath(directory, sessionId, baseRevision);
    try {
      return parseCommitRecord(await fs.readFile(source, "utf8"), source);
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  }

  async function loadHead(sessionId) {
    requireText(sessionId, "Backend sessionId");
    let revision = 0;
    let state = null;

    while (true) {
      const record = await readCommit(sessionId, revision);
      if (record == null) {
        return Object.freeze({ revision, state: state == null ? null : clone(state) });
      }
      invariant(record.sessionId === sessionId, `Backend session commit belongs to another session: ${sessionId}`);
      invariant(record.baseRevision === revision, `Backend session commit base revision does not match ${revision}`);
      revision = record.nextRevision;
      state = record.state;
    }
  }

  async function publish(sessionId, expectedRevision, nextState) {
    await fs.mkdir(directory, { recursive: true });
    const destination = commitPath(directory, sessionId, expectedRevision);
    const tempPath = `${destination}.${randomUUID()}.tmp`;
    const record = defineCommitRecord({
      version: 1,
      sessionId,
      baseRevision: expectedRevision,
      nextRevision: expectedRevision + 1,
      state: nextState
    }, tempPath);

    await fs.writeFile(tempPath, serializeCommitRecord(record), "utf8");
    try {
      await fs.link(tempPath, destination);
    } catch (error) {
      if (error?.code === "EEXIST") {
        const current = await loadHead(sessionId);
        throw new StoreConflictError({
          sessionId,
          expectedRevision,
          actualRevision: current.revision
        });
      }
      throw error;
    } finally {
      try {
        await fs.unlink(tempPath);
      } catch (cleanupError) {
        if (cleanupError?.code !== "ENOENT") {
          // The published hard link, when present, is authority. Temp cleanup failure cannot revoke it.
        }
      }
    }
  }

  return Object.freeze({
    supportsRevisions: true,
    supportsDurableRecovery: true,

    async load(sessionId) {
      const head = await loadHead(sessionId);
      return head.state == null ? null : clone(head.state);
    },

    async save(session, { expectedRevision = session?.revision ?? 0 } = {}) {
      invariant(session && typeof session === "object" && !Array.isArray(session), "Backend session store requires a session object");
      const id = requireText(session.id, "Backend session id");
      invariant(Number.isInteger(expectedRevision) && expectedRevision >= 0, "expectedRevision must be a non-negative integer");

      const current = await loadHead(id);
      if (current.revision !== expectedRevision) {
        throw new StoreConflictError({
          sessionId: id,
          expectedRevision,
          actualRevision: current.revision
        });
      }

      const next = normalizePersistentState(session);
      next.revision = expectedRevision + 1;
      await publish(id, expectedRevision, next);
      session.schemaVersion = next.schemaVersion;
      session.revision = next.revision;
      return Object.freeze({ revision: next.revision });
    }
  });
}
