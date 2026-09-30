#!/usr/bin/env node
// Executed capability probe: OpenCode CLI as an agent-tools adapter candidate.
// Help/version/ENOENT only. Never runs `opencode run <prompt>` (no model/API call).
import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const stripAnsi = (text) => String(text ?? "").replace(/\u001b\[[0-9;]*m/g, "");
function run(command, args, { timeoutMs = 12000 } = {}) {
  const started = Date.now();
  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 512 * 1024,
    shell: false,
    windowsHide: true
  });
  const stdout = stripAnsi(result.stdout).slice(0, 8000);
  const stderr = stripAnsi(result.stderr).slice(0, 8000);
  return {
    exitCode: result.status,
    errorCode: result.error?.code ?? null,
    timedOut: result.error?.code === "ETIMEDOUT",
    durationMs: Date.now() - started,
    stdout,
    stderr,
    combined: `${stdout}\n${stderr}`
  };
}
function resolveOpenCode() {
  const pathEnv = process.env.PATH ?? "";
  for (const dir of pathEnv.split(":").filter(Boolean)) {
    const candidate = join(dir, "opencode");
    if (existsSync(candidate)) return { path: candidate, source: "PATH" };
  }
  const home = join(homedir(), ".opencode", "bin", "opencode");
  if (existsSync(home)) return { path: home, source: "HOME_INSTALL_EXISTS" };
  return { path: null, source: "NOT_FOUND" };
}
const bin = resolveOpenCode();
const version = bin.path ? run(bin.path, ["--version"]) : null;
const help = bin.path ? run(bin.path, ["run", "--help"]) : null;
const topHelp = bin.path ? run(bin.path, ["--help"]) : null;
const missing = run(join(homedir(), "no-such-opencode-bb122"), ["--version"]);
const helpText = help?.combined ?? "";
const topText = topHelp?.combined ?? "";
const has = (text, flag) => text.includes(flag);
const root = join(here, "../../../..");
const adapters = readFileSync(join(root, "packages/agent-tools/src/tool-adapters.js"), "utf8");
const parsers = readFileSync(join(root, "packages/agent-tools/src/output-parsers.js"), "utf8");
const cli = readFileSync(join(root, "packages/agent-tools/bin/exharness-agent.mjs"), "utf8");
const versionText = String(version?.stdout ?? "").trim().split("\n").filter((l) => /^\d+\.\d+/.test(l)).at(-1) ?? null;
const result = {
  kind: "BB-122_OPENCODE_CLI_PROBE_V1",
  resolved: bin,
  version: versionText,
  onDefaultPath: bin.source === "PATH",
  runHelpFlags: {
    format: has(helpText, "--format"),
    formatJsonChoice: has(helpText, '"json"') || has(helpText, "json (raw JSON"),
    dir: has(helpText, "--dir"),
    model: has(helpText, "--model"),
    auto: has(helpText, "--auto"),
    continue: has(helpText, "--continue"),
    session: has(helpText, "--session"),
    positionalMessage: has(helpText, "message to send") || has(helpText, "run [message..]"),
    promptFlagOnRun: has(helpText, "--prompt"),
    attach: has(helpText, "--attach")
  },
  topLevelHasPromptFlag: has(topText, "--prompt"),
  missingBinaryIsEnoent: missing.errorCode === "ENOENT",
  deliveredAgentTools: /AGENT_TOOLS = Object\.freeze\(\{ codex: codexTool, kiro: kiroTool, agy: agyTool \}\)/.test(adapters),
  deliveredHasOpencode: adapters.includes("opencode"),
  parseToolOutputIds: ["codex", "kiro", "agy"].every((id) => parsers.includes(`if (toolId === "${id}")`)),
  cliUsageCodexKiroAgy: cli.includes("run --tool <codex|kiro|agy>"),
  liveModelRun: false
};
writeFileSync(join(here, "opencode-cli-probe-result.json"), `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(result)}\n`);
