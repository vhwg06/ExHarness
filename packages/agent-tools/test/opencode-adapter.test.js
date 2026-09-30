import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AGENT_TOOLS,
  AgentTaskStatus,
  AttemptOutcome,
  InvocationStatus,
  PermissionProfile,
  UsageUnavailableReason,
  createRedactor,
  createRunTraceWriter,
  defineAgentTool,
  opencodeTool,
  parseOpencodeJsonl,
  parseToolOutput,
  readTraces,
  runAgentInvocation,
  runObservedInvocation,
  runSupervisedTask
} from "../src/index.js";
import { redactArgv } from "../src/run-trace.js";
import { auditPaths } from "./scope-audit.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const FAKE_OPENCODE = join(here, "fixtures", "fake-opencode.mjs");
const OPENCODE_USAGE = join(here, "fixtures", "opencode-usage.jsonl");
const OPENCODE_NO_USAGE = join(here, "fixtures", "opencode-no-usage.jsonl");
const BIN = join(here, "..", "bin", "exharness-agent.mjs");
const REPO_ROOT = join(here, "..", "..", "..");
const T = { timeout: 60000 };
const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const opencodeFake = () => defineAgentTool(opencodeTool, { command: process.execPath, prefixArgs: [FAKE_OPENCODE] });
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
  const root = tempDir("bb122-source-");
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

// ---------------------------------------------------------------- OC1 adapter argv

test("OC1 opencode is registered beside the delivered tools with a version probe", T, () => {
  assert.equal(AGENT_TOOLS.opencode, opencodeTool);
  assert.equal(opencodeTool.id, "opencode");
  assert.equal(opencodeTool.command, "opencode");
  assert.deepEqual(opencodeTool.prefixArgs, []);
  assert.deepEqual(opencodeTool.versionArgs, ["--version"]);
});

test("OC1 WORKSPACE_EDIT does not pass --auto", T, () => {
  const { args, stdin } = opencodeTool.buildInvocation({ prompt: "fix sum", resume: null, permissionProfile: PermissionProfile.WORKSPACE_EDIT });
  assert.equal(args.includes("--auto"), false, "WORKSPACE_EDIT must not pass --auto");
  assert.deepEqual(args.slice(0, 3), ["run", "--format", "json"]);
  assert.equal(args.at(-1), "fix sum");
  assert.equal(stdin, null);
});

test("OC1 FULL_AUTO passes --auto", T, () => {
  const { args, stdin } = opencodeTool.buildInvocation({ prompt: "fix sum", resume: null, permissionProfile: PermissionProfile.FULL_AUTO });
  assert.ok(args.includes("--auto"), "FULL_AUTO passes --auto");
  assert.deepEqual(args, ["run", "--format", "json", "--auto", "--", "fix sum"]);
  assert.equal(stdin, null);
});

test("OC1 opencode passes --dir and --model optionally and ignores extra fields", T, () => {
  assert.deepEqual(
    opencodeTool.buildInvocation({ prompt: "p", resume: null, permissionProfile: PermissionProfile.WORKSPACE_EDIT, cwd: "/work", model: "m1", logFile: "/tmp/x.log", timeoutMs: 99 }).args,
    ["run", "--format", "json", "--dir", "/work", "--model", "m1", "--", "p"]
  );
  assert.deepEqual(
    opencodeTool.buildInvocation({ prompt: "p", resume: null, permissionProfile: PermissionProfile.WORKSPACE_EDIT }).args,
    ["run", "--format", "json", "--", "p"]
  );
  assert.deepEqual(
    opencodeTool.buildInvocation({ prompt: "p", resume: null, permissionProfile: PermissionProfile.WORKSPACE_EDIT, cwd: "" }).args,
    ["run", "--format", "json", "--", "p"]
  );
});

