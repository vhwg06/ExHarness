import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  BackendContextSchema,
  BackendEvidenceClaim,
  BackendWorkStatus,
  assessBackendCompletion,
  defineBackendObjective,
  makeBackendWorkOrder,
  mapBackendOrderToAgentTask,
  parseBackendWorkOrder,
  runSupervisedBackendWork
} from "../src/index.js";
import {
  AGENT_TOOLS,
  codexTool,
  defineAgentTool
} from "../../agent-tools/src/index.js";

const run = promisify(execFile);
const T = { timeout: 60000 };
const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(here, "..", "..", "..");
const FAKE = join(REPO_ROOT, "packages", "agent-tools", "test", "fixtures", "fake-agent.mjs");
const GIT_ENV = Object.freeze({
  GIT_AUTHOR_NAME: "bb100",
  GIT_AUTHOR_EMAIL: "bb100@localhost.invalid",
  GIT_COMMITTER_NAME: "bb100",
  GIT_COMMITTER_EMAIL: "bb100@localhost.invalid",
  GIT_CONFIG_NOSYSTEM: "1"
});

const fakeTool = (base = codexTool) => defineAgentTool(base, { command: process.execPath, prefixArgs: [FAKE] });

async function git(cwd, args) {
  const { stdout } = await run("git", args, { cwd, shell: false, encoding: "utf8", env: { ...process.env, ...GIT_ENV } });
  return stdout.trim();
}

async function sourceRepository() {
  const directory = await mkdtemp(join(tmpdir(), "bb100-source-"));
  const repo = join(directory, "repo");
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(repo, { recursive: true });
  await writeFile(join(repo, "sum.mjs"), "export const sum = (a, b) => a - b;\n");
  await writeFile(
    join(repo, "sum.test.mjs"),
    "import test from \"node:test\";\nimport assert from \"node:assert/strict\";\nimport { sum } from \"./sum.mjs\";\ntest(\"sum adds\", () => { assert.equal(sum(2, 3), 5); });\n"
  );
  await git(repo, ["init", "-q"]);
  await git(repo, ["checkout", "-q", "-b", "main"]);
  await git(repo, ["add", "-A"]);
  await git(repo, ["-c", "commit.gpgsign=false", "commit", "-q", "-m", "failing sum"]);
  return { directory, repo, base: await git(repo, ["rev-parse", "HEAD"]) };
}

async function disposeSource({ directory }) {
  await rm(directory, { recursive: true, force: true });
}

async function sourceSnapshot(repo) {
  return {
    head: await git(repo, ["rev-parse", "HEAD"]),
    symbolic: await git(repo, ["symbolic-ref", "HEAD"]),
    refs: await git(repo, ["for-each-ref", "--format=%(refname) %(objectname)", "refs/heads"]),
    status: await git(repo, ["status", "--porcelain", "--untracked-files=all"])
  };
}

function backendVerifications() {
  return [
    { name: "typecheck", command: process.execPath, args: ["--test", "sum.test.mjs"], timeoutMs: 30000, claim: BackendEvidenceClaim.TYPECHECK },
    { name: "tests", command: process.execPath, args: ["--test", "sum.test.mjs"], timeoutMs: 30000, claim: BackendEvidenceClaim.TESTS }
  ];
}

function backendOrderContext(base) {
  const order = parseBackendWorkOrder(makeBackendWorkOrder(defineBackendObjective({
    id: "sum-objective",
    task: "Fix sum in sum.mjs so that sum(a, b) returns a + b.",
    repository: { ref: "repo://supervised-backend-test", revision: base },
    requiredFiles: ["sum.mjs"]
  })));
  const context = BackendContextSchema.parse({
    repository: { ref: "repo://supervised-backend-test", revision: base },
    files: [{ path: "sum.mjs", content: "export const sum = (a, b) => a - b;\n", sourceRef: "bb100-fixture" }]
  });
  return { order, context };
}

async function supervisedBackend(scenario, { maxAttempts = 2, tool = null, observer = null, recordIn = null } = {}) {
  const { directory, repo, base } = await sourceRepository();
  const before = await sourceSnapshot(repo);
  const recordsDir = recordIn ?? await mkdtemp(join(tmpdir(), "bb100-records-"));
  const recordPath = join(recordsDir, "record.json");
  const seen = [];
  try {
    const { order, context } = backendOrderContext(base);
    const result = await runSupervisedBackendWork({
      tool: tool ?? fakeTool(),
      order,
      context,
      repositoryRoot: repo,
      verifications: backendVerifications(),
      maxAttempts,
      timeoutMs: 30000,
      env: { FAKE_AGENT_SCENARIO: scenario, FAKE_AGENT_RECORD: recordPath },
      ...(observer ? { invocationObserver: observer(seen) } : {})
    });
    const after = await sourceSnapshot(repo);
    const records = existsSync(recordPath) ? JSON.parse(readFileSync(recordPath, "utf8")) : [];
    return { result, before, after, records, seen, repo, base };
  } finally {
    await disposeSource({ directory });
    if (!recordIn) await rm(recordsDir, { recursive: true, force: true });
  }
}

