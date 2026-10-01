// BB-066: opencode-backed coding-agent runtime adapter.
//
// Maps one DomainExecutionController runtimeInvocationKey to exactly one
// durable opencode session. The adapter owns attempt manifests, driver
// process lifecycle (bounded TERM/KILL), driver result validation and
// content-addressed evidence publication. It never accepts delivery,
// publishes, or mutates Blackboard/Oracle authority: driver output is only
// a runtime result candidate.
//
// Driver protocol: the driver is spawned as
//   [...driverCommand, operation, "--manifest", manifestPath, "--result", resultPath]
// and prints exactly one bounded JSON envelope on stdout. Diagnostics go to
// stderr. The adapter enforces timeouts and AbortSignal cancellation.
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, fsyncSync, openSync, closeSync,
  readdirSync, statSync,
} from "node:fs";
import { join, resolve, relative, isAbsolute, sep } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

export const OPENCODE_ADAPTER_REF = "runtime-adapter:opencode-v1";
export const OPENCODE_RUNTIME_KIND = "OPENCODE_LOCAL_CLI";
export const OPENCODE_STRATEGY_ID = "opencode-local-v1";
export const OPENCODE_STRATEGY_VERSION = "1.18.34";
export const OPENCODE_AGENT_NAME = "opencode";

const FORBIDDEN_RESULT_FIELDS = ["accepted", "published", "deliveryVerdict", "blackboardMutation", "oracleMutation"];
const TERMINATION_KINDS = new Set(["FINISHED", "ERROR", "CANCELLED"]);
const GRACE_MS = 5000;
const DEFAULT_TIMEOUT_MS = 600000;
const MAX_PROMPT_BYTES = 16384;
const MAX_DRIVER_STDOUT_BYTES = 4 * 1024 * 1024;
const MAX_DRIVER_STDERR_BYTES = 1024 * 1024;

export class OpencodeRecoveryRequiredError extends Error {
  constructor(message, evidenceRefs = []) {
    super(message);
    this.name = "OpencodeRecoveryRequiredError";
    this.evidenceRefs = evidenceRefs;
  }
}

const sha256hex = (data) => createHash("sha256").update(data).digest("hex");
const sha256of = (value) => sha256hex(JSON.stringify(value));
const canonical = (value) => JSON.stringify(value);
const isoNow = () => new Date().toISOString();

function fail(message) {
  throw new TypeError(`opencode-runtime-adapter: ${message}`);
}
const txt = (v, n) => {
  if (typeof v !== "string" || !v.trim()) fail(`${n} must be a non-empty string`);
  return v;
};
const absPath = (v, n) => {
  const p = txt(v, n);
  if (!isAbsolute(p)) fail(`${n} must be absolute: ${p}`);
  return resolve(p);
};

// Sorted content manifest of a workspace root: [{path, sha256}].
// Directories named node_modules, .git and .opencode are excluded so agent
// dependency installs do not churn the tree identity.
const TREE_EXCLUDED = new Set(["node_modules", ".git", ".opencode"]);
export function hashWorkspaceTree(root) {
  const entries = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      if (TREE_EXCLUDED.has(name)) continue;
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (st.isFile()) {
        const rel = relative(root, full).split(sep).join("/");
        entries.push({ path: rel, sha256: sha256hex(readFileSync(full)) });
      }
    }
  };
  walk(root);
  const manifest = canonical(entries);
  return { entries, digest: "sha256:" + sha256hex(manifest), manifest };
}

// Minimal glob matcher for allowed write paths: supports "*", "**".
function globToRegExp(glob) {
  const g = String(glob).split("/").join("/");
  let re = "^";
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === "*") {
      if (g[i + 1] === "*") { re += ".*"; i++; }
      else re += "[^/]*";
    } else if ("+.^${}()|[]\\".includes(c)) re += "\\" + c;
    else re += c;
  }
  return new RegExp(re + "$");
}
export function isPathAllowed(path, globs) {
  const p = String(path).split(sep).join("/");
  return globs.some((g) => globToRegExp(g).test(p));
}

