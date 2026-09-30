// ExHarness verification-query MCP server over stdio (NDJSON JSON-RPC 2.0).
// Exposes exharness_verify and exharness_status only. There is no promote,
// accept, merge or credential tool: outer supervision remains the only
// promotion authority. Zero runtime npm dependencies (node built-ins only).
import { createLocalCommandVerifier } from "../../agentic-system/src/index.js";
import { runProcess } from "./process-runner.js";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const MCP_PROTOCOL_VERSION = "2025-03-26";
export const MCP_FORBIDDEN_TOOL = "MCP_FORBIDDEN_TOOL";
export const MCP_SERVER_INFO = Object.freeze({ name: "exharness-verify", version: "1.0.0" });
export const EXHARNESS_MCP_TOOLS = Object.freeze({
  VERIFY: "exharness_verify",
  STATUS: "exharness_status"
});

const ALLOWED_TOOLS = new Set([EXHARNESS_MCP_TOOLS.VERIFY, EXHARNESS_MCP_TOOLS.STATUS]);
const FORBIDDEN_PATTERN = /promote|accept|merge/i;

function forbiddenToolError(name) {
  const error = new TypeError(`MCP tool forbidden: ${name}`);
  error.code = MCP_FORBIDDEN_TOOL;
  return error;
}

function verificationReason(artifact) {
  const line = (artifact.evidence ?? []).find((item) => typeof item === "string" && item.includes(":reason="));
  return line ? line.slice(line.indexOf(":reason=") + ":reason=".length) : artifact.status;
}

function toolDefinitions(enabled) {
  const order = [EXHARNESS_MCP_TOOLS.VERIFY, EXHARNESS_MCP_TOOLS.STATUS];
  return order
    .filter((name) => enabled.has(name))
    .map((name) => ({
      name,
      inputSchema: { type: "object", properties: {}, additionalProperties: false }
    }));
}

/**
 * Creates a verification-query MCP server bound to one worktree.
 * verifiers: non-empty [{ name, verify }]; verify({ candidate }) resolves
 * { claim, status, evidence, summary }. status is a live object
 * { attemptIndex, candidateSha, lastVerification } read at call time.
 */
