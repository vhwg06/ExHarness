// Shell-free process runner for agent CLIs. Every process is started with spawn, an argument
// array and shell:false; a timeout kills the whole process tree. This is not a sandbox.
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { accessSync, constants, existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

export const InvocationStatus = Object.freeze({
  COMPLETED: "COMPLETED",
  TIMED_OUT: "TIMED_OUT",
  TOOL_UNAVAILABLE: "TOOL_UNAVAILABLE"
});

const EMPTY_SHA256 = createHash("sha256").update("").digest("hex");
const SCRIPT_ENTRY = /\.(?:mjs|cjs|js)$/i;

/**
 * Names copied from the host process.env into every supervised child. This is an
 * allowlist, not a copy of process.env: host secrets that are not allowlisted, not
 * declared in the tool's authEnvNames and not present in the caller overlay never
 * reach the child. PATH and HOME stay so CLIs resolve binaries and homedir config.
 */
export const AGENT_CHILD_INHERITED_ENV = Object.freeze([
  "PATH", "HOME", "USER", "LOGNAME", "SHELL",
  "TMPDIR", "TEMP", "TMP",
  "LANG", "LC_ALL", "LC_CTYPE",
  "TERM", "TERM_PROGRAM", "COLORTERM",
  "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME", "XDG_RUNTIME_DIR", "XDG_STATE_HOME",
  "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "APPDATA", "LOCALAPPDATA", "PATHEXT",
  "SYSTEMROOT", "COMSPEC", "WINDIR"
]);

/** Copies the tool's declared authEnvNames own string values from process.env. */
function authPassthrough(tool) {
  const names = tool?.authEnvNames;
  if (!Array.isArray(names)) return {};
  const passthrough = {};
  for (const name of names) {
    if (name === "NODE_TEST_CONTEXT") continue;
    if (Object.prototype.hasOwnProperty.call(process.env, name) && typeof process.env[name] === "string") {
      passthrough[name] = process.env[name];
    }
  }
  return passthrough;
}

function boundedCapture(maxBytes) {
  const digest = createHash("sha256");
  const chunks = [];
  let kept = 0;
  let truncated = false;
  return {
    push(chunk) {
      digest.update(chunk);
      if (kept < maxBytes) {
        const slice = chunk.subarray(0, maxBytes - kept);
        chunks.push(slice);
        kept += slice.length;
        if (slice.length < chunk.length) truncated = true;
      } else if (chunk.length > 0) {
        truncated = true;
      }
    },
    text: () => Buffer.concat(chunks).toString("utf8"),
    sha256: () => digest.digest("hex"),
    truncated: () => truncated
  };
}

/**
 * Builds the environment for a supervised child: allowlisted host names, then the
 * tool's declared auth passthrough, then the caller overlay (which wins).
 * NODE_TEST_CONTEXT is always stripped, including when passed in the overlay.
 * process.env is never spread wholesale.
 */
function childEnvironment(env, { tool = null } = {}) {
  const inherited = {};
  for (const name of AGENT_CHILD_INHERITED_ENV) {
    if (Object.prototype.hasOwnProperty.call(process.env, name) && typeof process.env[name] === "string") {
      inherited[name] = process.env[name];
    }
  }
  const overlay = env == null ? {} : env;
  const child = { ...inherited, ...authPassthrough(tool), ...overlay };
  delete child.NODE_TEST_CONTEXT;
  return child;
}

/**
 * Builds the caller overlay the bin forwards into the supervised child: FAKE_AGENT_*
 * string values picked from the bin's own environment, then the parsed --env
 * KEY=VALUE flags applied last (so they win).
 */
export function binOverlayEnv(binProcessEnv, envFlags) {
  const overlay = {};
  if (binProcessEnv != null) {
    for (const name of Object.keys(binProcessEnv)) {
      if (name.startsWith("FAKE_AGENT_") && typeof binProcessEnv[name] === "string") {
        overlay[name] = binProcessEnv[name];
      }
    }
  }
  for (const { name, value } of envFlags ?? []) {
    overlay[name] = value;
  }
  return overlay;
}

function waitForExit(child) {
  return new Promise((resolvePromise) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolvePromise();
    child.once("close", () => resolvePromise());
    child.once("error", () => resolvePromise());
  });
}

