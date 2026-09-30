import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AgentTaskStatus,
  DeliverSliceStatus,
  LOCAL_SLICE_CLAIM_BOUNDARY,
  RecoveryError,
  codexTool,
  commandDeliver,
  defineAgentTool,
  readAgentToolRunHandle,
  runDeliverSlice,
  runSliceQa,
  runSupervisedTask
} from "../src/index.js";
import { auditPaths } from "./scope-audit.mjs";
import { createLocalGitWorkspace } from "../../agentic-system/src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const FAKE = join(here, "fixtures", "fake-agent.mjs");
const CRASH = join(here, "fixtures", "crash-deliver-slice.mjs");
const BIN = join(here, "..", "bin", "exharness-agent.mjs");
const REPO_ROOT = join(here, "..", "..", "..");
const T = { timeout: 120000 };
const PLAN = JSON.parse(readFileSync(join(REPO_ROOT, "docs", "blackboard", "artifacts", "ready-implement-plan", "BB-104.json"), "utf8"));

const fakeTool = (base) => defineAgentTool(base, { command: process.execPath, prefixArgs: [FAKE] });
const tempDir = (prefix) => mkdtempSync(join(tmpdir(), prefix));

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
  const root = tempDir("bb104-source-");
  git(root, "init", "-q");
  git(root, "checkout", "-q", "-b", "main");
  writeFileSync(join(root, "sum.mjs"), "export const sum = (a, b) => a - b;\n");
  writeFileSync(join(root, "sum.test.mjs"), 'import test from "node:test";\nimport assert from "node:assert/strict";\nimport { sum } from "./sum.mjs";\ntest("sum adds", () => { assert.equal(sum(2, 3), 5); });\n');
  git(root, "add", "-A");
  git(root, "-c", "commit.gpgsign=false", "commit", "-q", "-m", "failing sum");
  return { root, base: git(root, "rev-parse", "HEAD") };
}

function repositorySnapshot(root) {
  return {
    head: git(root, "rev-parse", "HEAD"),
    symbolic: git(root, "symbolic-ref", "HEAD"),
    refs: git(root, "for-each-ref", "--format=%(refname) %(objectname)", "refs/heads"),
    status: git(root, "status", "--porcelain", "--untracked-files=all"),
    worktrees: git(root, "worktree", "list", "--porcelain").split("\n").filter((line) => line.startsWith("worktree ")).length
  };
}

function sliceFor(root, base, extra = {}) {
  return {
    id: "slice-1",
    repositoryRoot: root,
    baseRevision: base,
    prompt: "Fix sum in sum.mjs so that sum(a, b) returns a + b.",
    tool: "codex",
    backendVerifications: [{ name: "unit", command: process.execPath, args: ["--test", "sum.test.mjs"], timeoutMs: 30000 }],
    qaVerifications: [{ name: "qa-unit", command: process.execPath, args: ["--test", "sum.test.mjs"], timeoutMs: 30000 }],
    ...extra
  };
}

