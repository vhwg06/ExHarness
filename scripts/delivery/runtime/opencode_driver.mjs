#!/usr/bin/env node
// BB-066: opencode driver for the coding-agent runtime adapter.
//
// Usage:
//   node opencode_driver.mjs dispatch --manifest <abs> --result <abs>
//   node opencode_driver.mjs recover  --manifest <abs> --result <abs>
//
// The driver owns the opencode CLI invocation. It prints exactly one bounded
// JSON envelope on stdout; diagnostics go to stderr. result.json is written
// atomically (tmp + fsync + rename). session-created.json is created
// exclusively: exactly one opencode session per manifest.
//
// Exit codes: 0 = envelope complete (termination kind inside may still be
// ERROR); 2 = driver-level failure (no envelope).
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  existsSync, mkdirSync, readFileSync, writeFileSync, renameSync,
  fsyncSync, openSync, closeSync, readdirSync, statSync,
} from "node:fs";
import { join, resolve, relative, sep, dirname } from "node:path";

const sha256hex = (d) => createHash("sha256").update(d).digest("hex");
const MAX_STDOUT_BYTES = 4 * 1024 * 1024;
const MAX_STDERR_BYTES = 1024 * 1024;

function parseArgs(argv) {
  const out = { operation: null, manifest: null, result: null };
  const rest = [...argv];
  out.operation = rest.shift();
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--manifest") out.manifest = rest[++i];
    else if (rest[i] === "--result") out.result = rest[++i];
  }
  return out;
}

function hashWorkspaceTree(root) {
  const excluded = new Set(["node_modules", ".git", ".opencode"]);
  const entries = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      if (excluded.has(name)) continue;
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (st.isFile()) entries.push({ path: relative(root, full).split(sep).join("/"), sha256: sha256hex(readFileSync(full)) });
    }
  };
  walk(root);
  return { digest: "sha256:" + sha256hex(JSON.stringify(entries)), entries };
}

function atomicWriteJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = path + ".tmp";
  const fd = openSync(tmp, "w");
  try { writeFileSync(fd, JSON.stringify(value)); fsyncSync(fd); }
  finally { closeSync(fd); }
  renameSync(tmp, path);
}

// Parse opencode `--format json` JSONL: first sessionID wins, count events,
// track last text part, detect stream errors.
function parseOpencodeJsonl(stdout) {
  let sessionId = null, eventCount = 0, finalText = null, streamError = null;
  const kinds = {};
  for (const line of String(stdout).split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    let ev;
    try { ev = JSON.parse(t); } catch { continue; }
    if (!ev || typeof ev !== "object") continue;
    eventCount++;
    const k = typeof ev.type === "string" ? ev.type : "unknown";
    kinds[k] = (kinds[k] ?? 0) + 1;
    if (sessionId === null) {
      const id = ev.sessionID ?? ev.sessionId ?? ev.session_id ?? ev?.session?.id ?? null;
      if (typeof id === "string" && id) sessionId = id;
    }
    const part = ev.part;
    if (part && typeof part === "object" && part.type === "text" && typeof part.text === "string") finalText = part.text;
    const errText = ev.error?.message ?? ev.error ?? null;
    if ((k.includes("error") || k === "stream_error") && typeof errText === "string") streamError = errText.slice(0, 500);
  }
  return { sessionId, eventCount, kinds, finalText, streamError };
}

