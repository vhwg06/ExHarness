import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  AGENT_TOOL_RUN_HANDLE_VERSION,
  AgentTaskStatus,
  RecoveryError,
  canonicalJson,
  codexTool,
  createFileSessionStore,
  defineAgentTool,
  disposeRecoverableRun,
  handleDigest,
  readAgentToolRunHandle,
  resumeSupervisedTask,
  runSupervisedTask,
  verifyAgentToolRunHandle,
  writeAgentToolRunHandle
} from "../src/index.js";
import { StoreConflictError } from "../../core-harness/src/index.js";
import { auditPaths } from "./scope-audit.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const FAKE = join(here, "fixtures", "fake-agent.mjs");
const CRASH = join(here, "fixtures", "crash-supervised.mjs");
const REPO_ROOT = join(here, "..", "..", "..");
const T = { timeout: 60000 };
const PLAN = JSON.parse(readFileSync(join(REPO_ROOT, "docs", "blackboard", "artifacts", "ready-implement-plan", "BB-101.json"), "utf8"));

const fakeTool = (base) => defineAgentTool(base, { command: process.execPath, prefixArgs: [FAKE] });
const tempDir = (prefix) => mkdtempSync(join(tmpdir(), prefix));
const readRecords = (path) => (existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : []);

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
  const root = tempDir("bb101-source-");
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

function taskFor(root, base, extra = {}) {
  return {
    id: "sum-task",
    repositoryRoot: root,
    baseRevision: base,
    prompt: "Fix sum in sum.mjs so that sum(a, b) returns a + b.",
    verifications: [{ name: "unit", command: process.execPath, args: ["--test", "sum.test.mjs"], timeoutMs: 30000 }],
    ...extra
  };
}

