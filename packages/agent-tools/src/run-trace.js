// AGENT_TOOL_RUN_TRACE_V1: one append-only, digest-chained JSON line per agent invocation.
// Traces are evidence only; nothing here decides acceptance or value.
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { runProcess } from "./process-runner.js";
import { createRedactor, redactedExcerpt } from "./redaction.js";
import { parseToolOutput } from "./output-parsers.js";

export const AGENT_TOOL_RUN_TRACE_VERSION = "AGENT_TOOL_RUN_TRACE_V1";
export const TRACE_FILE = "traces.jsonl";
export const EXCERPT_CHARS = 4000;
export const TraceMode = Object.freeze({ DIRECT: "DIRECT", SUPERVISED: "SUPERVISED" });
export const MAX_LOG_BYTES = 1048576;

export class TraceError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "TraceError";
    this.code = code;
  }
}

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

/** Canonical JSON: sorted object keys, no whitespace. */
export function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

export function traceDigest(record) {
  const { digest, ...body } = record;
  return sha256(canonicalJson(body));
}

function parseLines(text, path) {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines.map((line, index) => {
    try { return JSON.parse(line); } catch { throw new TraceError("TRACE_CHAIN_BROKEN", `${path}: line ${index + 1} is not JSON`); }
  });
}

/** Recomputes every digest, sequence and prevDigest link; returns the verified records. */
export function verifyTraceFile(path) {
  const records = parseLines(readFileSync(path, "utf8"), path);
  let prev = null;
  records.forEach((record, index) => {
    if (record?.kind !== AGENT_TOOL_RUN_TRACE_VERSION) throw new TraceError("TRACE_CHAIN_BROKEN", `${path}: line ${index + 1} is not ${AGENT_TOOL_RUN_TRACE_VERSION}`);
    if (record.sequence !== index + 1) throw new TraceError("TRACE_CHAIN_BROKEN", `${path}: line ${index + 1} has sequence ${record.sequence}`);
    if (record.prevDigest !== prev) throw new TraceError("TRACE_CHAIN_BROKEN", `${path}: line ${index + 1} does not link to the previous digest`);
    if (traceDigest(record) !== record.digest) throw new TraceError("TRACE_CHAIN_BROKEN", `${path}: line ${index + 1} does not match its digest`);
    prev = record.digest;
  });
  return records;
}

/** Reads and verifies <dir>/traces.jsonl. */
export function readTraces(dir) {
  return verifyTraceFile(join(dir, TRACE_FILE));
}

/**
 * Appends records to <dir>/traces.jsonl. Before a line is written it is re-checked against the
 * writer's secret set; a line that still contains a secret is refused (SECRET_IN_TRACE).
 */
export function createRunTraceWriter({ dir, env = process.env }) {
  if (typeof dir !== "string" || dir.length === 0) throw new TypeError("createRunTraceWriter requires dir");
  const path = join(dir, TRACE_FILE);
  let queue = Promise.resolve();
  // extraEnv: the invocation env, whose secret values are checked in addition to the writer env.
  const append = (body, { extraEnv = {} } = {}) => {
    const guard = createRedactor({ env: { ...env, ...extraEnv } });
    const run = queue.then(async () => {
      await mkdir(dir, { recursive: true });
      const existing = existsSync(path) ? verifyTraceFile(path) : [];
      const last = existing.at(-1) ?? null;
      const record = { ...body, kind: AGENT_TOOL_RUN_TRACE_VERSION, version: 1, sequence: existing.length + 1, prevDigest: last?.digest ?? null };
      delete record.digest;
      record.digest = traceDigest(record);
      const line = `${JSON.stringify(record)}\n`;
      if (guard.containsSecret(line)) throw new TraceError("SECRET_IN_TRACE", `refusing to write trace ${record.traceId}`);
      await appendFile(path, line);
      return record;
    });
    queue = run.catch(() => {});
    return run;
  };
  return Object.freeze({ dir, path, append, env });
}