function redactSecrets(text, secrets) {
  let out = String(text ?? "");
  for (const s of secrets) {
    if (typeof s === "string" && s.length >= 8) out = out.split(s).join("[REDACTED]");
  }
  return out;
}

function writeFileExclusive(path, data) {
  try {
    writeFileSync(path, data, { flag: "wx" });
    return true;
  } catch (e) {
    if (e && e.code === "EEXIST") return false;
    throw e;
  }
}

function atomicWriteJson(path, value) {
  const tmp = path + ".tmp";
  const data = canonical(value);
  const fd = openSync(tmp, "w");
  try {
    writeFileSync(fd, data);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function createOpencodeRuntimeAdapter({
  adapterRef = OPENCODE_ADAPTER_REF,
  runtimeDeploymentRef,
  producerAuthorityRef,
  driverCommand = null,
  modelProfileResolver,
  workspaceResolver,
  runtimeEvidenceStore,
  maxEvidenceBytes = 262144,
  opencodeBin = null,
} = {}) {
  txt(adapterRef, "adapterRef");
  if (typeof runtimeDeploymentRef !== "string" || !runtimeDeploymentRef.trim()) fail("runtimeDeploymentRef required");
  if (/(^|[:/@-])latest$/i.test(runtimeDeploymentRef)) fail("runtimeDeploymentRef must not be latest");
  txt(producerAuthorityRef, "producerAuthorityRef");
  if (typeof modelProfileResolver !== "function") fail("modelProfileResolver required");
  if (typeof workspaceResolver !== "function") fail("workspaceResolver required");
  if (typeof runtimeEvidenceStore?.put !== "function") fail("runtimeEvidenceStore.put required");
  const driver = Array.isArray(driverCommand) && driverCommand.length > 0
    ? driverCommand
    : [process.execPath, fileURLToPath(new URL("../../../scripts/delivery/runtime/opencode_driver.mjs", import.meta.url))];

  async function putEvidence(kind, body) {
    const text = canonical(body);
    if (Buffer.byteLength(text, "utf8") > maxEvidenceBytes) {
      fail(`evidence ${kind} exceeds maxEvidenceBytes`);
    }
    const ref = await runtimeEvidenceStore.put(kind, body);
    if (typeof ref !== "string" || !ref.length) fail(`evidence store returned invalid ref for ${kind}`);
    return ref;
  }

  function checkBinding(binding, runtimeInvocationKey) {
    if (!binding || typeof binding !== "object") fail("binding required");
    const rb = binding.runtimeBinding;
    if (!rb || typeof rb !== "object") fail("binding.runtimeBinding required");
    if (rb.kind !== "coding-agent-sdk") fail(`unsupported runtime binding kind: ${rb.kind}`);
    if (rb.adapterRef !== adapterRef) fail("binding adapterRef mismatch");
    if (rb.expectedRuntimeCodeRef !== runtimeDeploymentRef) fail("binding runtime code ref mismatch");
    txt(rb.runtimeInvocationKey, "runtimeInvocationKey");
    if (rb.runtimeInvocationKey !== runtimeInvocationKey) fail("runtimeInvocationKey mismatch");
    txt(binding.executionAttemptId, "executionAttemptId");
  }

  function checkInput(input) {
    if (!input || typeof input !== "object") fail("input required");
    const workspaceDescriptorRef = txt(input.workspaceDescriptorRef, "input.workspaceDescriptorRef");
    const taskId = txt(input.taskId, "input.taskId");
    const promptRef = txt(input.promptRef, "input.promptRef");
    const promptText = txt(input.promptText, "input.promptText");
    if (Buffer.byteLength(promptText, "utf8") > MAX_PROMPT_BYTES) fail("input.promptText exceeds bound");
    const promptHash = "sha256:" + sha256hex(promptText);
    if (input.promptHash !== undefined && input.promptHash !== promptHash) fail("input.promptHash mismatch");
    const outputRoot = absPath(input.outputRoot, "input.outputRoot");
    const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 1200000) fail("input.timeoutMs out of range");
    return { workspaceDescriptorRef, taskId, promptRef, promptText, promptHash, outputRoot, timeoutMs };
  }

  async function resolveContext(binding, checked) {
    const ws = await workspaceResolver({ workspaceDescriptorRef: checked.workspaceDescriptorRef });
    if (!ws || typeof ws !== "object") fail("workspaceResolver returned invalid descriptor");
    const workspaceRoot = absPath(ws.root, "workspace root");
    if (!existsSync(workspaceRoot) || !statSync(workspaceRoot).isDirectory()) fail("workspace root missing");
    const allowedWriteGlobs = Array.isArray(ws.allowedWriteGlobs) && ws.allowedWriteGlobs.length > 0
      ? ws.allowedWriteGlobs.map((g) => txt(g, "allowedWriteGlob"))
      : fail("allowedWriteGlobs required");
    if (checked.outputRoot === workspaceRoot || checked.outputRoot.startsWith(workspaceRoot + sep)) {
      fail("outputRoot must be outside the agent workspace");
    }
    const profile = await modelProfileResolver({ modelProfileRef: binding.modelProfileRef ?? null });
    if (!profile || typeof profile !== "object") fail("modelProfileResolver returned invalid profile");
    const provider = txt(profile.provider, "profile.provider");
    const immutableModelId = txt(profile.immutableModelId, "profile.immutableModelId");
    if (/(latest|current|auto)/i.test(immutableModelId)) fail("profile model id must be immutable");
    const credentialEnvName = profile.credentialEnvName ?? null;
    if (credentialEnvName !== null) txt(credentialEnvName, "profile.credentialEnvName");
    return {
      workspaceRoot, allowedWriteGlobs,
      profile: { provider, immutableModelId, credentialEnvName },
      profileHash: "sha256:" + sha256of({ provider, immutableModelId, credentialEnvName }),
    };
  }

  function attemptDirFor(outputRoot, runtimeInvocationKey) {
    return join(outputRoot, "attempts", sha256hex(runtimeInvocationKey));
  }

  function buildManifest({ binding, checked, ctx, startingTree, signal }) {
    void signal;
    return {
      kind: "OPENCODE_ATTEMPT_MANIFEST",
      version: 1,
      executionAttemptId: binding.executionAttemptId,
      runtimeInvocationKeyHash: "sha256:" + sha256hex(checked.runtimeInvocationKey),
      adapterRef,
      runtimeDeploymentRef,
      strategyId: OPENCODE_STRATEGY_ID,
      strategyVersion: OPENCODE_STRATEGY_VERSION,
      runtimeKind: OPENCODE_RUNTIME_KIND,
      agent: { name: OPENCODE_AGENT_NAME, version: OPENCODE_STRATEGY_VERSION },
      workspaceRoot: ctx.workspaceRoot,
      workspaceStartingTree: startingTree.digest,
      allowedWriteGlobs: ctx.allowedWriteGlobs,
      taskId: checked.taskId,
      promptRef: checked.promptRef,
      promptHash: checked.promptHash,
      promptText: checked.promptText,
      modelProfile: ctx.profile,
      modelProfileHash: ctx.profileHash,
      toolsetRef: binding.toolsetRef ?? null,
      harnessRef: binding.harnessRef ?? null,
      sessionBinding: { mode: "OPENCODE_MANAGED", capture: "driver-event-sessionID" },
      persistenceDir: "<attemptDir>/session",
      createdAt: isoNow(),
    };
  }

  // Spawn the driver; enforce timeout/AbortSignal with bounded TERM/KILL.
  // Resolves {exitCode, signal, timedOut, cancelled, stdout, stderr, startedAt, finishedAt}.
  function runDriver({ manifestPath, resultPath, operation, timeoutMs, signal, secrets, extraEnv }) {
    const startedAt = isoNow();
    return new Promise((resolveRun) => {
      const args = [...driver.slice(1), operation, "--manifest", manifestPath, "--result", resultPath];
      const env = { ...extraEnv };
      // Allowlist: keep PATH/HOME/TMPDIR plus explicit driver needs.
      for (const k of ["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "USER"]) {
        if (process.env[k] !== undefined && env[k] === undefined) env[k] = process.env[k];
      }
      if (opencodeBin) env.EXHARNESS_OPENCODE_BIN = opencodeBin;
      const child = spawn(driver[0], args, { env, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "", stderr = "", stdoutBytes = 0, stderrBytes = 0, stdoutTruncated = false, stderrTruncated = false;
      let timedOut = false, cancelled = false, settled = false;
      const killTimer = setTimeout(() => {
        timedOut = true;
        terminate("timeout");
      }, timeoutMs);
      const onAbort = () => { cancelled = true; terminate("abort"); };
      if (signal) {
        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, { once: true });
      }
      function terminate() {
        if (settled || child.exitCode !== null || child.signalCode !== null) return;
        child.kill("SIGTERM");
        setTimeout(() => {
          if (!settled && child.exitCode === null && child.signalCode === null) {
            try { child.kill("SIGKILL"); } catch { /* already gone */ }
          }
        }, GRACE_MS);
      }
      child.stdout.on("data", (d) => {
        const room = MAX_DRIVER_STDOUT_BYTES - stdoutBytes;
        if (room <= 0) { stdoutTruncated = true; return; }
        const s = d.toString("utf8").slice(0, room);
        stdout += s; stdoutBytes += Buffer.byteLength(s, "utf8");
        if (d.length > Buffer.byteLength(s, "utf8")) stdoutTruncated = true;
      });
      child.stderr.on("data", (d) => {
        const room = MAX_DRIVER_STDERR_BYTES - stderrBytes;
        if (room <= 0) { stderrTruncated = true; return; }
        const s = d.toString("utf8").slice(0, room);
        stderr += s; stderrBytes += Buffer.byteLength(s, "utf8");
      });
      child.on("error", (e) => {
        if (settled) return;
        settled = true;
        clearTimeout(killTimer);
        if (signal) signal.removeEventListener("abort", onAbort);
        resolveRun({ exitCode: null, signal: null, spawnError: String(e?.message ?? e), timedOut, cancelled, stdout, stderr, stdoutTruncated, stderrTruncated, startedAt, finishedAt: isoNow() });
      });
      child.on("close", (code, sig) => {
        if (settled) return;
        settled = true;
        clearTimeout(killTimer);
        if (signal) signal.removeEventListener("abort", onAbort);
        resolveRun({ exitCode: code, signal: sig, timedOut, cancelled, stdout, stderr, stdoutTruncated, stderrTruncated, startedAt, finishedAt: isoNow() });
      });
    }).then((proc) => {
      // Redact secrets before anything is hashed or stored.
      proc.stdout = redactSecrets(proc.stdout, secrets);
      proc.stderr = redactSecrets(proc.stderr, secrets);
      return proc;
    });
  }

  function parseEnvelope(stdout) {
    const line = String(stdout ?? "").trim().split("\n").filter((l) => l.trim().startsWith("{")).pop();
    if (!line) fail("driver produced no JSON envelope");
    let env;
    try { env = JSON.parse(line); } catch { fail("driver envelope is not valid JSON"); }
    return env;
  }

  function checkEnvelope(env, { operation, manifest, sessionId }) {
    if (!env || typeof env !== "object") fail("driver envelope must be an object");
    if (env.schemaVersion !== 1) fail("driver envelope schemaVersion mismatch");
    if (env.operation !== operation) fail("driver envelope operation mismatch");
    if (env.sessionId !== sessionId) fail("driver envelope sessionId mismatch");
    if (!TERMINATION_KINDS.has(env.termination?.kind)) fail("driver envelope termination kind invalid");
    if (operation === "dispatch" && env.promptSendCount !== 1) fail("dispatch must send the task prompt exactly once");
    for (const f of FORBIDDEN_RESULT_FIELDS) {
      if (env[f] !== undefined) fail(`driver envelope carries forbidden field: ${f}`);
    }
    const ws = env.workspace;
    if (!ws || ws.startingTree !== manifest.workspaceStartingTree) fail("driver workspace starting tree drift");
    const changed = Array.isArray(ws.changedPaths) ? ws.changedPaths : fail("driver changedPaths invalid");
    for (const p of changed) {
      if (typeof p !== "string" || p.includes("..") || p.startsWith("/")) fail(`driver changed path unsafe: ${p}`);
      if (!isPathAllowed(p, manifest.allowedWriteGlobs)) fail(`driver changed path outside allowed globs: ${p}`);
    }
    return env;
  }

  async function publishAttemptEvidence({ manifest, manifestRef, sessionId, proc, envelope }) {
    const attemptEvidenceDir = join(manifest.__attemptDir, "evidence");
    mkdirSync(attemptEvidenceDir, { recursive: true });
    const processDoc = {
      kind: "OPENCODE_PROCESS_EVIDENCE", version: 1,
      executionAttemptId: manifest.executionAttemptId,
      sessionId, operation: envelope.operation,
      pid: proc.pid ?? null, exitCode: proc.exitCode, signal: proc.signal,
      spawnError: proc.spawnError ?? null, timedOut: proc.timedOut, cancelled: proc.cancelled,
      startedAt: proc.startedAt, finishedAt: proc.finishedAt,
      stdoutDigest: "sha256:" + sha256hex(proc.stdout),
      stderrDigest: "sha256:" + sha256hex(proc.stderr),
      stdoutTruncated: proc.stdoutTruncated, stderrTruncated: proc.stderrTruncated,
    };
    const processRef = await putEvidence("opencode-process", processDoc);
    const driverResultRef = await putEvidence("opencode-driver-result", envelope);
    const treeRef = await putEvidence("opencode-workspace-tree", {
      kind: "OPENCODE_WORKSPACE_TREE", version: 1,
      executionAttemptId: manifest.executionAttemptId, sessionId,
      startingTree: envelope.workspace.startingTree,
      resultTree: envelope.workspace.resultTree,
      changedPaths: [...envelope.workspace.changedPaths].sort(),
    });
    return { processRef, driverResultRef, treeRef, manifestRef };
  }

  function mapResult({ status, manifest, envelope, refs, proc, sessionId }) {
    const runtimeInvocationId = "opencode-invocation:sha256:" + sha256hex(manifest.__runtimeInvocationKey + refs.manifestRef);
    const candidateRef = "opencode-candidate-source:" + envelope.workspace.resultTree;
    return Object.freeze({
      status,
      runtimeInvocationId,
      startedAt: proc.startedAt,
      finishedAt: proc.finishedAt,
      outputArtifactRefs: [{ ref: candidateRef, digest: envelope.workspace.resultTree.replace(/^sha256:/, "") }],
      effectRefs: [refs.treeRef],
      traceRefs: [refs.processRef],
      verificationCandidateRefs: [refs.manifestRef, refs.processRef, refs.driverResultRef, refs.treeRef],
      counterevidenceRefs: proc.timedOut || proc.cancelled || envelope.termination.kind !== "FINISHED" ? [refs.processRef] : [],
      proposedDerivationEdges: [{
        outputRef: candidateRef,
        derivedFrom: [manifest.promptRef, manifest.workspaceStartingTree, manifest.modelProfileHash].filter(Boolean),
      }],
      sessionId,
    });
  }

  function secretsFor(profile, extraEnv) {
    const secrets = [];
    if (profile.credentialEnvName) {
      const v = extraEnv?.[profile.credentialEnvName] ?? process.env[profile.credentialEnvName];
      if (typeof v === "string" && v) secrets.push(v);
    }
    return secrets;
  }

  async function dispatch({ binding, input, runtimeInvocationKey, signal = null }) {
    if (signal !== null && !(signal instanceof AbortSignal)) fail("signal must be AbortSignal|null");
    checkBinding(binding, runtimeInvocationKey);
    const checked = { ...checkInput(input), runtimeInvocationKey };
    const ctx = await resolveContext(binding, checked);
    const secrets = secretsFor(ctx.profile, null);
    const startingTree = hashWorkspaceTree(ctx.workspaceRoot);

    const attemptDir = attemptDirFor(checked.outputRoot, runtimeInvocationKey);
    mkdirSync(attemptDir, { recursive: true });
    const manifestPath = join(attemptDir, "manifest.json");
    const resultPath = join(attemptDir, "driver-result.json");
    const sessionMarkerPath = join(attemptDir, "session-created.json");

    const manifest = buildManifest({ binding, checked, ctx, startingTree, signal });
    manifest.__attemptDir = attemptDir;
    manifest.__runtimeInvocationKey = runtimeInvocationKey;
    const manifestForStore = { ...manifest };
    delete manifestForStore.__attemptDir;
    delete manifestForStore.__runtimeInvocationKey;

    if (!writeFileExclusive(manifestPath, canonical(manifestForStore))) {
      const collisionRef = await putEvidence("opencode-dispatch-collision", {
        kind: "OPENCODE_DISPATCH_COLLISION", version: 1,
        executionAttemptId: binding.executionAttemptId,
        runtimeInvocationKeyHash: "sha256:" + sha256hex(runtimeInvocationKey),
        observedAt: isoNow(),
      });
      throw new OpencodeRecoveryRequiredError("dispatch collision: manifest already exists for runtimeInvocationKey", [collisionRef]);
    }
    const manifestRef = await putEvidence("opencode-manifest", manifestForStore);
    const manifestHash = manifestRef.split(":").pop();

    const extraEnv = {};
    if (ctx.profile.credentialEnvName) {
      const v = process.env[ctx.profile.credentialEnvName];
      if (typeof v !== "string" || !v) {
        throw new OpencodeRecoveryRequiredError("credential env var missing for profile", [manifestRef]);
      }
      extraEnv[ctx.profile.credentialEnvName] = v;
      secrets.push(v);
    }

    const proc = await runDriver({ manifestPath, resultPath, operation: "dispatch", timeoutMs: checked.timeoutMs, signal, secrets, extraEnv });
    proc.pid = proc.pid ?? null;

    if (proc.spawnError || proc.exitCode !== 0) {
      const refs = await publishAttemptEvidence({
        manifest, manifestRef,
        sessionId: readSessionId(sessionMarkerPath),
        proc, envelope: proc.spawnError ? { schemaVersion: 1, operation: "dispatch", sessionId: null, termination: { kind: "ERROR", reason: "spawn failed" }, workspace: { startingTree: manifest.workspaceStartingTree, resultTree: manifest.workspaceStartingTree, changedPaths: [] } } : parseEnvelopeSafe(proc.stdout, manifest),
      });
      // Ambiguous: the driver may have acted before dying. Never terminalize.
      throw new OpencodeRecoveryRequiredError(
        `dispatch driver ${proc.spawnError ? "failed to spawn: " + proc.spawnError : "exited " + proc.exitCode + (proc.signal ? " signal " + proc.signal : "")}`,
        [refs.manifestRef, refs.processRef, refs.driverResultRef, refs.treeRef],
      );
    }

    const envelope = parseEnvelope(proc.stdout);
    const sessionId = readSessionId(sessionMarkerPath);
    if (!sessionId) fail("dispatch completed without a session-created marker");
    checkEnvelope(envelope, { operation: "dispatch", manifest: manifestForStore, sessionId });
    const refs = await publishAttemptEvidence({ manifest, manifestRef, sessionId, proc, envelope });
    const status = envelope.termination.kind === "FINISHED" ? "SUCCEEDED" : "FAILED";
    return mapResult({ status, manifest: manifestForStore, envelope, refs, proc, sessionId });
  }

  function readSessionId(sessionMarkerPath) {
    try {
      const m = readJson(sessionMarkerPath);
      return typeof m?.sessionId === "string" ? m.sessionId : null;
    } catch { return null; }
  }

  function parseEnvelopeSafe(stdout, manifest) {
    try { return parseEnvelope(stdout); } catch {
      return { schemaVersion: 1, operation: "dispatch", sessionId: null, termination: { kind: "ERROR", reason: "unparseable envelope" }, workspace: { startingTree: manifest.workspaceStartingTree, resultTree: manifest.workspaceStartingTree, changedPaths: [] } };
    }
  }

  function loadManifest(attemptDir) {
    const p = join(attemptDir, "manifest.json");
    if (!existsSync(p)) return null;
    try { return readJson(p); } catch { return { __corrupt: true }; }
  }

  // recover returns a result object (SUCCEEDED/FAILED/BLOCKED/UNKNOWN) and
  // never creates a second session. Only recover may return UNKNOWN, and only
  // after the exact persisted effects were examined and cannot be reconciled.
  async function recover({ binding, input, runtimeInvocationKey, signal = null }) {
    if (signal !== null && !(signal instanceof AbortSignal)) fail("signal must be AbortSignal|null");
    checkBinding(binding, runtimeInvocationKey);
    const checked = { ...checkInput(input), runtimeInvocationKey };
    const attemptDir = attemptDirFor(checked.outputRoot, runtimeInvocationKey);
    const manifestPath = join(attemptDir, "manifest.json");
    const resultPath = join(attemptDir, "driver-result.json");
    const sessionMarkerPath = join(attemptDir, "session-created.json");

    const blocked = (reason, evidence = []) => Object.freeze({
      status: "BLOCKED", runtimeInvocationId: "opencode-invocation:sha256:" + sha256hex(runtimeInvocationKey + reason),
      startedAt: isoNow(), finishedAt: isoNow(), outputArtifactRefs: [], effectRefs: [], traceRefs: [],
      verificationCandidateRefs: evidence, counterevidenceRefs: evidence,
      proposedDerivationEdges: [], blockReason: reason,
    });

    const manifest = loadManifest(attemptDir);
    if (!manifest) return blocked("manifest-missing");
    if (manifest.__corrupt) return blocked("manifest-corrupt");
    if (manifest.executionAttemptId !== binding.executionAttemptId) return blocked("attempt-id-mismatch");
    if (manifest.runtimeInvocationKeyHash !== "sha256:" + sha256hex(runtimeInvocationKey)) return blocked("invocation-key-mismatch");
    if (manifest.adapterRef !== adapterRef || manifest.runtimeDeploymentRef !== runtimeDeploymentRef) return blocked("adapter-identity-mismatch");

    const ctx = await resolveContext(binding, checked);
    if (ctx.workspaceRoot !== manifest.workspaceRoot) return blocked("workspace-root-mismatch");
    if (ctx.profileHash !== manifest.modelProfileHash) return blocked("model-profile-mismatch");
    if ((binding.toolsetRef ?? null) !== (manifest.toolsetRef ?? null)) return blocked("toolset-mismatch");
    if ((binding.harnessRef ?? null) !== (manifest.harnessRef ?? null)) return blocked("harness-mismatch");
    const currentTree = hashWorkspaceTree(ctx.workspaceRoot);
    const secrets = secretsFor(ctx.profile, null);

    const sessionId = readSessionId(sessionMarkerPath);
    if (!sessionId) return blocked("session-marker-missing");

    // Replay a complete atomically-published driver result without respawning.
    if (existsSync(resultPath)) {
      try {
        const prior = readJson(resultPath);
        checkEnvelope(prior, { operation: prior.operation, manifest, sessionId });
        const manifestRef = await putEvidence("opencode-manifest", manifest);
        const refs = await publishAttemptEvidence({
          manifest: { ...manifest, __attemptDir: attemptDir }, manifestRef, sessionId,
          proc: { startedAt: isoNow(), finishedAt: isoNow(), exitCode: 0, signal: null, timedOut: false, cancelled: false, stdout: "", stderr: "", stdoutTruncated: false, stderrTruncated: false },
          envelope: prior,
        });
        const status = prior.termination.kind === "FINISHED" ? "SUCCEEDED" : "FAILED";
        return mapResult({ status, manifest, envelope: prior, refs, proc: { startedAt: isoNow(), finishedAt: isoNow() }, sessionId });
      } catch { /* fall through to live recover */ }
    }

    const extraEnv = {};
    if (ctx.profile.credentialEnvName) {
      const v = process.env[ctx.profile.credentialEnvName];
      if (typeof v !== "string" || !v) return blocked("credential-missing");
      extraEnv[ctx.profile.credentialEnvName] = v;
      secrets.push(v);
    }

    const proc = await runDriver({ manifestPath, resultPath, operation: "recover", timeoutMs: checked.timeoutMs, signal, secrets, extraEnv });
    if (proc.spawnError || proc.exitCode !== 0) {
      // Examine persisted effects: if the driver left no result and the
      // workspace is unchanged from the manifest start, the kill happened
      // before durable effects -> UNKNOWN only after this examination.
      const afterTree = hashWorkspaceTree(ctx.workspaceRoot);
      const resultExists = existsSync(resultPath);
      const manifestRef = await putEvidence("opencode-manifest", manifest);
      const refs = await publishAttemptEvidence({
        manifest: { ...manifest, __attemptDir: attemptDir }, manifestRef, sessionId, proc,
        envelope: { schemaVersion: 1, operation: "recover", sessionId, termination: { kind: proc.cancelled ? "CANCELLED" : "ERROR", reason: proc.spawnError ?? `exit ${proc.exitCode}` }, workspace: { startingTree: manifest.workspaceStartingTree, resultTree: afterTree.digest, changedPaths: [] } },
      });
      if (!resultExists && afterTree.digest === manifest.workspaceStartingTree) {
        return { ...mapResult({ status: "UNKNOWN", manifest, envelope: { schemaVersion: 1, operation: "recover", sessionId, termination: { kind: "ERROR", reason: "unreconciled" }, workspace: { startingTree: manifest.workspaceStartingTree, resultTree: afterTree.digest, changedPaths: [] } }, refs, proc, sessionId }), status: "UNKNOWN" };
      }
      throw new OpencodeRecoveryRequiredError("recover driver failed after possible effects; reconciliation required", [refs.manifestRef, refs.processRef, refs.driverResultRef, refs.treeRef]);
    }

    const envelope = parseEnvelope(proc.stdout);
    checkEnvelope(envelope, { operation: "recover", manifest, sessionId });
    const manifestRef = await putEvidence("opencode-manifest", manifest);
    const refs = await publishAttemptEvidence({ manifest: { ...manifest, __attemptDir: attemptDir }, manifestRef, sessionId, proc, envelope });
    const status = envelope.termination.kind === "FINISHED" ? "SUCCEEDED" : "FAILED";
    return mapResult({ status, manifest, envelope, refs, proc, sessionId });
  }

  return Object.freeze({
    adapterRef,
    runtimeKind: OPENCODE_RUNTIME_KIND,
    runtimeDeploymentRef,
    producerAuthorityRef,
    dispatch,
    recover,
  });
}