// SB1: mapping plus default-path isolation.

test("SB1 maps BackendWorkOrder and BackendContext to AGENT_TASK_V1", T, async () => {
  const { directory, repo, base } = await sourceRepository();
  try {
    const { order, context } = backendOrderContext(base);
    const task = mapBackendOrderToAgentTask(order, context, { repositoryRoot: repo, verifications: backendVerifications() });
    assert.equal(task.id, order.id);
    assert.equal(task.repositoryRoot, repo);
    assert.equal(task.baseRevision, order.revision);
    assert.equal(task.prompt, order.task);
    assert.deepEqual(task.verifications, [
      { name: "typecheck", command: process.execPath, args: ["--test", "sum.test.mjs"], timeoutMs: 30000 },
      { name: "tests", command: process.execPath, args: ["--test", "sum.test.mjs"], timeoutMs: 30000 }
    ]);
    assert.ok(!("requiredFiles" in task));
    assert.ok(!("claim" in task.verifications[0]));
    const custom = mapBackendOrderToAgentTask(order, context, {
      repositoryRoot: repo,
      verifications: backendVerifications(),
      prompt: "Custom prompt."
    });
    assert.equal(custom.prompt, "Custom prompt.");
  } finally {
    await disposeSource({ directory });
  }
});

test("SB1 invalid mappings throw TypeError", T, async () => {
  const { directory, repo, base } = await sourceRepository();
  try {
    const { order, context } = backendOrderContext(base);
    const verifications = backendVerifications();
    assert.throws(() => mapBackendOrderToAgentTask(order, context, { verifications }), TypeError);
    assert.throws(() => mapBackendOrderToAgentTask(order, context, { repositoryRoot: "", verifications }), TypeError);
    assert.throws(() => mapBackendOrderToAgentTask(order, context, { repositoryRoot: repo, verifications: [] }), TypeError);
    assert.throws(
      () => mapBackendOrderToAgentTask(order, context, {
        repositoryRoot: repo,
        verifications: verifications.filter((item) => item.claim !== BackendEvidenceClaim.TESTS)
      }),
      TypeError
    );
    assert.throws(
      () => mapBackendOrderToAgentTask(order, context, {
        repositoryRoot: repo,
        verifications: [verifications[0], { ...verifications[1], name: "typecheck-again", claim: verifications[0].claim }]
      }),
      TypeError
    );
    const wrongRef = BackendContextSchema.parse({
      repository: { ref: "repo://other", revision: base },
      files: [{ path: "sum.mjs", content: "x", sourceRef: "s" }]
    });
    assert.throws(() => mapBackendOrderToAgentTask(order, wrongRef, { repositoryRoot: repo, verifications }), TypeError);
    const wrongFiles = BackendContextSchema.parse({
      repository: { ref: "repo://supervised-backend-test", revision: base },
      files: [{ path: "other.mjs", content: "x", sourceRef: "s" }]
    });
    assert.throws(() => mapBackendOrderToAgentTask(order, wrongFiles, { repositoryRoot: repo, verifications }), TypeError);
  } finally {
    await disposeSource({ directory });
  }
});

test("SB1 default BackendWorker path does not import agent-tools", T, async () => {
  const source = await readFile(join(REPO_ROOT, "packages", "agentic-system", "src", "backend-worker.js"), "utf8");
  assert.ok(!source.includes("agent-tools"), "backend-worker.js must not reference agent-tools");
  assert.ok(!source.includes("runSupervisedTask"), "backend-worker.js must not reference runSupervisedTask");
  assert.ok(!source.includes("createSupervisedAgentStrategy"), "backend-worker.js must not reference createSupervisedAgentStrategy");
  assert.ok(source.includes("workspace.act"), "worker act delegates to the injected workspace");
  assert.ok(source.includes("candidate.version !== order.revision"), "worker evaluate stays mutation-only");
  const workspaceSource = await readFile(join(REPO_ROOT, "packages", "agentic-system", "src", "local-git-workspace.js"), "utf8");
  assert.ok(workspaceSource.includes("APPLY_BACKEND_CHANGE"), "workspace act stays APPLY_BACKEND_CHANGE");
  assert.ok(!workspaceSource.includes("RUN_AGENT_TOOL"), "workspace act is not RUN_AGENT_TOOL");
});

