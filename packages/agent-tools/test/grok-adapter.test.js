import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AGENT_TOOLS,
  AgentTaskStatus,
  AttemptOutcome,
  GROK_DEFAULT_MODEL,
  InvocationStatus,
  PermissionProfile,
  UsageUnavailableReason,
  defineAgentTool,
  grokTool,
  parseGrokJson,
  parseToolOutput,
  readTraces,
  runAgentInvocation,
  runObservedInvocation,
  runSupervisedTask,
  summarizeTraces,
  createRunTraceWriter
} from "../src/index.js";
import { auditPaths } from "./scope-audit.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const FAKE_GROK = join(here, "fixtures", "fake-grok.mjs");
const GROK_USAGE = join(here, "fixtures", "grok-usage.json");
const GROK_NO_USAGE = join(here, "fixtures", "grok-no-usage.json");
const BIN = join(here, "..", "bin", "exharness-agent.mjs");
const REPO_ROOT = join(here, "..", "..", "..");
const T = { timeout: 60000 };
const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const grokFake = () => defineAgentTool(grokTool, { command: process.execPath, prefixArgs: [FAKE_GROK] });
const readRecords = (path) => (existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : []);

function tempDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

function git(cwd, ...args) {
  const result = spawnSync("git", args, {
    cwd,
    shell: false,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@localhost.invalid", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@localhost.invalid" }
  });
  assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

function sourceRepository() {
  const root = tempDir("bb105-source-");
  git(root, "init", "-q");
  git(root, "checkout", "-q", "-b", "main");
  writeFileSync(join(root, "sum.mjs"), "export const sum = (a, b) => a - b;\n");
  writeFileSync(join(root, "sum.test.mjs"), 'import test from "node:test";\nimport assert from "node:assert/strict";\nimport { sum } from "./sum.mjs";\ntest("sum adds", () => { assert.equal(sum(2, 3), 5); });\n');
  git(root, "add", "-A");
  git(root, "-c", "commit.gpgsign=false", "commit", "-q", "-m", "failing sum");
  return { root, base: git(root, "rev-parse", "HEAD") };
}

function taskFor(root, base) {
  return {
    id: "sum-task",
    repositoryRoot: root,
    baseRevision: base,
    prompt: "Fix sum in sum.mjs so that sum(a, b) returns a + b.",
    verifications: [{ name: "unit", command: process.execPath, args: ["--test", "sum.test.mjs"], timeoutMs: 30000 }]
  };
}

function promptFileFor(dir) {
  const path = join(dir, "prompt.txt");
  writeFileSync(path, "Fix sum in sum.mjs so that sum(a, b) returns a + b.");
  return path;
}

