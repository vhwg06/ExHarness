// Local operator Backend-then-QA delivery slice (DELIVER_SLICE_V1).
// Composes delivered seams only: runSupervisedTask (plus durable recovery and
// optional requiredFiles) for the Backend stage, then independent QA on a fresh
// detached checkout of the accepted Backend commit. No sandbox, no push, no
// OpenHands. This module imports leaf modules only, never src/index.js.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_TOOLS, defineAgentTool } from "./tool-adapters.js";
import { resolveExecutable } from "./process-runner.js";
import { RecoveryError, disposeRecoverableRun, readAgentToolRunHandle } from "./recovery.js";
import { AgentTaskStatus, resumeSupervisedTask, runSupervisedTask } from "./supervisor.js";
import { createLocalCommandVerifier } from "../../agentic-system/src/local-command-verifier.js";
import { createLocalGitWorkspace } from "../../agentic-system/src/local-git-workspace.js";

export const DELIVER_SLICE_VERSION = "DELIVER_SLICE_V1";
export const LOCAL_SLICE_CLAIM_BOUNDARY = "LOCAL_COMPOSITION_SLICE_NOT_BB069_NOT_BB074";

export const DeliverSliceStatus = Object.freeze({
  ACCEPTED: "ACCEPTED",
  QA_FAILED: "QA_FAILED",
  EXHAUSTED: "EXHAUSTED",
  TOOL_UNAVAILABLE: "TOOL_UNAVAILABLE"
});

const SHA40 = /^[0-9a-f]{40}$/;
const SLICE_TOOLS = Object.freeze(["codex", "kiro", "agy"]);

function checkVerifications(list, label) {
  const invalid = (message) => { throw new TypeError(`${DELIVER_SLICE_VERSION} invalid: ${message}`); };
  if (!Array.isArray(list) || list.length === 0) invalid(`${label} must be a non-empty array`);
  const names = new Set();
  for (const item of list) {
    if (!item || typeof item !== "object" || Array.isArray(item)) invalid(`each ${label} entry must be an object`);
    if (typeof item.name !== "string" || item.name.length === 0) invalid(`${label} name must be a non-empty string`);
    if (names.has(item.name)) invalid(`duplicate ${label} name: ${item.name}`);
    names.add(item.name);
    if (typeof item.command !== "string" || item.command.length === 0) invalid(`${label} ${item.name} command must be a non-empty string`);
    if (!Array.isArray(item.args) || item.args.some((arg) => typeof arg !== "string")) invalid(`${label} ${item.name} args must be an array of strings`);
    if (!Number.isInteger(item.timeoutMs) || item.timeoutMs <= 0) invalid(`${label} ${item.name} timeoutMs must be a positive integer`);
  }
  return Object.freeze(list.map((item) => Object.freeze({
    name: item.name,
    command: item.command,
    args: Object.freeze([...item.args]),
    timeoutMs: item.timeoutMs
  })));
}

function checkSafeRequiredPath(path) {
  const invalid = (message) => { throw new TypeError(`${DELIVER_SLICE_VERSION} invalid: ${message}`); };
  if (typeof path !== "string" || path.length === 0) invalid("each requiredFiles entry must be a non-empty string");
  if (path.includes("\\") || path.includes("\0")) invalid(`unsafe requiredFiles path: ${path}`);
  if (path.startsWith("/")) invalid(`unsafe requiredFiles path: ${path}`);
  if (/^[A-Za-z]:/.test(path)) invalid(`unsafe requiredFiles path: ${path}`);
  const segments = path.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) invalid(`unsafe requiredFiles path: ${path}`);
  if (segments.some((segment) => segment.toLowerCase() === ".git")) invalid(`unsafe requiredFiles path: ${path}`);
}

function checkRequiredFiles(value) {
  const invalid = (message) => { throw new TypeError(`${DELIVER_SLICE_VERSION} invalid: ${message}`); };
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) invalid("requiredFiles must be an array of relative POSIX paths");
  if (value.length === 0) return undefined;
  for (const entry of value) checkSafeRequiredPath(entry);
  if (new Set(value).size !== value.length) invalid("requiredFiles must list each path once");
  return Object.freeze([...value]);
}

