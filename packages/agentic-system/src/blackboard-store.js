import { createHash, randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { promises as nodeFs } from "node:fs";
import { defineBlackboardSnapshot } from "./blackboard-orchestrator.js";

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

function freezeClone(value) {
  return Object.freeze(clone(value));
}

function serializeSnapshot(snapshot) {
  return `${JSON.stringify(defineBlackboardSnapshot(snapshot), null, 2)}\n`;
}

function snapshotDigest(snapshot) {
  return createHash("sha256").update(serializeSnapshot(snapshot)).digest("hex");
}

function rootPath(path) {
  return `${path}.root`;
}

function commitPath(path, baseToken) {
  return `${path}.commit-${baseToken}`;
}

function mutationFencePath(path) {
  return `${path}.mutation-fence`;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseSnapshot(raw, source) {
  try {
    return defineBlackboardSnapshot(JSON.parse(raw));
  } catch (error) {
    const wrapped = new Error(`Blackboard store contains invalid snapshot at ${source}`);
    wrapped.cause = error;
    throw wrapped;
  }
}

function defineCommitRecord(raw, source) {
  invariant(raw && typeof raw === "object" && !Array.isArray(raw), `Blackboard commit record is invalid at ${source}`);
  invariant(raw.version === 1, `Blackboard commit record version is invalid at ${source}`);
  const baseToken = requireText(raw.baseToken, `Blackboard commit baseToken at ${source}`);
  const baseDigest = requireText(raw.baseDigest, `Blackboard commit baseDigest at ${source}`);
  const nextToken = requireText(raw.nextToken, `Blackboard commit nextToken at ${source}`);
  invariant(nextToken !== baseToken, `Blackboard commit record cannot point to its own revision at ${source}`);
  return freezeClone({
    version: 1,
    baseToken,
    baseDigest,
    nextToken,
    snapshot: defineBlackboardSnapshot(raw.snapshot)
  });
}

function parseCommitRecord(raw, source) {
  try {
    return defineCommitRecord(JSON.parse(raw), source);
  } catch (error) {
    if (error?.message?.includes(source)) throw error;
    const wrapped = new Error(`Blackboard store contains invalid commit record at ${source}`);
    wrapped.cause = error;
    throw wrapped;
  }
}

function serializeCommitRecord(record) {
  return `${JSON.stringify(record, null, 2)}\n`;
}

export function createJsonBlackboardStore({ path, fs = nodeFs, lockStaleMs = 300_000 }) {
  requireText(path, "Blackboard store path");
  invariant(Number.isInteger(lockStaleMs) && lockStaleMs > 0, "Blackboard lockStaleMs must be a positive integer");
  invariant(
    fs &&
      typeof fs.readFile === "function" &&
      typeof fs.writeFile === "function" &&
      typeof fs.mkdir === "function" &&
      typeof fs.link === "function" &&
      typeof fs.rename === "function" &&
      typeof fs.unlink === "function",
    "Blackboard store requires filesystem read/write/hard-link capability"
  );

  async function readLegacyProjectionOrEmpty() {
    try {
      return parseSnapshot(await fs.readFile(path, "utf8"), path);
    } catch (error) {
      if (error?.code === "ENOENT") return defineBlackboardSnapshot();
      throw error;
    }
  }

  async function ensureRoot() {
    const authorityPath = rootPath(path);
    try {
      return parseSnapshot(await fs.readFile(authorityPath, "utf8"), authorityPath);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }

    await fs.mkdir(dirname(path), { recursive: true });
    const initial = await readLegacyProjectionOrEmpty();
    const tempPath = `${authorityPath}.${randomUUID()}.tmp`;
    await fs.writeFile(tempPath, serializeSnapshot(initial), "utf8");

    try {
      await fs.link(tempPath, authorityPath);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    } finally {
      try {
        await fs.unlink(tempPath);
      } catch (cleanupError) {
        if (cleanupError?.code !== "ENOENT") {
          // Root publication, when present, is authoritative. Temp cleanup failure must not rewrite authority.
        }
      }
    }

    return parseSnapshot(await fs.readFile(authorityPath, "utf8"), authorityPath);
  }

  async function acquireMutationFence() {
    await fs.mkdir(dirname(path), { recursive: true });
    const token = randomUUID();
    const destination = mutationFencePath(path);
    const tempPath = `${destination}.${token}.tmp`;
    await fs.writeFile(tempPath, `${JSON.stringify({ version: 1, token })}\n`, "utf8");
    const startedAt = Date.now();
    const retryDelayMs = Math.min(25, Math.max(1, Math.floor(lockStaleMs / 100)));

    try {
      while (true) {
        try {
          await fs.link(tempPath, destination);
          return token;
        } catch (error) {
          if (error?.code !== "EEXIST") throw error;
          if (Date.now() - startedAt >= lockStaleMs) {
            throw new Error("Blackboard store mutation fence remained held past wait limit");
          }
          await delay(retryDelayMs);
        }
      }
    } finally {
      try {
        await fs.unlink(tempPath);
      } catch (cleanupError) {
        if (cleanupError?.code !== "ENOENT") {
          // The fence hard link, when present, is the ownership token. Temp cleanup is non-authoritative.
        }
      }
    }
  }

  async function releaseMutationFence(token) {
    const destination = mutationFencePath(path);
    let record;
    try {
      record = JSON.parse(await fs.readFile(destination, "utf8"));
    } catch (error) {
      if (error?.code === "ENOENT") throw new Error("Blackboard store mutation fence disappeared before release");
      throw error;
    }
    invariant(record?.version === 1 && record.token === token, "Blackboard store mutation fence ownership changed");
    await fs.unlink(destination);
  }

  async function withMutationFence(action) {
    invariant(typeof action === "function", "Blackboard store mutation fence requires an action");
    const token = await acquireMutationFence();
    try {
      return await action();
    } finally {
      await releaseMutationFence(token);
    }
  }

  async function loadRoot() {
    return freezeClone({ token: "root", snapshot: await ensureRoot() });
  }

  async function readCommittedSuccessor(head) {
    const source = commitPath(path, head.token);
    try {
      const record = parseCommitRecord(await fs.readFile(source, "utf8"), source);
      invariant(record.baseToken === head.token, `Blackboard commit base revision does not match ${head.token}`);
      invariant(
        record.baseDigest === snapshotDigest(head.snapshot),
        `Blackboard commit base digest does not match revision ${head.token}`
      );
      return record;
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  }

  async function loadCommittedHead() {
    let head = await loadRoot();
    const seenTokens = new Set();

    while (true) {
      invariant(!seenTokens.has(head.token), `Blackboard store committed revision chain contains a cycle at ${head.token}`);
      seenTokens.add(head.token);

      const successor = await readCommittedSuccessor(head);
      if (successor == null) return head;
      invariant(!seenTokens.has(successor.nextToken), `Blackboard store committed revision chain contains a cycle at ${successor.nextToken}`);
      head = freezeClone({ token: successor.nextToken, snapshot: successor.snapshot });
    }
  }

  async function publishSuccessor(baseHead, nextSnapshot) {
    const baseDigest = snapshotDigest(baseHead.snapshot);
    const nextDigest = snapshotDigest(nextSnapshot);
    if (baseDigest === nextDigest) return false;

    await fs.mkdir(dirname(path), { recursive: true });
    const nextToken = randomUUID();
    const destination = commitPath(path, baseHead.token);
    const tempPath = `${destination}.${nextToken}.tmp`;
    const record = defineCommitRecord({
      version: 1,
      baseToken: baseHead.token,
      baseDigest,
      nextToken,
      snapshot: nextSnapshot
    }, tempPath);

    await fs.writeFile(tempPath, serializeCommitRecord(record), "utf8");

    try {
      await fs.link(tempPath, destination);
    } catch (error) {
      if (error?.code === "EEXIST") {
        throw new Error(`Blackboard store transaction conflict: revision ${baseHead.token} already has a committed successor`);
      }
      throw error;
    } finally {
      try {
        await fs.unlink(tempPath);
      } catch (cleanupError) {
        if (cleanupError?.code !== "ENOENT") {
          // The committed hard link, when present, is authoritative. A leaked temp file is cleanup debt, not permission to hide commit outcome.
        }
      }
    }

    return true;
  }

  async function refreshCompatibilityProjection() {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const head = await loadCommittedHead();
      const tempPath = `${path}.projection-${randomUUID()}.tmp`;
      await fs.writeFile(tempPath, serializeSnapshot(head.snapshot), "utf8");
      try {
        await fs.rename(tempPath, path);
      } finally {
        try {
          await fs.unlink(tempPath);
        } catch (cleanupError) {
          if (cleanupError?.code !== "ENOENT") {
            // Projection cleanup has no authority over the immutable commit chain.
          }
        }
      }

      const after = await loadCommittedHead();
      if (after.token === head.token) return true;
    }
    return false;
  }

  return Object.freeze({
    async load() {
      const head = await loadCommittedHead();
      return freezeClone(head.snapshot);
    },

    async withMutationFence(action) {
      invariant(typeof action === "function", "Blackboard store withMutationFence requires an action");
      return withMutationFence(async () => {
        const head = await loadCommittedHead();
        return action(freezeClone({ token: head.token, snapshot: head.snapshot }));
      });
    },

    async transact(mutator) {
      invariant(typeof mutator === "function", "Blackboard store transact requires a mutator");
      const current = await loadCommittedHead();
      const next = clone(current.snapshot);
      const result = await mutator(next);
      const normalized = defineBlackboardSnapshot(next);
      const committed = await publishSuccessor(current, normalized);
      if (committed) {
        try {
          await refreshCompatibilityProjection();
        } catch {
          // The immutable successor chain is commit authority. Projection failure cannot turn a committed transaction into an unknown outcome.
        }
      }
      return freezeClone({ snapshot: normalized, result });
    }
  });
}
