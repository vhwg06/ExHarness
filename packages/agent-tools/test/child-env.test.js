// BB-120 child environment trust boundary: allowlisted inheritance, declared
// per-tool auth passthrough and caller overlay forwarded through the bin.
// Host process.env secrets are never copied wholesale; NODE_TEST_CONTEXT is
// always stripped. The package is still not a sandbox.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AGENT_CHILD_INHERITED_ENV,
  agyTool,
  binOverlayEnv,
  codexTool,
  defineAgentTool,
  grokTool,
  kiroTool,
  opencodeTool,
  runAgentInvocation,
  runProcess
} from "../src/index.js";
import { AGENT_CHILD_INHERITED_ENV as RUNNER_ALLOWLIST } from "../src/process-runner.js";
import { auditPaths } from "./scope-audit.mjs";

const T = { timeout: 60000 };
const here = dirname(fileURLToPath(import.meta.url));
const BIN = join(here, "..", "bin", "exharness-agent.mjs");
const REPO_ROOT = join(here, "..", "..", "..");

// Dumps the child process environment as JSON on stdout.
const DUMP = [
  "process.stdout.write(JSON.stringify({",
  "keys:Object.keys(process.env),",
  "planted:process.env.EXHARNESS_PLANTED_SECRET??null,",
  "aws:process.env.AWS_SECRET_ACCESS_KEY??null,",
  "nodeTestContext:process.env.NODE_TEST_CONTEXT??null,",
  "fakeScenario:process.env.FAKE_AGENT_SCENARIO??null,",
  "overlayProbe:process.env.EXHARNESS_OVERLAY_PROBE??null,",
  "authProbe:process.env.EXHARNESS_AUTH_PROBE??null,",
  "undeclared:process.env.EXHARNESS_UNDECLARED??null,",
  "path:process.env.PATH??null,",
  "home:process.env.HOME??null",
  "}))"
].join("");

function tempDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** Plants entries on process.env; returns a restore function for finally blocks. */
function plantEnv(entries) {
  const previous = {};
  for (const [key, value] of Object.entries(entries)) {
    previous[key] = Object.prototype.hasOwnProperty.call(process.env, key) ? process.env[key] : undefined;
    process.env[key] = value;
  }
  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

async function childEnvViaRunProcess(overlay) {
  const run = await runProcess(process.execPath, ["-e", DUMP], { cwd: REPO_ROOT, env: overlay, timeoutMs: 30000, maxOutputBytes: 65536 });
  assert.equal(run.status, "COMPLETED");
  assert.equal(run.exitCode, 0, run.stderr);
  return JSON.parse(run.stdout);
}

const probeTool = (authEnvNames) => defineAgentTool({
  id: "env-probe",
  command: process.execPath,
  prefixArgs: [],
  versionArgs: ["--version"],
  authEnvNames,
  buildInvocation: () => ({ args: ["-e", DUMP], stdin: null }),
  parseResult: ({ stdout }) => ({ claimedSuccess: true, finalMessage: stdout, sessionRef: null })
});

async function childEnvViaInvocation(tool, overlay) {
  const run = await runAgentInvocation(tool, { prompt: "probe" }, { cwd: REPO_ROOT, env: overlay, timeoutMs: 30000, maxOutputBytes: 65536 });
  assert.equal(run.status, "COMPLETED");
  assert.equal(run.exitCode, 0, run.stderr);
  return JSON.parse(run.stdout);
}

function git(cwd, ...args) {
  const result = spawnSync("git", args, {
    cwd,
    shell: false,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@localhost.invalid", GIT_COMMITTER_NAME: "t@localhost.invalid", GIT_COMMITTER_EMAIL: "t@localhost.invalid" }
  });
  assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

function runBin(args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BIN, ...args], { shell: false, env: { ...process.env, ...env } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("EN1 AGENT_CHILD_INHERITED_ENV is exported and the child copies only those names", T, async () => {
  assert.ok(Object.isFrozen(AGENT_CHILD_INHERITED_ENV), "index export is frozen");
  assert.ok(Object.isFrozen(RUNNER_ALLOWLIST), "process-runner export is frozen");
  assert.deepEqual([...AGENT_CHILD_INHERITED_ENV], [...RUNNER_ALLOWLIST]);
  assert.ok(AGENT_CHILD_INHERITED_ENV.includes("PATH"));
  assert.ok(AGENT_CHILD_INHERITED_ENV.includes("HOME"));
  const restore = plantEnv({ EXHARNESS_PLANTED_SECRET: "en1-secret", AWS_SECRET_ACCESS_KEY: "en1-aws" });
  try {
    const child = await childEnvViaRunProcess({});
    assert.ok(!child.keys.includes("EXHARNESS_PLANTED_SECRET"), "no wholesale process.env spread");
    assert.ok(!child.keys.includes("AWS_SECRET_ACCESS_KEY"), "no wholesale process.env spread");
    for (const key of child.keys) {
      assert.ok(AGENT_CHILD_INHERITED_ENV.includes(key), `child key ${key} is allowlisted`);
    }
  } finally {
    restore();
  }
});

async function childEnvViaRunProcessInline(overlay) {
  const run = await runProcess(process.execPath, ["-e", DUMP], { cwd: REPO_ROOT, env: overlay, timeoutMs: 30000, maxOutputBytes: 65536 });
  assert.equal(run.status, "COMPLETED");
  assert.equal(run.exitCode, 0, run.stderr);
  return JSON.parse(run.stdout);
}

test("EN2 planted EXHARNESS_PLANTED_SECRET is not inherited", T, async () => {
  const restore = plantEnv({ EXHARNESS_PLANTED_SECRET: "en2-secret" });
  try {
    const run = await runProcess(process.execPath, ["-e", DUMP], { cwd: REPO_ROOT, env: {}, timeoutMs: 30000, maxOutputBytes: 65536 });
    assert.equal(run.status, "COMPLETED");
    const bare = JSON.parse(run.stdout);
    assert.equal(bare.planted, null);
  } finally {
    restore();
  }
});

test("EN2 planted AWS_SECRET_ACCESS_KEY is not inherited", T, async () => {
  const restore = plantEnv({ AWS_SECRET_ACCESS_KEY: "en2-aws" });
  try {
    const run = await runProcess(process.execPath, ["-e", DUMP], { cwd: REPO_ROOT, env: {}, timeoutMs: 30000, maxOutputBytes: 65536 });
    assert.equal(run.status, "COMPLETED");
    const bare = JSON.parse(run.stdout);
    assert.equal(bare.aws, null);
  } finally {
    restore();
  }
});

test("EN2 overlay key not on allowlist is present", T, async () => {
  const restore = plantEnv({ EXHARNESS_PLANTED_SECRET: "en2-secret" });
  try {
    const run = await runProcess(process.execPath, ["-e", DUMP], { cwd: REPO_ROOT, env: { EXHARNESS_OVERLAY_PROBE: "yes", EXHARNESS_PLANTED_SECRET: "via-overlay" }, timeoutMs: 30000, maxOutputBytes: 65536 });
    assert.equal(run.status, "COMPLETED");
    const overlaid = JSON.parse(run.stdout);
    assert.equal(overlaid.overlayProbe, "yes");
    assert.equal(overlaid.planted, "via-overlay", "overlay keys present even off the allowlist");
  } finally {
    restore();
  }
});

test("EN3 NODE_TEST_CONTEXT is absent from the child", T, async () => {
  const restore = plantEnv({ NODE_TEST_CONTEXT: "parent-context" });
  try {
    const run1 = await runProcess(process.execPath, ["-e", DUMP], { cwd: REPO_ROOT, env: {}, timeoutMs: 30000, maxOutputBytes: 65536 });
    const bare = JSON.parse(run1.stdout);
    assert.equal(bare.nodeTestContext, null);
    const run2 = await runProcess(process.execPath, ["-e", DUMP], { cwd: REPO_ROOT, env: { NODE_TEST_CONTEXT: "overlay-context" }, timeoutMs: 30000, maxOutputBytes: 65536 });
    const overlaid = JSON.parse(run2.stdout);
    assert.equal(overlaid.nodeTestContext, null, "stripped even from the overlay");
  } finally {
    restore();
  }
});

test("EN4 PATH and HOME are inherited when set on the parent", T, async () => {
  const child = await childEnvViaRunProcess({});
  if (process.env.PATH !== undefined) assert.equal(child.path, process.env.PATH);
  if (process.env.HOME !== undefined) assert.equal(child.home, process.env.HOME);
});

test("EN5 declared auth name is forwarded but undeclared ambient auth is not", T, async () => {
  const restore = plantEnv({ EXHARNESS_AUTH_PROBE: "auth-value", EXHARNESS_UNDECLARED: "ambient-value" });
  try {
    const tool = probeTool(["EXHARNESS_AUTH_PROBE"]);
    assert.ok(Object.isFrozen(tool.authEnvNames));
    const run1 = await runAgentInvocation(tool, { prompt: "probe" }, { cwd: REPO_ROOT, env: {}, timeoutMs: 30000, maxOutputBytes: 65536 });
    assert.equal(run1.status, "COMPLETED");
    const passed = JSON.parse(run1.stdout);
    assert.equal(passed.authProbe, "auth-value");
    assert.equal(passed.undeclared, null);
    const run2 = await runAgentInvocation(tool, { prompt: "probe" }, { cwd: REPO_ROOT, env: { EXHARNESS_AUTH_PROBE: "overlay-wins" }, timeoutMs: 30000, maxOutputBytes: 65536 });
    const overlayWins = JSON.parse(run2.stdout);
    assert.equal(overlayWins.authProbe, "overlay-wins", "caller overlay wins over auth passthrough");
    const undeclaredTool = probeTool([]);
    const run3 = await runAgentInvocation(undeclaredTool, { prompt: "probe" }, { cwd: REPO_ROOT, env: {}, timeoutMs: 30000, maxOutputBytes: 65536 });
    const dropped = JSON.parse(run3.stdout);
    assert.equal(dropped.authProbe, null);
    assert.equal(dropped.undeclared, null);
  } finally {
    restore();
  }
});

test("EN5 delivered adapters declare empty authEnvNames", T, () => {
  for (const tool of [codexTool, kiroTool, agyTool, grokTool, opencodeTool]) {
    assert.deepEqual([...tool.authEnvNames], [], `${tool.id} declares no auth names`);
    assert.ok(Object.isFrozen(tool.authEnvNames), `${tool.id} authEnvNames is frozen`);
  }
});

test("EN6 bin forwards FAKE_AGENT_SCENARIO and --env into the supervised child", T, async () => {
  const overlay = binOverlayEnv(
    { FAKE_AGENT_SCENARIO: "from-bin", OTHER: "dropped", FAKE_AGENT_RECORD: "/tmp/r" },
    [{ name: "EN6_EXTRA", value: "yes" }, { name: "FAKE_AGENT_SCENARIO", value: "from-flag" }]
  );
  assert.deepEqual(overlay, { FAKE_AGENT_SCENARIO: "from-flag", FAKE_AGENT_RECORD: "/tmp/r", EN6_EXTRA: "yes" });

  const malformed = await runBin(["run", "--tool", "codex", "--task", "x", "--env", "NO_EQUALS"], {});
  assert.equal(malformed.code, 64, `malformed --env is a usage error: ${malformed.stderr}`);

  // Spawn the bin as the AT4/GR3 tests do: FAKE_AGENT_* in the bin env plus --env
  // flags must reach the supervised child, while planted host secrets must not.
  const root = tempDir("bb120-en6-repo-");
  const scratch = tempDir("bb120-en6-");
  const restore = plantEnv({ EXHARNESS_PLANTED_SECRET: "en6-secret" });
  try {
    git(root, "init", "-q");
    git(root, "checkout", "-q", "-b", "main");
    writeFileSync(join(root, "noop.txt"), "noop\n");
    git(root, "add", "-A");
    git(root, "-c", "commit.gpgsign=false", "commit", "-q", "-m", "noop");
    const base = git(root, "rev-parse", "HEAD");
    const dumpScript = join(scratch, "env-dump.mjs");
    writeFileSync(dumpScript, 'import { writeFileSync } from "node:fs";\nwriteFileSync(process.env.EN6_DUMP_PATH, JSON.stringify(process.env));\n');
    const dumpPath = join(scratch, "child-env.json");
    const taskPath = join(scratch, "task.json");
    writeFileSync(taskPath, JSON.stringify({
      id: "en6-bin-probe",
      repositoryRoot: root,
      baseRevision: base,
      prompt: "noop",
      verifications: [{ name: "noop", command: process.execPath, args: ["-e", ""], timeoutMs: 30000 }]
    }));
    const result = await runBin(
      ["run", "--tool", "codex", "--task", taskPath, "--command", dumpScript, "--max-attempts", "1", "--timeout-ms", "30000",
        "--env", `EN6_DUMP_PATH=${dumpPath}`, "--env", "EN6_EXTRA=yes"],
      { FAKE_AGENT_SCENARIO: "EN6_BIN" }
    );
    const childEnv = JSON.parse(readFileSync(dumpPath, "utf8"));
    assert.equal(childEnv.FAKE_AGENT_SCENARIO, "EN6_BIN", `bin stderr: ${result.stderr}`);
    assert.equal(childEnv.EN6_EXTRA, "yes");
    assert.equal(childEnv.EN6_DUMP_PATH, dumpPath);
    assert.equal(childEnv.EXHARNESS_PLANTED_SECRET, undefined, "planted host secret not forwarded");
    assert.equal(childEnv.NODE_TEST_CONTEXT, undefined, "NODE_TEST_CONTEXT stripped");
    assert.ok(typeof childEnv.PATH === "string", "allowlisted PATH inherited");
  } finally {
    restore();
    rmSync(root, { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("EN7 write scope excludes core-harness", T, () => {
  const doc = readFileSync(join(REPO_ROOT, "docs", "living", "system", "agent-tools", "state.md"), "utf8");
  assert.match(doc, /allowlist/i);
  assert.match(doc, /auth passthrough/i);
  assert.match(doc, /overlay/i);
  assert.match(doc, /not a sandbox/i);
  assert.doesNotMatch(doc, /BB-120/, "no Blackboard ids in living docs");
  const plan = JSON.parse(readFileSync(join(REPO_ROOT, "docs", "blackboard", "artifacts", "ready-implement-plan", "BB-120.json"), "utf8"));
  const forbidden = auditPaths(["packages/core-harness/src/x.js"], plan.sourceScope);
  assert.equal(forbidden.forbidden.length, 1);
  const allowed = auditPaths(["packages/agent-tools/src/process-runner.js"], plan.sourceScope);
  assert.equal(allowed.forbidden.length, 0);
  assert.equal(allowed.allowed.length, 1);
});