async function git(cwd, args) {
  const result = await runProcess("git", args, { cwd, env: { GIT_CONFIG_NOSYSTEM: "1" }, timeoutMs: 60000, maxOutputBytes: 16777216 });
  if (result.status !== "COMPLETED" || result.exitCode !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr}`);
  return result.stdout;
}

function numstat(text) {
  const diff = { filesChanged: 0, insertions: 0, deletions: 0, binaryFiles: 0 };
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const [added, removed] = line.split("\t");
    diff.filesChanged += 1;
    if (added === "-" || removed === "-") diff.binaryFiles += 1;
    else { diff.insertions += Number(added); diff.deletions += Number(removed); }
  }
  return diff;
}

/** Diff between two commits in a repository (supervised attempts). */
export async function commitDiffStats(cwd, from, to) {
  if (from === to) return { filesChanged: 0, insertions: 0, deletions: 0, binaryFiles: 0 };
  return numstat(await git(cwd, ["diff", "--numstat", "--no-renames", from, to]));
}

/**
 * Diff of a working tree against baseRevision (direct runs): tracked changes via numstat plus
 * untracked files, each counted as one file with insertions = its line count (binary: binaryFiles).
 */
export async function workingTreeDiffStats(cwd, baseRevision) {
  const diff = numstat(await git(cwd, ["diff", "--numstat", "--no-renames", baseRevision]));
  const untracked = (await git(cwd, ["ls-files", "--others", "--exclude-standard", "-z"])).split("\0").filter(Boolean);
  for (const file of untracked) {
    const bytes = await readFile(join(cwd, file));
    diff.filesChanged += 1;
    if (bytes.includes(0)) { diff.binaryFiles += 1; continue; }
    const text = bytes.toString("utf8");
    diff.insertions += text.length === 0 ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
  }
  return diff;
}

function streamView(text, digest, truncated, redactor) {
  return {
    sha256: digest,
    capturedBytes: Buffer.byteLength(String(text ?? "")),
    truncated: truncated === true,
    excerpt: redactedExcerpt(text, { redactor, truncated, maxChars: EXCERPT_CHARS })
  };
}

async function logFileView(logFile, redactor) {
  if (typeof logFile !== "string" || !existsSync(logFile)) return null;
  const bytes = await readFile(logFile);
  const kept = bytes.subarray(0, MAX_LOG_BYTES);
  return {
    sha256: sha256(bytes),
    bytes: bytes.length,
    excerpt: redactedExcerpt(kept.toString("utf8"), { redactor, truncated: kept.length < bytes.length, maxChars: EXCERPT_CHARS })
  };
}

/** argv as launched, with the prompt replaced by its digest and every element redacted. */
export function redactArgv(tool, request, timeoutMs, redactor) {
  const prompt = request.prompt;
  let args = [];
  try { args = tool.buildInvocation({ ...request, timeoutMs }).args; } catch { args = []; }
  const marker = `<prompt sha256=${sha256(prompt)} chars=${prompt.length}>`;
  return [tool.command, ...tool.prefixArgs, ...args].map((arg) => (arg === prompt ? marker : redactor.redact(arg)));
}

/**
 * Builds the trace body (without chain fields) from one observed invocation. `env` is the process
 * environment merged with the invocation env; it defines which values are secrets.
 */
export async function buildTraceBody({
  runId, taskId, tool, toolVersion = null, arm, mode, attemptIndex, request, timeoutMs, invocation,
  startedAt, endedAt, diff, verification = [], harness = null, env
}) {
  if (typeof arm !== "string" || arm.length === 0) throw new TypeError("trace arm label is required");
  const redactor = createRedactor({ env });
  const parsed = parseToolOutput(tool.id, invocation);
  return {
    traceId: randomUUID(),
    runId,
    taskId,
    tool: tool.id,
    toolVersion,
    arm,
    mode,
    attemptIndex,
    startedAt,
    endedAt,
    durationMs: invocation.durationMs ?? null,
    status: invocation.status,
    exitCode: invocation.exitCode ?? null,
    signal: invocation.signal ?? null,
    timedOut: invocation.timedOut === true,
    promptSha256: sha256(request.prompt),
    argvRedacted: redactArgv(tool, request, timeoutMs, redactor),
    stdout: streamView(invocation.stdout, invocation.stdoutSha256, invocation.truncated?.stdout, redactor),
    stderr: streamView(invocation.stderr, invocation.stderrSha256, invocation.truncated?.stderr, redactor),
    logFile: await logFileView(request.logFile, redactor),
    toolEvents: parsed.toolEvents,
    usage: parsed.usage,
    diff,
    verification: verification.map(({ name, status, reason = null }) => ({ name, status, reason: reason == null ? null : redactor.redact(reason) })),
    harness
  };
}