/** Validates DELIVER_SLICE_V1 before any process starts; extra fields are ignored. */
export function validateDeliverSlice(slice) {
  const invalid = (message) => { throw new TypeError(`${DELIVER_SLICE_VERSION} invalid: ${message}`); };
  if (!slice || typeof slice !== "object" || Array.isArray(slice)) invalid("slice must be an object");
  if (typeof slice.id !== "string" || slice.id.length === 0) invalid("id must be a non-empty string");
  if (typeof slice.repositoryRoot !== "string" || slice.repositoryRoot.length === 0) invalid("repositoryRoot must be a non-empty string");
  if (typeof slice.baseRevision !== "string" || !SHA40.test(slice.baseRevision)) invalid("baseRevision must be a 40-hex commit sha");
  if (typeof slice.prompt !== "string" || slice.prompt.length === 0) invalid("prompt must be a non-empty string");
  if (typeof slice.tool !== "string" || !SLICE_TOOLS.includes(slice.tool)) invalid("tool must be one of codex|kiro|agy");
  const backendVerifications = checkVerifications(slice.backendVerifications, "backendVerifications");
  const qaVerifications = checkVerifications(slice.qaVerifications, "qaVerifications");
  const requiredFiles = checkRequiredFiles(slice.requiredFiles);
  let recoveryDir = undefined;
  if (slice.recoveryDir !== undefined) {
    if (typeof slice.recoveryDir !== "string" || slice.recoveryDir.length === 0) invalid("recoveryDir must be a non-empty string");
    recoveryDir = slice.recoveryDir;
  }
  let maxAttempts = undefined;
  if (slice.maxAttempts !== undefined) {
    if (!Number.isInteger(slice.maxAttempts) || slice.maxAttempts <= 0) invalid("maxAttempts must be a positive integer");
    maxAttempts = slice.maxAttempts;
  }
  let timeoutMs = undefined;
  if (slice.timeoutMs !== undefined) {
    if (!Number.isInteger(slice.timeoutMs) || slice.timeoutMs <= 0) invalid("timeoutMs must be a positive integer");
    timeoutMs = slice.timeoutMs;
  }
  return Object.freeze({
    id: slice.id,
    repositoryRoot: slice.repositoryRoot,
    baseRevision: slice.baseRevision,
    prompt: slice.prompt,
    tool: slice.tool,
    backendVerifications,
    qaVerifications,
    ...(requiredFiles === undefined ? {} : { requiredFiles }),
    ...(recoveryDir === undefined ? {} : { recoveryDir }),
    ...(maxAttempts === undefined ? {} : { maxAttempts }),
    ...(timeoutMs === undefined ? {} : { timeoutMs })
  });
}

function verificationReason(record, fallback) {
  const line = (record.evidence ?? []).find((item) => typeof item === "string" && item.includes(":reason="));
  return line ? line.slice(line.indexOf(":reason=") + ":reason=".length) : (record.status ?? fallback);
}

/**
 * Runs the QA verifications on an existing checkout at acceptedSha. Each
 * verifier is bound with claim `qa.<name>` and requireUnchangedTree, so a QA
 * write fails with TREE_MUTATED and a different revision with REVISION_MISMATCH.
 */
export async function runSliceQa({ workspaceRoot, acceptedSha, qaVerifications, sliceId = "slice" } = {}) {
  if (typeof workspaceRoot !== "string" || workspaceRoot.length === 0) {
    throw new TypeError(`${DELIVER_SLICE_VERSION} invalid: workspaceRoot must be a non-empty string`);
  }
  if (typeof acceptedSha !== "string" || !SHA40.test(acceptedSha)) {
    throw new TypeError(`${DELIVER_SLICE_VERSION} invalid: acceptedSha must be a 40-hex commit sha`);
  }
  const verifications = checkVerifications(qaVerifications, "qaVerifications");
  const qa = [];
  for (const verification of verifications) {
    const verifier = createLocalCommandVerifier({
      name: verification.name,
      claim: `qa.${verification.name}`,
      root: workspaceRoot,
      command: verification.command,
      args: [...verification.args],
      timeoutMs: verification.timeoutMs,
      requireUnchangedTree: true
    });
    const record = await verifier.verify({ candidate: { id: sliceId, version: acceptedSha } });
    qa.push(Object.freeze({
      name: verification.name,
      status: record.status,
      reason: verificationReason(record, record.status)
    }));
  }
  const failed = qa.find((entry) => entry.status !== "PASS") ?? null;
  return Object.freeze({
    acceptedSha,
    sliceId,
    qa: Object.freeze(qa),
    passed: failed === null,
    reason: failed === null ? "PASS" : failed.reason,
    claimBoundary: LOCAL_SLICE_CLAIM_BOUNDARY
  });
}

