// Local command verifier: runs one argument-array process (shell:false) in a checkout and binds the
// verification record to the evaluated revision. This is a trusted local fixture, not a sandbox.
import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { VerificationStatus } from "../../core-harness/src/index.js";

const run = promisify(execFile);

export const LocalVerificationReason = Object.freeze({
  PASS: "PASS",
  FAIL: "FAIL",
  TIMEOUT: "TIMEOUT",
  REVISION_MISMATCH: "REVISION_MISMATCH",
  TREE_MUTATED: "TREE_MUTATED",
  SPAWN_ERROR: "SPAWN_ERROR"
});

const SUMMARY_CHARS = 2000;

async function gitState(root) {
  const options = { cwd: root, shell: false, encoding: "utf8", env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" } };
  const head = (await run("git", ["rev-parse", "HEAD"], options)).stdout.trim();
  const status = (await run("git", ["status", "--porcelain", "--untracked-files=all"], options)).stdout;
  return { head, status };
}

function killTree(child) {
  if (child.pid == null) return;
  try {
    if (process.platform === "win32") {
      execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], { shell: false }, () => {});
    } else {
      process.kill(-child.pid, "SIGKILL");
    }
  } catch {
    try { child.kill("SIGKILL"); } catch { /* already exited */ }
  }
}

function boundedCapture(maxBytes) {
  const digest = createHash("sha256");
  const chunks = [];
  let kept = 0;
  return {
    push(chunk) {
      digest.update(chunk);
      if (kept < maxBytes) {
        const slice = chunk.subarray(0, maxBytes - kept);
        chunks.push(slice);
        kept += slice.length;
      }
    },
    text: () => Buffer.concat(chunks).toString("utf8"),
    sha256: () => digest.digest("hex")
  };
}

function childEnvironment() {
  // A nested node:test run must report on its own stdio, not a parent test-runner channel.
  const { NODE_TEST_CONTEXT, ...env } = process.env;
  return env;
}

function executeProcess({ root, command, args, timeoutMs, maxOutputBytes }) {
  return new Promise((resolvePromise) => {
    const stdout = boundedCapture(maxOutputBytes);
    const stderr = boundedCapture(maxOutputBytes);
    let settled = false;
    let timedOut = false;
    let spawnError = null;
    const child = spawn(command, args, {
      cwd: root,
      shell: false,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
      env: childEnvironment(),
      windowsHide: true
    });
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, timeoutMs);
    const finish = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({ code, timedOut, spawnError, stdout, stderr });
    };
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", (error) => {
      spawnError = error;
      finish(null);
    });
    child.on("close", (code) => {
      // Reap any remaining members of the process group once the leader exits.
      if (timedOut) killTree(child);
      finish(code);
    });
  });
}

export function createLocalCommandVerifier({
  name,
  claim,
  root,
  command,
  args = [],
  timeoutMs = 30000,
  maxOutputBytes = 65536,
  requireUnchangedTree = true
}) {
  if (typeof name !== "string" || name.length === 0) throw new TypeError("local command verifier requires name");
  if (typeof claim !== "string" || claim.length === 0) throw new TypeError("local command verifier requires claim");
  if (typeof root !== "string" || root.length === 0) throw new TypeError("local command verifier requires root");
  if (typeof command !== "string" || command.length === 0) throw new TypeError("local command verifier requires command");
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) throw new TypeError("local command verifier args must be an array of strings");
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new TypeError("local command verifier timeoutMs must be a positive integer");
  if (!Number.isInteger(maxOutputBytes) || maxOutputBytes <= 0) throw new TypeError("local command verifier maxOutputBytes must be a positive integer");
  const frozenArgs = Object.freeze([...args]);

  const record = ({ status, revision, exit, reason, stdout = "", stderr = "", stdoutSha, stderrSha }) => {
    const empty = createHash("sha256").update("").digest("hex");
    const output = `${stdout}${stderr}`;
    return {
      claim,
      status,
      evidence: [
        `${name}:revision=${revision}`,
        `${name}:exit=${exit ?? "null"}`,
        `${name}:reason=${reason}`,
        `${name}:stdout-sha256=${stdoutSha ?? empty}`,
        `${name}:stderr-sha256=${stderrSha ?? empty}`
      ],
      summary: `${name} ${reason} exit=${exit ?? "null"} revision=${revision}\n${output.slice(-SUMMARY_CHARS)}`
    };
  };

  async function verify({ candidate }) {
    const before = await gitState(root);
    if (before.head !== candidate?.version) {
      return record({ status: VerificationStatus.FAIL, revision: before.head, exit: null, reason: LocalVerificationReason.REVISION_MISMATCH });
    }
    const outcome = await executeProcess({ root, command, args: [...frozenArgs], timeoutMs, maxOutputBytes });
    let status;
    let reason;
    if (outcome.timedOut) {
      status = VerificationStatus.INCONCLUSIVE;
      reason = LocalVerificationReason.TIMEOUT;
    } else if (outcome.spawnError) {
      status = VerificationStatus.FAIL;
      reason = LocalVerificationReason.SPAWN_ERROR;
    } else if (outcome.code === 0) {
      status = VerificationStatus.PASS;
      reason = LocalVerificationReason.PASS;
    } else {
      status = VerificationStatus.FAIL;
      reason = LocalVerificationReason.FAIL;
    }
    if (requireUnchangedTree) {
      const after = await gitState(root);
      if (after.head !== before.head || after.status !== before.status) {
        status = VerificationStatus.FAIL;
        reason = LocalVerificationReason.TREE_MUTATED;
      }
    }
    return record({
      status,
      revision: before.head,
      exit: outcome.code,
      reason,
      stdout: outcome.stdout.text(),
      stderr: outcome.stderr.text(),
      stdoutSha: outcome.stdout.sha256(),
      stderrSha: outcome.stderr.sha256()
    });
  }

  return Object.freeze({ name, verify });
}
