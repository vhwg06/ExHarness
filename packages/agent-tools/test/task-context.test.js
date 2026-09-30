import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AgentTaskStatus,
  CONTEXT_UNSATISFIED,
  GROUNDED_CONTEXT_HEADER,
  codexTool,
  defineAgentTool,
  projectAgentTaskContext,
  resolveAgentTaskContext,
  runSupervisedTask,
  validateAgentTask
} from "../src/index.js";
import { auditPaths } from "./task-context-scope-audit.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const FAKE = join(here, "fixtures", "fake-agent.mjs");
const DOCS = join(here, "..", "..", "..", "docs", "living", "system", "agent-tools");
const README = join(here, "..", "README.md");
const T = { timeout: 60000 };
const APP = 'export const greeting = "hello";\n';
const fakeTool = () => defineAgentTool(codexTool, { command: process.execPath, prefixArgs: [FAKE] });

function git(cwd, ...args) {
  const result = spawnSync("git", args, {
    cwd, shell: false, encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@localhost.invalid", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@localhost.invalid" }
  });
  assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

// A source repository with one grounded file (src/app.js) plus the BB-097
// failing-sum fixture the fake agent's FIX_FIRST scenario repairs.
function sourceRepository() {
  const root = mkdtempSync(join(tmpdir(), "cx-source-"));
  git(root, "init", "-q");
  git(root, "checkout", "-q", "-b", "main");
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "app.js"), APP);
  writeFileSync(join(root, "sum.mjs"), "export const sum = (a, b) => a - b;\n");
  writeFileSync(join(root, "sum.test.mjs"), 'import test from "node:test";\nimport assert from "node:assert/strict";\nimport { sum } from "./sum.mjs";\ntest("sum adds", () => { assert.equal(sum(2, 3), 5); });\n');
  git(root, "add", "-A");
  git(root, "-c", "commit.gpgsign=false", "commit", "-q", "-m", "base");
  return { root, baseRevision: git(root, "rev-parse", "HEAD") };
}

function taskFor(root, baseRevision, extra = {}) {
  return {
    id: "cx-task",
    repositoryRoot: root,
    baseRevision,
    prompt: "Fix sum in sum.mjs so that sum(a, b) returns a + b.",
    verifications: [{ name: "unit", command: process.execPath, args: ["--test", "sum.test.mjs"], timeoutMs: 30000 }],
    ...extra
  };
}

const readRecords = (path) => (existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : []);

// ---------------------------------------------------------------- CX1 schema