function runBin(args, env = {}) {
  return new Promise((resolve) => {
    const { NODE_TEST_CONTEXT, ...inherited } = process.env;
    const child = spawn(process.execPath, [BIN, ...args], { shell: false, env: { ...inherited, ...env } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolve({ code, stdout, stderr, json: (() => { try { return JSON.parse(stdout); } catch { return null; } })() }));
  });
}

// ---------------------------------------------------------------- GR1 adapter argv

test("GR1 grok builds the exact WORKSPACE_EDIT argv with the default model", T, () => {
  assert.equal(AGENT_TOOLS.grok, grokTool);
  assert.equal(GROK_DEFAULT_MODEL, "grok-4.6");
  assert.equal(grokTool.command, "grok");
  assert.deepEqual(grokTool.versionArgs, ["--version"]);
  assert.deepEqual(
    grokTool.buildInvocation({ prompt: "do it", resume: null, permissionProfile: PermissionProfile.WORKSPACE_EDIT, promptFile: "/tmp/p.txt", cwd: "/work" }),
    {
      args: ["--output-format", "json", "--model", "grok-4.6", "--cwd", "/work", "--permission-mode", "acceptEdits", "--disable-web-search", "--no-subagents", "--no-auto-update", "--prompt-file", "/tmp/p.txt"],
      stdin: null
    }
  );
  assert.deepEqual(
    grokTool.buildInvocation({ prompt: "do it", resume: null, model: "grok-x", permissionProfile: PermissionProfile.WORKSPACE_EDIT, promptFile: "/tmp/p.txt", cwd: "/work" }).args.slice(0, 4),
    ["--output-format", "json", "--model", "grok-x"]
  );
  assert.deepEqual(
    grokTool.buildInvocation({ prompt: "do it", resume: null, permissionProfile: PermissionProfile.WORKSPACE_EDIT, promptFile: "/tmp/p.txt" }),
    {
      args: ["--output-format", "json", "--model", "grok-4.6", "--permission-mode", "acceptEdits", "--disable-web-search", "--no-subagents", "--no-auto-update", "--prompt-file", "/tmp/p.txt"],
      stdin: null
    }
  );
});

test("GR1 FULL_AUTO passes always-approve", T, () => {
  const { args, stdin } = grokTool.buildInvocation({ prompt: "do it", resume: null, permissionProfile: PermissionProfile.FULL_AUTO, promptFile: "/tmp/p.txt", cwd: "/work" });
  assert.ok(args.includes("--always-approve"), "FULL_AUTO passes --always-approve");
  assert.equal(args.includes("--permission-mode"), false, "FULL_AUTO omits --permission-mode");
  assert.equal(args.includes("acceptEdits"), false, "FULL_AUTO omits acceptEdits");
  assert.equal(stdin, null);
  assert.deepEqual(args, ["--output-format", "json", "--model", "grok-4.6", "--cwd", "/work", "--always-approve", "--disable-web-search", "--no-subagents", "--no-auto-update", "--prompt-file", "/tmp/p.txt"]);
});

test("GR1 WORKSPACE_EDIT does not pass always-approve", T, () => {
  const { args } = grokTool.buildInvocation({ prompt: "do it", resume: null, permissionProfile: PermissionProfile.WORKSPACE_EDIT, promptFile: "/tmp/p.txt", cwd: "/work" });
  assert.equal(args.includes("--always-approve"), false, "WORKSPACE_EDIT must not pass --always-approve");
  assert.deepEqual(args.slice(6, 8), ["--permission-mode", "acceptEdits"]);
});

test("GR1 grok argv uses prompt-file not positional prompt", T, () => {
  const prompt = "Create a file named hello.txt containing exactly hi.";
  const { args, stdin } = grokTool.buildInvocation({ prompt, resume: null, permissionProfile: PermissionProfile.WORKSPACE_EDIT, promptFile: "/tmp/p.txt", cwd: "/work" });
  assert.equal(args.some((word) => word === prompt), false, "argv never includes a positional prompt word");
  assert.equal(stdin, null, "stdin is always null");
  assert.ok(args.includes("--prompt-file"), "the prompt travels via --prompt-file");
  assert.equal(args[args.indexOf("--prompt-file") + 1], "/tmp/p.txt");
});

test("GR1 grok resume flags use resume with a session id and continue without one", T, () => {
  const base = { prompt: "again", permissionProfile: PermissionProfile.WORKSPACE_EDIT, promptFile: "/tmp/p.txt", cwd: "/work" };
  assert.deepEqual(
    grokTool.buildInvocation({ ...base, resume: { sessionRef: "sess-1" } }).args,
    ["--output-format", "json", "--model", "grok-4.6", "--cwd", "/work", "--permission-mode", "acceptEdits", "--disable-web-search", "--no-subagents", "--no-auto-update", "--resume", "sess-1", "--prompt-file", "/tmp/p.txt"]
  );
  assert.ok(grokTool.buildInvocation({ ...base, resume: { sessionRef: null } }).args.includes("--continue"));
  assert.ok(grokTool.buildInvocation({ ...base, resume: {} }).args.includes("--continue"));
  assert.equal(grokTool.buildInvocation({ ...base, resume: null }).args.includes("--continue"), false);
  assert.equal(grokTool.buildInvocation({ ...base, resume: null }).args.includes("--resume"), false);
});

test("GR1 grok requires a prompt file", T, () => {
  assert.throws(() => grokTool.buildInvocation({ prompt: "p", resume: null, permissionProfile: PermissionProfile.WORKSPACE_EDIT, cwd: "/work" }), /promptFile/);
  assert.throws(() => grokTool.buildInvocation({ prompt: "p", resume: null, permissionProfile: PermissionProfile.WORKSPACE_EDIT, promptFile: "" }), /promptFile/);
  const parsed = grokTool.parseResult({ exitCode: 0, stdout: '{"text":"hi","sessionId":"sess-9","stopReason":"end_turn","num_turns":1,"usage":{"input_tokens":1,"output_tokens":2}}', stderr: "" });
  assert.deepEqual(parsed, { claimedSuccess: true, finalMessage: "hi", sessionRef: "sess-9" });
  assert.equal(grokTool.parseResult({ exitCode: 1, stdout: "", stderr: "x" }).claimedSuccess, false);
});

// ---------------------------------------------------------------- GR2 parser and traces

test("GR2 parseGrokJson reports observed tokens and cost from the usage fixture", T, () => {
  const parsed = parseGrokJson(readFileSync(GROK_USAGE, "utf8"));
  assert.deepEqual(parsed.usage, {
    inputTokens: 50117,
    cachedInputTokens: 42752,
    outputTokens: 239,
    reasoningOutputTokens: 117,
    source: "grok.output.json",
    unavailableReason: null,
    totalCostUsd: 0.01200404
  });
  assert.deepEqual(parsed.toolEvents, { num_turns: 3, stopReason: "end_turn", invalidJson: false });
});

test("GR2 usage-free grok JSON is null with GROK_USAGE_NOT_REPORTED", T, () => {
  const parsed = parseGrokJson(readFileSync(GROK_NO_USAGE, "utf8"));
  for (const field of ["inputTokens", "cachedInputTokens", "outputTokens", "reasoningOutputTokens", "totalCostUsd"]) {
    assert.equal(parsed.usage[field], null, `${field} is null, not zero`);
  }
  assert.equal(parsed.usage.unavailableReason, UsageUnavailableReason.GROK_USAGE_NOT_REPORTED);
  assert.equal(parsed.toolEvents, null);
  const empty = parseGrokJson("no json here");
  assert.equal(empty.usage.unavailableReason, UsageUnavailableReason.GROK_USAGE_NOT_REPORTED);
  for (const field of ["inputTokens", "outputTokens"]) assert.equal(empty.usage[field], null, field);
  const truncated = parseGrokJson('{"type":"start"}', { truncated: true });
  assert.equal(truncated.usage.unavailableReason, UsageUnavailableReason.GROK_JSON_TRUNCATED);
  assert.equal(parseGrokJson('{"usage":{"input_tokens":0,"output_tokens":0},"total_cost_usd":"n/a"}').usage.inputTokens, 0, "zero is observed");
});

test("GR2 parseToolOutput dispatches grok and keeps six-field Codex Kiro agy usage objects", T, () => {
  const parsed = parseToolOutput("grok", { status: "COMPLETED", stdout: readFileSync(GROK_USAGE, "utf8") });
  assert.equal(parsed.usage.inputTokens, 50117);
  assert.equal(parsed.usage.totalCostUsd, 0.01200404);
  assert.equal(parseToolOutput("grok", { status: "TOOL_UNAVAILABLE" }).usage.unavailableReason, UsageUnavailableReason.TOOL_UNAVAILABLE);
  assert.equal(parseToolOutput("grok", { status: "COMPLETED", timedOut: true, stdout: "" }).usage.unavailableReason, UsageUnavailableReason.TIMED_OUT);
  for (const id of ["codex", "kiro", "agy"]) {
    const usage = parseToolOutput(id, { status: "COMPLETED", stdout: "" }).usage;
    assert.deepEqual(Object.keys(usage).sort(), ["cachedInputTokens", "inputTokens", "outputTokens", "reasoningOutputTokens", "source", "unavailableReason"], `${id} usage stays six fields`);
  }
});

test("GR2 argvRedacted does not contain the prompt", T, async () => {
  const { root, base } = sourceRepository();
  const dir = tempDir("bb105-traces-");
  const prompt = "Fix sum in sum.mjs with a grok prompt that must stay out of argv.";
  try {
    const writer = createRunTraceWriter({ dir });
    const { trace } = await runObservedInvocation({
      tool: grokFake(), request: { prompt }, cwd: root, env: { FAKE_AGENT_SCENARIO: "FIX_FIRST" },
      timeoutMs: 30000, baseRevision: base, taskId: "task-1", arm: "DIRECT_GROK", writer
    });
    assert.equal(trace.promptSha256, sha256(prompt));
    assert.equal(trace.argvRedacted.join("\n").includes(prompt), false, "argvRedacted never stores the prompt verbatim");
    assert.deepEqual(readTraces(dir).length, 1);
    const report = summarizeTraces(readTraces(dir));
    assert.equal(report.groups[0].usage.totalCostUsdOverCoveredTraces, 0.01200404);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- GR3 arms and CLI

test("GR3 the same grok adapter serves direct and supervised arms", T, async () => {
  const { root, base } = sourceRepository();
  const dir = tempDir("bb105-traces-");
  const record = join(tempDir("bb105-records-"), "record.json");
  try {
    const writer = createRunTraceWriter({ dir });
    const direct = await runObservedInvocation({
      tool: grokFake(), request: { prompt: "Fix sum." }, cwd: root,
      env: { FAKE_AGENT_SCENARIO: "FIX_FIRST", FAKE_AGENT_RECORD: record },
      timeoutMs: 30000, baseRevision: base, taskId: "task-1", arm: "DIRECT_GROK", writer
    });
    assert.equal(direct.invocation.status, InvocationStatus.COMPLETED);
    assert.equal(direct.trace.tool, "grok");
    assert.ok(Number.isInteger(direct.trace.usage.inputTokens));
    const [seen] = readRecords(record);
    assert.ok(seen.argv.includes("--prompt-file"), "direct run passes --prompt-file");
    assert.ok(String(seen.promptFile).startsWith(tmpdir()), "direct prompt file lives under os.tmpdir()");
    assert.equal(String(seen.promptFile).startsWith(root), false, "direct prompt file is not inside the worktree");
    assert.ok(seen.argv.includes("--cwd") && seen.argv[seen.argv.indexOf("--cwd") + 1] === root, "direct run passes --cwd");

    const supervised = await runSupervisedTask({
      tool: grokFake(), task: taskFor(root, base), maxAttempts: 2, timeoutMs: 30000,
      env: { FAKE_AGENT_SCENARIO: "FIX_FIRST" }
    });
    assert.equal(supervised.status, AgentTaskStatus.ACCEPTED);
    assert.equal(supervised.tool, "grok");
    assert.equal(supervised.attempts[0].outcome, AttemptOutcome.CANDIDATE_CREATED);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
    rmSync(dirname(record), { recursive: true, force: true });
  }
});

test("GR3 direct grok run removes its staged prompt directory", T, async () => {
  const { root, base } = sourceRepository();
  const dir = tempDir("bb105-traces-");
  const fakeTmp = tempDir("bb105-tmpdir-");
  const staged = () => readdirSync(fakeTmp).filter((name) => name.startsWith("exharness-grok-prompt-"));
  const previousTmpdir = process.env.TMPDIR;
  process.env.TMPDIR = fakeTmp;
  try {
    const writer = createRunTraceWriter({ dir });
    const ok = await runObservedInvocation({
      tool: grokFake(), request: { prompt: "Fix sum with staged cleanup." }, cwd: root,
      env: { FAKE_AGENT_SCENARIO: "FIX_FIRST" }, timeoutMs: 30000,
      baseRevision: base, taskId: "task-1", arm: "DIRECT_GROK", writer
    });
    assert.equal(ok.invocation.status, InvocationStatus.COMPLETED);
    assert.deepEqual(staged(), [], "no staged prompt dir remains after success");
    const missing = await runObservedInvocation({
      tool: defineAgentTool(grokTool, { command: join(dir, "no-such-grok") }),
      request: { prompt: "Fix sum with staged cleanup." }, cwd: root,
      timeoutMs: 5000, baseRevision: base, taskId: "task-1", arm: "DIRECT_GROK", writer
    });
    assert.equal(missing.invocation.status, InvocationStatus.TOOL_UNAVAILABLE);
    assert.deepEqual(staged(), [], "no staged prompt dir remains after TOOL_UNAVAILABLE");
  } finally {
    if (previousTmpdir === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previousTmpdir;
    rmSync(root, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
    rmSync(fakeTmp, { recursive: true, force: true });
  }
});

test("GR3 exharness-agent probe and smoke accept grok", T, async () => {
  const empty = tempDir("bb105-empty-path-");
  try {
    const probe = await runBin(["probe"], { PATH: empty, Path: empty });
    assert.equal(probe.code, 0, probe.stderr);
    assert.deepEqual(probe.json.tools.grok, { installed: false, version: null });
    const notInstalled = await runBin(["smoke", "--tool", "grok"], { PATH: empty, Path: empty });
    assert.equal(notInstalled.code, 0);
    assert.deepEqual([notInstalled.json.smoke, notInstalled.json.reason], ["SKIPPED", "NOT_INSTALLED"]);
    const unauthenticated = await runBin(["smoke", "--tool", "grok", "--command", FAKE_GROK, "--timeout-ms", "20000"], { FAKE_AGENT_SCENARIO: "AUTH_FAIL" });
    assert.deepEqual([unauthenticated.json.smoke, unauthenticated.json.reason], ["SKIPPED", "TOOL_FAILED_BEFORE_EDIT"]);
    assert.notEqual(unauthenticated.json.result.status, AgentTaskStatus.ACCEPTED);
    const usage = await runBin(["smoke", "--tool", "cursor"]);
    assert.equal(usage.code, 64);
    assert.match(usage.stderr, /unknown --tool/);
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});

test("GR3 npm test does not run live grok smoke", T, () => {
  const scripts = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")).scripts;
  for (const name of ["test", "verify"]) assert.doesNotMatch(scripts[name], /smoke:agent-tools|exharness-agent\.mjs smoke/, `${name} runs no live agent`);
  assert.equal(scripts["smoke:agent-tools"], "node packages/agent-tools/bin/exharness-agent.mjs smoke");
  assert.match(readFileSync(BIN, "utf8"), /codex\|kiro\|agy\|grok/);
});

// ---------------------------------------------------------------- GR4 fake CLI and missing binary

test("GR4 fake grok covers FIX_FIRST with JSON usage", T, async () => {
  const version = spawnSync(process.execPath, [FAKE_GROK, "--version"], { encoding: "utf8" });
  assert.equal(version.status, 0);
  assert.match(version.stdout.trim(), /^fake-grok 0\.0\.0$/);
  const dir = tempDir("bb105-fake-");
  try {
    const promptFile = promptFileFor(dir);
    const record = join(dir, "record.json");
    const run = await runAgentInvocation(grokFake(), { prompt: "Fix sum.", resume: null, promptFile }, {
      cwd: dir, env: { FAKE_AGENT_SCENARIO: "FIX_FIRST", FAKE_AGENT_RECORD: record }, timeoutMs: 20000
    });
    assert.equal(run.status, InvocationStatus.COMPLETED);
    assert.equal(run.exitCode, 0);
    const body = JSON.parse(run.stdout);
    assert.equal(body.sessionId, "fake-grok-1");
    assert.equal(body.stopReason, "end_turn");
    assert.ok(Number.isInteger(body.usage.input_tokens) && Number.isInteger(body.usage.output_tokens));
    assert.ok(Number.isFinite(body.total_cost_usd));
    const parsed = grokTool.parseResult(run);
    assert.deepEqual({ claimedSuccess: parsed.claimedSuccess, sessionRef: parsed.sessionRef }, { claimedSuccess: true, sessionRef: "fake-grok-1" });
    assert.equal(typeof parsed.finalMessage, "string");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("GR4 missing grok executable is TOOL_UNAVAILABLE", T, async () => {
  const dir = tempDir("bb105-missing-");
  try {
    const missing = await runAgentInvocation(
      defineAgentTool(grokTool, { command: join(dir, "no-such-grok") }),
      { prompt: "p", resume: null, promptFile: join(dir, "prompt.txt") },
      { cwd: dir, timeoutMs: 5000 }
    );
    assert.equal(missing.status, InvocationStatus.TOOL_UNAVAILABLE);
    assert.equal(missing.exitCode, null);
    assert.equal(missing.timedOut, false);
    const { root, base } = sourceRepository();
    try {
      const result = await runSupervisedTask({
        tool: defineAgentTool(grokTool, { command: join(dir, "no-such-grok") }),
        task: taskFor(root, base), maxAttempts: 2, timeoutMs: 5000
      });
      assert.equal(result.status, AgentTaskStatus.TOOL_UNAVAILABLE);
      assert.equal(result.acceptedSha, null);
      assert.notEqual(result.status, AgentTaskStatus.ACCEPTED);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- GR5 docs and scope

test("GR5 living docs and README list grok without work ids", T, () => {
  const state = readFileSync(join(REPO_ROOT, "docs", "living", "system", "agent-tools", "state.md"), "utf8");
  const observation = readFileSync(join(REPO_ROOT, "docs", "living", "system", "agent-tools", "observation.md"), "utf8");
  const system = readFileSync(join(REPO_ROOT, "docs", "living", "system", "state.md"), "utf8");
  const readme = readFileSync(join(REPO_ROOT, "packages", "agent-tools", "README.md"), "utf8");
  for (const [name, doc] of [["state.md", state], ["observation.md", observation], ["system state.md", system], ["README", readme]]) {
    assert.ok(doc.includes("grok"), `${name} names grok`);
    assert.doesNotMatch(doc, /BB-\d+/, `${name} carries no work id`);
  }
  assert.match(state, /--prompt-file/);
  assert.match(observation, /GROK_USAGE_NOT_REPORTED/);
});

test("GR5 write scope excludes core-harness", T, () => {
  const plan = JSON.parse(readFileSync(join(REPO_ROOT, "docs", "blackboard", "artifacts", "ready-implement-plan", "BB-105.json"), "utf8"));
  const result = auditPaths(
    ["packages/agent-tools/src/tool-adapters.js", "packages/core-harness/src/harness.js", "docs/blackboard/work-graph.json"],
    plan.sourceScope
  );
  assert.deepEqual(result.allowed, ["packages/agent-tools/src/tool-adapters.js"]);
  assert.deepEqual(result.forbidden.sort(), ["docs/blackboard/work-graph.json", "packages/core-harness/src/harness.js"].sort());
  assert.ok(result.forbidden.includes("packages/core-harness/src/harness.js"), "a write under packages/core-harness is rejected");
});