test("SB1 public indexes expose the adapter without a load-time cycle", T, async () => {
  const agentic = await import(pathToFileURL(join(REPO_ROOT, "packages", "agentic-system", "src", "index.js")).href);
  const tools = await import(pathToFileURL(join(REPO_ROOT, "packages", "agent-tools", "src", "index.js")).href);
  assert.equal(typeof agentic.mapBackendOrderToAgentTask, "function");
  assert.equal(typeof agentic.runSupervisedBackendWork, "function");
  assert.equal(typeof tools.runSupervisedTask, "function");
  const { directory, repo, base } = await sourceRepository();
  try {
    const { order, context } = backendOrderContext(base);
    const task = agentic.mapBackendOrderToAgentTask(order, context, { repositoryRoot: repo, verifications: backendVerifications() });
    assert.equal(task.baseRevision, base);
  } finally {
    await disposeSource({ directory });
  }
});

// SB2: fail-closed projection plus verifier-grounded APPLIED.

test("SB2 FIX_FIRST applies after verifier PASS at acceptedSha", T, async () => {
  const { result, base, records } = await supervisedBackend("FIX_FIRST", { maxAttempts: 2 });
  assert.equal(result.status, BackendWorkStatus.APPLIED);
  assert.match(result.revision, /^[0-9a-f]{40}$/);
  assert.notEqual(result.revision, base);
  assert.equal(records.length, 1);
});

test("SB2 FIX_AFTER_FEEDBACK applies only after the retry", T, async () => {
  const { result, records } = await supervisedBackend("FIX_AFTER_FEEDBACK", { maxAttempts: 3 });
  assert.equal(result.status, BackendWorkStatus.APPLIED);
  assert.ok(records.length >= 2, `expected a retry, saw ${records.length} invocation(s)`);
});

test("SB2 NEVER_FIX is not APPLIED", T, async () => {
  const { result } = await supervisedBackend("NEVER_FIX", { maxAttempts: 2 });
  assert.equal(result.status, BackendWorkStatus.FAILED);
  assert.equal(result.revision, null);
  assert.deepEqual(result.evidence, []);
});

test("SB2 missing executable is not APPLIED", T, async () => {
  const missing = defineAgentTool(AGENT_TOOLS.codex, { command: join(tmpdir(), "bb100-no-such-agent"), prefixArgs: [] });
  const { result } = await supervisedBackend("FIX_FIRST", { maxAttempts: 1, tool: missing });
  assert.equal(result.status, BackendWorkStatus.BLOCKED);
  assert.deepEqual(result.blockers, ["TOOL_UNAVAILABLE"]);
  assert.equal(result.revision, null);
  assert.deepEqual(result.evidence, []);
});

test("SB2 NO_CHANGE is not APPLIED", T, async () => {
  const { result } = await supervisedBackend("CLAIM_SUCCESS_NO_EDIT", { maxAttempts: 2 });
  assert.equal(result.status, BackendWorkStatus.FAILED);
  assert.equal(result.revision, null);
  assert.deepEqual(result.evidence, []);
});

test("SB2 AUTH_FAIL is not APPLIED", T, async () => {
  const { result } = await supervisedBackend("AUTH_FAIL", { maxAttempts: 1 });
  assert.equal(result.status, BackendWorkStatus.FAILED);
  assert.equal(result.revision, null);
  assert.deepEqual(result.blockers, []);
  assert.deepEqual(result.evidence, []);
});

// SB3: agent authority is telemetry; source repository is preserved.

test("SB3 CLAIM_SUCCESS_NO_EDIT does not apply", T, async () => {
  const { result, records } = await supervisedBackend("CLAIM_SUCCESS_NO_EDIT", { maxAttempts: 2 });
  assert.equal(result.status, BackendWorkStatus.FAILED);
  assert.equal(result.revision, null);
  assert.deepEqual(result.evidence, []);
  assert.ok(records.length > 0, "agent ran but its success claim never authorizes APPLIED");
});

test("SB3 agent claimedSuccess is telemetry only", T, async () => {
  const observed = [];
  const { result } = await supervisedBackend("CLAIM_SUCCESS_NO_EDIT", {
    maxAttempts: 2,
    observer: () => async (facts) => { observed.push(facts); }
  });
  assert.ok(observed.length > 0, "expected invocation observations");
  assert.ok(observed.every((facts) => facts.invocation.exitCode === 0), "fake agent exits success");
  assert.ok(observed.every((facts) => facts.outcome === "NO_CHANGE"), "no candidate was created");
  assert.equal(result.status, BackendWorkStatus.FAILED);
});

test("SB3 source repository HEAD is unchanged", T, async () => {
  const { result, before, after } = await supervisedBackend("FIX_FIRST", { maxAttempts: 2 });
  assert.equal(result.status, BackendWorkStatus.APPLIED);
  assert.deepEqual(after, before);
});

// SB4: grounded APPLIED evidence.