/** Kills the process tree of `child`; resolves once the kill has been delivered (win32: taskkill exited). */
export async function killProcessTree(child, { platform = process.platform } = {}) {
  if (child.pid == null) return;
  if (platform === "win32") {
    const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { shell: false, stdio: "ignore", windowsHide: true });
    await waitForExit(killer);
    return;
  }
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    try { child.kill("SIGKILL"); } catch { /* already exited */ }
  }
}

function isExecutableFile(path, platform) {
  try {
    if (!statSync(path).isFile()) return false;
    if (platform !== "win32") accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// npm shims: `"%dp0%\node_modules\pkg\bin\cli.js"` (.cmd) or `"$basedir/node_modules/pkg/bin/cli.js"` (.ps1).
const SHIM_TARGET = /(?:%~?dp0%?|\$basedir)[\\/]+(node_modules[\\/][^"'\s]+?\.(?:c|m)?js)\b/i;

function resolveNpmShim(shimPath) {
  const dir = dirname(shimPath);
  if (!existsSync(join(dir, "node_modules"))) return null;
  const match = readFileSync(shimPath, "utf8").match(SHIM_TARGET);
  if (!match) return null;
  const entry = join(dir, ...match[1].split(/[\\/]/));
  return existsSync(entry) ? entry : null;
}

/**
 * Resolves the launch tuple for a command without a shell.
 * - An absolute .mjs/.js/.cjs path runs as { command: process.execPath, prefixArgs: [path] }.
 * - A command containing a path separator is returned unchanged.
 * - Otherwise PATH is searched; on win32 an npm .cmd/.ps1 shim next to node_modules resolves to
 *   its JavaScript entry run through process.execPath, and a native .exe is returned unchanged.
 * Returns null when nothing is found.
 */
export function resolveExecutable(command, { platform = process.platform, pathEnv = process.env.PATH ?? process.env.Path ?? "" } = {}) {
  if (typeof command !== "string" || command.length === 0) throw new TypeError("resolveExecutable requires a command");
  if (isAbsolute(command) && SCRIPT_ENTRY.test(command)) return { command: process.execPath, prefixArgs: [resolve(command)] };
  if (/[\\/]/.test(command)) return { command, prefixArgs: [] };
  const delimiter = platform === "win32" ? ";" : ":";
  const dirs = String(pathEnv).split(delimiter).filter(Boolean);
  const extensions = platform === "win32" ? [".exe", ".cmd", ".ps1", ""] : [""];
  for (const dir of dirs) {
    for (const extension of extensions) {
      const candidate = join(dir, `${command}${extension}`);
      if (!isExecutableFile(candidate, platform)) continue;
      if (platform === "win32" && /\.(?:cmd|ps1)$/i.test(candidate)) {
        const entry = resolveNpmShim(candidate);
        if (entry) return { command: process.execPath, prefixArgs: [entry] };
        continue; // a non-npm .cmd/.ps1 would need cmd.exe/powershell, which is never used
      }
      if (platform === "win32" && extension === "") continue;
      return { command: candidate, prefixArgs: [] };
    }
  }
  return null;
}

function spawnBounded({ command, args, cwd, env, tool = null, stdin, timeoutMs, maxOutputBytes }) {
  return new Promise((resolvePromise) => {
    const started = Date.now();
    const stdout = boundedCapture(maxOutputBytes);
    const stderr = boundedCapture(maxOutputBytes);
    let settled = false;
    let timedOut = false;
    let spawnError = null;
    let killing = null;
    const child = spawn(command, args, {
      cwd,
      shell: false,
      detached: process.platform !== "win32",
      stdio: [stdin == null ? "ignore" : "pipe", "pipe", "pipe"],
      env: childEnvironment(env, { tool }),
      windowsHide: true
    });
    const timer = setTimeout(() => {
      timedOut = true;
      killing = killProcessTree(child);
    }, timeoutMs);
    const finish = async (exitCode, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (timedOut) {
        await killing;
        // Reap remaining members of the process group once the leader exited.
        await killProcessTree(child);
      }
      resolvePromise({
        spawnError,
        exitCode,
        signal,
        timedOut,
        durationMs: Date.now() - started,
        stdout: stdout.text(),
        stderr: stderr.text(),
        stdoutSha256: stdout.sha256(),
        stderrSha256: stderr.sha256(),
        truncated: { stdout: stdout.truncated(), stderr: stderr.truncated() }
      });
    };
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", (error) => {
      spawnError = error;
      finish(null, null);
    });
    child.on("close", (code, signal) => finish(code, signal));
    if (stdin != null) {
      child.stdin.on("error", () => {}); // the tool may exit before reading its prompt
      child.stdin.end(stdin);
    }
  });
}

function unavailable(durationMs, error) {
  return {
    status: InvocationStatus.TOOL_UNAVAILABLE,
    exitCode: null,
    signal: null,
    timedOut: false,
    durationMs,
    stdout: "",
    stderr: "",
    stdoutSha256: EMPTY_SHA256,
    stderrSha256: EMPTY_SHA256,
    truncated: { stdout: false, stderr: false },
    error: error?.code ?? "ENOENT"
  };
}

/**
 * Runs one agent invocation: spawns tool.command with [...prefixArgs, ...args] (shell:false),
 * writes the prompt to stdin when the adapter asks for it, bounds and hashes both streams and
 * kills the process tree at timeoutMs. A missing executable returns TOOL_UNAVAILABLE.
 */
export async function runAgentInvocation(tool, request, { cwd, env = {}, timeoutMs = 600000, maxOutputBytes = 1048576 } = {}) {
  if (typeof cwd !== "string" || cwd.length === 0) throw new TypeError("runAgentInvocation requires cwd");
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new TypeError("runAgentInvocation timeoutMs must be a positive integer");
  if (!Number.isInteger(maxOutputBytes) || maxOutputBytes <= 0) throw new TypeError("runAgentInvocation maxOutputBytes must be a positive integer");
  const { args, stdin = null } = tool.buildInvocation({ ...request, timeoutMs, cwd });
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) throw new TypeError(`${tool.id} buildInvocation must return string args`);
  const outcome = await spawnBounded({ command: tool.command, args: [...tool.prefixArgs, ...args], cwd, env, tool, stdin, timeoutMs, maxOutputBytes });
  if (outcome.spawnError) {
    if (outcome.spawnError.code === "ENOENT") return unavailable(outcome.durationMs, outcome.spawnError);
    throw outcome.spawnError;
  }
  const { spawnError, ...result } = outcome;
  return { status: result.timedOut ? InvocationStatus.TIMED_OUT : InvocationStatus.COMPLETED, ...result };
}

/** Runs a bounded shell-free process (used for version probes and git). */
export async function runProcess(command, args, { cwd, env = {}, stdin = null, timeoutMs = 60000, maxOutputBytes = 1048576 } = {}) {
  const outcome = await spawnBounded({ command, args, cwd, env, stdin, timeoutMs, maxOutputBytes });
  if (outcome.spawnError?.code === "ENOENT") return unavailable(outcome.durationMs, outcome.spawnError);
  if (outcome.spawnError) throw outcome.spawnError;
  const { spawnError, ...result } = outcome;
  return { status: result.timedOut ? InvocationStatus.TIMED_OUT : InvocationStatus.COMPLETED, ...result };
}
