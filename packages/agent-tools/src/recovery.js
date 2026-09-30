// Durable recovery for supervised agent-tool runs (AGENT_TOOL_RUN_HANDLE_V1).
// A handle file next to a persisted worktree identifies one semantic attempt so a fresh
// process can resume the same Core session, worktree and tool session after a crash.
// This module never imports supervisor.js.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { StoreConflictError, normalizePersistentState } from "../../core-harness/src/index.js";
import { runProcess } from "./process-runner.js";
import { canonicalJson } from "./run-trace.js";

export const AGENT_TOOL_RUN_HANDLE_VERSION = "AGENT_TOOL_RUN_HANDLE_V1";
export const HANDLE_FILE = "handle.json";

export const HandlePhase = Object.freeze({
  ACT_COMPLETED: "ACT_COMPLETED",
  ATTEMPT_COMPLETED: "ATTEMPT_COMPLETED"
});

export const HandleStatus = Object.freeze({
  RUNNING: "RUNNING",
  ACCEPTED: "ACCEPTED",
  EXHAUSTED: "EXHAUSTED",
  TOOL_UNAVAILABLE: "TOOL_UNAVAILABLE"
});

export class RecoveryError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "RecoveryError";
    this.code = code;
  }
}

const SHA40 = /^[0-9a-f]{40}$/;
const SHA64 = /^[0-9a-f]{64}$/;

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

export function handlePath(recoveryDir) {
  return join(recoveryDir, HANDLE_FILE);
}

/** Digest over the canonical body (every field except digest). */
export function handleDigest(body) {
  const { digest: _ignored, ...rest } = body;
  return sha256(canonicalJson(rest));
}

function invalid(message) {
  return new RecoveryError("HANDLE_INVALID", message);
}

/** Builds a frozen handle body with a fresh digest. createdAt defaults to now. */
export function createAgentToolRunHandle(fields) {
  const body = {
    version: fields.version,
    taskId: fields.taskId,
    repositoryRoot: fields.repositoryRoot,
    baseRevision: fields.baseRevision,
    sourceHead: fields.sourceHead,
    recoveryDir: fields.recoveryDir,
    worktreeRoot: fields.worktreeRoot,
    candidateSha: fields.candidateSha,
    coreSessionId: fields.coreSessionId,
    toolId: fields.toolId,
    toolVersion: fields.toolVersion ?? null,
    toolSessionRef: fields.toolSessionRef ?? null,
    attemptIndex: fields.attemptIndex,
    maxAttempts: fields.maxAttempts,
    phase: fields.phase,
    status: fields.status,
    feedback: fields.feedback ?? "",
    createdAt: fields.createdAt ?? new Date().toISOString()
  };
  assertHandleBody(body);
  return Object.freeze({ ...body, digest: handleDigest(body) });
}

function assertHandleBody(body) {
  const need = (ok, message) => { if (!ok) throw invalid(message); };
  need(body && typeof body === "object" && !Array.isArray(body), "handle must be an object");
  need(body.version === AGENT_TOOL_RUN_HANDLE_VERSION, `handle version must be ${AGENT_TOOL_RUN_HANDLE_VERSION}`);
  for (const key of ["taskId", "repositoryRoot", "baseRevision", "sourceHead", "recoveryDir", "worktreeRoot", "candidateSha", "coreSessionId", "toolId", "createdAt"]) {
    need(typeof body[key] === "string" && body[key].length > 0, `handle ${key} must be a non-empty string`);
  }
  need(SHA40.test(body.baseRevision), "handle baseRevision must be a 40-hex commit sha");
  need(SHA40.test(body.sourceHead), "handle sourceHead must be a 40-hex commit sha");
  need(SHA40.test(body.candidateSha), "handle candidateSha must be a 40-hex commit sha");
  need(body.toolVersion === null || typeof body.toolVersion === "string", "handle toolVersion must be null or a string");
  need(body.toolSessionRef === null || typeof body.toolSessionRef === "string", "handle toolSessionRef must be null or a string");
  need(Number.isInteger(body.attemptIndex) && body.attemptIndex >= 1, "handle attemptIndex must be a positive integer");
  need(Number.isInteger(body.maxAttempts) && body.maxAttempts >= 1, "handle maxAttempts must be a positive integer");
  need(Object.values(HandlePhase).includes(body.phase), "handle phase must be ACT_COMPLETED or ATTEMPT_COMPLETED");
  need(Object.values(HandleStatus).includes(body.status), "handle status must be a known handle status");
  need(typeof body.feedback === "string", "handle feedback must be a string");
}

