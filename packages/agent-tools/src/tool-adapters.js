// AGENT_TOOL_ADAPTER_V1: frozen, shell-free argv contracts for external CLI coding agents.
// Codex (codex-cli 0.158.0), Kiro (kiro-cli-chat 2.24.1) and agy (1.1.1). An adapter only builds
// argument arrays and parses output; it never reads or writes CLI configuration or credentials.

export const AGENT_TOOL_ADAPTER_VERSION = "AGENT_TOOL_ADAPTER_V1";

export const PermissionProfile = Object.freeze({
  WORKSPACE_EDIT: "WORKSPACE_EDIT",
  FULL_AUTO: "FULL_AUTO"
});

function assertStringArray(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new TypeError(`${label} must be an array of strings`);
  }
}

function assertInvocationRequest({ prompt, resume = null, model = null, permissionProfile = PermissionProfile.WORKSPACE_EDIT }) {
  if (typeof prompt !== "string" || prompt.length === 0) throw new TypeError("agent invocation requires a non-empty prompt");
  if (resume !== null && (typeof resume !== "object" || !(resume.sessionRef === null || resume.sessionRef === undefined || typeof resume.sessionRef === "string"))) {
    throw new TypeError("agent invocation resume must be null or { sessionRef }");
  }
  if (model !== null && (typeof model !== "string" || model.length === 0)) throw new TypeError("agent invocation model must be null or a non-empty string");
  if (!Object.values(PermissionProfile).includes(permissionProfile)) throw new TypeError(`unknown permission profile: ${permissionProfile}`);
  return permissionProfile;
}

const modelArgs = (model) => (model == null ? [] : ["--model", model]);

function lastLines(text, maxChars = 4000) {
  const trimmed = String(text ?? "").trim();
  return trimmed.length === 0 ? null : trimmed.slice(-maxChars);
}

function assertAdapter(tool) {
  if (!tool || typeof tool !== "object") throw new TypeError("agent tool adapter is required");
  if (typeof tool.id !== "string" || tool.id.length === 0) throw new TypeError("agent tool adapter requires id");
  if (typeof tool.command !== "string" || tool.command.length === 0) throw new TypeError("agent tool adapter requires command");
  assertStringArray(tool.prefixArgs, "agent tool prefixArgs");
  assertStringArray(tool.versionArgs, "agent tool versionArgs");
  if (typeof tool.buildInvocation !== "function") throw new TypeError("agent tool adapter requires buildInvocation()");
  if (typeof tool.parseResult !== "function") throw new TypeError("agent tool adapter requires parseResult()");
  return tool;
}

/**
 * Validates an adapter and optionally replaces its launch tuple (command plus prefixArgs)
 * atomically, preserving the adapter's argument builder and result parser.
 */
export function defineAgentTool(base, launch = undefined) {
  assertAdapter({ prefixArgs: [], ...base });
  const tuple = launch === undefined
    ? { command: base.command, prefixArgs: [...(base.prefixArgs ?? [])] }
    : { command: launch.command, prefixArgs: [...(launch.prefixArgs ?? [])] };
  const tool = {
    id: base.id,
    command: tuple.command,
    prefixArgs: Object.freeze(tuple.prefixArgs),
    versionArgs: Object.freeze([...base.versionArgs]),
    buildInvocation: base.buildInvocation,
    parseResult: base.parseResult
  };
  return Object.freeze(assertAdapter(tool));
}

// Codex: `exec --json` emits JSONL events; the first thread.started carries the session id.
function parseCodexEvents(stdout) {
  let sessionRef = null;
  let finalMessage = null;
  for (const line of String(stdout ?? "").split(/\r?\n/)) {
    if (!line.trim().startsWith("{")) continue;
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    if (sessionRef === null) {
      const id = event.thread_id ?? event.session_id ?? event.msg?.session_id ?? null;
      if (typeof id === "string" && id.length > 0) sessionRef = id;
    }
    const item = event.item ?? null;
    if (event.type === "item.completed" && item && (item.type === "agent_message" || item.type === "assistant_message") && typeof item.text === "string") {
      finalMessage = item.text;
    }
  }
  return { sessionRef, finalMessage };
}

export const codexTool = defineAgentTool({
  id: "codex",
  command: "codex",
  prefixArgs: [],
  versionArgs: ["--version"],
  buildInvocation(request) {
    const permissionProfile = assertInvocationRequest(request);
    const { prompt, resume = null, model = null } = request;
    // The prompt is always passed on stdin (`-`), never as an argument.
    if (resume !== null && typeof resume.sessionRef === "string") {
      return { args: ["exec", "resume", resume.sessionRef, "--json", "-"], stdin: prompt };
    }
    const sandbox = permissionProfile === PermissionProfile.FULL_AUTO ? "danger-full-access" : "workspace-write";
    return { args: ["exec", "--json", "--skip-git-repo-check", "--sandbox", sandbox, ...modelArgs(model), "-"], stdin: prompt };
  },
  parseResult({ exitCode, stdout }) {
    const { sessionRef, finalMessage } = parseCodexEvents(stdout);
    return { claimedSuccess: exitCode === 0, finalMessage, sessionRef };
  }
});

export const kiroTool = defineAgentTool({
  id: "kiro",
  command: "kiro-cli",
  prefixArgs: [],
  versionArgs: ["--version"],
  buildInvocation(request) {
    const permissionProfile = assertInvocationRequest(request);
    const { prompt, resume = null, model = null } = request;
    // --resume is scoped to the worktree cwd by the Kiro help text, so sessionRef is ignored.
    const trust = permissionProfile === PermissionProfile.FULL_AUTO ? "--trust-all-tools" : "--trust-tools=fs_read,fs_write";
    return { args: ["chat", ...(resume === null ? [] : ["--resume"]), "--no-interactive", trust, ...modelArgs(model), prompt], stdin: null };
  },
  parseResult({ exitCode, stdout }) {
    return { claimedSuccess: exitCode === 0, finalMessage: lastLines(stdout), sessionRef: null };
  }
});

export const agyTool = defineAgentTool({
  id: "agy",
  command: "agy",
  prefixArgs: [],
  versionArgs: ["--version"],
  buildInvocation(request) {
    const permissionProfile = assertInvocationRequest(request);
    const { prompt, resume = null, model = null, logFile, timeoutMs } = request;
    if (typeof logFile !== "string" || logFile.length === 0) throw new TypeError("agy invocation requires logFile");
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new TypeError("agy invocation requires a positive integer timeoutMs");
    // --continue resolves the most recent conversation for the cwd; sessionRef is ignored.
    const permission = permissionProfile === PermissionProfile.FULL_AUTO ? ["--dangerously-skip-permissions"] : ["--mode", "accept-edits"];
    return {
      args: [
        ...(resume === null ? [] : ["--continue"]),
        "--print", prompt,
        ...permission,
        "--print-timeout", `${Math.ceil(timeoutMs / 1000)}s`,
        ...modelArgs(model),
        "--log-file", logFile
      ],
      stdin: null
    };
  },
  parseResult({ exitCode, stdout }) {
    return { claimedSuccess: exitCode === 0, finalMessage: lastLines(stdout), sessionRef: null };
  }
});

export const AGENT_TOOLS = Object.freeze({ codex: codexTool, kiro: kiroTool, agy: agyTool });
