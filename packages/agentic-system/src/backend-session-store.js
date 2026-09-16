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

function sessionPath(directory, sessionId) {
  return join(directory, `${encodeURIComponent(requireText(sessionId, "Backend sessionId"))}.json`);
}

function lockPath(path) {
  return `${path}.lock`;
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
      typeof fs.rename === "function" &&
      typeof fs.open === "function" &&
      typeof fs.unlink === "function" &&
      typeof fs.stat === "function",
    "Backend session store requires filesystem read/write/lock capability"
  );

  async function read(path) {
    try {
      return JSON.parse(await fs.readFile(path, "utf8"));
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  }

  async function createLock(path) {
    const target = lockPath(path);
    const handle = await fs.open(target, "wx");
    try {
      await handle.writeFile(`${JSON.stringify({ createdAt: Date.now() })}\n`, "utf8");
      return { handle, target };
    } catch (error) {
      await handle.close();
      try {
        await fs.unlink(target);
      } catch (unlinkError) {
        if (unlinkError?.code !== "ENOENT") throw unlinkError;
      }
      throw error;
    }
  }

  async function lockIsStale(path) {
    const target = lockPath(path);
    try {
      const metadata = JSON.parse(await fs.readFile(target, "utf8"));
      if (Number.isFinite(metadata.createdAt)) return Date.now() - metadata.createdAt > lockStaleMs;
    } catch {
      // Fall back to filesystem mtime for a crashed/partial lock write.
    }
    try {
      const stat = await fs.stat(target);
      return Date.now() - stat.mtimeMs > lockStaleMs;
    } catch (error) {
      if (error?.code === "ENOENT") return false;
      throw error;
    }
  }

  async function acquire(path) {
    await fs.mkdir(directory, { recursive: true });
    try {
      return await createLock(path);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      if (!(await lockIsStale(path))) throw new Error("Backend session store mutation already in progress");
      try {
        await fs.unlink(lockPath(path));
      } catch (unlinkError) {
        if (unlinkError?.code !== "ENOENT") throw unlinkError;
      }
      try {
        return await createLock(path);
      } catch (retryError) {
        if (retryError?.code === "EEXIST") throw new Error("Backend session store mutation already in progress");
        throw retryError;
      }
    }
  }

  async function withLock(path, action) {
    const { handle, target } = await acquire(path);
    try {
      return await action();
    } finally {
      await handle.close();
      try {
        await fs.unlink(target);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
  }

  return Object.freeze({
    supportsRevisions: true,
    supportsDurableRecovery: true,

    async load(sessionId) {
      const raw = await read(sessionPath(directory, sessionId));
      return raw == null ? null : clone(raw);
    },

    async save(session, { expectedRevision = session?.revision ?? 0 } = {}) {
      invariant(session && typeof session === "object" && !Array.isArray(session), "Backend session store requires a session object");
      const id = requireText(session.id, "Backend session id");
      invariant(Number.isInteger(expectedRevision) && expectedRevision >= 0, "expectedRevision must be a non-negative integer");
      const path = sessionPath(directory, id);

      return withLock(path, async () => {
        const current = await read(path);
        const actualRevision = current?.revision ?? 0;
        if (actualRevision !== expectedRevision) {
          throw new StoreConflictError({
            sessionId: id,
            expectedRevision,
            actualRevision
          });
        }

        const next = normalizePersistentState(session);
        next.revision = expectedRevision + 1;
        await fs.mkdir(directory, { recursive: true });
        const temp = `${path}.tmp`;
        await fs.writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, "utf8");
        await fs.rename(temp, path);
        session.schemaVersion = next.schemaVersion;
        session.revision = next.revision;
        return Object.freeze({ revision: next.revision });
      });
    }
  });
}
