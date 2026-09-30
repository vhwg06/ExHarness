import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AGENT_TOOLS,
  AgentTaskStatus,
  AttemptOutcome,
  FEEDBACK_HEADER,
  InvocationStatus,
  PermissionProfile,
  agyTool,
  buildFeedback,
  codexTool,
  defineAgentTool,
  kiroTool,
  resolveExecutable,
  runAgentInvocation,
  runSupervisedTask,
  validateAgentTask
} from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const FAKE = join(here, "fixtures", "fake-agent.mjs");
const BIN = join(here, "..", "bin", "exharness-agent.mjs");
const REPO_ROOT = join(here, "..", "..", "..");
const T = { timeout: 60000 };
const METACHAR_PROMPT = "Fix it; $(touch pwned) `touch pwned2` && rm -rf ./x | cat > y \"quoted\" 'single' %PATH% ^& <in >out\nsecond line";
const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const fakeTool = (base) => defineAgentTool(base, { command: process.execPath, prefixArgs: [FAKE] });
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

// AT3 fixture: a repository with one failing test; the fake agent's built-in fix makes it pass.
function sourceRepository() {
  const root = tempDir("bb097-source-");
  git(root, "init", "-q");
  git(root, "checkout", "-q", "-b", "main");
  writeFileSync(join(root, "sum.mjs"), "export const sum = (a, b) => a - b;\n");
  writeFileSync(join(root, "sum.test.mjs"), 'import test from "node:test";\nimport assert from "node:assert/strict";\nimport { sum } from "./sum.mjs";\ntest("sum adds", () => { assert.equal(sum(2, 3), 5); });\n');
  git(root, "add", "-A");
  git(root, "-c", "commit.gpgsign=false", "commit", "-q", "-m", "failing sum");
  git(root, "branch", "keep");
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

async function supervised(scenario, { tool = codexTool, maxAttempts = 3, task = null, maxFeedbackChars, timeoutMs = 30000 } = {}) {
  const { root, base } = sourceRepository();
  const scratch = tempDir("bb097-records-");
  const record = join(scratch, "record.json");
  const before = repositorySnapshot(root);
  try {
    const result = await runSupervisedTask({
      tool: fakeTool(tool),
      task: task ?? taskFor(root, base),
      maxAttempts,
      timeoutMs,
      ...(maxFeedbackChars ? { maxFeedbackChars } : {}),
      env: { FAKE_AGENT_SCENARIO: scenario, FAKE_AGENT_RECORD: record }
    });
    const after = repositorySnapshot(root);
    // Inspect candidate commits while the source repository (their object store) still exists.
    const shas = [...new Set([result.acceptedSha, ...result.attempts.map((attempt) => attempt.candidateSha)].filter(Boolean))];
    const show = (sha, path) => spawnSync("git", ["show", `${sha}:${path}`], { cwd: root, shell: false, encoding: "utf8" });
    const commits = Object.fromEntries(shas.map((sha) => [sha, {
      fromBase: git(root, "rev-list", "--count", `${base}..${sha}`),
      parent: sha === base ? null : git(root, "rev-parse", `${sha}^`),
      files: Object.fromEntries(["sum.mjs", "notes.txt"].map((path) => [path, show(sha, path).status === 0 ? show(sha, path).stdout.trim() : null]))
    }]));
    return { result, records: readRecords(record), before, after, base, commits };
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true });
  }
}

function assertSourcePreserved({ before, after }) {
  assert.deepEqual(after, before, "source HEAD, branch refs, status and worktree list are unchanged");
}

const alive = (pid) => {
  try { process.kill(pid, 0); return true; } catch { return false; }
};

async function waitDead(pids, ms = 5000) {
  const until = Date.now() + ms;
  while (pids.some(alive) && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 50));
  return pids.filter(alive);
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

// ---------------------------------------------------------------- AT1 adapters