test("SB4 APPLIED carries grounded mutation typecheck tests evidence", T, async () => {
  const { result, base } = await supervisedBackend("FIX_FIRST", { maxAttempts: 2 });
  assert.equal(result.status, BackendWorkStatus.APPLIED);
  const revision = result.revision;
  assert.deepEqual(result.artifacts, [{ ref: `git:${revision}:sum.mjs`, path: "sum.mjs" }]);
  assert.equal(result.evidence.length, 3);
  const byClaim = new Map(result.evidence.map((artifact) => [artifact.metadata?.claim, artifact]));
  const mutation = byClaim.get(BackendEvidenceClaim.MUTATION);
  assert.equal(mutation.kind, "BACKEND_MUTATION");
  assert.equal(mutation.metadata?.verificationStatus, "PASS");
  assert.deepEqual(mutation.content, { beforeRevision: base, afterRevision: revision, lineageAdvanced: true });
  assert.equal(mutation.producer?.identity, "supervised-backend-adapter");
  for (const claim of [BackendEvidenceClaim.TYPECHECK, BackendEvidenceClaim.TESTS]) {
    const artifact = byClaim.get(claim);
    assert.ok(artifact, `missing evidence for ${claim}`);
    assert.equal(artifact.metadata?.verificationStatus, "PASS");
    assert.equal(artifact.content?.status, "PASS");
    assert.equal(artifact.content?.claim, claim);
  }
  const completion = assessBackendCompletion(result);
  assert.equal(completion.action, "ACCEPT");
});

test("SB4 failed runs do not claim PASS evidence", T, async () => {
  const failed = await supervisedBackend("AUTH_FAIL", { maxAttempts: 1 });
  assert.equal(failed.result.status, BackendWorkStatus.FAILED);
  assert.deepEqual(failed.result.evidence, []);
  assert.notEqual(assessBackendCompletion(failed.result).action, "ACCEPT");
  const missing = defineAgentTool(AGENT_TOOLS.codex, { command: join(tmpdir(), "bb100-no-such-agent"), prefixArgs: [] });
  const blocked = await supervisedBackend("FIX_FIRST", { maxAttempts: 1, tool: missing });
  assert.equal(blocked.result.status, BackendWorkStatus.BLOCKED);
  assert.deepEqual(blocked.result.evidence, []);
  assert.notEqual(assessBackendCompletion(blocked.result).action, "ACCEPT");
});

// SB5: living docs.

test("SB5 living docs distinguish the supervised backend path", T, async () => {
  const state = await readFile(join(REPO_ROOT, "docs", "living", "system", "agentic-application", "state.md"), "utf8");
  const capabilities = await readFile(join(REPO_ROOT, "docs", "living", "system", "agentic-application", "capabilities.md"), "utf8");
  for (const [label, body] of [["state.md", state], ["capabilities.md", capabilities]]) {
    assert.ok(/supervised backend/i.test(body), `${label} must describe the supervised backend adapter`);
    assert.ok(/CodeAct/.test(body), `${label} must name the default CodeAct BackendWorker path`);
    assert.ok(/OpenHands/.test(body), `${label} must name OpenHands domain-runtime execution as a separate seam`);
    assert.ok(!/BB-\d+/.test(body), `${label} must not contain Blackboard ids`);
    assert.ok(/AGENT_TASK_V1/.test(body) || /acceptedSha/.test(body), `${label} must describe the mapping/acceptance seam`);
  }
  assert.ok(/verifier/i.test(state), "state.md must describe verifier-PASS acceptance");
  assert.ok(/APPLIED/.test(capabilities) && /FAILED/.test(capabilities) && /BLOCKED/.test(capabilities), "capabilities.md must name APPLIED/FAILED/BLOCKED");
});

// SB6: write scope.

test("SB6 write scope excludes backend-worker and agent-tools", T, async () => {
  const WRITE = [
    "packages/agentic-system/src/supervised-backend.js",
    "packages/agentic-system/src/index.js",
    "packages/agentic-system/test/bb100-supervised-backend.test.js",
    "docs/living/system/agentic-application/state.md",
    "docs/living/system/agentic-application/capabilities.md"
  ];
  const FORBIDDEN = [
    "packages/agentic-system/src/backend-worker.js",
    "packages/agent-tools/src/supervisor.js",
    "packages/agent-tools/src/tool-adapters.js",
    "packages/agent-tools/test/fixtures/fake-agent.mjs",
    "packages/core-harness/src/index.js",
    "packages/oracle/src/oracle.js",
    "docs/blackboard/state.md",
    "docs/blackboard/artifacts/ready-implement-plan/BB-100.json"
  ];
  const inWriteScope = (path) => WRITE.includes(path);
  for (const path of WRITE) assert.equal(inWriteScope(path), true, `${path} must pass scope verification`);
  for (const path of FORBIDDEN) assert.equal(inWriteScope(path), false, `${path} must fail scope verification`);
});