function runOpencode({ bin, workspaceRoot, model, prompt, sessionId, progressPath, timeoutMs }) {
  return new Promise((resolveRun) => {
    const args = ["run", "--format", "json", "--dir", workspaceRoot, "-m", model];
    if (sessionId) args.push("--session", sessionId);
    args.push("--", prompt);
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "", oob = 0, eob = 0;
    const progressFd = openSync(progressPath, "a");
    let lastProgressWrite = 0;
    const killTimer = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, Math.max(1000, timeoutMs));
    child.stdout.on("data", (d) => {
      const room = MAX_STDOUT_BYTES - oob;
      if (room > 0) { const s = d.toString("utf8").slice(0, room); stdout += s; oob += Buffer.byteLength(s, "utf8"); }
      const now = Date.now();
      if (now - lastProgressWrite > 1000) {
        lastProgressWrite = now;
        const p = parseOpencodeJsonl(stdout);
        try { writeFileSync(progressFd, JSON.stringify({ t: new Date().toISOString(), events: p.eventCount, sessionId: p.sessionId }) + "\n"); } catch {}
      }
    });
    child.stderr.on("data", (d) => {
      const room = MAX_STDERR_BYTES - eob;
      if (room > 0) { const s = d.toString("utf8").slice(0, room); stderr += s; eob += Buffer.byteLength(s, "utf8"); }
    });
    child.on("error", (e) => { clearTimeout(killTimer); try { closeSync(progressFd); } catch {} resolveRun({ exitCode: null, signal: null, spawnError: String(e?.message ?? e), stdout, stderr }); });
    child.on("close", (code, signal) => {
      clearTimeout(killTimer);
      try { closeSync(progressFd); } catch {}
      resolveRun({ exitCode: code, signal, stdout, stderr });
    });
  });
}