test("AT1 codex builds exact first and resume invocations with the prompt on stdin for each permission profile", T, () => {
  assert.deepEqual(codexTool.buildInvocation({ prompt: METACHAR_PROMPT, resume: null, permissionProfile: PermissionProfile.WORKSPACE_EDIT }),
    { args: ["exec", "--json", "--skip-git-repo-check", "--sandbox", "workspace-write", "-"], stdin: METACHAR_PROMPT });
  assert.deepEqual(codexTool.buildInvocation({ prompt: "p", resume: null, model: "gpt-x", permissionProfile: PermissionProfile.FULL_AUTO }),
    { args: ["exec", "--json", "--skip-git-repo-check", "--sandbox", "danger-full-access", "--model", "gpt-x", "-"], stdin: "p" });
  assert.deepEqual(codexTool.buildInvocation({ prompt: "again", resume: { sessionRef: "thread-9" }, permissionProfile: PermissionProfile.WORKSPACE_EDIT }),
    { args: ["exec", "resume", "thread-9", "--json", "-"], stdin: "again" });
  assert.deepEqual(codexTool.buildInvocation({ prompt: "again", resume: { sessionRef: null }, permissionProfile: PermissionProfile.WORKSPACE_EDIT }),
    codexTool.buildInvocation({ prompt: "again", resume: null, permissionProfile: PermissionProfile.WORKSPACE_EDIT }),
    "a resume without a session id builds a fresh first invocation");
  const parsed = codexTool.parseResult({ exitCode: 0, stdout: '{"type":"thread.started","thread_id":"th-1"}\nnoise\n{"type":"item.completed","item":{"type":"agent_message","text":"done"}}\n', stderr: "" });
  assert.deepEqual(parsed, { claimedSuccess: true, finalMessage: "done", sessionRef: "th-1" });
  assert.equal(codexTool.parseResult({ exitCode: 1, stdout: "", stderr: "x" }).claimedSuccess, false);
});

test("AT1 kiro builds exact first and resume invocations with the prompt as one argument", T, () => {
  assert.deepEqual(kiroTool.buildInvocation({ prompt: METACHAR_PROMPT, resume: null, permissionProfile: PermissionProfile.WORKSPACE_EDIT }),
    { args: ["chat", "--no-interactive", "--trust-tools=fs_read,fs_write", METACHAR_PROMPT], stdin: null });
  assert.deepEqual(kiroTool.buildInvocation({ prompt: "p", resume: { sessionRef: "ignored" }, model: "m1", permissionProfile: PermissionProfile.FULL_AUTO }),
    { args: ["chat", "--resume", "--no-interactive", "--trust-all-tools", "--model", "m1", "p"], stdin: null });
  assert.deepEqual(kiroTool.parseResult({ exitCode: 0, stdout: "Finished.\n", stderr: "" }), { claimedSuccess: true, finalMessage: "Finished.", sessionRef: null });
});

test("AT1 agy builds exact first and resume invocations with a seconds print timeout and log file", T, () => {
  assert.deepEqual(agyTool.buildInvocation({ prompt: METACHAR_PROMPT, resume: null, permissionProfile: PermissionProfile.WORKSPACE_EDIT, logFile: "/tmp/a.log", timeoutMs: 90001 }),
    { args: ["--print", METACHAR_PROMPT, "--mode", "accept-edits", "--print-timeout", "91s", "--log-file", "/tmp/a.log"], stdin: null });
  assert.deepEqual(agyTool.buildInvocation({ prompt: "p", resume: { sessionRef: null }, model: "g", permissionProfile: PermissionProfile.FULL_AUTO, logFile: "/tmp/b.log", timeoutMs: 600000 }),
    { args: ["--continue", "--print", "p", "--dangerously-skip-permissions", "--print-timeout", "600s", "--model", "g", "--log-file", "/tmp/b.log"], stdin: null });
  assert.equal(agyTool.parseResult({ exitCode: 0, stdout: "ok", stderr: "" }).sessionRef, null);
  assert.throws(() => agyTool.buildInvocation({ prompt: "p", resume: null, permissionProfile: PermissionProfile.WORKSPACE_EDIT, timeoutMs: 1000 }), /logFile/);
});