function crashRun({ taskPath, recoveryDir, scenario = "FIX_AFTER_FEEDBACK", attempt = 1, phase = "ACT_COMPLETED", record = null }) {
  return new Promise((resolvePromise) => {
    const { NODE_TEST_CONTEXT, ...inherited } = process.env;
    const child = spawn(process.execPath, [CRASH], {
      shell: false,
      env: {
        ...inherited,
        CRASH_TASK_JSON: taskPath,
        CRASH_RECOVERY_DIR: recoveryDir,
        CRASH_SCENARIO: scenario,
        CRASH_ATTEMPT: String(attempt),
        CRASH_PHASE: phase,
        ...(record ? { FAKE_AGENT_RECORD: record } : {})
      }
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolvePromise({ code, stdout, stderr }));
  });
}

/**
 * Runs fn with TMPDIR pointed at a test-local empty directory and returns the
 * directory's exharness-agent-* entries afterwards. os.tmpdir() honors TMPDIR per
 * call, so any mkdtemp scratch the code under test creates lands here instead of
 * the shared system temp dir, where concurrent suites would pollute the reading.
 */
async function scratchesUnderTest(fn) {
  const probe = tempDir("bb101-tmpdir-probe-");
  const saved = process.env.TMPDIR;
  process.env.TMPDIR = probe;
  try {
    await fn();
  } finally {
    if (saved === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = saved;
  }
  return readdirSync(probe).filter((name) => name.startsWith("exharness-agent-")).sort();
}

// ---------------------------------------------------------------- RC1 handle schema

test("RC1 handle records identity fields and digest", T, async () => {
  const { root, base } = sourceRepository();
  const recoveryDir = tempDir("bb101-rec-");
  try {
    const before = repositorySnapshot(root);
    const result = await runSupervisedTask({
      tool: fakeTool(codexTool),
      task: taskFor(root, base),
      maxAttempts: 1,
      timeoutMs: 30000,
      recoveryDir,
      env: { FAKE_AGENT_SCENARIO: "FIX_FIRST" }
    });
    assert.equal(result.status, AgentTaskStatus.ACCEPTED);
    const handle = await readAgentToolRunHandle(recoveryDir);
    assert.equal(handle.version, AGENT_TOOL_RUN_HANDLE_VERSION);
    assert.equal(handle.taskId, "sum-task");
    assert.equal(handle.repositoryRoot, resolve(root));
    assert.equal(handle.baseRevision, base);
    assert.equal(handle.sourceHead, before.head);
    assert.equal(handle.recoveryDir, resolve(recoveryDir));
    assert.equal(handle.worktreeRoot, resolve(join(recoveryDir, "worktree")));
    assert.equal(handle.candidateSha, result.acceptedSha);
    assert.match(handle.candidateSha, /^[0-9a-f]{40}$/);
    assert.equal(handle.coreSessionId, "agent-task:sum-task");
    assert.equal(handle.toolId, "codex");
    assert.equal(handle.toolVersion, "fake-agent 0.0.0");
    assert.equal(handle.toolSessionRef, "fake-1");
    assert.equal(handle.attemptIndex, 1);
    assert.equal(handle.maxAttempts, 1);
    assert.equal(handle.phase, "ATTEMPT_COMPLETED");
    assert.equal(handle.status, "ACCEPTED");
    assert.equal(handle.feedback, "");
    assert.ok(typeof handle.createdAt === "string" && handle.createdAt.length > 0);
    const { digest, ...body } = handle;
    assert.equal(digest, handleDigest(handle));
    assert.equal(digest, handleDigest(body));
    assert.doesNotThrow(() => verifyAgentToolRunHandle(handle));
    assert.equal(canonicalJson({ b: 1, a: 2 }), '{"a":2,"b":1}');
    const probe = new RecoveryError("HANDLE_CURRENT", "taken");
    assert.equal(probe.code, "HANDLE_CURRENT");
    assert.equal(probe.name, "RecoveryError");
    assert.match(probe.message, /^HANDLE_CURRENT: /);
    const during = repositorySnapshot(root);
    assert.equal(during.head, before.head);
    assert.equal(during.refs, before.refs);
    assert.equal(during.status, before.status);
    assert.equal(during.worktrees, before.worktrees + 1, "the recoverable worktree persists");
    await disposeRecoverableRun(handle);
    assert.equal(existsSync(recoveryDir), false);
    assert.deepEqual(repositorySnapshot(root), before);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(recoveryDir, { recursive: true, force: true });
  }
});

test("RC1 file session store roundtrips revisions across instances", T, async () => {
  const dir = tempDir("bb101-store-");
  try {
    const first = createFileSessionStore({ directory: join(dir, "core-session") });
    assert.equal(first.supportsRevisions, true);
    assert.equal(await first.load("agent-task:sum-task"), null);
    const session = { id: "agent-task:sum-task", schemaVersion: 1, revision: 0, currentCandidate: { id: "t", version: "a".repeat(40) } };
    const saved = await first.save(session);
    assert.equal(saved.revision, 1);
    const second = createFileSessionStore({ directory: join(dir, "core-session") });
    const loaded = await second.load("agent-task:sum-task");
    assert.equal(loaded.revision, 1);
    assert.equal(loaded.currentCandidate.version, "a".repeat(40));
    await assert.rejects(second.save({ ...loaded, revision: 0 }, { expectedRevision: 0 }), (error) => error instanceof StoreConflictError);
    const journal = createFileSessionStore({ directory: join(dir, "core-session") });
    await journal.save({ id: "__exharness_avo_action_effects__:agent-task%3Asum-task", schemaVersion: 1, revision: 0 });
    assert.ok(await journal.load("__exharness_avo_action_effects__:agent-task%3Asum-task") !== null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- RC2 default disposal

test("RC2 default run still disposes the worktree", T, async () => {
  const { root, base } = sourceRepository();
  try {
    let seen = null;
    const result = await runSupervisedTask({
      tool: fakeTool(codexTool),
      task: taskFor(root, base),
      maxAttempts: 1,
      timeoutMs: 30000,
      env: { FAKE_AGENT_SCENARIO: "FIX_FIRST" },
      invocationObserver: async (observation) => { seen = observation.worktree; }
    });
    assert.equal(result.status, AgentTaskStatus.ACCEPTED);
    assert.ok(typeof seen === "string" && seen.length > 0);
    assert.equal(existsSync(seen), false, "the default worktree is disposed after ACCEPTED");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("RC2 recoverable run survives until dispose", T, async () => {
  const { root, base } = sourceRepository();
  const acceptedDir = tempDir("bb101-rec-acc-");
  const exhaustedDir = tempDir("bb101-rec-exh-");
  try {
    const before = repositorySnapshot(root);
    const accepted = await runSupervisedTask({
      tool: fakeTool(codexTool), task: taskFor(root, base), maxAttempts: 1, timeoutMs: 30000,
      recoveryDir: acceptedDir, env: { FAKE_AGENT_SCENARIO: "FIX_FIRST" }
    });
    assert.equal(accepted.status, AgentTaskStatus.ACCEPTED);
    assert.equal(existsSync(join(acceptedDir, "worktree", "sum.mjs")), true);
    const acceptedHandle = await readAgentToolRunHandle(acceptedDir);
    assert.equal(acceptedHandle.status, "ACCEPTED");

    const exhausted = await runSupervisedTask({
      tool: fakeTool(codexTool), task: taskFor(root, base), maxAttempts: 1, timeoutMs: 30000,
      recoveryDir: exhaustedDir, env: { FAKE_AGENT_SCENARIO: "NEVER_FIX" }
    });
    assert.equal(exhausted.status, AgentTaskStatus.EXHAUSTED);
    assert.equal(existsSync(join(exhaustedDir, "worktree", "sum.mjs")), true);
    const exhaustedHandle = await readAgentToolRunHandle(exhaustedDir);
    assert.equal(exhaustedHandle.status, "EXHAUSTED");

    assert.equal(repositorySnapshot(root).worktrees, before.worktrees + 2, "both recoverable worktrees persist");
    await disposeRecoverableRun(acceptedHandle);
    await disposeRecoverableRun(exhaustedHandle);
    assert.equal(existsSync(acceptedDir), false);
    assert.equal(existsSync(exhaustedDir), false);
    assert.deepEqual(repositorySnapshot(root), before);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(acceptedDir, { recursive: true, force: true });
    rmSync(exhaustedDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- RC3 crash resume

test("RC3 crash resume keeps the same task id", T, async () => {
  const { root, base } = sourceRepository();
  const scratch = tempDir("bb101-rc3-");
  const recoveryDir = join(scratch, "recovery");
  const taskPath = join(scratch, "task.json");
  const record = join(scratch, "record.json");
  writeFileSync(taskPath, JSON.stringify(taskFor(root, base)));
  try {
    const before = repositorySnapshot(root);
    const crashed = await crashRun({ taskPath, recoveryDir, record });
    assert.equal(crashed.code, 97, `crash fixture exits 97, stderr: ${crashed.stderr}`);
    const handle = await readAgentToolRunHandle(recoveryDir);
    assert.equal(handle.phase, "ACT_COMPLETED");
    assert.equal(handle.status, "RUNNING");
    assert.equal(handle.attemptIndex, 1);
    assert.equal(handle.taskId, "sum-task");

    const resumed = await resumeSupervisedTask(handle, {
      tool: fakeTool(codexTool),
      task: taskFor(root, base),
      timeoutMs: 30000,
      env: { FAKE_AGENT_SCENARIO: "FIX_AFTER_FEEDBACK", FAKE_AGENT_RECORD: record }
    });
    assert.equal(resumed.status, AgentTaskStatus.ACCEPTED);
    assert.equal(resumed.taskId, handle.taskId);
    assert.deepEqual(resumed.attempts.map((attempt) => attempt.index), [1, 2], "resumed attempts keep their original index");
    const after = await readAgentToolRunHandle(recoveryDir);
    assert.equal(after.coreSessionId, handle.coreSessionId, "the same Core session continues");
    assert.equal(after.worktreeRoot, handle.worktreeRoot, "the same worktree continues");
    assert.equal(after.status, "ACCEPTED");
    assert.equal(after.candidateSha, resumed.acceptedSha);
    const records = readRecords(record);
    assert.equal(records.length, 2);
    assert.deepEqual(records[1].argv, ["exec", "resume", "fake-1", "--json", "-"], "the tool session continues");
    const during = repositorySnapshot(root);
    assert.equal(during.head, before.head, "the source repository HEAD is unchanged");
    assert.equal(during.refs, before.refs);
    assert.equal(during.status, before.status);
    assert.equal(during.worktrees, before.worktrees + 1, "no second worktree was minted");

    await assert.rejects(
      resumeSupervisedTask(handle, { tool: fakeTool(codexTool), task: taskFor(root, base), timeoutMs: 30000 }),
      (error) => error instanceof RecoveryError && error.code === "STALE_HANDLE",
      "the crashed handle cannot mint a second lineage after resume"
    );
    await assert.rejects(
      runSupervisedTask({ tool: fakeTool(codexTool), task: taskFor(root, base), timeoutMs: 30000, recoveryDir }),
      (error) => error instanceof RecoveryError && error.code === "HANDLE_CURRENT",
      "a current handle refuses a second first-run"
    );
    await disposeRecoverableRun(after);
    assert.deepEqual(repositorySnapshot(root), before);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- RC4 fail-closed refusals

async function crashedHandle(scratch, scenario = "FIX_AFTER_FEEDBACK") {
  const { root, base } = sourceRepository();
  const recoveryDir = join(scratch, `recovery-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  const taskPath = join(scratch, "task.json");
  writeFileSync(taskPath, JSON.stringify(taskFor(root, base)));
  const crashed = await crashRun({ taskPath, recoveryDir, scenario });
  assert.equal(crashed.code, 97, `crash fixture exits 97, stderr: ${crashed.stderr}`);
  const handle = await readAgentToolRunHandle(recoveryDir);
  return { root, base, recoveryDir, handle, before: repositorySnapshot(root) };
}

test("RC4 deleted worktree refuses resume", T, async () => {
  const scratch = tempDir("bb101-rc4-missing-");
  const { root, recoveryDir, handle, before } = await crashedHandle(scratch);
  try {
    rmSync(handle.worktreeRoot, { recursive: true, force: true });
    const leftovers = await scratchesUnderTest(() => assert.rejects(
      resumeSupervisedTask(handle, { tool: fakeTool(codexTool), task: taskFor(root, handle.baseRevision), timeoutMs: 30000 }),
      (error) => error instanceof RecoveryError && error.code === "MISSING_WORKTREE"
    ));
    assert.deepEqual(leftovers, [], "refusal does not mkdtemp a fresh run");
    const after = repositorySnapshot(root);
    assert.equal(after.worktrees, before.worktrees);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("RC4 rewritten digest refuses resume", T, async () => {
  const scratch = tempDir("bb101-rc4-digest-");
  const { root, base, recoveryDir, handle, before } = await crashedHandle(scratch);
  try {
    const tampered = { ...handle, feedback: "tampered feedback" };
    await assert.rejects(
      resumeSupervisedTask(tampered, { tool: fakeTool(codexTool), task: taskFor(root, base), timeoutMs: 30000 }),
      (error) => error instanceof RecoveryError && error.code === "DIGEST_MISMATCH"
    );
    assert.deepEqual(repositorySnapshot(root), before);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("RC4 source HEAD drift refuses resume", T, async () => {
  const scratch = tempDir("bb101-rc4-head-");
  const { root, base, recoveryDir, handle } = await crashedHandle(scratch);
  try {
    writeFileSync(join(root, "drift.txt"), "drift\n");
    git(root, "add", "-A");
    git(root, "-c", "commit.gpgsign=false", "commit", "-q", "-m", "drift");
    assert.notEqual(git(root, "rev-parse", "HEAD"), handle.sourceHead);
    await assert.rejects(
      resumeSupervisedTask(handle, { tool: fakeTool(codexTool), task: taskFor(root, base), timeoutMs: 30000 }),
      (error) => error instanceof RecoveryError && error.code === "SOURCE_HEAD_DRIFT"
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("RC4 stale handle refuses resume", T, async () => {
  const scratch = tempDir("bb101-rc4-stale-");
  const { root, base, recoveryDir, handle, before } = await crashedHandle(scratch);
  try {
    await writeAgentToolRunHandle(recoveryDir, { ...handle, feedback: "a newer persist" });
    const fresh = await readAgentToolRunHandle(recoveryDir);
    assert.notEqual(fresh.digest, handle.digest);
    await assert.rejects(
      resumeSupervisedTask(handle, { tool: fakeTool(codexTool), task: taskFor(root, base), timeoutMs: 30000 }),
      (error) => error instanceof RecoveryError && error.code === "STALE_HANDLE"
    );
    assert.deepEqual(repositorySnapshot(root), before);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- RC5 docs and scope

test("RC5 write scope excludes core-harness", T, () => {
  const { write, forbiddenWrite } = PLAN.sourceScope;
  const forbidden = auditPaths(["packages/core-harness/src/store.js"], { write, forbiddenWrite });
  assert.deepEqual(forbidden.forbidden, ["packages/core-harness/src/store.js"]);
  const allowed = auditPaths([...write], { write, forbiddenWrite });
  assert.equal(allowed.forbidden.length, 0);
  assert.equal(allowed.outOfScope.length, 0);
  assert.equal(allowed.allowed.length, write.length);
  assert.ok(write.includes("packages/agent-tools/src/recovery.js"));
  assert.ok(write.includes("packages/agent-tools/test/recovery.test.js"));
  assert.ok(forbiddenWrite.includes("packages/core-harness/**"));
});

test("RC5 living docs describe recovery", T, () => {
  const recovery = readFileSync(join(REPO_ROOT, "docs", "living", "system", "agent-tools", "recovery.md"), "utf8");
  const state = readFileSync(join(REPO_ROOT, "docs", "living", "system", "agent-tools", "state.md"), "utf8");
  assert.match(recovery, /AGENT_TOOL_RUN_HANDLE_V1/);
  assert.match(recovery, /disposeRecoverableRun/);
  assert.match(recovery, /MISSING_WORKTREE/);
  assert.match(recovery, /SOURCE_HEAD_DRIFT/);
  assert.match(recovery, /STALE_HANDLE/);
  assert.match(recovery, /dispos/i);
  assert.match(recovery, /resum/i);
  assert.match(state, /recovery\.md/);
  for (const [name, body] of [["recovery.md", recovery], ["state.md", state]]) {
    assert.doesNotMatch(body, /BB-\d+/, `${name} carries no delivery-work id`);
    assert.doesNotMatch(body, /\bD0\d+\b/, `${name} carries no delivery-decision id`);
  }
});
