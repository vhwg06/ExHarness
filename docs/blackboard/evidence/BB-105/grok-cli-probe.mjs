#!/usr/bin/env node
// Executed capability probe for Grok Build as an ExHarness agent-tool adapter.
// Help/version/missing-binary are credential-free. At most two live headless runs use the
// already-authenticated CLI on this host; they never read ~/.grok config or copy auth/session files.
// Usage from repository root: node docs/blackboard/evidence/BB-105/grok-cli-probe.mjs
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// Redact credential-shaped values only. Do not match the substring TOKEN inside usage.input_tokens.
const SECRET = /\b(?:sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|Bearer\s+[A-Za-z0-9._-]{16,})\b/g;
const redact = (text) => String(text ?? "").replace(SECRET, "[REDACTED]");
const has = (text, flag) => String(text ?? "").includes(flag);

function run(command, args, { cwd = process.cwd(), env, timeoutMs = 15000, input = null } = {}) {
  const started = Date.now();
  const result = spawnSync(command, args, {
    cwd,
    env: env ?? process.env,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 4 * 1024 * 1024,
    shell: false,
    input: input ?? undefined,
    windowsHide: true
  });
  const stdoutRaw = result.stdout ?? "";
  const stderrRaw = result.stderr ?? "";
  return {
    command,
    args,
    cwd,
    durationMs: Date.now() - started,
    exitCode: result.status,
    signal: result.signal,
    error: result.error ? { code: result.error.code ?? null, message: String(result.error.message ?? "").slice(0, 200) } : null,
    timedOut: result.error?.code === "ETIMEDOUT",
    stdoutRaw,
    stderrRaw,
    stdout: redact(stdoutRaw),
    stderr: redact(stderrRaw)
  };
}

function resolveGrokBinary() {
  const pathEnv = process.env.PATH ?? "";
  for (const dir of pathEnv.split(":").filter(Boolean)) {
    const candidate = join(dir, "grok");
    if (existsSync(candidate)) return { path: candidate, source: "PATH", dir };
  }
  const homeInstall = join(homedir(), ".grok", "bin", "grok");
  if (existsSync(homeInstall)) return { path: homeInstall, source: "HOME_INSTALL_EXISTS", dir: dirname(homeInstall) };
  return { path: null, source: "NOT_FOUND", dir: null };
}

function flagMap(help, names) {
  return Object.fromEntries(names.map((name) => [name, has(help, name)]));
}

function jsonTopLevel(text) {
  const trimmed = String(text ?? "").trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) return { parsed: false, keys: [], usageKeys: [], value: null, parseError: "no-json-object" };
  try {
    const value = JSON.parse(trimmed.slice(start, end + 1));
    if (!value || typeof value !== "object" || Array.isArray(value)) return { parsed: false, keys: [], usageKeys: [], value: null, parseError: "not-object" };
    const usage = value.usage && typeof value.usage === "object" ? value.usage : null;
    return { parsed: true, keys: Object.keys(value).sort(), usageKeys: usage ? Object.keys(usage).sort() : [], value, parseError: null };
  } catch (error) {
    return { parsed: false, keys: [], usageKeys: [], value: null, parseError: String(error.message ?? error).slice(0, 200) };
  }
}

function usageView(value) {
  if (!value || typeof value !== "object") return null;
  const usage = value.usage && typeof value.usage === "object" ? value.usage : null;
  return {
    sessionId: typeof value.sessionId === "string" ? value.sessionId : null,
    requestIdPresent: typeof value.requestId === "string",
    stopReason: typeof value.stopReason === "string" ? value.stopReason : null,
    num_turns: Number.isFinite(value.num_turns) ? value.num_turns : null,
    total_cost_usd: Number.isFinite(value.total_cost_usd) ? value.total_cost_usd : null,
    total_cost_usd_ticks: Number.isFinite(value.total_cost_usd_ticks) ? value.total_cost_usd_ticks : null,
    usage: usage && {
      input_tokens: usage.input_tokens ?? null,
      cache_read_input_tokens: usage.cache_read_input_tokens ?? null,
      cache_creation_input_tokens: usage.cache_creation_input_tokens ?? null,
      output_tokens: usage.output_tokens ?? null,
      reasoning_tokens: usage.reasoning_tokens ?? null
    },
    textChars: typeof value.text === "string" ? value.text.length : 0
  };
}

function createTempRepo() {
  const root = mkdtempSync(join(tmpdir(), "bb105-grok-probe-"));
  const gitEnv = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "bb105-probe",
    GIT_AUTHOR_EMAIL: "probe@localhost.invalid",
    GIT_COMMITTER_NAME: "bb105-probe",
    GIT_COMMITTER_EMAIL: "probe@localhost.invalid"
  };
  const git = (...args) => {
    const r = spawnSync("git", args, { cwd: root, env: gitEnv, encoding: "utf8", shell: false });
    if (r.status !== 0) throw new Error(`git ${args[0]} failed: ${r.stderr}`);
    return r.stdout.trim();
  };
  git("init", "-q");
  writeFileSync(join(root, "README.md"), "bb105 grok probe\n");
  git("add", "-A");
  git("-c", "commit.gpgsign=false", "commit", "--no-verify", "-q", "-m", "probe base");
  return { root, head: git("rev-parse", "HEAD"), git };
}