export function createExharnessMcpVerifyServer({ worktreeRoot, verifiers, status = null, tools = null } = {}) {
  if (typeof worktreeRoot !== "string" || worktreeRoot.length === 0) {
    throw new TypeError("createExharnessMcpVerifyServer requires worktreeRoot");
  }
  if (!Array.isArray(verifiers) || verifiers.length === 0) {
    throw new TypeError("createExharnessMcpVerifyServer requires a non-empty verifiers array");
  }
  for (const verifier of verifiers) {
    if (!verifier || typeof verifier !== "object") throw new TypeError("each verifier must be an object");
    if (typeof verifier.name !== "string" || verifier.name.length === 0) throw new TypeError("each verifier requires a name");
    if (typeof verifier.verify !== "function") throw new TypeError(`verifier ${verifier.name} requires verify()`);
  }
  let liveStatus;
  if (status === null || status === undefined) {
    liveStatus = { attemptIndex: 0, candidateSha: null, lastVerification: null };
  } else {
    if (typeof status !== "object" || Array.isArray(status)) throw new TypeError("status must be an object");
    liveStatus = status;
    if (liveStatus.attemptIndex === undefined) liveStatus.attemptIndex = 0;
    if (liveStatus.candidateSha === undefined) liveStatus.candidateSha = null;
    if (liveStatus.lastVerification === undefined) liveStatus.lastVerification = null;
  }
  let requested;
  if (tools === null || tools === undefined) {
    requested = [EXHARNESS_MCP_TOOLS.VERIFY, EXHARNESS_MCP_TOOLS.STATUS];
  } else {
    if (!Array.isArray(tools) || tools.length === 0) throw new TypeError("tools must be a non-empty array");
    requested = [...tools];
  }
  for (const name of requested) {
    if (typeof name !== "string" || !ALLOWED_TOOLS.has(name) || FORBIDDEN_PATTERN.test(name)) {
      throw forbiddenToolError(name);
    }
  }
  const enabled = new Set(requested);
  // Canonical order: VERIFY then STATUS.
  const ordered = [EXHARNESS_MCP_TOOLS.VERIFY, EXHARNESS_MCP_TOOLS.STATUS].filter((name) => enabled.has(name));
  const frozenTools = Object.freeze(ordered);

  let active = null;

  async function handleVerify() {
    const head = await runProcess("git", ["rev-parse", "HEAD"], {
      cwd: worktreeRoot,
      env: { GIT_CONFIG_NOSYSTEM: "1" },
      timeoutMs: 120000
    });
    if (head.status !== "COMPLETED" || head.exitCode !== 0) {
      throw new Error(`mcp verify HEAD failed (exit ${head.exitCode})`);
    }
    const version = String(head.stdout).trim();
    const results = [];
    for (const verifier of verifiers) {
      const artifact = await verifier.verify({ candidate: { id: "mcp-verify", version } });
      results.push({ name: verifier.name, status: artifact.status, reason: verificationReason(artifact) });
    }
    return { ok: results.every((item) => item.status === "PASS"), results };
  }

  function handleStatus() {
    return {
      attemptIndex: liveStatus.attemptIndex,
      candidateSha: liveStatus.candidateSha,
      lastVerification: liveStatus.lastVerification
    };
  }

  function send(stream, message) {
    stream.write(`${JSON.stringify(message)}\n`);
  }

  async function dispatch(message, stdout) {
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      return { error: { code: -32600, message: "Invalid Request" } };
    }
    if (message.jsonrpc !== "2.0" || typeof message.method !== "string") {
      return { error: { code: -32600, message: "Invalid Request" } };
    }
    const { method, params } = message;
    if (method === "notifications/initialized") return null;
    if (method === "initialize") {
      return { result: { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: { ...MCP_SERVER_INFO } } };
    }
    if (method === "ping") return { result: {} };
    if (method === "tools/list") {
      return { result: { tools: toolDefinitions(enabled) } };
    }
    if (method === "tools/call") {
      const name = params?.name;
      if (typeof name !== "string" || !enabled.has(name)) {
        return { error: { code: -32601, message: `Unknown tool: ${name ?? "null"}` } };
      }
      if (name === EXHARNESS_MCP_TOOLS.VERIFY) {
        const payload = await handleVerify();
        return { result: { content: [{ type: "text", text: JSON.stringify(payload) }], isError: false } };
      }
      const payload = handleStatus();
      return { result: { content: [{ type: "text", text: JSON.stringify(payload) }], isError: false } };
    }
    return { error: { code: -32601, message: `Unknown method: ${method}` } };
  }

  async function start({ stdin, stdout } = {}) {
    if (!stdin || typeof stdin.on !== "function") throw new TypeError("start requires stdin");
    if (!stdout || typeof stdout.write !== "function") throw new TypeError("start requires stdout");
    if (active) throw new Error("MCP server already started");
    let buffer = "";
    const onData = (chunk) => {
      buffer += String(chunk);
      let index = buffer.indexOf("\n");
      while (index >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        index = buffer.indexOf("\n");
        if (line.trim() === "") continue;
        void handleLine(line);
      }
    };
    const handleLine = async (line) => {
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        send(stdout, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
        return;
      }
      // Notifications carry no id and receive no reply.
      if (parsed && typeof parsed === "object" && parsed.id === undefined) {
        if (parsed.method === "notifications/initialized") return;
        if (parsed.jsonrpc === "2.0" && typeof parsed.method === "string") return;
        return;
      }
      const id = parsed?.id ?? null;
      try {
        const outcome = await dispatch(parsed, stdout);
        if (outcome === null) return;
        if (outcome.error) send(stdout, { jsonrpc: "2.0", id, error: outcome.error });
        else send(stdout, { jsonrpc: "2.0", id, result: outcome.result });
      } catch (error) {
        send(stdout, { jsonrpc: "2.0", id, error: { code: -32603, message: error?.message ?? "Internal error" } });
      }
    };
    stdin.setEncoding?.("utf8");
    stdin.on("data", onData);
    active = { stdin, stdout, onData };
  }

  async function stop() {
    if (!active) return;
    const { stdin, onData } = active;
    active = null;
    try {
      stdin.off?.("data", onData);
      stdin.removeListener?.("data", onData);
    } catch { /* already detached */ }
  }

  return { start, stop, tools: frozenTools };
}

function parseCliArgs(argv) {
  let worktree = null;
  let verifiersJson = null;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--worktree") worktree = argv[i + 1] ?? null;
    if (argv[i] === "--verifiers") verifiersJson = argv[i + 1] ?? null;
  }
  return { worktree, verifiersJson };
}

// CLI entry: node mcp-server.js --worktree <abs> --verifiers <json [{name,command,args,timeoutMs}]>
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { worktree, verifiersJson } = parseCliArgs(process.argv.slice(2));
  if (!worktree || !verifiersJson) {
    process.stderr.write("usage: mcp-server.js --worktree <abs> --verifiers <json>\n");
    process.exit(64);
  }
  let specs;
  try {
    specs = JSON.parse(verifiersJson);
  } catch {
    process.stderr.write("invalid --verifiers JSON\n");
    process.exit(64);
  }
  if (!Array.isArray(specs) || specs.length === 0) {
    process.stderr.write("invalid --verifiers JSON\n");
    process.exit(64);
  }
  const verifiers = specs.map((spec) => createLocalCommandVerifier({
    name: spec.name,
    claim: `agent-task.${spec.name}`,
    root: worktree,
    command: spec.command,
    args: [...(spec.args ?? [])],
    timeoutMs: spec.timeoutMs ?? 30000,
    requireUnchangedTree: true
  }));
  const server = createExharnessMcpVerifyServer({ worktreeRoot: worktree, verifiers });
  void server.start({ stdin: process.stdin, stdout: process.stdout });
}