test("AT1 invalid requests are rejected and defineAgentTool replaces only the launch tuple", T, () => {
  for (const tool of Object.values(AGENT_TOOLS)) {
    assert.throws(() => tool.buildInvocation({ prompt: "", resume: null, permissionProfile: PermissionProfile.WORKSPACE_EDIT, logFile: "l", timeoutMs: 1 }), /non-empty prompt/);
    assert.throws(() => tool.buildInvocation({ prompt: "p", resume: null, permissionProfile: "YOLO", logFile: "l", timeoutMs: 1 }), /unknown permission profile/);
  }
  const replaced = defineAgentTool(codexTool, { command: "/opt/node", prefixArgs: ["/opt/codex.js"] });
  assert.equal(replaced.command, "/opt/node");
  assert.deepEqual(replaced.prefixArgs, ["/opt/codex.js"]);
  assert.equal(replaced.buildInvocation, codexTool.buildInvocation);
  assert.equal(replaced.parseResult, codexTool.parseResult);
  assert.deepEqual(defineAgentTool(replaced, { command: "codex" }).prefixArgs, [], "the tuple is replaced atomically");
  assert.throws(() => defineAgentTool(codexTool, { command: "" }), /requires command/);
});

test("AT1 executables resolve without a shell: script paths, POSIX PATH, win32 npm shims and native exe", T, () => {
  const dir = tempDir("bb097-resolve-");
  try {
    assert.deepEqual(resolveExecutable(FAKE), { command: process.execPath, prefixArgs: [FAKE] });
    assert.deepEqual(resolveExecutable("./relative/tool"), { command: "./relative/tool", prefixArgs: [] });
    // npm shims next to node_modules resolve to their JavaScript entry run through node.
    const entry = join(dir, "node_modules", "@openai", "codex", "bin", "codex.js");
    mkdirSync(dirname(entry), { recursive: true });
    writeFileSync(entry, "");
    writeFileSync(join(dir, "codex.cmd"), '@ECHO off\r\n"%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n');
    assert.deepEqual(resolveExecutable("codex", { platform: "win32", pathEnv: `C:\\missing;${dir}` }), { command: process.execPath, prefixArgs: [entry] });
    const kiroEntry = join(dir, "node_modules", "kiro", "cli.mjs");
    mkdirSync(dirname(kiroEntry), { recursive: true });
    writeFileSync(kiroEntry, "");
    writeFileSync(join(dir, "kiro-cli.ps1"), '#!/usr/bin/env pwsh\n$basedir=Split-Path $MyInvocation.MyCommand.Definition -Parent\n& "node$exe"  "$basedir/node_modules/kiro/cli.mjs" $args\n');
    assert.deepEqual(resolveExecutable("kiro-cli", { platform: "win32", pathEnv: dir }), { command: process.execPath, prefixArgs: [kiroEntry] });
    writeFileSync(join(dir, "agy.exe"), "MZ");
    assert.deepEqual(resolveExecutable("agy", { platform: "win32", pathEnv: dir }), { command: join(dir, "agy.exe"), prefixArgs: [] });
    writeFileSync(join(dir, "plain.cmd"), "@echo plain\r\n");
    assert.equal(resolveExecutable("plain", { platform: "win32", pathEnv: dir }), null, "a non-npm .cmd would need cmd.exe and is never used");
    const posix = join(dir, "posix-tool");
    writeFileSync(posix, "#!/bin/sh\necho hi\n");
    chmodSync(posix, 0o755);
    assert.deepEqual(resolveExecutable("posix-tool", { platform: "linux", pathEnv: `/missing:${dir}` }), { command: posix, prefixArgs: [] });
    assert.equal(resolveExecutable("definitely-not-installed", { platform: "linux", pathEnv: dir }), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("AT1 each adapter launches the fake CLI with the exact recorded argv and stdin, and a missing tool is TOOL_UNAVAILABLE", T, async () => {
  const dir = tempDir("bb097-argv-");
  try {
    for (const base of [codexTool, kiroTool, agyTool]) {
      const record = join(dir, `${base.id}.json`);
      const request = { prompt: METACHAR_PROMPT, resume: null, permissionProfile: PermissionProfile.WORKSPACE_EDIT, logFile: join(dir, "agy.log") };
      const run = await runAgentInvocation(fakeTool(base), request, { cwd: dir, env: { FAKE_AGENT_SCENARIO: "CLAIM_SUCCESS_NO_EDIT", FAKE_AGENT_RECORD: record }, timeoutMs: 20000 });
      assert.equal(run.status, InvocationStatus.COMPLETED);
      assert.equal(run.exitCode, 0);
      const [seen] = readRecords(record);
      const expected = base.buildInvocation({ ...request, timeoutMs: 20000 });
      assert.deepEqual(seen.argv, expected.args, `${base.id} argv is exact`);
      assert.equal(seen.stdin, expected.stdin ?? "", `${base.id} stdin is exact`);
      assert.ok(seen.argv.includes(METACHAR_PROMPT) || seen.stdin === METACHAR_PROMPT, `${base.id} receives the prompt verbatim`);
    }
    assert.equal(existsSync(join(dir, "pwned")), false);
    const missing = await runAgentInvocation(defineAgentTool(codexTool, { command: join(dir, "no-such-codex") }), { prompt: "p", resume: null }, { cwd: dir, timeoutMs: 5000 });
    assert.equal(missing.status, InvocationStatus.TOOL_UNAVAILABLE);
    assert.equal(missing.exitCode, null);
    assert.equal(missing.timedOut, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- AT2 process runner

test("AT2 a prompt with shell metacharacters reaches the tool verbatim and is never interpreted", T, async () => {
  const dir = tempDir("bb097-meta-");
  try {
    for (const base of [codexTool, kiroTool]) {
      const record = join(dir, `${base.id}.json`);
      await runAgentInvocation(fakeTool(base), { prompt: METACHAR_PROMPT, resume: null }, { cwd: dir, env: { FAKE_AGENT_SCENARIO: "CLAIM_SUCCESS_NO_EDIT", FAKE_AGENT_RECORD: record }, timeoutMs: 20000 });
      const [seen] = readRecords(record);
      assert.equal(base.id === "codex" ? seen.stdin : seen.argv.at(-1), METACHAR_PROMPT);
    }
    for (const name of ["pwned", "pwned2", "y", "out"]) assert.equal(existsSync(join(dir, name)), false, `${name} was not created by a shell`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("AT2 output is bounded per stream while the digest covers the full stream", T, async () => {
  const dir = tempDir("bb097-bounded-");
  try {
    const run = await runAgentInvocation(fakeTool(kiroTool), { prompt: "p", resume: null }, {
      cwd: dir,
      env: { FAKE_AGENT_SCENARIO: "CLAIM_SUCCESS_NO_EDIT", FAKE_AGENT_OUTPUT_BYTES: "300000" },
      timeoutMs: 20000,
      maxOutputBytes: 4096
    });
    const full = `All tests pass. Task complete.\n${"o".repeat(300000)}`;
    assert.equal(Buffer.byteLength(run.stdout), 4096);
    assert.equal(run.stdout, full.slice(0, 4096));
    assert.equal(run.stdoutSha256, sha256(full));
    assert.equal(run.stderrSha256, sha256(""));
    assert.deepEqual(run.truncated, { stdout: true, stderr: false });
    assert.equal(run.timedOut, false);
    assert.ok(Number.isInteger(run.durationMs));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("AT2 a missing executable is TOOL_UNAVAILABLE without throwing", T, async () => {
  const run = await runAgentInvocation(defineAgentTool(kiroTool, { command: "exharness-no-such-tool-bb097" }), { prompt: "p", resume: null }, { cwd: tmpdir(), timeoutMs: 5000 });
  assert.equal(run.status, InvocationStatus.TOOL_UNAVAILABLE);
  assert.equal(run.exitCode, null);
  assert.equal(run.timedOut, false);
});

test("AT2 a hung tool is killed at timeoutMs together with its process tree", T, async () => {
  const dir = tempDir("bb097-hang-");
  try {
    const record = join(dir, "record.json");
    const started = Date.now();
    const run = await runAgentInvocation(fakeTool(agyTool), { prompt: "p", resume: null, logFile: join(dir, "agy.log") }, { cwd: dir, env: { FAKE_AGENT_SCENARIO: "HANG", FAKE_AGENT_RECORD: record }, timeoutMs: 1500 });
    assert.equal(run.status, InvocationStatus.TIMED_OUT);
    assert.equal(run.timedOut, true);
    assert.ok(Date.now() - started < 15000);
    const [seen] = readRecords(record);
    assert.ok(Number.isInteger(seen.pid) && Number.isInteger(seen.childPid), "the fake recorded its pid and its child pid");
    assert.deepEqual(await waitDead([seen.pid, seen.childPid]), [], "no process of the tree is alive");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- AT3 supervisor

test("AT3 a verified candidate is promoted: ACCEPTED with one ExHarness commit and the source repository preserved", T, async () => {
  const run = await supervised("FIX_FIRST");
  assert.equal(run.result.status, AgentTaskStatus.ACCEPTED);
  assert.equal(run.result.tool, "codex");
  assert.equal(run.result.toolVersion, "fake-agent 0.0.0");
  assert.equal(run.result.attempts.length, 1);
  const [attempt] = run.result.attempts;
  assert.equal(attempt.outcome, AttemptOutcome.CANDIDATE_CREATED);
  assert.equal(attempt.mutated, true);
  assert.equal(attempt.resume, null);
  assert.deepEqual(attempt.verification, [{ name: "unit", status: "PASS", reason: "PASS" }]);
  assert.equal(run.result.acceptedSha, attempt.candidateSha);
  assert.match(run.result.acceptedSha, /^[0-9a-f]{40}$/);
  assert.equal(run.commits[run.result.acceptedSha].fromBase, "1");
  assert.equal(run.commits[run.result.acceptedSha].files["sum.mjs"], "export const sum = (a, b) => a + b;");
  assertSourcePreserved(run);
});

test("AT3 failed verification is fed back through resume and the fix is accepted on the next attempt", T, async () => {
  const run = await supervised("FIX_AFTER_FEEDBACK");
  assert.equal(run.result.status, AgentTaskStatus.ACCEPTED);
  assert.deepEqual(run.result.attempts.map((attempt) => attempt.outcome), [AttemptOutcome.NO_CHANGE, AttemptOutcome.CANDIDATE_CREATED]);
  assert.equal(run.result.attempts[0].verification[0].status, "FAIL");
  assert.deepEqual(run.result.attempts[1].resume, { sessionRef: "fake-1" }, "codex resumes the session id from the first --json stream");
  assert.deepEqual(run.records[1].argv, ["exec", "resume", "fake-1", "--json", "-"]);
  assert.ok(run.records[1].stdin.startsWith("Fix sum in sum.mjs"), "the complete task is sent again");
  assert.ok(run.records[1].stdin.split("\n").includes(FEEDBACK_HEADER));
  assert.match(run.records[1].stdin, /- unit: FAIL FAIL/);
  assert.equal(run.result.attempts[1].feedbackChars, run.records[1].stdin.length - "Fix sum in sum.mjs so that sum(a, b) returns a + b.\n\n".length);
  assertSourcePreserved(run);
});

test("AT3 a tool that never fixes ends EXHAUSTED after exactly maxAttempts without promotion", T, async () => {
  const run = await supervised("NEVER_FIX", { tool: kiroTool, maxAttempts: 3 });
  assert.equal(run.result.status, AgentTaskStatus.EXHAUSTED);
  assert.equal(run.result.acceptedSha, null);
  assert.equal(run.result.attempts.length, 3);
  assert.equal(run.records.length, 3);
  assert.ok(run.result.attempts.every((attempt) => attempt.outcome === AttemptOutcome.CANDIDATE_CREATED && attempt.claimedSuccess === true));
  assert.ok(run.result.attempts.every((attempt) => attempt.verification[0].status === "FAIL"), "the agent's claim never counts as verification");
  assert.deepEqual(run.records.map((seen) => seen.argv[1]), ["--no-interactive", "--resume", "--resume"]);
  assertSourcePreserved(run);
});

test("AT3 a tool that claims success without editing is NO_CHANGE and never ACCEPTED", T, async () => {
  const run = await supervised("CLAIM_SUCCESS_NO_EDIT", { tool: agyTool, maxAttempts: 2 });
  assert.equal(run.result.status, AgentTaskStatus.EXHAUSTED);
  assert.deepEqual(run.result.attempts.map((attempt) => [attempt.outcome, attempt.mutated, attempt.claimedSuccess, attempt.exitCode]),
    [[AttemptOutcome.NO_CHANGE, false, true, 0], [AttemptOutcome.NO_CHANGE, false, true, 0]]);
  assert.equal(run.records[1].argv[0], "--continue");
  assertSourcePreserved(run);
});

test("AT3 commits made by the agent are folded into exactly one candidate commit", T, async () => {
  const run = await supervised("SELF_COMMIT");
  assert.equal(run.result.status, AgentTaskStatus.ACCEPTED);
  assert.equal(run.result.attempts[0].foldedAgentCommits, 2);
  assert.equal(run.commits[run.result.acceptedSha].fromBase, "1");
  assert.equal(run.commits[run.result.acceptedSha].parent, run.base);
  assert.equal(run.commits[run.result.acceptedSha].files["notes.txt"], "working on sum");
  assert.equal(run.commits[run.result.acceptedSha].files["sum.mjs"], "export const sum = (a, b) => a + b;");
  assertSourcePreserved(run);
});

test("AT3 a partial edit is rejected, its feedback drives the fix, and the accepted candidate builds on it", T, async () => {
  const run = await supervised("PARTIAL_THEN_FIX", { tool: kiroTool });
  assert.equal(run.result.status, AgentTaskStatus.ACCEPTED);
  const [first, second] = run.result.attempts;
  assert.equal(first.outcome, AttemptOutcome.CANDIDATE_CREATED);
  assert.equal(first.verification[0].status, "FAIL");
  assert.equal(second.outcome, AttemptOutcome.CANDIDATE_CREATED);
  assert.equal(run.commits[run.result.acceptedSha].parent, first.candidateSha);
  assert.equal(run.commits[first.candidateSha].files["notes.txt"], "unrelated edit");
  assert.ok(run.records[1].argv.at(-1).includes(FEEDBACK_HEADER));
  assertSourcePreserved(run);
});

test("AT3 a failing tool, a missing tool and an invalid task are never ACCEPTED", T, async () => {
  const auth = await supervised("AUTH_FAIL", { maxAttempts: 1 });
  assert.equal(auth.result.status, AgentTaskStatus.EXHAUSTED);
  assert.deepEqual([auth.result.attempts[0].exitCode, auth.result.attempts[0].mutated, auth.result.attempts[0].claimedSuccess], [3, false, false]);
  assertSourcePreserved(auth);

  const { root, base } = sourceRepository();
  const scratch = tempDir("bb097-invalid-");
  try {
    const before = repositorySnapshot(root);
    const missing = await runSupervisedTask({ tool: defineAgentTool(codexTool, { command: join(scratch, "no-codex") }), task: taskFor(root, base), maxAttempts: 2, timeoutMs: 5000 });
    assert.equal(missing.status, AgentTaskStatus.TOOL_UNAVAILABLE);
    assert.equal(missing.acceptedSha, null);
    assert.equal(missing.toolVersion, null);
    assert.equal(missing.attempts.length, 1);
    assert.deepEqual(repositorySnapshot(root), before);

    const record = join(scratch, "record.json");
    for (const task of [
      taskFor(root, "abc"),
      taskFor(root, base, { verifications: [] }),
      taskFor(root, base, { verifications: [{ name: "a", command: "node", args: [], timeoutMs: 1 }, { name: "a", command: "node", args: [], timeoutMs: 1 }] }),
      taskFor(root, base, { verifications: [{ name: "a", command: "", args: [], timeoutMs: 1 }] }),
      taskFor(root, base, { verifications: [{ name: "a", command: "node", args: [1], timeoutMs: 1 }] }),
      taskFor(root, base, { verifications: [{ name: "a", command: "node", args: [], timeoutMs: 0 }] }),
      taskFor(root, base, { prompt: "" })
    ]) {
      await assert.rejects(runSupervisedTask({ tool: fakeTool(codexTool), task, env: { FAKE_AGENT_RECORD: record } }), /AGENT_TASK_V1 invalid/);
    }
    assert.equal(existsSync(record), false, "no process started for an invalid task");
    assert.deepEqual(repositorySnapshot(root), before);
    assert.ok(validateAgentTask(taskFor(root, base)));
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("AT3 verification feedback is bounded by maxFeedbackChars", T, async () => {
  const long = [{ name: "unit", status: "FAIL", reason: "FAIL", output: "x".repeat(20000) }, { name: "lint", status: "INCONCLUSIVE", reason: "TIMEOUT", output: "y".repeat(20000) }];
  const block = buildFeedback(long, 600);
  assert.ok(block.length <= 600);
  assert.ok(block.startsWith(`${FEEDBACK_HEADER}\n- unit: FAIL FAIL`));
  assert.match(block, /- lint: INCONCLUSIVE TIMEOUT/);
  const run = await supervised("NEVER_FIX", { maxAttempts: 2, maxFeedbackChars: 300 });
  assert.ok(run.result.attempts[1].feedbackChars > 0 && run.result.attempts[1].feedbackChars <= 300);
  assertSourcePreserved(run);
});

// ---------------------------------------------------------------- AT4 CLI and docs

test("AT4 run prints AGENT_SUPERVISED_RESULT_V1 and reports ACCEPTED only after passing verification", T, async () => {
  const { root, base } = sourceRepository();
  const scratch = tempDir("bb097-cli-");
  try {
    const taskPath = join(scratch, "task.json");
    writeFileSync(taskPath, JSON.stringify(taskFor(root, base)));
    const accepted = await runBin(["run", "--tool", "codex", "--task", taskPath, "--command", FAKE, "--max-attempts", "2", "--timeout-ms", "20000"], { FAKE_AGENT_SCENARIO: "FIX_FIRST" });
    assert.equal(accepted.code, 0, accepted.stderr);
    assert.equal(accepted.json.status, AgentTaskStatus.ACCEPTED);
    assert.equal(accepted.json.attempts[0].verification[0].status, "PASS");
    const exhausted = await runBin(["run", "--tool", "kiro", "--task", taskPath, "--command", FAKE, "--max-attempts", "2", "--timeout-ms", "20000"], { FAKE_AGENT_SCENARIO: "CLAIM_SUCCESS_NO_EDIT" });
    assert.equal(exhausted.code, 1);
    assert.equal(exhausted.json.status, AgentTaskStatus.EXHAUSTED);
    assert.equal(exhausted.json.acceptedSha, null);
    const missing = await runBin(["run", "--tool", "agy", "--task", taskPath], { PATH: scratch, Path: scratch });
    assert.equal(missing.code, 2);
    assert.equal(missing.json.status, AgentTaskStatus.TOOL_UNAVAILABLE);
    const usage = await runBin(["run", "--tool", "cursor", "--task", taskPath]);
    assert.equal(usage.code, 64);
    assert.match(usage.stderr, /unknown --tool/);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("AT4 smoke skips missing and unauthenticated tools and never reports ACCEPTED without passing verification", T, async () => {
  const empty = tempDir("bb097-empty-path-");
  try {
    const notInstalled = await runBin(["smoke", "--tool", "codex"], { PATH: empty, Path: empty });
    assert.equal(notInstalled.code, 0);
    assert.deepEqual([notInstalled.json.smoke, notInstalled.json.reason], ["SKIPPED", "NOT_INSTALLED"]);
    const missingCommand = await runBin(["smoke", "--tool", "agy", "--command", join(empty, "agy")]);
    assert.deepEqual([missingCommand.json.smoke, missingCommand.json.reason], ["SKIPPED", "NOT_INSTALLED"]);
    const unauthenticated = await runBin(["smoke", "--tool", "kiro", "--command", FAKE, "--timeout-ms", "20000"], { FAKE_AGENT_SCENARIO: "AUTH_FAIL" });
    assert.deepEqual([unauthenticated.json.smoke, unauthenticated.json.reason], ["SKIPPED", "TOOL_FAILED_BEFORE_EDIT"]);
    assert.notEqual(unauthenticated.json.result.status, AgentTaskStatus.ACCEPTED);
    const never = await runBin(["smoke", "--tool", "codex", "--command", FAKE, "--timeout-ms", "20000"], { FAKE_AGENT_SCENARIO: "NEVER_FIX" });
    assert.equal(never.json.smoke, AgentTaskStatus.EXHAUSTED);
    assert.equal(never.code, 1);
    const fixed = await runBin(["smoke", "--tool", "codex", "--command", FAKE, "--timeout-ms", "20000"], { FAKE_AGENT_SCENARIO: "FIX_FIRST" });
    assert.equal(fixed.json.smoke, AgentTaskStatus.ACCEPTED);
    assert.equal(fixed.json.result.attempts.at(-1).verification[0].status, "PASS");
    const probe = await runBin(["probe"], { PATH: empty, Path: empty });
    assert.deepEqual(probe.json.tools, { codex: { installed: false, version: null }, kiro: { installed: false, version: null }, agy: { installed: false, version: null }, grok: { installed: false, version: null }, opencode: { installed: false, version: null } });
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});

test("AT4 root scripts run agent-tools tests in npm test while live smoke stays out of test and verify", T, () => {
  const scripts = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")).scripts;
  assert.equal(scripts["test:agent-tools"], "node --test packages/agent-tools/test/*.test.js");
  assert.match(scripts.test, /npm run test:agent-tools/);
  assert.equal(scripts["smoke:agent-tools"], "node packages/agent-tools/bin/exharness-agent.mjs smoke");
  for (const name of ["test", "verify"]) assert.doesNotMatch(scripts[name], /smoke:agent-tools|exharness-agent\.mjs smoke/, `${name} runs no live agent`);
});

test("AT4 the Living doc states the trust boundary", T, () => {
  const doc = readFileSync(join(REPO_ROOT, "docs", "living", "system", "agent-tools", "state.md"), "utf8");
  assert.match(doc, /not a sandbox/i);
  assert.match(doc, /user's CLI permissions/i);
  assert.match(doc, /temporary git worktree/i);
  assert.match(doc, /isolation/i);
});