test("OC1 opencode resume uses --session with an id and --continue without one", T, () => {
  const base = { prompt: "again", permissionProfile: PermissionProfile.WORKSPACE_EDIT };
  assert.deepEqual(opencodeTool.buildInvocation({ ...base, resume: { sessionRef: "sess-1" } }).args,
    ["run", "--format", "json", "--session", "sess-1", "--", "again"]);
  assert.ok(opencodeTool.buildInvocation({ ...base, resume: { sessionRef: null } }).args.includes("--continue"));
  assert.ok(opencodeTool.buildInvocation({ ...base, resume: {} }).args.includes("--continue"));
  const fresh = opencodeTool.buildInvocation({ ...base, resume: null }).args;
  assert.equal(fresh.includes("--continue"), false);
  assert.equal(fresh.includes("--session"), false);
  assert.deepEqual(fresh, ["run", "--format", "json", "--", "again"]);
});

test("OC1 opencode launch through runAgentInvocation records the exact headless argv", T, async () => {
  const dir = tempDir("bb122-argv-");
  try {
    const record = join(dir, "record.json");
    const request = { prompt: "Fix sum in sum.mjs.", resume: null, permissionProfile: PermissionProfile.WORKSPACE_EDIT, logFile: join(dir, "extra.log") };
    const run = await runAgentInvocation(opencodeFake(), request, { cwd: dir, env: { FAKE_AGENT_SCENARIO: "CLAIM_SUCCESS_NO_EDIT", FAKE_AGENT_RECORD: record }, timeoutMs: 20000 });
    assert.equal(run.status, InvocationStatus.COMPLETED);
    assert.equal(run.exitCode, 0);
    const [seen] = readRecords(record);
    const expected = opencodeTool.buildInvocation({ ...request, timeoutMs: 20000, cwd: dir });
    assert.deepEqual(seen.argv, expected.args, "opencode argv is exact");
    assert.equal(seen.argv[0], "run");
    assert.ok(seen.argv.includes("--format") && seen.argv.includes("json"));
    assert.equal(seen.argv[seen.argv.indexOf("--dir") + 1], dir);
    assert.equal(seen.argv.at(-1), request.prompt, "the prompt is the positional message");
    assert.equal(seen.argv.some((word) => word === "--prompt"), false, "no top-level --prompt is passed");
    assert.equal(seen.stdin, "", "stdin is null");
    assert.equal(seen.argv[seen.argv.indexOf("--") + 1], request.prompt, "the prompt follows the -- separator");
    const flagLike = opencodeTool.buildInvocation({ prompt: "--help me fix", resume: null, permissionProfile: PermissionProfile.WORKSPACE_EDIT }).args;
    assert.deepEqual(flagLike.slice(-2), ["--", "--help me fix"], "a prompt starting with - stays positional");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- OC2 parser and traces

test("OC2 parseOpencodeJsonl reports observed tokens and cost from the usage fixture", T, () => {
  const parsed = parseOpencodeJsonl(readFileSync(OPENCODE_USAGE, "utf8"));
  assert.deepEqual(parsed.usage, {
    inputTokens: 3000,
    cachedInputTokens: 500,
    outputTokens: 120,
    reasoningOutputTokens: 30,
    source: "opencode.step_finish",
    unavailableReason: null,
    totalCostUsd: 0.375
  });
  assert.deepEqual(parsed.toolEvents, {
    counts: { step_finish: 2, step_start: 2, text: 2 },
    invalidLines: 1
  });
  const viaDispatch = parseToolOutput("opencode", { status: "COMPLETED", stdout: readFileSync(OPENCODE_USAGE, "utf8") });
  assert.equal(viaDispatch.usage.inputTokens, 3000);
  assert.equal(viaDispatch.usage.totalCostUsd, 0.375);
});

test("OC2 usage-free opencode JSONL is null with OPENCODE_USAGE_NOT_REPORTED", T, () => {
  const parsed = parseOpencodeJsonl(readFileSync(OPENCODE_NO_USAGE, "utf8"));
  for (const field of ["inputTokens", "cachedInputTokens", "outputTokens", "reasoningOutputTokens", "totalCostUsd"]) {
    assert.equal(parsed.usage[field], null, `${field} is null, not zero`);
  }
  assert.equal(parsed.usage.unavailableReason, UsageUnavailableReason.OPENCODE_USAGE_NOT_REPORTED);
  assert.equal(parsed.usage.source, "opencode.step_finish");
  assert.equal(parseOpencodeJsonl("").usage.unavailableReason, UsageUnavailableReason.OPENCODE_USAGE_NOT_REPORTED);
  assert.equal(parseOpencodeJsonl("not json at all").usage.unavailableReason, UsageUnavailableReason.OPENCODE_USAGE_NOT_REPORTED);
  const truncated = parseOpencodeJsonl('{"type":"step_start"}', { truncated: true });
  assert.equal(truncated.usage.unavailableReason, UsageUnavailableReason.OPENCODE_JSONL_TRUNCATED);
  for (const field of ["inputTokens", "outputTokens"]) assert.equal(truncated.usage[field], null, field);
  assert.equal(parseOpencodeJsonl('{"type":"step_finish","part":{"tokens":{"input":0,"output":0}}}').usage.inputTokens, 0, "zero is observed");
});

test("OC2 argvRedacted does not contain the prompt", T, async () => {
  const { root, base } = sourceRepository();
  const dir = tempDir("bb122-traces-");
  const prompt = "Fix sum in sum.mjs with an opencode prompt that must stay out of argv.";
  try {
    const writer = createRunTraceWriter({ dir });
    const { trace } = await runObservedInvocation({
      tool: opencodeFake(), request: { prompt }, cwd: root, env: { FAKE_AGENT_SCENARIO: "FIX_FIRST" },
      timeoutMs: 30000, baseRevision: base, taskId: "task-1", arm: "DIRECT_OPENCODE", writer
    });
    assert.equal(trace.promptSha256, sha256(prompt));
    const joined = trace.argvRedacted.join("\n");
    assert.equal(joined.includes(prompt), false, "argvRedacted never stores the prompt verbatim");
    assert.match(joined, /<prompt sha256=[0-9a-f]{64} chars=\d+>/);
    const redactor = createRedactor({ env: {} });
    const directArgv = redactArgv(opencodeTool, { prompt, resume: null, permissionProfile: PermissionProfile.WORKSPACE_EDIT, cwd: root }, 30000, redactor);
    assert.equal(directArgv.join("\n").includes(prompt), false, "redactArgv never stores the prompt verbatim");
    assert.deepEqual(readTraces(dir).length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

test("OC2 opencode usage is partial-safe and other tools keep six fields", T, () => {
  const partial = parseOpencodeJsonl('{"type":"step_finish","part":{"type":"step-finish","tokens":{"input":5,"output":6},"cost":"n/a"}}\n{"type":"step_finish","part":{"type":"step-finish","tokens":{"input":7,"output":8,"reasoning":3,"cache":{"read":1,"write":0}},"cost":0.5}}\n');
  assert.deepEqual([partial.usage.inputTokens, partial.usage.outputTokens], [12, 14]);
  assert.equal(partial.usage.reasoningOutputTokens, null, "reasoning stays null unless every counted event reported it");
  assert.equal(partial.usage.cachedInputTokens, null, "cache.read stays null unless every counted event reported it");
  assert.equal(partial.usage.totalCostUsd, null, "cost stays null unless every counted event reported a finite non-negative number");
  assert.equal(partial.usage.unavailableReason, null);
  for (const id of ["codex", "kiro", "agy"]) {
    const usage = parseToolOutput(id, { status: "COMPLETED", stdout: "" }).usage;
    assert.deepEqual(Object.keys(usage).sort(), ["cachedInputTokens", "inputTokens", "outputTokens", "reasoningOutputTokens", "source", "unavailableReason"], `${id} usage stays six fields`);
  }
  assert.equal(parseToolOutput("opencode", { status: "TOOL_UNAVAILABLE" }).usage.unavailableReason, UsageUnavailableReason.TOOL_UNAVAILABLE);
  assert.equal(parseToolOutput("opencode", { status: "COMPLETED", timedOut: true, stdout: "" }).usage.unavailableReason, UsageUnavailableReason.TIMED_OUT);
});

test("OC2 opencode cost is null unless every counted step reports a finite non-negative number", T, () => {
  const step = (costJson) => `{"type":"step_finish","sessionID":"s","part":{"type":"step-finish","tokens":{"input":10,"output":4},"cost":${costJson}}}`;
  for (const costJson of ["null", '""', "true", '"0.5"', "-1"]) {
    const parsed = parseOpencodeJsonl(`${step(costJson)}\n`);
    assert.equal(parsed.usage.totalCostUsd, null, `cost ${costJson} is unreported, never coerced`);
    assert.deepEqual([parsed.usage.inputTokens, parsed.usage.outputTokens], [10, 4], `tokens are still reported for cost ${costJson}`);
    assert.equal(parsed.usage.unavailableReason, null);
  }
  const mixed = parseOpencodeJsonl(`${step("0.25")}\n{"type":"step_finish","sessionID":"s","part":{"type":"step-finish","tokens":{"input":6,"output":2}}}\n`);
  assert.deepEqual([mixed.usage.inputTokens, mixed.usage.outputTokens], [16, 6]);
  assert.equal(mixed.usage.totalCostUsd, null, "one step without cost nulls the total");
  const zero = parseOpencodeJsonl(`${step("0")}\n${step("0")}\n`);
  assert.equal(zero.usage.totalCostUsd, 0, "an explicit 0 on all steps is 0, not null");
  assert.deepEqual([zero.usage.inputTokens, zero.usage.outputTokens], [20, 8]);
});

test("OC2 opencode parseResult reports sessionRef and the last text part", T, () => {
  const parsed = opencodeTool.parseResult({ exitCode: 0, stdout: readFileSync(OPENCODE_USAGE, "utf8"), stderr: "" });
  assert.deepEqual(parsed, { claimedSuccess: true, finalMessage: "Fixed sum.", sessionRef: "sess-1" });
  assert.equal(opencodeTool.parseResult({ exitCode: 1, stdout: readFileSync(OPENCODE_USAGE, "utf8"), stderr: "" }).claimedSuccess, false);
  const noSession = opencodeTool.parseResult({ exitCode: 0, stdout: "plain tail text\n", stderr: "" });
  assert.equal(noSession.sessionRef, null);
  assert.equal(noSession.finalMessage, "plain tail text");
});

// ---------------------------------------------------------------- OC3 arms and CLI

test("OC3 the same opencode adapter serves direct and supervised arms", T, async () => {
  const { root, base } = sourceRepository();
  const dir = tempDir("bb122-traces-");
  const record = join(tempDir("bb122-records-"), "record.json");
  try {
    const writer = createRunTraceWriter({ dir });
    const direct = await runObservedInvocation({
      tool: opencodeFake(), request: { prompt: "Fix sum." }, cwd: root,
      env: { FAKE_AGENT_SCENARIO: "FIX_FIRST", FAKE_AGENT_RECORD: record },
      timeoutMs: 30000, baseRevision: base, taskId: "task-1", arm: "DIRECT_OPENCODE", writer
    });
    assert.equal(direct.invocation.status, InvocationStatus.COMPLETED);
    assert.equal(direct.trace.tool, "opencode");
    assert.equal(direct.trace.usage.inputTokens, 1201);
    assert.equal(direct.trace.usage.totalCostUsd, 0.0015);
    const [seen] = readRecords(record);
    assert.ok(seen.argv.includes("--dir") && seen.argv[seen.argv.indexOf("--dir") + 1] === root, "direct run passes --dir");
    assert.equal(seen.argv.at(-1), "Fix sum.");

    const supervised = await runSupervisedTask({
      tool: opencodeFake(), task: taskFor(root, base), maxAttempts: 2, timeoutMs: 30000,
      env: { FAKE_AGENT_SCENARIO: "FIX_FIRST" }
    });
    assert.equal(supervised.status, AgentTaskStatus.ACCEPTED);
    assert.equal(supervised.tool, "opencode");
    assert.equal(supervised.attempts[0].outcome, AttemptOutcome.CANDIDATE_CREATED);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
    rmSync(dirname(record), { recursive: true, force: true });
  }
});

test("OC3 supervised retry resumes the opencode session", T, async () => {
  const { root, base } = sourceRepository();
  const scratch = tempDir("bb122-records-");
  const record = join(scratch, "record.json");
  try {
    const result = await runSupervisedTask({
      tool: opencodeFake(), task: taskFor(root, base), maxAttempts: 3, timeoutMs: 30000,
      env: { FAKE_AGENT_SCENARIO: "FIX_AFTER_FEEDBACK", FAKE_AGENT_RECORD: record }
    });
    assert.equal(result.status, AgentTaskStatus.ACCEPTED);
    const records = readRecords(record);
    assert.equal(records.length, 2);
    assert.deepEqual(records[1].argv.slice(0, 3), ["run", "--format", "json"]);
    assert.ok(records[1].argv.includes("--session"), "retry resumes with --session");
    assert.equal(records[1].argv[records[1].argv.indexOf("--session") + 1], "fake-opencode-1");
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("OC3 exharness-agent probe and smoke accept opencode", T, async () => {
  const empty = tempDir("bb122-empty-path-");
  try {
    const probe = await runBin(["probe"], { PATH: empty, Path: empty });
    assert.equal(probe.code, 0, probe.stderr);
    assert.deepEqual(probe.json.tools.opencode, { installed: false, version: null });
    assert.deepEqual(Object.keys(probe.json.tools).sort(), ["agy", "codex", "grok", "kiro", "opencode"]);
    const notInstalled = await runBin(["smoke", "--tool", "opencode"], { PATH: empty, Path: empty });
    assert.equal(notInstalled.code, 0);
    assert.deepEqual([notInstalled.json.smoke, notInstalled.json.reason], ["SKIPPED", "NOT_INSTALLED"]);
    const unauthenticated = await runBin(["smoke", "--tool", "opencode", "--command", FAKE_OPENCODE, "--timeout-ms", "20000"], { FAKE_AGENT_SCENARIO: "AUTH_FAIL" });
    assert.deepEqual([unauthenticated.json.smoke, unauthenticated.json.reason], ["SKIPPED", "TOOL_FAILED_BEFORE_EDIT"]);
    assert.notEqual(unauthenticated.json.result.status, AgentTaskStatus.ACCEPTED);
    const never = await runBin(["smoke", "--tool", "opencode", "--command", FAKE_OPENCODE, "--timeout-ms", "20000"], { FAKE_AGENT_SCENARIO: "NEVER_FIX" });
    assert.equal(never.json.smoke, AgentTaskStatus.EXHAUSTED);
    assert.equal(never.code, 1);
    const fixed = await runBin(["smoke", "--tool", "opencode", "--command", FAKE_OPENCODE, "--timeout-ms", "20000"], { FAKE_AGENT_SCENARIO: "FIX_FIRST" });
    assert.equal(fixed.json.smoke, AgentTaskStatus.ACCEPTED);
    assert.equal(fixed.json.result.attempts.at(-1).verification[0].status, "PASS");
    const usage = await runBin(["smoke", "--tool", "cursor"]);
    assert.equal(usage.code, 64);
    assert.match(usage.stderr, /unknown --tool/);
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});

test("OC3 npm test does not run live opencode smoke", T, () => {
  const scripts = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")).scripts;
  for (const name of ["test", "verify"]) assert.doesNotMatch(scripts[name], /smoke:agent-tools|exharness-agent\.mjs smoke/, `${name} runs no live agent`);
  assert.equal(scripts["smoke:agent-tools"], "node packages/agent-tools/bin/exharness-agent.mjs smoke");
  assert.match(readFileSync(BIN, "utf8"), /codex\|kiro\|agy\|grok\|opencode/);
  const { args, stdin } = opencodeTool.buildInvocation({ prompt: "routine check", resume: null, permissionProfile: PermissionProfile.WORKSPACE_EDIT, cwd: tmpdir() });
  assert.equal(args.includes("smoke"), false, "opencode argv never triggers a live smoke run");
  assert.equal(args.some((word) => word.includes("exharness-agent")), false, "opencode argv never shells out to the agent CLI");
  assert.equal(stdin, null);
});

// ---------------------------------------------------------------- OC4 fake CLI and missing binary

test("OC4 fake opencode covers FIX_FIRST with JSONL usage", T, async () => {
  const version = spawnSync(process.execPath, [FAKE_OPENCODE, "--version"], { encoding: "utf8" });
  assert.equal(version.status, 0);
  assert.match(version.stdout.trim(), /^fake-opencode 0\.0\.0$/);
  const dir = tempDir("bb122-fake-");
  try {
    const record = join(dir, "record.json");
    const run = await runAgentInvocation(opencodeFake(), { prompt: "Fix sum.", resume: null }, {
      cwd: dir, env: { FAKE_AGENT_SCENARIO: "FIX_FIRST", FAKE_AGENT_RECORD: record }, timeoutMs: 20000
    });
    assert.equal(run.status, InvocationStatus.COMPLETED);
    assert.equal(run.exitCode, 0);
    const lines = run.stdout.split("\n").filter(Boolean);
    assert.equal(lines.length, 3);
    const finishEvent = JSON.parse(lines[2]);
    assert.equal(finishEvent.type, "step_finish");
    assert.equal(finishEvent.sessionID, "fake-opencode-1");
    assert.ok(Number.isInteger(finishEvent.part.tokens.input) && Number.isInteger(finishEvent.part.tokens.output));
    assert.ok(Number.isFinite(finishEvent.part.cost));
    const parsed = opencodeTool.parseResult(run);
    assert.deepEqual({ claimedSuccess: parsed.claimedSuccess, sessionRef: parsed.sessionRef }, { claimedSuccess: true, sessionRef: "fake-opencode-1" });
    assert.equal(parsed.finalMessage, "Fixed sum.");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("OC4 missing opencode executable is TOOL_UNAVAILABLE", T, async () => {
  const dir = tempDir("bb122-missing-");
  try {
    const missing = await runAgentInvocation(
      defineAgentTool(opencodeTool, { command: join(dir, "no-such-opencode") }),
      { prompt: "p", resume: null },
      { cwd: dir, timeoutMs: 5000 }
    );
    assert.equal(missing.status, InvocationStatus.TOOL_UNAVAILABLE);
    assert.equal(missing.exitCode, null);
    assert.equal(missing.timedOut, false);
    assert.notEqual(missing.status, AgentTaskStatus.ACCEPTED, "a missing tool is never ACCEPTED");
    const { root, base } = sourceRepository();
    try {
      const result = await runSupervisedTask({
        tool: defineAgentTool(opencodeTool, { command: join(dir, "no-such-opencode") }),
        task: taskFor(root, base), maxAttempts: 2, timeoutMs: 5000
      });
      assert.equal(result.status, AgentTaskStatus.TOOL_UNAVAILABLE);
      assert.equal(result.acceptedSha, null);
      assert.notEqual(result.status, AgentTaskStatus.ACCEPTED, "a missing tool is never ACCEPTED");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- OC5 docs and scope

test("OC5 living docs and README list opencode without work ids", T, () => {
  const state = readFileSync(join(REPO_ROOT, "docs", "living", "system", "agent-tools", "state.md"), "utf8");
  const observation = readFileSync(join(REPO_ROOT, "docs", "living", "system", "agent-tools", "observation.md"), "utf8");
  const system = readFileSync(join(REPO_ROOT, "docs", "living", "system", "state.md"), "utf8");
  const readme = readFileSync(join(REPO_ROOT, "packages", "agent-tools", "README.md"), "utf8");
  for (const [name, doc] of [["state.md", state], ["observation.md", observation], ["system state.md", system], ["README", readme]]) {
    assert.ok(doc.includes("opencode"), `${name} names opencode`);
    assert.doesNotMatch(doc, /BB-\d+/, `${name} carries no work id`);
  }
  assert.match(state, /run --format json/);
  assert.match(observation, /OPENCODE_USAGE_NOT_REPORTED/);
});

test("OC5 write scope excludes core-harness", T, () => {
  const plan = JSON.parse(readFileSync(join(REPO_ROOT, "docs", "blackboard", "artifacts", "ready-implement-plan", "BB-122.json"), "utf8"));
  const result = auditPaths(
    ["packages/agent-tools/src/tool-adapters.js", "packages/core-harness/src/harness.js", "docs/blackboard/work-graph.json"],
    plan.sourceScope
  );
  assert.deepEqual(result.allowed, ["packages/agent-tools/src/tool-adapters.js"]);
  assert.deepEqual(result.forbidden.sort(), ["docs/blackboard/work-graph.json", "packages/core-harness/src/harness.js"].sort());
  assert.ok(result.forbidden.includes("packages/core-harness/src/harness.js"), "a write under packages/core-harness is rejected");
});