async function main() {
  const { operation, manifest, result } = parseArgs(process.argv.slice(2));
  if (!["dispatch", "recover"].includes(operation) || !manifest || !result) {
    process.stderr.write("usage: opencode_driver.mjs dispatch|recover --manifest <abs> --result <abs>\n");
    process.exit(2);
  }
  const manifestPath = resolve(manifest), resultPath = resolve(result);
  const attemptDir = dirname(manifestPath);
  const sessionMarkerPath = join(attemptDir, "session-created.json");
  const progressPath = join(attemptDir, "driver-progress.jsonl");

  let m;
  try { m = JSON.parse(readFileSync(manifestPath, "utf8")); }
  catch { process.stderr.write("driver: cannot read manifest\n"); process.exit(2); }

  // Recover fast-path: replay a complete atomically-published result.
  if (operation === "recover" && existsSync(resultPath)) {
    try {
      const prior = JSON.parse(readFileSync(resultPath, "utf8"));
      if (prior && prior.schemaVersion === 1 && prior.workspace && prior.termination) {
        process.stdout.write(JSON.stringify(prior) + "\n");
        process.exit(0);
      }
    } catch { /* fall through to live recover */ }
  }

  if (operation === "dispatch" && existsSync(sessionMarkerPath)) {
    process.stderr.write("driver: session already created for this manifest\n");
    process.exit(2);
  }
  let sessionId = null;
  if (operation === "recover") {
    try { sessionId = JSON.parse(readFileSync(sessionMarkerPath, "utf8")).sessionId ?? null; }
    catch { process.stderr.write("driver: recover requires session-created.json\n"); process.exit(2); }
    if (!sessionId) { process.stderr.write("driver: session marker has no sessionId\n"); process.exit(2); }
  }

  const bin = process.env.EXHARNESS_OPENCODE_BIN || "opencode";
  const workspaceRoot = m.workspaceRoot;
  const model = m.modelProfile?.immutableModelId;
  if (!workspaceRoot || !model) { process.stderr.write("driver: manifest missing workspaceRoot/model\n"); process.exit(2); }

  const prompt = operation === "dispatch"
    ? m.promptText
    : "Continue the task from where you left off. Do not restate what is already done; finish any remaining work within the current workspace.";
  if (typeof prompt !== "string" || !prompt) { process.stderr.write("driver: empty prompt\n"); process.exit(2); }

  const startingTree = hashWorkspaceTree(workspaceRoot);
  const timeoutMs = 25 * 60 * 1000; // adapter enforces the real timeout; driver cap is a backstop
  // Discover the opencode session ID early via `opencode session list` (stdout
  // may be block-buffered when piped, so we cannot rely on streaming the
  // session ID). Runs concurrently with the agent; writes the durable marker
  // as soon as the session is visible.
  const spawnWallClock = Date.now();
  let discoveredSessionId = sessionId;
  let stopDiscovery = false;
  const discover = (async () => {
    if (operation === "recover") return; // recover already has the session ID
    const { execFile } = await import("node:child_process");
    const execFileP = (await import("node:util")).promisify(execFile);
    // Query opencode's SQLite DB directly: the session row is visible immediately,
    // while `opencode session list` does not show in-progress sessions and piped
    // stdout may be block-buffered.
    const dbPath = join(process.env.HOME ?? "", ".local", "share", "opencode", "opencode.db");
    const query = `SELECT id FROM session WHERE directory = '${workspaceRoot.replace(/'/g, "''")}' AND time_created >= ${spawnWallClock - 30000} ORDER BY time_created DESC LIMIT 1;`;
    while (!stopDiscovery && !discoveredSessionId) {
      await new Promise((r) => setTimeout(r, 2000));
      if (stopDiscovery || discoveredSessionId) break;
      try {
        const { stdout } = await execFileP("sqlite3", [dbPath, query], { timeout: 10000, maxBuffer: 1024 * 1024 });
        const id = stdout.trim().split("\n")[0]?.trim();
        if (id && id.startsWith("ses_")) {
          discoveredSessionId = id;
          atomicWriteJson(sessionMarkerPath, { sessionId: discoveredSessionId, createdAt: new Date().toISOString(), discoveredVia: "sqlite" });
        }
      } catch { /* retry */ }
    }
  })();
  const proc = await runOpencode({ bin, workspaceRoot, model, prompt, sessionId, progressPath, timeoutMs });
  stopDiscovery = true;
  await discover;
  if (discoveredSessionId) sessionId = discoveredSessionId;
  const parsed = parseOpencodeJsonl(proc.stdout);
  const resultTree = hashWorkspaceTree(workspaceRoot);

  const startPaths = new Map(startingTree.entries.map((e) => [e.path, e.sha256]));
  const changedPaths = [];
  for (const e of resultTree.entries) {
    if (startPaths.get(e.path) !== e.sha256) changedPaths.push(e.path);
  }
  for (const e of startingTree.entries) {
    if (!resultTree.entries.some((x) => x.path === e.path)) changedPaths.push(e.path);
  }
  changedPaths.sort();

  const capturedSessionId = parsed.sessionId ?? sessionId;
  if (operation === "dispatch") {
    if (!capturedSessionId) { process.stderr.write("driver: no session id captured from opencode events\n"); process.exit(2); }
    try {
      writeFileSync(sessionMarkerPath, JSON.stringify({ sessionId: capturedSessionId, createdAt: new Date().toISOString() }), { flag: "wx" });
    } catch (e) {
      if (e?.code === "EEXIST") {
        // Early discovery may have already written the marker; verify it matches.
        try {
          const existing = JSON.parse(readFileSync(sessionMarkerPath, "utf8")).sessionId ?? null;
          if (existing !== capturedSessionId) { process.stderr.write("driver: session marker conflict\n"); process.exit(2); }
        } catch { process.stderr.write("driver: session marker unreadable\n"); process.exit(2); }
      } else throw e;
    }
  }

  const termination = proc.spawnError
    ? { kind: "ERROR", reason: "spawn failed: " + String(proc.spawnError).slice(0, 300) }
    : proc.exitCode === 0
      ? { kind: "FINISHED", reason: "opencode exited 0" }
      : { kind: "ERROR", reason: `opencode exited ${proc.exitCode}${proc.signal ? " signal " + proc.signal : ""}`.slice(0, 300) };
  if (parsed.streamError && termination.kind === "FINISHED") {
    termination.kind = "ERROR";
    termination.reason = "stream error: " + parsed.streamError;
  }

  const envelope = {
    schemaVersion: 1,
    operation,
    sessionId: capturedSessionId,
    promptSendCount: operation === "dispatch" ? 1 : 0,
    sessionContinuations: operation === "recover" ? 1 : 0,
    agent: { name: "opencode", version: m.agent?.version ?? "unknown" },
    model,
    workspace: { startingTree: startingTree.digest, resultTree: resultTree.digest, changedPaths },
    events: { count: parsed.eventCount, kinds: parsed.kinds, lastTextDigest: parsed.finalText ? "sha256:" + sha256hex(parsed.finalText) : null },
    termination,
    usage: { inputTokens: null, outputTokens: null, costUsd: null },
    streamError: parsed.streamError,
  };
  atomicWriteJson(resultPath, envelope);
  process.stdout.write(JSON.stringify(envelope) + "\n");
  process.exit(0);
}

main().catch((e) => { process.stderr.write("driver fatal: " + String(e?.stack ?? e) + "\n"); process.exit(2); });