/** Reads and validates recoveryDir/handle.json (structure only; use verify for digest). */
export async function readAgentToolRunHandle(recoveryDir) {
  if (typeof recoveryDir !== "string" || recoveryDir.length === 0) throw invalid("recoveryDir must be a non-empty string");
  let raw;
  try {
    raw = await readFile(handlePath(recoveryDir), "utf8");
  } catch (error) {
    throw invalid(`handle file is missing in ${recoveryDir}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw invalid("handle file is not JSON");
  }
  assertHandleBody(parsed);
  if (typeof parsed.digest !== "string" || !SHA64.test(parsed.digest)) throw invalid("handle digest must be a 64-hex sha256");
  return Object.freeze({ ...parsed });
}

/** Throws DIGEST_MISMATCH when body digest !== handle.digest; HANDLE_INVALID on bad shape. */
export function verifyAgentToolRunHandle(handle) {
  assertHandleBody(handle);
  if (typeof handle.digest !== "string" || !SHA64.test(handle.digest)) throw invalid("handle digest must be a 64-hex sha256");
  if (handleDigest(handle) !== handle.digest) {
    throw new RecoveryError("DIGEST_MISMATCH", "handle digest does not match its canonical body");
  }
  return handle;
}

async function writeJsonAtomic(path, value) {
  await mkdir(join(path, ".."), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temp, path);
}

/** Persists a handle body (refreshing its digest) to recoveryDir/handle.json. */
export async function writeAgentToolRunHandle(recoveryDir, body) {
  const handle = createAgentToolRunHandle({ ...body, recoveryDir: resolve(recoveryDir) });
  await writeJsonAtomic(handlePath(resolve(recoveryDir)), handle);
  return handle;
}

// ---------------------------------------------------------------- file session store

function clone(value) {
  return value == null ? value : structuredClone(value);
}

/**
 * File-backed Core sessionStore with the createInMemorySessionStore contract
 * (load / save / supportsRevisions: true). One JSON file per session id, atomic
 * tmp+rename writes, StoreConflictError on revision mismatch. The file also covers
 * the AVO effect-journal session id, so a new process sees the same session.
 */
export function createFileSessionStore({ directory }) {
  if (typeof directory !== "string" || directory.length === 0) throw new TypeError("createFileSessionStore requires directory");
  const dir = resolve(directory);
  const pathFor = (sessionId) => {
    if (typeof sessionId !== "string" || sessionId.length === 0) throw new TypeError("session store requires a non-empty session id");
    return join(dir, `${encodeURIComponent(sessionId)}.json`);
  };
  return Object.freeze({
    supportsRevisions: true,

    async load(sessionId) {
      let raw;
      try {
        raw = await readFile(pathFor(sessionId), "utf8");
      } catch (error) {
        if (error?.code === "ENOENT") return null;
        throw error;
      }
      return clone(JSON.parse(raw));
    },

    async save(session, { expectedRevision = session?.revision ?? 0 } = {}) {
      if (!session || typeof session !== "object" || Array.isArray(session)) throw new TypeError("session store requires a session with id");
      if (typeof session.id !== "string" || session.id.length === 0) throw new TypeError("session store requires a session with id");
      if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw new TypeError("expectedRevision must be a non-negative integer");
      const path = pathFor(session.id);
      let current = null;
      try {
        current = JSON.parse(await readFile(path, "utf8"));
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      const actualRevision = current?.revision ?? 0;
      if (actualRevision !== expectedRevision) {
        throw new StoreConflictError({ sessionId: session.id, expectedRevision, actualRevision });
      }
      const next = normalizePersistentState(session);
      next.revision = expectedRevision + 1;
      await mkdir(dir, { recursive: true });
      const temp = `${path}.${process.pid}.tmp`;
      await writeFile(temp, `${JSON.stringify(next)}\n`, "utf8");
      await rename(temp, path);
      session.schemaVersion = next.schemaVersion;
      session.revision = next.revision;
      return Object.freeze({ revision: next.revision });
    }
  });
}

// ---------------------------------------------------------------- workspace reopen/dispose

async function gitOk(cwd, args) {
  const result = await runProcess("git", args, { cwd, env: { GIT_CONFIG_NOSYSTEM: "1" }, timeoutMs: 120000, maxOutputBytes: 16 * 1024 * 1024 });
  if (result.status !== "COMPLETED" || result.exitCode !== 0) return null;
  return result.stdout;
}

/**
 * Reopens an existing recoverable worktree without running `git worktree add`.
 * Throws RecoveryError MISSING_WORKTREE when the path is gone or is not a git
 * worktree registered under repositoryRoot.
 */
export async function reopenRecoverableWorkspace({ repositoryRoot, worktreeRoot }) {
  const missing = (message) => new RecoveryError("MISSING_WORKTREE", message);
  if (typeof repositoryRoot !== "string" || repositoryRoot.length === 0) throw missing("repositoryRoot must be a non-empty string");
  if (typeof worktreeRoot !== "string" || worktreeRoot.length === 0) throw missing("worktreeRoot must be a non-empty string");
  const root = resolve(worktreeRoot);
  const source = resolve(repositoryRoot);
  let info;
  try {
    info = await stat(root);
  } catch {
    throw missing(`recoverable worktree is missing: ${root}`);
  }
  if (!info.isDirectory()) throw missing(`recoverable worktree is not a directory: ${root}`);
  const head = await gitOk(root, ["rev-parse", "HEAD"]);
  if (head === null) throw missing(`recoverable worktree is not a git worktree: ${root}`);
  const list = await gitOk(source, ["worktree", "list", "--porcelain"]);
  if (list === null) throw missing(`cannot list worktrees of ${source}`);
  const registered = list.split("\n").some((line) => line.startsWith("worktree ") && resolve(line.slice("worktree ".length).trim()) === root);
  if (!registered) throw missing(`recoverable worktree is not registered under ${source}: ${root}`);
  let disposed = false;
  return Object.freeze({
    root,
    async head() {
      if (disposed) throw missing("workspace was disposed");
      const current = await gitOk(root, ["rev-parse", "HEAD"]);
      if (current === null) throw missing(`recoverable worktree is not a git worktree: ${root}`);
      return current.trim();
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      try {
        await gitOk(source, ["worktree", "remove", "--force", root]);
      } finally {
        await rm(root, { recursive: true, force: true });
        await gitOk(source, ["worktree", "prune"]);
      }
    }
  });
}

export function recoverablePaths(recoveryDir) {
  const root = resolve(recoveryDir);
  return Object.freeze({
    root,
    handle: handlePath(root),
    worktree: join(root, "worktree"),
    logs: join(root, "logs"),
    session: join(root, "core-session")
  });
}

/**
 * Disposes a recoverable run: removes the git worktree registration and deletes
 * the recovery directory. Best-effort on the git side; the directory removal
 * always runs.
 */
export async function disposeRecoverableRun(handle) {
  if (!handle || typeof handle !== "object") throw invalid("disposeRecoverableRun requires a handle");
  const repositoryRoot = handle.repositoryRoot;
  const worktreeRoot = handle.worktreeRoot;
  const recoveryDir = handle.recoveryDir;
  if (typeof worktreeRoot !== "string" || worktreeRoot.length === 0) throw invalid("handle worktreeRoot must be a non-empty string");
  if (typeof recoveryDir !== "string" || recoveryDir.length === 0) throw invalid("handle recoveryDir must be a non-empty string");
  try {
    if (typeof repositoryRoot === "string" && repositoryRoot.length > 0 && existsSync(resolve(worktreeRoot))) {
      await gitOk(resolve(repositoryRoot), ["worktree", "remove", "--force", resolve(worktreeRoot)]);
    }
  } finally {
    await rm(resolve(worktreeRoot), { recursive: true, force: true });
    if (typeof repositoryRoot === "string" && repositoryRoot.length > 0) {
      await gitOk(resolve(repositoryRoot), ["worktree", "prune"]);
    }
    await rm(resolve(recoveryDir), { recursive: true, force: true });
  }
}