test("CX1 optional requiredFiles maps to EXACT ContextRequirement", T, async () => {
  const { root, baseRevision } = sourceRepository();
  try {
    const validated = validateAgentTask(taskFor(root, baseRevision, { requiredFiles: ["src/app.js"] }));
    assert.deepEqual(validated.requiredFiles, ["src/app.js"]);
    const omitted = validateAgentTask(taskFor(root, baseRevision));
    assert.equal("requiredFiles" in omitted, false);
    assert.equal("requiredFiles" in validateAgentTask(taskFor(root, baseRevision, { requiredFiles: [] })), false);
    const resolved = await resolveAgentTaskContext(validated, { maxMaterializedBytes: 8192 });
    assert.equal(resolved.used, true);
    assert.equal(resolved.requirement.consumerRef, "agent-task:cx-task");
    assert.deepEqual(resolved.requirement.budget, { maxItems: 1, maxProviderCalls: 1, maxResolutionSteps: 1, maxMaterializedBytes: 8192 });
    assert.equal(resolved.requirement.evidence.length, 1);
    const [evidence] = resolved.requirement.evidence;
    assert.deepEqual([evidence.id, evidence.necessity, evidence.source.kind], ["file-0", "REQUIRED", "REPOSITORY"]);
    assert.deepEqual(evidence.source.snapshot, { mode: "EXACT", ref: baseRevision });
    assert.deepEqual(evidence.source.itemRefs, ["src/app.js"]);
    assert.equal(resolved.resolution.status, "COMPLETE");
    assert.equal(resolved.items.length, 1);
    assert.equal(resolved.items[0].path, "src/app.js");
    assert.equal(resolved.items[0].content, APP);
    assert.equal(resolved.items[0].sourceRef, `${baseRevision}:src/app.js`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CX1 path with .. is rejected", T, () => {
  assert.throws(() => validateAgentTask(taskFor("/tmp/repo", "a".repeat(40), { requiredFiles: ["src/../escape.js"] })), /AGENT_TASK_V1 invalid:/);
  assert.throws(() => validateAgentTask(taskFor("/tmp/repo", "a".repeat(40), { requiredFiles: ["../escape.js"] })), /AGENT_TASK_V1 invalid:/);
  assert.throws(() => validateAgentTask(taskFor("/tmp/repo", "a".repeat(40), { requiredFiles: ["src/app.js", "src/app.js"] })), /AGENT_TASK_V1 invalid:/);
});

test("CX1 absolute path is rejected", T, () => {
  assert.throws(() => validateAgentTask(taskFor("/tmp/repo", "a".repeat(40), { requiredFiles: ["/tmp/escape.js"] })), /AGENT_TASK_V1 invalid:/);
});

// ---------------------------------------------------------------- CX2 projection

test("CX2 consumable items project into prompt and worktree with sourceRef", T, async () => {
  const { root, baseRevision } = sourceRepository();
  const scratch = mkdtempSync(join(tmpdir(), "cx-records-"));
  const record = join(scratch, "record.json");
  const seen = {};
  try {
    const result = await runSupervisedTask({
      tool: fakeTool(),
      task: taskFor(root, baseRevision, { requiredFiles: ["src/app.js"] }),
      maxAttempts: 1,
      timeoutMs: 30000,
      maxMaterializedBytes: 8192,
      env: { FAKE_AGENT_SCENARIO: "FIX_FIRST", FAKE_AGENT_RECORD: record },
      invocationObserver: async (observation) => {
        seen.prompt = observation.request.prompt;
        seen.worktree = observation.worktree;
        seen.candidateBefore = observation.candidateBefore;
        seen.grounded = readFileSync(join(observation.worktree, ".exharness", "context", "src", "app.js"), "utf8");
        seen.porcelain = git(observation.worktree, "status", "--porcelain", "--untracked-files=all");
      }
    });
    assert.equal(result.status, AgentTaskStatus.ACCEPTED);
    assert.ok(readRecords(record).length >= 1, "the agent spawned (FAKE_AGENT_RECORD present)");
    assert.ok(seen.prompt.startsWith(GROUNDED_CONTEXT_HEADER), "prefix begins exactly with the grounded header");
    assert.ok(seen.prompt.startsWith("ExHarness grounded context:"), "prefix header text is exact");
    assert.ok(seen.prompt.includes("src/app.js"), "prefix names the grounded path");
    assert.ok(seen.prompt.includes(`sourceRef: ${baseRevision}:src/app.js`), "prefix carries the sourceRef");
    assert.ok(seen.prompt.includes(APP.trim()), "prefix carries the grounded excerpt");
    assert.ok(seen.prompt.endsWith("\n\nFix sum in sum.mjs so that sum(a, b) returns a + b."), "strategy prompt appends the original prompt");
    assert.equal(seen.grounded, APP, "the worktree copy carries the full content");
    assert.equal(seen.porcelain, "", "grounded copies do not dirty the worktree");
    assert.equal(seen.candidateBefore, baseRevision, "the agent spawned at the base revision");
    assert.equal(git(root, "rev-parse", "HEAD"), baseRevision, "the source repository HEAD is unchanged");
    assert.equal(existsSync(join(root, ".exharness")), false, "the source repository is not written");
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("CX2 grounded context files are git-excluded from the candidate", T, async () => {
  const { root, baseRevision } = sourceRepository();
  const worktree = mkdtempSync(join(tmpdir(), "cx-worktree-"));
  const dirty = mkdtempSync(join(tmpdir(), "cx-dirty-"));
  try {
    git(worktree, "init", "-q");
    writeFileSync(join(worktree, "sum.mjs"), "export const sum = (a, b) => a - b;\n");
    git(worktree, "add", "-A");
    git(worktree, "-c", "commit.gpgsign=false", "commit", "-q", "-m", "base");
    const resolved = await resolveAgentTaskContext(
      validateAgentTask(taskFor(root, baseRevision, { requiredFiles: ["src/app.js"] })),
      { maxMaterializedBytes: 8192 }
    );
    const projected = await projectAgentTaskContext(resolved, { worktreeRoot: worktree });
    assert.deepEqual(projected.files, [".exharness/context/src/app.js"]);
    assert.equal(readFileSync(join(worktree, ".exharness", "context", "src", "app.js"), "utf8"), APP);
    assert.equal(git(worktree, "status", "--porcelain", "--untracked-files=all"), "", "excluded copies leave porcelain empty");
    // Without the exclude line the same file would dirty the tree.
    git(dirty, "init", "-q");
    writeFileSync(join(dirty, "sum.mjs"), "x\n");
    git(dirty, "add", "-A");
    git(dirty, "-c", "commit.gpgsign=false", "commit", "-q", "-m", "base");
    mkdirSync(join(dirty, ".exharness", "context", "src"), { recursive: true });
    writeFileSync(join(dirty, ".exharness", "context", "src", "app.js"), APP);
    assert.ok(git(dirty, "status", "--porcelain", "--untracked-files=all").includes(".exharness"), "unexcluded copies dirty the tree");
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(worktree, { recursive: true, force: true });
    rmSync(dirty, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- CX3 fail-closed

test("CX3 missing required file does not spawn", T, async () => {
  const { root, baseRevision } = sourceRepository();
  const scratch = mkdtempSync(join(tmpdir(), "cx-records-"));
  const record = join(scratch, "record.json");
  try {
    await assert.rejects(
      runSupervisedTask({
        tool: fakeTool(),
        task: taskFor(root, baseRevision, { requiredFiles: ["src/missing.js"] }),
        maxAttempts: 1,
        timeoutMs: 30000,
        maxMaterializedBytes: 8192,
        env: { FAKE_AGENT_SCENARIO: "FIX_FIRST", FAKE_AGENT_RECORD: record }
      }),
      (error) => {
        assert.equal(error.name, "AgentTaskContextError");
        assert.equal(error.code, CONTEXT_UNSATISFIED);
        assert.equal(error.status, "UNSATISFIED");
        assert.deepEqual(error.unresolved, [{ evidenceId: "file-0", reason: "SOURCE_FAILURE" }]);
        return true;
      }
    );
    assert.equal(existsSync(record), false, "FAKE_AGENT_RECORD is absent: the agent never spawned");
    assert.equal(git(root, "rev-parse", "HEAD"), baseRevision, "the source repository is unchanged");
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("CX3 budget exhaustion does not spawn", T, async () => {
  const { root, baseRevision } = sourceRepository();
  const scratch = mkdtempSync(join(tmpdir(), "cx-records-"));
  const record = join(scratch, "record.json");
  try {
    const validated = validateAgentTask(taskFor(root, baseRevision, { requiredFiles: ["src/app.js"] }));
    await assert.rejects(
      resolveAgentTaskContext(validated, { maxMaterializedBytes: 2 }),
      (error) => {
        assert.equal(error.name, "AgentTaskContextError");
        assert.equal(error.code, CONTEXT_UNSATISFIED);
        assert.equal(error.status, "UNSATISFIED");
        assert.ok(error.unresolved.some((entry) => entry.reason === "BUDGET_EXHAUSTED"));
        return true;
      }
    );
    await assert.rejects(
      resolveAgentTaskContext(validated, { maxMaterializedBytes: 1 }),
      (error) => {
        assert.equal(error.name, "AgentTaskContextError");
        assert.equal(error.code, CONTEXT_UNSATISFIED);
        assert.equal(error.status, "UNSATISFIED");
        return true;
      }
    );
    await assert.rejects(
      runSupervisedTask({
        tool: fakeTool(),
        task: taskFor(root, baseRevision, { requiredFiles: ["src/app.js"] }),
        maxAttempts: 1,
        timeoutMs: 30000,
        maxMaterializedBytes: 2,
        env: { FAKE_AGENT_SCENARIO: "FIX_FIRST", FAKE_AGENT_RECORD: record }
      }),
      (error) => {
        assert.equal(error.name, "AgentTaskContextError");
        assert.equal(error.code, CONTEXT_UNSATISFIED);
        return true;
      }
    );
    assert.equal(existsSync(record), false, "FAKE_AGENT_RECORD is absent: the agent never spawned");
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("CX3 stale snapshot does not spawn", T, async () => {
  const { root, baseRevision } = sourceRepository();
  const scratch = mkdtempSync(join(tmpdir(), "cx-records-"));
  const record = join(scratch, "record.json");
  try {
    const validated = validateAgentTask(taskFor(root, baseRevision, { requiredFiles: ["src/app.js"] }));
    let calls = 0;
    const drifting = async () => ({ snapshotRef: calls++ === 0 ? baseRevision : "b".repeat(40) });
    await assert.rejects(
      resolveAgentTaskContext(validated, { maxMaterializedBytes: 8192, snapshotObserve: drifting }),
      (error) => {
        assert.equal(error.name, "AgentTaskContextError");
        assert.equal(error.code, CONTEXT_UNSATISFIED);
        assert.equal(error.status, "STALE");
        assert.equal(error.reason, "STALE_DURING_RESOLUTION");
        return true;
      }
    );
    let resumeCalls = 0;
    await assert.rejects(
      runSupervisedTask({
        tool: fakeTool(),
        task: taskFor(root, baseRevision, { requiredFiles: ["src/app.js"] }),
        maxAttempts: 1,
        timeoutMs: 30000,
        maxMaterializedBytes: 8192,
        snapshotObserve: async () => ({ snapshotRef: resumeCalls++ === 0 ? baseRevision : "b".repeat(40) }),
        env: { FAKE_AGENT_SCENARIO: "FIX_FIRST", FAKE_AGENT_RECORD: record }
      }),
      (error) => {
        assert.equal(error.name, "AgentTaskContextError");
        assert.equal(error.code, "CONTEXT_UNSATISFIED");
        assert.equal(error.status, "STALE");
        return true;
      }
    );
    assert.equal(existsSync(record), false, "FAKE_AGENT_RECORD is absent: the agent never spawned");
    assert.deepEqual(Object.keys(AgentTaskStatus).sort(), ["ACCEPTED", "EXHAUSTED", "TOOL_UNAVAILABLE"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- CX4 default

test("CX4 tasks without requiredFiles never construct Oracle", T, async () => {
  let readerCalls = 0;
  let observeCalls = 0;
  const spyingReader = { async readFile() { readerCalls += 1; throw new Error("must not be called"); } };
  const spyingObserve = async () => { observeCalls += 1; throw new Error("must not be called"); };
  const omitted = await resolveAgentTaskContext(
    validateAgentTask(taskFor("/tmp/repo", "a".repeat(40))),
    { repositoryReader: spyingReader, snapshotObserve: spyingObserve }
  );
  assert.deepEqual(omitted, { used: false, items: [], promptPrefix: "" });
  const empty = await resolveAgentTaskContext(
    validateAgentTask(taskFor("/tmp/repo", "a".repeat(40), { requiredFiles: [] })),
    { repositoryReader: spyingReader, snapshotObserve: spyingObserve }
  );
  assert.deepEqual(empty, { used: false, items: [], promptPrefix: "" });
  assert.equal(readerCalls, 0, "repositoryReader is never called");
  assert.equal(observeCalls, 0, "snapshotObserve is never called");
  // Existing callers without requiredFiles still run unchanged.
  const { root, baseRevision } = sourceRepository();
  const scratch = mkdtempSync(join(tmpdir(), "cx-records-"));
  const record = join(scratch, "record.json");
  try {
    const result = await runSupervisedTask({
      tool: fakeTool(),
      task: taskFor(root, baseRevision),
      maxAttempts: 1,
      timeoutMs: 30000,
      env: { FAKE_AGENT_SCENARIO: "FIX_FIRST", FAKE_AGENT_RECORD: record }
    });
    assert.equal(result.status, AgentTaskStatus.ACCEPTED);
    assert.ok(readRecords(record).length >= 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- CX5 docs

test("CX5 living docs describe the agent-tools Oracle consumer", T, () => {
  const context = readFileSync(join(DOCS, "context.md"), "utf8");
  const state = readFileSync(join(DOCS, "state.md"), "utf8");
  const readme = readFileSync(README, "utf8");
  for (const [name, body] of [["context.md", context], ["state.md", state]]) {
    assert.ok(body.includes("requiredFiles"), `${name} describes the optional requiredFiles list`);
    assert.ok(body.includes("EXACT"), `${name} describes EXACT resolution`);
    assert.ok(body.includes("ExHarness grounded context:"), `${name} describes the grounded prompt prefix`);
    assert.ok(body.includes(".exharness/context"), `${name} describes the git-excluded worktree copies`);
    assert.ok(body.includes("AgentTaskContextError"), `${name} describes the fail-closed error`);
    assert.ok(body.includes("CONTEXT_UNSATISFIED"), `${name} names the error code`);
    assert.ok(body.includes("sourceRef"), `${name} describes sourceRef binding`);
    assert.equal(/BB-\d+/.test(body), false, `${name} carries no delivery-work ids`);
  }
  assert.ok(/Backend.*QA|QA.*Backend|production adoption/i.test(context), "context.md distinguishes the Backend/QA production consumer");
  assert.ok(readme.includes("context.md"), "the package README points to context.md");
  assert.equal(/BB-\d+/.test(readme), false, "the package README carries no delivery-work ids");
});

// ---------------------------------------------------------------- CX6 scope

test("CX6 write scope excludes packages/oracle", T, () => {
  assert.equal(typeof auditPaths, "function", "the scope audit matcher is reused from scope-audit.mjs");
  const scope = {
    write: [
      "packages/agent-tools/src/task-context.js",
      "packages/agent-tools/src/supervisor.js",
      "packages/agent-tools/src/index.js",
      "packages/agent-tools/README.md",
      "packages/agent-tools/test/task-context.test.js",
      "packages/agent-tools/test/task-context-scope-audit.mjs",
      "docs/living/system/agent-tools/state.md",
      "docs/living/system/agent-tools/context.md"
    ],
    forbiddenWrite: [
      "packages/core-harness/**",
      "packages/oracle/**",
      "packages/agentic-system/**",
      "packages/benchmark/**",
      "packages/agent-tools/src/tool-adapters.js",
      "packages/agent-tools/src/process-runner.js",
      "packages/agent-tools/test/agent-tools.test.js",
      "packages/agent-tools/test/run-trace.test.js",
      "packages/agent-tools/test/scope-audit.mjs",
      "packages/agent-tools/bin/**",
      ".github/**",
      "docs/blackboard/**",
      "docs/living/system/oracle/**"
    ]
  };
  const allowed = auditPaths(
    ["packages/agent-tools/src/task-context.js", "packages/agent-tools/src/supervisor.js", "packages/agent-tools/src/index.js", "docs/living/system/agent-tools/context.md"],
    scope
  );
  assert.deepEqual(allowed.forbidden, []);
  assert.deepEqual(allowed.outOfScope, []);
  const blocked = auditPaths(
    [
      "packages/oracle/src/index.js",
      "packages/core-harness/src/index.js",
      "packages/agentic-system/src/index.js",
      "docs/blackboard/state.md",
      "packages/agent-tools/test/agent-tools.test.js",
      "packages/agent-tools/test/run-trace.test.js"
    ],
    scope
  );
  assert.equal(blocked.allowed.length, 0, "no forbidden path is allowed");
  assert.equal(blocked.forbidden.length, 6, "every forbidden probe path fails the matcher");
});
