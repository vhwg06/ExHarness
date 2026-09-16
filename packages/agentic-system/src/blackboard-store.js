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

function commitPath(path, baseDigest) {
  return `${path}.commit-${baseDigest}`;
}

function parseSnapshot(raw, source) {
  try {
    return defineBlackboardSnapshot(JSON.parse(raw));
  } catch (error) {
    const wrapped = new Error(`Blackboard store contains invalid committed snapshot at ${source}`);
    wrapped.cause = error;
    throw wrapped;
  }
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
      typeof fs.unlink === "function",
    "Blackboard store requires filesystem read/write/hard-link capability"
  );

  async function loadRoot() {
    try {
      return parseSnapshot(await fs.readFile(path, "utf8"), path);
    } catch (error) {
      if (error?.code === "ENOENT") return defineBlackboardSnapshot();
      throw error;
    }
  }

  async function readCommittedSuccessor(baseSnapshot) {
    const baseDigest = snapshotDigest(baseSnapshot);
    const source = commitPath(path, baseDigest);
    try {
      return parseSnapshot(await fs.readFile(source, "utf8"), source);
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  }

  async function loadCommittedHead() {
    let current = await loadRoot();
    const seen = new Set();

    while (true) {
      const digest = snapshotDigest(current);
      invariant(!seen.has(digest), `Blackboard store committed snapshot chain contains a cycle at ${digest}`);
      seen.add(digest);

      const successor = await readCommittedSuccessor(current);
      if (successor == null) return current;

      const successorDigest = snapshotDigest(successor);
      invariant(successorDigest !== digest, `Blackboard store committed snapshot cannot point to itself at ${digest}`);
      current = successor;
    }
  }

  async function publishSuccessor(baseSnapshot, nextSnapshot) {
    const baseDigest = snapshotDigest(baseSnapshot);
    const nextDigest = snapshotDigest(nextSnapshot);
    if (baseDigest === nextDigest) return false;

    await fs.mkdir(dirname(path), { recursive: true });
    const destination = commitPath(path, baseDigest);
    const tempPath = `${destination}.${randomUUID()}.tmp`;
    await fs.writeFile(tempPath, serializeSnapshot(nextSnapshot), "utf8");

    try {
      await fs.link(tempPath, destination);
    } catch (error) {
      if (error?.code === "EEXIST") {
        throw new Error(`Blackboard store transaction conflict: base snapshot ${baseDigest} already has a committed successor`);
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

  return Object.freeze({
    async load() {
      return freezeClone(await loadCommittedHead());
    },

    async transact(mutator) {
      invariant(typeof mutator === "function", "Blackboard store transact requires a mutator");
      const current = await loadCommittedHead();
      const next = clone(current);
      const result = await mutator(next);
      const normalized = defineBlackboardSnapshot(next);
      await publishSuccessor(current, normalized);
      return freezeClone({ snapshot: normalized, result });
    }
  });
}