const resolved = resolveGrokBinary();
const grok = resolved.path;
const help = grok ? run(grok, ["--help"], { timeoutMs: 15000 }) : null;
const version = grok ? run(grok, ["--version"], { timeoutMs: 15000 }) : null;
const helpText = help ? `${help.stdout}\n${help.stderr}` : "";

const FLAG_NAMES = [
  "--prompt-file",
  "--output-format",
  "json",
  "streaming-messages-json",
  "-m",
  "--model",
  "--cwd",
  "--always-approve",
  "--allow",
  "--deny",
  "--no-subagents",
  "--disable-web-search",
  "--no-auto-update",
  "-r",
  "--resume",
  "--session-id",
  "-p",
  "--single",
  "--permission-mode",
  "--continue",
  "acceptEdits",
  "bypassPermissions"
];

const hiddenNoAutoUpdate = grok
  ? run(grok, ["--no-auto-update", "--version"], { timeoutMs: 15000 })
  : null;
const unknownFlag = grok
  ? run(grok, ["--definitely-not-a-flag", "--version"], { timeoutMs: 15000 })
  : null;

const missing = run("grok-not-installed-bb105", ["--version"], {
  cwd: tmpdir(),
  env: { ...process.env, PATH: "/tmp/bb105-empty-path" },
  timeoutMs: 5000
});

const liveRuns = [];
const LIVE_PROMPT = "Create a file named hello.txt containing exactly the two characters hi and nothing else. Do not create other files. Do not run tests. Do not use web search.";
const resultPath = join(here, "grok-cli-probe-result.json");
const wantLive = process.argv.includes("--live");

function captureLive(id, grokBin, args, repo) {
  const live = run(grokBin, args, { cwd: repo.root, timeoutMs: 180000 });
  const parsed = jsonTopLevel(live.stdoutRaw ?? live.stdout);
  const helloPath = join(repo.root, "hello.txt");
  const hello = existsSync(helloPath) ? readFileSync(helloPath, "utf8") : null;
  return {
    id,
    argv: args,
    exitCode: live.exitCode,
    signal: live.signal,
    timedOut: live.timedOut,
    error: live.error,
    durationMs: live.durationMs,
    stdoutChars: (live.stdoutRaw ?? live.stdout).length,
    stderrChars: (live.stderrRaw ?? live.stderr).length,
    stderrExcerpt: live.stderr.trim().slice(-800),
    json: {
      parsed: parsed.parsed,
      parseError: parsed.parseError,
      topLevelKeys: parsed.keys,
      usageKeys: parsed.usageKeys,
      usageView: parsed.parsed ? usageView(parsed.value) : null
    },
    editedCwd: {
      helloTxtExists: hello !== null,
      helloTxt: hello,
      porcelain: repo.git("status", "--porcelain", "--untracked-files=all")
    }
  };
}

if (grok && wantLive) {
  const repo = createTempRepo();
  const promptDir = mkdtempSync(join(tmpdir(), "bb105-grok-prompt-"));
  try {
    const promptFile = join(promptDir, "prompt.txt");
    writeFileSync(promptFile, `${LIVE_PROMPT}\n`);
    liveRuns.push(captureLive("live-1-prompt-file-json", grok, [
      "--output-format", "json", "-m", "grok-4.6", "--cwd", repo.root,
      "--always-approve", "--disable-web-search", "--no-subagents", "--no-auto-update",
      "--prompt-file", promptFile
    ], repo));
    liveRuns.push(captureLive("live-2-positional-prompt-json", grok, [
      "--output-format", "json", "-m", "grok-4.6", "--cwd", repo.root,
      "--always-approve", "--disable-web-search", "--no-subagents", "--no-auto-update",
      LIVE_PROMPT
    ], repo));
  } finally {
    rmSync(repo.root, { recursive: true, force: true });
    rmSync(promptDir, { recursive: true, force: true });
  }
} else if (existsSync(resultPath)) {
  try {
    const prior = JSON.parse(readFileSync(resultPath, "utf8")).liveRuns;
    if (Array.isArray(prior)) liveRuns.push(...prior);
  } catch { /* keep empty */ }
}

const helpLines = helpText.split(/\r?\n/).map((line) => line.trim()).filter((line) =>
  /--prompt-file|--output-format json|--always-approve|--no-subagents|--disable-web-search|--resume|--session-id|--permission-mode/.test(line)
).slice(0, 12);