function runBin(args, env = {}) {
  return new Promise((resolvePromise) => {
    const { NODE_TEST_CONTEXT, ...inherited } = process.env;
    const child = spawn(process.execPath, [BIN, ...args], { shell: false, env: { ...inherited, ...env } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolvePromise({ code, stdout, stderr, json: (() => { try { return JSON.parse(stdout); } catch { return null; } })() }));
  });
}

function crashDeliverRun({ slicePath, recoveryDir, scenario = "FIX_FIRST" }) {
  return new Promise((resolvePromise) => {
    const { NODE_TEST_CONTEXT, ...inherited } = process.env;
    const child = spawn(process.execPath, [CRASH], {
      shell: false,
      env: { ...inherited, DELIVER_SLICE_JSON: slicePath, DELIVER_RECOVERY_DIR: recoveryDir, DELIVER_SCENARIO: scenario }
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolvePromise({ code, stdout, stderr }));
  });
}

// ---------------------------------------------------------------- DL1 manifest + CLI

test("DL1 deliver without slice is usage error", T, async () => {
  const scratch = tempDir("bb104-dl1-usage-");
  try {
    await assert.rejects(commandDeliver({}), /--slice/);
    await assert.rejects(commandDeliver({ slice: null }), /--slice/);
    assert.deepEqual(readdirSync(scratch), [], "no agent artifact is spawned without --slice");
    const cli = await runBin(["deliver"]);
    assert.equal(cli.code, 64);
    assert.match(cli.stderr, /--slice/);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("DL1 deliver runs Backend then QA through runSupervisedTask", T, async () => {
  const { root, base } = sourceRepository();
  const scratch = tempDir("bb104-dl1-");
  try {
    const before = repositorySnapshot(root);
    const slicePath = join(scratch, "slice.json");
    writeFileSync(slicePath, JSON.stringify(sliceFor(root, base)));
    const result = await commandDeliver({ slice: slicePath, command: FAKE, env: { FAKE_AGENT_SCENARIO: "FIX_FIRST" } });
    assert.equal(result.status, DeliverSliceStatus.ACCEPTED);
    assert.match(result.backendSha, /^[0-9a-f]{40}$/);
    assert.ok(Array.isArray(result.qa) && result.qa.length === 1, "independent QA ran after Backend");
    assert.equal(result.qa[0].status, "PASS");
    assert.equal(result.backend.status, AgentTaskStatus.ACCEPTED, "Backend ran through runSupervisedTask");
    assert.equal(result.backend.acceptedSha, result.backendSha, "QA is bound to the accepted Backend sha");
    assert.equal(result.claimBoundary, LOCAL_SLICE_CLAIM_BOUNDARY);
    assert.deepEqual(repositorySnapshot(root), before, "the source repository is preserved");
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("DL1 deliver rejects bad manifests with usage exit 64", T, async () => {
  const { root, base } = sourceRepository();
  const scratch = tempDir("bb104-dl1-bad-");
  try {
    const record = join(scratch, "record.json");
    const env = { FAKE_AGENT_RECORD: record, FAKE_AGENT_SCENARIO: "FIX_FIRST" };
    const missing = await runBin(["deliver", "--slice", join(scratch, "no-such.json")], env);
    assert.equal(missing.code, 64);
    assert.match(missing.stderr, /deliver cannot read slice manifest/);
    const badJson = join(scratch, "bad.json");
    writeFileSync(badJson, "{ not json");
    const invalid = await runBin(["deliver", "--slice", badJson], env);
    assert.equal(invalid.code, 64);
    assert.match(invalid.stderr, /deliver cannot read slice manifest/);
    const badTool = join(scratch, "bad-tool.json");
    writeFileSync(badTool, JSON.stringify(sliceFor(root, base, { tool: "nope" })));
    const wrong = await runBin(["deliver", "--slice", badTool], env);
    assert.equal(wrong.code, 64);
    assert.match(wrong.stderr, /DELIVER_SLICE_V1 invalid/);
    for (const out of [missing, invalid, wrong]) {
      assert.equal(out.stdout, "", "a bad manifest prints no result");
      assert.doesNotMatch(out.stdout, /ACCEPTED/);
      assert.doesNotMatch(out.stderr, /^\s+at /m, "usage errors print no stack trace");
    }
    assert.equal(existsSync(record), false, "no agent was spawned for a bad manifest");
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- DL2 Backend then QA

test("DL2 QA mutation fails the slice", T, async () => {
  const { root, base } = sourceRepository();
  try {
    const before = repositorySnapshot(root);
    const slice = sliceFor(root, base, {
      qaVerifications: [{ name: "qa-mutate", command: process.execPath, args: ["-e", "require('fs').writeFileSync('mutated.txt','x')"], timeoutMs: 30000 }]
    });
    const result = await runDeliverSlice(slice, { tool: fakeTool(codexTool), env: { FAKE_AGENT_SCENARIO: "FIX_FIRST" } });
    assert.equal(result.status, DeliverSliceStatus.QA_FAILED);
    assert.notEqual(result.status, DeliverSliceStatus.ACCEPTED, "a mutating QA is never ACCEPTED");
    assert.match(result.backendSha, /^[0-9a-f]{40}$/, "the Backend sha is recorded");
    assert.match(result.qa.map((entry) => entry.reason).join(","), /TREE_MUTATED/);
    assert.equal(result.reason, "TREE_MUTATED");
    assert.equal(result.claimBoundary, LOCAL_SLICE_CLAIM_BOUNDARY);
    assert.deepEqual(repositorySnapshot(root), before, "the source repository is preserved");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("DL2 QA on a different revision fails", T, async () => {
  const { root, base } = sourceRepository();
  const scratch = tempDir("bb104-dl2-rev-");
  let workspace = null;
  try {
    workspace = await createLocalGitWorkspace({ repositoryRoot: root, baseRevision: base, worktreeRoot: join(scratch, "worktree") });
    const wrong = "a".repeat(40);
    assert.notEqual(wrong, base, "the QA revision differs from the checkout");
    const out = await runSliceQa({
      workspaceRoot: workspace.root,
      acceptedSha: wrong,
      qaVerifications: [{ name: "qa-unit", command: process.execPath, args: ["--test", "sum.test.mjs"], timeoutMs: 30000 }],
      sliceId: "slice-1"
    });
    assert.equal(out.passed, false);
    assert.match(out.qa.map((entry) => entry.reason).join(","), /REVISION_MISMATCH/);
    assert.equal(out.reason, "REVISION_MISMATCH");
  } finally {
    if (workspace) await workspace.dispose();
    rmSync(root, { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- DL3 resume

test("DL3 crash resume continues QA on the same accepted sha", T, async () => {
  const { root, base } = sourceRepository();
  const scratch = tempDir("bb104-dl3-");
  const recoveryDir = join(scratch, "recovery");
  const slicePath = join(scratch, "slice.json");
  writeFileSync(slicePath, JSON.stringify(sliceFor(root, base)));
  try {
    const before = repositorySnapshot(root);
    const crashed = await crashDeliverRun({ slicePath, recoveryDir });
    assert.equal(crashed.code, 97, `crash fixture exits 97, stderr: ${crashed.stderr}`);
    const handle = await readAgentToolRunHandle(recoveryDir);
    assert.equal(handle.phase, "ACT_COMPLETED");
    assert.equal(handle.status, "RUNNING");
    assert.equal(handle.attemptIndex, 1);
    const result = await runDeliverSlice(JSON.parse(readFileSync(slicePath, "utf8")), {
      tool: fakeTool(codexTool),
      recoveryDir,
      env: { FAKE_AGENT_SCENARIO: "FIX_FIRST" }
    });
    assert.equal(result.status, DeliverSliceStatus.ACCEPTED);
    assert.equal(result.backendSha, handle.candidateSha, "resume continues QA on the same accepted sha");
    assert.ok(result.qa.every((entry) => entry.status === "PASS"));
    assert.equal(result.claimBoundary, LOCAL_SLICE_CLAIM_BOUNDARY);
    assert.equal(existsSync(recoveryDir), false, "a terminal slice disposes the recovery dir");
    assert.deepEqual(repositorySnapshot(root), before, "the source repository is preserved");
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("DL3 accepted handle skips Backend and runs QA", T, async () => {
  const { root, base } = sourceRepository();
  const scratch = tempDir("bb104-dl3-acc-");
  const recoveryDir = join(scratch, "recovery");
  const record = join(scratch, "record.json");
  try {
    const backendTask = {
      id: "slice-1",
      repositoryRoot: root,
      baseRevision: base,
      prompt: "Fix sum in sum.mjs so that sum(a, b) returns a + b.",
      verifications: [{ name: "unit", command: process.execPath, args: ["--test", "sum.test.mjs"], timeoutMs: 30000 }]
    };
    const first = await runSupervisedTask({
      tool: fakeTool(codexTool),
      task: backendTask,
      maxAttempts: 1,
      timeoutMs: 30000,
      recoveryDir,
      env: { FAKE_AGENT_SCENARIO: "FIX_FIRST", FAKE_AGENT_RECORD: record }
    });
    assert.equal(first.status, AgentTaskStatus.ACCEPTED);
    const handle = await readAgentToolRunHandle(recoveryDir);
    assert.equal(handle.status, "ACCEPTED");
    const spawnsBefore = JSON.parse(readFileSync(record, "utf8")).length;
    const result = await runDeliverSlice(sliceFor(root, base), {
      tool: fakeTool(codexTool),
      recoveryDir,
      env: { FAKE_AGENT_SCENARIO: "FIX_FIRST", FAKE_AGENT_RECORD: record }
    });
    assert.equal(result.status, DeliverSliceStatus.ACCEPTED);
    assert.equal(result.backendSha, handle.candidateSha, "QA runs on the accepted handle candidate");
    assert.equal(result.backend, null, "an ACCEPTED handle skips Backend (HANDLE_COMPLETE)");
    assert.equal(JSON.parse(readFileSync(record, "utf8")).length, spawnsBefore, "no new agent process started");
    assert.equal(result.claimBoundary, LOCAL_SLICE_CLAIM_BOUNDARY);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true });
  }
});

function backendTaskFor(root, base) {
  return {
    id: "slice-1",
    repositoryRoot: root,
    baseRevision: base,
    prompt: "Fix sum in sum.mjs so that sum(a, b) returns a + b.",
    verifications: [{ name: "unit", command: process.execPath, args: ["--test", "sum.test.mjs"], timeoutMs: 30000 }]
  };
}

test("DL3 mismatched EXHAUSTED handle is refused and left untouched", T, async () => {
  const { root, base } = sourceRepository();
  const scratch = tempDir("bb104-dl3-mismatch-exh-");
  const recoveryDir = join(scratch, "recovery");
  try {
    const first = await runSupervisedTask({
      tool: fakeTool(codexTool),
      task: backendTaskFor(root, base),
      maxAttempts: 1,
      timeoutMs: 30000,
      recoveryDir,
      env: { FAKE_AGENT_SCENARIO: "NEVER_FIX" }
    });
    assert.equal(first.status, AgentTaskStatus.EXHAUSTED);
    const handle = await readAgentToolRunHandle(recoveryDir);
    assert.equal(handle.status, "EXHAUSTED");
    const beforeBytes = readFileSync(join(recoveryDir, "handle.json"), "utf8");
    await assert.rejects(
      runDeliverSlice(sliceFor(root, base, { id: "other-slice" }), {
        tool: fakeTool(codexTool),
        recoveryDir,
        env: { FAKE_AGENT_SCENARIO: "FIX_FIRST" }
      }),
      (error) => error instanceof RecoveryError && error.code === "HANDLE_INVALID" && /recovery handle/.test(error.message)
    );
    assert.equal(existsSync(recoveryDir), true, "the foreign recovery dir is left untouched");
    assert.equal(readFileSync(join(recoveryDir, "handle.json"), "utf8"), beforeBytes, "handle.json is byte-identical afterwards");
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("DL3 mismatched ACCEPTED handle is refused without spawning", T, async () => {
  const { root, base } = sourceRepository();
  const scratch = tempDir("bb104-dl3-mismatch-acc-");
  const recoveryDir = join(scratch, "recovery");
  const record = join(scratch, "record.json");
  try {
    const first = await runSupervisedTask({
      tool: fakeTool(codexTool),
      task: backendTaskFor(root, base),
      maxAttempts: 1,
      timeoutMs: 30000,
      recoveryDir,
      env: { FAKE_AGENT_SCENARIO: "FIX_FIRST", FAKE_AGENT_RECORD: record }
    });
    assert.equal(first.status, AgentTaskStatus.ACCEPTED);
    const handle = await readAgentToolRunHandle(recoveryDir);
    assert.equal(handle.status, "ACCEPTED");
    const beforeBytes = readFileSync(join(recoveryDir, "handle.json"), "utf8");
    const spawnsBefore = JSON.parse(readFileSync(record, "utf8")).length;
    await assert.rejects(
      runDeliverSlice(sliceFor(root, base, { id: "other-slice" }), {
        tool: fakeTool(codexTool),
        recoveryDir,
        env: { FAKE_AGENT_SCENARIO: "FIX_FIRST", FAKE_AGENT_RECORD: record }
      }),
      (error) => error instanceof RecoveryError && error.code === "HANDLE_INVALID" && /recovery handle/.test(error.message)
    );
    assert.equal(JSON.parse(readFileSync(record, "utf8")).length, spawnsBefore, "no agent process spawned");
    assert.equal(existsSync(recoveryDir), true, "the foreign recovery dir is left untouched");
    assert.equal(readFileSync(join(recoveryDir, "handle.json"), "utf8"), beforeBytes, "handle.json is byte-identical afterwards");
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- DL4 unavailable / exhausted

test("DL4 missing tool is not ACCEPTED", T, async () => {
  const { root, base } = sourceRepository();
  const scratch = tempDir("bb104-dl4-missing-");
  try {
    const slicePath = join(scratch, "slice.json");
    writeFileSync(slicePath, JSON.stringify(sliceFor(root, base)));
    const result = await commandDeliver({ slice: slicePath, command: "exharness-no-such-tool-bb104" });
    assert.equal(result.status, DeliverSliceStatus.TOOL_UNAVAILABLE);
    assert.notEqual(result.status, DeliverSliceStatus.ACCEPTED, "a missing tool is never ACCEPTED");
    assert.equal(result.reason, "NOT_INSTALLED");
    assert.equal(result.backendSha, null);
    assert.equal(result.qa, null);
    assert.equal(result.claimBoundary, LOCAL_SLICE_CLAIM_BOUNDARY);
    const cli = await runBin(["deliver", "--slice", slicePath, "--command", join(scratch, "no-such-tool")]);
    assert.equal(cli.code, 2);
    assert.equal(cli.json.status, "TOOL_UNAVAILABLE");
    assert.notEqual(cli.json.status, "ACCEPTED");
    assert.doesNotMatch(cli.stdout, /ACCEPTED/, "TOOL_UNAVAILABLE never prints ACCEPTED");
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("DL4 Backend EXHAUSTED does not run QA", T, async () => {
  const { root, base } = sourceRepository();
  try {
    const result = await runDeliverSlice(sliceFor(root, base), {
      tool: fakeTool(codexTool),
      maxAttempts: 2,
      timeoutMs: 30000,
      env: { FAKE_AGENT_SCENARIO: "NEVER_FIX" }
    });
    assert.equal(result.status, DeliverSliceStatus.EXHAUSTED);
    assert.notEqual(result.status, DeliverSliceStatus.ACCEPTED, "EXHAUSTED is not ACCEPTED");
    assert.equal(result.qa, null, "no QA runs after EXHAUSTED");
    assert.equal(result.backendSha, null);
    assert.equal(result.backend.status, AgentTaskStatus.EXHAUSTED);
    assert.equal(result.reason, "EXHAUSTED");
    assert.equal(result.claimBoundary, LOCAL_SLICE_CLAIM_BOUNDARY);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- DL5 docs, claim, scope

test("DL5 claim boundary is not BB-069", T, async () => {
  const { root, base } = sourceRepository();
  try {
    const result = await runDeliverSlice(sliceFor(root, base), {
      tool: fakeTool(codexTool),
      env: { FAKE_AGENT_SCENARIO: "FIX_FIRST" }
    });
    assert.equal(result.status, DeliverSliceStatus.ACCEPTED);
    assert.equal(result.claimBoundary, LOCAL_SLICE_CLAIM_BOUNDARY);
    assert.equal(result.claimBoundary, "LOCAL_COMPOSITION_SLICE_NOT_BB069_NOT_BB074");
    assert.doesNotMatch(result.claimBoundary, /BB-069/, "the boundary is not the first-slice work id");
    assert.doesNotMatch(result.claimBoundary, /BB-074/);
    assert.match(result.claimBoundary, /NOT_BB069_NOT_BB074/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("DL5 living operator docs omit work ids", T, () => {
  const operator = readFileSync(join(REPO_ROOT, "docs", "living", "system", "agent-tools", "operator.md"), "utf8");
  const state = readFileSync(join(REPO_ROOT, "docs", "living", "system", "agent-tools", "state.md"), "utf8");
  assert.match(operator, /deliver --slice/);
  assert.match(operator, /accepted.*commit/i, "QA is bound to the accepted Backend commit");
  assert.match(operator, /resum/i);
  assert.match(operator, /HANDLE_INVALID/, "a foreign handle is refused and left untouched");
  assert.match(operator, /TOOL_UNAVAILABLE|NOT_INSTALLED/);
  assert.match(operator, /first-slice\s+product-value/);
  assert.match(operator, /controlled-benchmark pilot/);
  assert.match(state, /operator\.md/);
  for (const [name, body] of [["operator.md", operator], ["state.md", state]]) {
    assert.doesNotMatch(body, /BB-\d+/, `${name} carries no delivery-work id`);
    assert.doesNotMatch(body, /\bD0\d+\b/, `${name} carries no delivery-decision id`);
    assert.doesNotMatch(body, /BB-?\d{2,}/i, `${name} carries no encoded work id either`);
  }
});

test("DL5 write scope excludes supervisor and agentic-system", T, () => {
  const { write, forbiddenWrite } = PLAN.sourceScope;
  assert.ok(auditPaths(["packages/agent-tools/src/supervisor.js"], { write, forbiddenWrite }).forbidden.includes("packages/agent-tools/src/supervisor.js"));
  assert.ok(auditPaths(["packages/agentic-system/src/composition.js"], { write, forbiddenWrite }).forbidden.includes("packages/agentic-system/src/composition.js"));
  const hit = auditPaths(["packages/agentic-system/src/composition.js", "packages/agent-tools/src/supervisor.js"], { write, forbiddenWrite });
  assert.deepEqual(hit.forbidden.sort(), ["packages/agent-tools/src/supervisor.js", "packages/agentic-system/src/composition.js"].sort());
  assert.deepEqual(hit.allowed, []);
  const allowed = auditPaths([...write], { write, forbiddenWrite });
  assert.equal(allowed.forbidden.length, 0);
  assert.equal(allowed.outOfScope.length, 0);
  assert.equal(allowed.allowed.length, write.length);
  assert.ok(write.includes("packages/agent-tools/src/deliver-slice.js"));
  assert.ok(forbiddenWrite.includes("packages/agent-tools/src/supervisor.js"));
});
