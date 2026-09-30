// AGENT_TOOL_ADAPTER_V1: frozen, shell-free argv contracts for external CLI coding agents.
// Codex (codex-cli 0.158.0), Kiro (kiro-cli-chat 2.24.1), agy (1.1.1), Grok Build (grok)
// and OpenCode (opencode 1.18.33).
// An adapter only builds argument arrays and parses output; it never reads or writes CLI
// configuration or credentials (including ~/.opencode). Operators put the opencode binary
// on PATH or pass it with --command.

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

/** Default model pinned on every grok invocation unless request.model overrides it. */
export const GROK_DEFAULT_MODEL = "grok-4.6";

/**
 * Reads the first balanced JSON object in stdout. Returns { value, text } where text is the
 * raw object slice, or null when stdout holds no parseable JSON object.
 */
function firstJsonObject(stdout) {
  const raw = String(stdout ?? "");
  const start = raw.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < raw.length; index += 1) {
    const char = raw[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        const text = raw.slice(start, index + 1);
        try { return { value: JSON.parse(text), text }; } catch { return null; }
      }
    }
  }
  return null;
}

export const grokTool = defineAgentTool({
  id: "grok",
  command: "grok",
  prefixArgs: [],
  versionArgs: ["--version"],
  buildInvocation(request) {
    const permissionProfile = assertInvocationRequest(request);
    const { prompt, resume = null, model = null, promptFile, cwd } = request;
    if (typeof promptFile !== "string" || promptFile.length === 0) throw new TypeError("grok invocation requires promptFile");
    // A positional prompt fails without a TTY; the prompt travels only via --prompt-file.
    // request.cwd carries the spawn cwd so the adapter can pass --cwd; other adapters ignore it.
    const cwdArgs = typeof cwd === "string" && cwd.length > 0 ? ["--cwd", cwd] : [];
    const permission = permissionProfile === PermissionProfile.FULL_AUTO
      ? ["--always-approve"]
      : ["--permission-mode", "acceptEdits"];
    const resumeArgs = resume === null
      ? []
      : (typeof resume.sessionRef === "string" ? ["--resume", resume.sessionRef] : ["--continue"]);
    return {
      args: [
        "--output-format", "json",
        "--model", model ?? GROK_DEFAULT_MODEL,
        ...cwdArgs,
        ...permission,
        "--disable-web-search",
        "--no-subagents",
        "--no-auto-update",
        ...resumeArgs,
        "--prompt-file", promptFile
      ],
      stdin: null
    };
  },
  parseResult({ exitCode, stdout }) {
    const found = firstJsonObject(stdout);
    const value = found && found.value && typeof found.value === "object" ? found.value : null;
    const sessionRef = value && typeof value.sessionId === "string" && value.sessionId.length > 0 ? value.sessionId : null;
    const finalMessage = value && typeof value.text === "string" ? value.text.slice(0, 2000) : lastLines(stdout);
    return { claimedSuccess: exitCode === 0, finalMessage, sessionRef };
  }
});

// OpenCode: `run --format json` emits JSONL events; a step_finish event carries the usage
// tokens and cost in part.tokens/part.cost. The task message is always the positional
// argument; stdin is null. --dir carries the spawn cwd. WORKSPACE_EDIT omits --auto;
// FULL_AUTO passes --auto. Resume is --session <id>, or --continue without a session id.
export const opencodeTool = defineAgentTool({
  id: "opencode",
  command: "opencode",
  prefixArgs: [],
  versionArgs: ["--version"],
  buildInvocation(request) {
    const permissionProfile = assertInvocationRequest(request);
    const { prompt, resume = null, model = null, cwd = null } = request;
    const dirArgs = typeof cwd === "string" && cwd.length > 0 ? ["--dir", cwd] : [];
    const permissionArgs = permissionProfile === PermissionProfile.FULL_AUTO ? ["--auto"] : [];
    const resumeArgs = resume === null
      ? []
      : (typeof resume.sessionRef === "string" ? ["--session", resume.sessionRef] : ["--continue"]);
    // `--` ends option parsing (yargs-style `run [message..]`), so a prompt that
    // begins with `-` is always the positional message, never an option.
    return {
      args: [
        "run", "--format", "json",
        ...dirArgs,
        ...modelArgs(model),
        ...permissionArgs,
        ...resumeArgs,
        "--",
        prompt
      ],
      stdin: null
    };
  },
  parseResult({ exitCode, stdout }) {
    const { sessionRef, finalMessage } = parseOpencodeEvents(stdout);
    return { claimedSuccess: exitCode === 0, finalMessage, sessionRef };
  }
});

// Shared with parseOpencodeJsonl: first string sessionID wins; the final message is the
// last text part, falling back to the tail of stdout.
function parseOpencodeEvents(stdout) {
  let sessionRef = null;
  let finalMessage = null;
  for (const line of String(stdout ?? "").split(/\r?\n/)) {
    if (!line.trim().startsWith("{")) continue;
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    if (event === null || typeof event !== "object") continue;
    if (sessionRef === null) {
      const id = event.sessionID ?? event.sessionId ?? event.session_id ?? null;
      if (typeof id === "string" && id.length > 0) sessionRef = id;
    }
    const part = event.part ?? null;
    if (part && typeof part === "object" && part.type === "text" && typeof part.text === "string") {
      finalMessage = part.text;
    }
  }
  if (finalMessage === null) finalMessage = lastLines(stdout);
  return { sessionRef, finalMessage };
}

export const AGENT_TOOLS = Object.freeze({ codex: codexTool, kiro: kiroTool, agy: agyTool, grok: grokTool, opencode: opencodeTool });