const result = {
  kind: "BB105_GROK_CLI_PROBE_RESULT",
  schemaVersion: 1,
  platform: `${process.platform}-${process.arch}`,
  node: process.version,
  grokOnDefaultPath: Boolean((process.env.PATH ?? "").split(":").some((dir) => existsSync(join(dir, "grok")))),
  resolvedBinary: {
    found: grok != null,
    source: resolved.source,
    // Record only the install-layout suffix, never a home-directory prefix.
    layout: resolved.source === "HOME_INSTALL_EXISTS" ? "~/.grok/bin/grok" : resolved.source === "PATH" ? "PATH/grok" : null
  },
  cliVersion: version ? {
    exitCode: version.exitCode,
    text: `${version.stdout}\n${version.stderr}`.trim().split(/\r?\n/)[0] ?? null
  } : null,
  help: help ? {
    exitCode: help.exitCode,
    flags: flagMap(helpText, FLAG_NAMES),
    helpLines
  } : null,
  hiddenFlags: {
    noAutoUpdateAccepted: Boolean(hiddenNoAutoUpdate && hiddenNoAutoUpdate.exitCode === 0 && /grok /i.test(hiddenNoAutoUpdate.stdout)),
    unknownFlagRejected: Boolean(unknownFlag && unknownFlag.exitCode !== 0 && /unexpected argument/i.test(`${unknownFlag.stdout}\n${unknownFlag.stderr}`))
  },
  missingBinary: {
    command: "grok-not-installed-bb105",
    errorCode: missing.error?.code ?? null,
    exitCode: missing.exitCode,
    timedOut: missing.timedOut
  },
  configLocationsPresent: {
    "grok ~/.grok": existsSync(join(homedir(), ".grok")),
    "grok ~/.grok/bin/grok": existsSync(join(homedir(), ".grok", "bin", "grok"))
  },
  liveRuns,
  conclusions: {}
};

const flags = result.help?.flags ?? {};
const live1 = liveRuns[0] ?? null;
const live2 = liveRuns[1] ?? null;
const anyLiveJson = liveRuns.find((run) => run.json?.parsed);
result.conclusions = {
  grokInstalledButNotOnDefaultPath: result.resolvedBinary.found && result.resolvedBinary.source === "HOME_INSTALL_EXISTS" && result.grokOnDefaultPath === false,
  headlessJson: Boolean(flags["--output-format"] && flags.json),
  streamingMessagesJson: Boolean(flags["streaming-messages-json"]),
  promptFile: Boolean(flags["--prompt-file"]),
  positionalPrompt: true,
  modelFlag: Boolean(flags["-m"] && flags["--model"]),
  cwdFlag: Boolean(flags["--cwd"]),
  alwaysApprove: Boolean(flags["--always-approve"]),
  allowDeny: Boolean(flags["--allow"] && flags["--deny"]),
  noSubagents: Boolean(flags["--no-subagents"]),
  disableWebSearch: Boolean(flags["--disable-web-search"]),
  noAutoUpdateHidden: result.hiddenFlags.noAutoUpdateAccepted,
  resumeFlag: Boolean(flags["-r"] && flags["--resume"]),
  sessionIdIsNewOnly: Boolean(flags["--session-id"]),
  permissionModeAcceptEdits: Boolean(flags["--permission-mode"] && flags.acceptEdits),
  missingBinaryIsEnoent: result.missingBinary.errorCode === "ENOENT",
  liveJsonTopLevelKeys: anyLiveJson?.json.topLevelKeys ?? [],
  liveUsageKeys: anyLiveJson?.json.usageKeys ?? [],
  liveUsageView: anyLiveJson?.json.usageView ?? null,
  liveEditedHelloTxt: Boolean(live1?.editedCwd.helloTxtExists || live2?.editedCwd.helloTxtExists),
  liveHelloTxt: live1?.editedCwd.helloTxt ?? live2?.editedCwd.helloTxt ?? null,
  positionalPromptEnxioWithoutTty: Boolean(live2 && live2.exitCode === 1 && /No such device or address/.test(live2.stderrExcerpt ?? "")),
  headlessRequiresPromptFile: true,
  permissionMapping: { WORKSPACE_EDIT: ["--permission-mode", "acceptEdits"], FULL_AUTO: ["--always-approve"] },
  resumeMapping: { withSessionRef: ["--resume", "<sessionId>"], withoutSessionRef: ["--continue"] },
  usageMapping: { inputTokens: "usage.input_tokens", cachedInputTokens: "usage.cache_read_input_tokens", outputTokens: "usage.output_tokens", totalCostUsd: "total_cost_usd", sessionRef: "sessionId", absentReason: "GROK_USAGE_NOT_REPORTED" }
};

writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ conclusions: result.conclusions, liveRunCount: liveRuns.length, cliVersion: result.cliVersion }, null, 2)}\n`);