function resolveSliceTool(toolId, command, adapterOverride) {
  if (adapterOverride && typeof adapterOverride === "object" && typeof adapterOverride.buildInvocation === "function") {
    return adapterOverride;
  }
  const base = AGENT_TOOLS[toolId];
  if (!base) return null;
  const launch = resolveExecutable(command ?? base.command);
  if (!launch) return null;
  return defineAgentTool(base, launch);
}

function backendTaskFor(slice) {
  return {
    id: slice.id,
    repositoryRoot: slice.repositoryRoot,
    baseRevision: slice.baseRevision,
    prompt: slice.prompt,
    verifications: slice.backendVerifications.map((item) => ({
      name: item.name,
      command: item.command,
      args: [...item.args],
      timeoutMs: item.timeoutMs
    })),
    ...(slice.requiredFiles === undefined ? {} : { requiredFiles: [...slice.requiredFiles] })
  };
}

/** A foreign recovery dir must never be consumed or destroyed: identity first. */
function assertSliceHandleIdentity(handle, slice) {
  if (handle.taskId !== slice.id
    || resolve(handle.repositoryRoot) !== resolve(slice.repositoryRoot)
    || handle.baseRevision !== slice.baseRevision) {
    throw new RecoveryError("HANDLE_INVALID", "deliver slice identity does not match the recovery handle");
  }
}

function sliceResult(fields) {
  return Object.freeze({
    sliceId: fields.sliceId,
    status: fields.status,
    backendSha: fields.backendSha ?? null,
    qa: fields.qa ?? null,
    backend: fields.backend ?? null,
    reason: fields.reason ?? null,
    claimBoundary: LOCAL_SLICE_CLAIM_BOUNDARY
  });
}

async function runQaOnFreshCheckout({ slice, acceptedSha }) {
  const scratch = await mkdtemp(join(tmpdir(), "exharness-deliver-qa-"));
  const worktreeRoot = join(scratch, "worktree");
  let workspace = null;
  try {
    workspace = await createLocalGitWorkspace({
      repositoryRoot: slice.repositoryRoot,
      baseRevision: acceptedSha,
      worktreeRoot
    });
    return await runSliceQa({
      workspaceRoot: workspace.root,
      acceptedSha,
      qaVerifications: slice.qaVerifications,
      sliceId: slice.id
    });
  } finally {
    try {
      if (workspace) await workspace.dispose();
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  }
}

async function disposeRecoveryQuietly(recoveryDir) {
  try {
    const handle = await readAgentToolRunHandle(recoveryDir);
    await disposeRecoverableRun(handle);
  } catch {
    /* No handle yet, already disposed, or dispose raced: terminal state stands. */
  }
}

function acceptedSliceResult({ slice, backend, acceptedSha, qaOut }) {
  if (qaOut.passed) {
    return sliceResult({
      sliceId: slice.id,
      status: DeliverSliceStatus.ACCEPTED,
      backendSha: acceptedSha,
      qa: qaOut.qa,
      backend,
      reason: "PASS"
    });
  }
  return sliceResult({
    sliceId: slice.id,
    status: DeliverSliceStatus.QA_FAILED,
    backendSha: acceptedSha,
    qa: qaOut.qa,
    backend,
    reason: qaOut.reason
  });
}

/**
 * Runs one DELIVER_SLICE_V1: Backend through runSupervisedTask (never
 * runSupervisedBackendWork), then independent QA on a fresh detached checkout
 * of the accepted Backend commit. With recoveryDir an interrupted slice resumes
 * through the durable handle; an ACCEPTED handle skips Backend (HANDLE_COMPLETE)
 * and runs QA on handle.candidateSha. A terminal slice disposes the recovery dir.
 */
export async function runDeliverSlice(sliceInput, options = {}) {
  const slice = validateDeliverSlice(sliceInput);
  const {
    tool: toolOverride = null,
    command = null,
    recoveryDir: recoveryDirOption = null,
    maxAttempts: maxAttemptsOption = null,
    timeoutMs: timeoutMsOption = null,
    env = {},
    onHandleWrite = null
  } = options ?? {};
  const recoveryDir = recoveryDirOption ?? slice.recoveryDir ?? null;
  const maxAttempts = maxAttemptsOption ?? slice.maxAttempts ?? 3;
  const timeoutMs = timeoutMsOption ?? slice.timeoutMs ?? 600000;
  if (recoveryDir !== null && (typeof recoveryDir !== "string" || recoveryDir.length === 0)) {
    throw new TypeError(`${DELIVER_SLICE_VERSION} invalid: recoveryDir must be null or a non-empty string`);
  }
  if (!Number.isInteger(maxAttempts) || maxAttempts <= 0) {
    throw new TypeError(`${DELIVER_SLICE_VERSION} invalid: maxAttempts must be a positive integer`);
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError(`${DELIVER_SLICE_VERSION} invalid: timeoutMs must be a positive integer`);
  }
  if (onHandleWrite !== null && typeof onHandleWrite !== "function") {
    throw new TypeError(`${DELIVER_SLICE_VERSION} invalid: onHandleWrite must be null or a function`);
  }
  const task = backendTaskFor(slice);

  const runBackendFresh = () => runSupervisedTask({
    tool: resolveSliceTool(slice.tool, command, toolOverride),
    task,
    recoveryDir,
    maxAttempts,
    timeoutMs,
    env,
    onHandleWrite,
    invocationObserver: null
  });

  const finishBackend = async (backend, { dispose }) => {
    if (backend.status === AgentTaskStatus.TOOL_UNAVAILABLE) {
      if (dispose) await disposeRecoveryQuietly(recoveryDir);
      return sliceResult({
        sliceId: slice.id,
        status: DeliverSliceStatus.TOOL_UNAVAILABLE,
        backendSha: null,
        qa: null,
        backend,
        reason: "NOT_INSTALLED"
      });
    }
    if (backend.status === AgentTaskStatus.EXHAUSTED) {
      if (dispose) await disposeRecoveryQuietly(recoveryDir);
      return sliceResult({
        sliceId: slice.id,
        status: DeliverSliceStatus.EXHAUSTED,
        backendSha: null,
        qa: null,
        backend,
        reason: "EXHAUSTED"
      });
    }
    if (backend.status !== AgentTaskStatus.ACCEPTED || !SHA40.test(backend.acceptedSha ?? "")) {
      if (dispose) await disposeRecoveryQuietly(recoveryDir);
      return sliceResult({
        sliceId: slice.id,
        status: DeliverSliceStatus.QA_FAILED,
        backendSha: backend.acceptedSha ?? null,
        qa: null,
        backend,
        reason: "INVALID_ACCEPTED_SHA"
      });
    }
    const qaOut = await runQaOnFreshCheckout({ slice, acceptedSha: backend.acceptedSha });
    if (dispose) await disposeRecoveryQuietly(recoveryDir);
    return acceptedSliceResult({ slice, backend, acceptedSha: backend.acceptedSha, qaOut });
  };

  if (recoveryDir === null) {
    const tool = resolveSliceTool(slice.tool, command, toolOverride);
    if (!tool) {
      return sliceResult({
        sliceId: slice.id,
        status: DeliverSliceStatus.TOOL_UNAVAILABLE,
        backendSha: null,
        qa: null,
        backend: null,
        reason: "NOT_INSTALLED"
      });
    }
    const backend = await runSupervisedTask({
      tool, task, maxAttempts, timeoutMs, env, onHandleWrite, invocationObserver: null
    });
    return finishBackend(backend, { dispose: false });
  }

  let existing = null;
  try {
    existing = await readAgentToolRunHandle(recoveryDir);
  } catch (error) {
    if (error instanceof RecoveryError) existing = null;
    else throw error;
  }

  // Identity gate for every handle status: a mismatched handle is refused with
  // HANDLE_INVALID before any resume, QA, or dispose touches the recovery dir.
  if (existing !== null) assertSliceHandleIdentity(existing, slice);

  if (existing === null) {
    const tool = resolveSliceTool(slice.tool, command, toolOverride);
    if (!tool) {
      return sliceResult({
        sliceId: slice.id,
        status: DeliverSliceStatus.TOOL_UNAVAILABLE,
        backendSha: null,
        qa: null,
        backend: null,
        reason: "NOT_INSTALLED"
      });
    }
    const backend = await runBackendFresh();
    return finishBackend(backend, { dispose: true });
  }

  if (existing.status === "EXHAUSTED") {
    await disposeRecoveryQuietly(recoveryDir);
    return sliceResult({
      sliceId: slice.id,
      status: DeliverSliceStatus.EXHAUSTED,
      backendSha: null,
      qa: null,
      backend: null,
      reason: "EXHAUSTED"
    });
  }
  if (existing.status === "TOOL_UNAVAILABLE") {
    await disposeRecoveryQuietly(recoveryDir);
    return sliceResult({
      sliceId: slice.id,
      status: DeliverSliceStatus.TOOL_UNAVAILABLE,
      backendSha: null,
      qa: null,
      backend: null,
      reason: "NOT_INSTALLED"
    });
  }
  if (existing.status === "ACCEPTED") {
    // HANDLE_COMPLETE: never resumeSupervisedTask an accepted handle; QA the recorded candidate.
    if (!SHA40.test(existing.candidateSha ?? "")) {
      await disposeRecoveryQuietly(recoveryDir);
      return sliceResult({
        sliceId: slice.id,
        status: DeliverSliceStatus.QA_FAILED,
        backendSha: existing.candidateSha ?? null,
        qa: null,
        backend: null,
        reason: "INVALID_ACCEPTED_SHA"
      });
    }
    const qaOut = await runQaOnFreshCheckout({ slice, acceptedSha: existing.candidateSha });
    await disposeRecoveryQuietly(recoveryDir);
    return acceptedSliceResult({ slice, backend: null, acceptedSha: existing.candidateSha, qaOut });
  }

  // RUNNING handle: resume the same Backend attempt, then QA the accepted sha.
  const tool = resolveSliceTool(slice.tool, command, toolOverride);
  if (!tool) {
    return sliceResult({
      sliceId: slice.id,
      status: DeliverSliceStatus.TOOL_UNAVAILABLE,
      backendSha: null,
      qa: null,
      backend: null,
      reason: "NOT_INSTALLED"
    });
  }
  const resumed = await resumeSupervisedTask(existing, {
    tool, task, maxAttempts, timeoutMs, env, onHandleWrite, invocationObserver: null
  });
  return finishBackend(resumed, { dispose: true });
}

/**
 * CLI entry for `exharness-agent deliver`. Reads the manifest at options.slice;
 * a missing --slice throws before any agent process starts. Returns the slice
 * result (DeliverSliceStatus with reason and claimBoundary); the bin maps the
 * status to the process exit code.
 */
export async function commandDeliver(options = {}) {
  const slicePath = options.slice ?? options["slice"] ?? null;
  if (typeof slicePath !== "string" || slicePath.length === 0) {
    throw new Error("deliver requires --slice <manifest.json>");
  }
  const command = options.command ?? null;
  const recoveryDir = options.recoveryDir ?? options["recovery-dir"] ?? null;
  const env = options.env ?? {};
  const tool = options.tool ?? null;
  const maxAttemptsRaw = options.maxAttempts ?? options["max-attempts"] ?? undefined;
  const timeoutMsRaw = options.timeoutMs ?? options["timeout-ms"] ?? undefined;
  let raw;
  try {
    raw = JSON.parse(await readFile(slicePath, "utf8"));
  } catch (error) {
    throw new Error(`deliver cannot read slice manifest: ${error.message}`);
  }
  return runDeliverSlice(raw, {
    tool,
    command,
    recoveryDir,
    env,
    ...(maxAttemptsRaw === undefined ? {} : { maxAttempts: Number(maxAttemptsRaw) }),
    ...(timeoutMsRaw === undefined ? {} : { timeoutMs: Number(timeoutMsRaw) })
  });
}
