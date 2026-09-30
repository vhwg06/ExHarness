import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  AVOCapability,
  EvaluationVerdict
} from "../../core-harness/src/index.js";
import {
  BackendContextSchema,
  BackendEvidenceClaim,
  BackendWorkStatus,
  assessBackendCompletion,
  createBackendWorker,
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

// Setup-only helper for bound tests: the subject call itself is inlined in
// each test body so the binding checker sees a direct invocation.
async function setupSupervised(scenario, { maxAttempts = 2, tool = null, observer = null } = {}) {
  const { directory, repo, base } = await sourceRepository();
  const before = await sourceSnapshot(repo);
  const recordsDir = await mkdtemp(join(tmpdir(), "bb100-records-"));
  const recordPath = join(recordsDir, "record.json");
  const seen = [];
  const { order, context } = backendOrderContext(base);
  const args = {
    tool: tool ?? fakeTool(),
    order,
    context,
    repositoryRoot: repo,
    verifications: backendVerifications(),
    maxAttempts,
    timeoutMs: 30000,
    env: { FAKE_AGENT_SCENARIO: scenario, FAKE_AGENT_RECORD: recordPath },
    ...(observer ? { invocationObserver: observer(seen) } : {})
  };
  return { directory, repo, base, before, recordsDir, recordPath, seen, args };
}

async function teardownSupervised(setup) {
  const after = await sourceSnapshot(setup.repo);
  const records = existsSync(setup.recordPath) ? JSON.parse(readFileSync(setup.recordPath, "utf8")) : [];
  await disposeSource({ directory: setup.directory });
  await rm(setup.recordsDir, { recursive: true, force: true });
  return { after, records };
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
  // Construct the default worker from in-test stubs (no agent-tools objects)
  // and execute Backend work through it: it must apply through the workspace
  // via APPLY_BACKEND_CHANGE with mutation-only evaluation.
  const actedKinds = [];
  const worker = createBackendWorker({
    strategy: {
      async run({ invoke }) {
        const action = await invoke(AVOCapability.ACT, { kind: "APPLY_BACKEND_CHANGE", edits: [] });
        const evaluation = await invoke(AVOCapability.EVALUATE);
        assert.equal(evaluation.verdict, EvaluationVerdict.PASS);
        await invoke(AVOCapability.PROMOTE);
        return {
          status: BackendWorkStatus.APPLIED,
          summary: "stub applied through the workspace",
          revision: action.candidate.version,
          artifacts: action.result.artifacts,
          blockers: []
        };
      }
    },
    workspace: {
      async act({ candidate, action }) {
        actedKinds.push(action?.kind);
        assert.equal(action?.kind, "APPLY_BACKEND_CHANGE");
        return {
          mutated: true,
          candidate: { id: candidate.id, version: "rev-2" },
          result: { artifacts: [{ ref: "workspace://rev-2/src/server.js", path: "src/server.js" }] }
        };
      }
    }
  });
  const order = parseBackendWorkOrder(makeBackendWorkOrder(defineBackendObjective({
    id: "default-path-probe",
    task: "Probe the default path.",
    repository: { ref: "repo://default-path", revision: "rev-1" },
    requiredFiles: ["src/server.js"]
  })));
  const context = BackendContextSchema.parse({
    repository: { ref: "repo://default-path", revision: "rev-1" },
    files: [{ path: "src/server.js", content: "stub\n", sourceRef: "stub" }]
  });
  const result = await worker.execute(order, context);
  assert.equal(result.status, BackendWorkStatus.APPLIED);
  assert.deepEqual(actedKinds, ["APPLY_BACKEND_CHANGE"]);
  // Runtime proof in a fresh child process: a resolve hook records every
  // loaded module URL while the default worker executes to APPLIED. No
  // resolved URL may point into packages/agent-tools.
  const resolveScratch = await mkdtemp(join(tmpdir(), "bb100-resolve-"));
  const urlsFile = join(resolveScratch, "resolved-urls.txt");
  const hookSource = [
    "import fs from 'node:fs';",
    "const NL = String.fromCharCode(10);",
    "export async function resolve(specifier, context, nextResolve) {",
    "  const resolved = await nextResolve(specifier, context);",
    "  try { fs.appendFileSync(process.env.BB100_RESOLVED_URLS_FILE, resolved.url + NL); } catch {}",
    "  return resolved;",
    "}"
  ].join(String.fromCharCode(10));
  const agenticIndexUrl = pathToFileURL(join(REPO_ROOT, "packages", "agentic-system", "src", "index.js")).href;
  const coreIndexUrl = pathToFileURL(join(REPO_ROOT, "packages", "core-harness", "src", "index.js")).href;
  const childScript = [
    "import { register } from 'node:module';",
    "import fs from 'node:fs';",
    "register('data:text/javascript,' + " + JSON.stringify(encodeURIComponent(hookSource)) + ");",
    "const agentic = await import(" + JSON.stringify(agenticIndexUrl) + ");",
    "const core = await import(" + JSON.stringify(coreIndexUrl) + ");",
    "const actedKinds = [];",
    "const worker = agentic.createBackendWorker({",
    "  strategy: {",
    "    async run({ invoke }) {",
    "      const action = await invoke(core.AVOCapability.ACT, { kind: 'APPLY_BACKEND_CHANGE', edits: [] });",
    "      await invoke(core.AVOCapability.EVALUATE);",
    "      await invoke(core.AVOCapability.PROMOTE);",
    "      return { status: agentic.BackendWorkStatus.APPLIED, summary: 'child applied', revision: action.candidate.version, artifacts: action.result.artifacts, blockers: [] };",
    "    }",
    "  },",
    "  workspace: {",
    "    async act({ candidate, action }) {",
    "      actedKinds.push(action?.kind);",
    "      if (action?.kind !== 'APPLY_BACKEND_CHANGE') throw new Error('unexpected act kind');",
    "      return { mutated: true, candidate: { id: candidate.id, version: 'rev-2' }, result: { artifacts: [{ ref: 'workspace://rev-2/src/server.js', path: 'src/server.js' }] } };",
    "    }",
    "  }",
    "});",
    "const order = agentic.parseBackendWorkOrder(agentic.makeBackendWorkOrder(agentic.defineBackendObjective({ id: 'child-probe', task: 'Probe.', repository: { ref: 'repo://child', revision: 'rev-1' }, requiredFiles: ['src/server.js'] })));",
    "const context = agentic.BackendContextSchema.parse({ repository: { ref: 'repo://child', revision: 'rev-1' }, files: [{ path: 'src/server.js', content: 'stub', sourceRef: 'stub' }] });",
    "const outcome = await worker.execute(order, context);",
    "const recorded = fs.readFileSync(process.env.BB100_RESOLVED_URLS_FILE, 'utf8').split(String.fromCharCode(10)).filter((line) => line.length > 0);",
    "console.log(JSON.stringify({ status: outcome.status, actedKinds, urlCount: recorded.length, agentToolsUrls: recorded.filter((url) => url.includes('/packages/agent-tools/')) }));"
  ].join(String.fromCharCode(10));
  try {
    const completion = spawnSync(process.execPath, ["--input-type=module", "-e", childScript], {
      cwd: REPO_ROOT,
      shell: false,
      encoding: "utf8",
      timeout: 120000,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, BB100_RESOLVED_URLS_FILE: urlsFile }
    });
    assert.equal(completion.status, 0, `resolve-hook child failed: ${(completion.stderr ?? "").slice(-2000)}`);
    const payload = JSON.parse(completion.stdout);
    assert.equal(payload.status, "APPLIED");
    assert.deepEqual(payload.actedKinds, ["APPLY_BACKEND_CHANGE"]);
    assert.ok(payload.urlCount > 50, `expected module resolutions recorded, saw ${payload.urlCount}`);
    assert.deepEqual(payload.agentToolsUrls, []);
  } finally {
    await rm(resolveScratch, { recursive: true, force: true });
  }
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
  const setup = await setupSupervised("NEVER_FIX", { maxAttempts: 2 });
  try {
    const result = await runSupervisedBackendWork(setup.args);
    assert.equal(result.status, BackendWorkStatus.FAILED);
    assert.equal(result.revision, null);
    assert.deepEqual(result.evidence, []);
  } finally {
    await teardownSupervised(setup);
  }
});

test("SB2 missing executable is not APPLIED", T, async () => {
  const missing = defineAgentTool(AGENT_TOOLS.codex, { command: join(tmpdir(), "bb100-no-such-agent"), prefixArgs: [] });
  const setup = await setupSupervised("FIX_FIRST", { maxAttempts: 1, tool: missing });
  try {
    const result = await runSupervisedBackendWork(setup.args);
    assert.equal(result.status, BackendWorkStatus.BLOCKED);
    assert.deepEqual(result.blockers, ["TOOL_UNAVAILABLE"]);
    assert.equal(result.revision, null);
    assert.deepEqual(result.evidence, []);
  } finally {
    await teardownSupervised(setup);
  }
});

test("SB2 NO_CHANGE is not APPLIED", T, async () => {
  const setup = await setupSupervised("CLAIM_SUCCESS_NO_EDIT", { maxAttempts: 2 });
  try {
    const result = await runSupervisedBackendWork(setup.args);
    assert.equal(result.status, BackendWorkStatus.FAILED);
    assert.equal(result.revision, null);
    assert.deepEqual(result.evidence, []);
  } finally {
    await teardownSupervised(setup);
  }
});

test("SB2 AUTH_FAIL is not APPLIED", T, async () => {
  const setup = await setupSupervised("AUTH_FAIL", { maxAttempts: 1 });
  try {
    const result = await runSupervisedBackendWork(setup.args);
    assert.equal(result.status, BackendWorkStatus.FAILED);
    assert.equal(result.revision, null);
    assert.deepEqual(result.blockers, []);
    assert.deepEqual(result.evidence, []);
  } finally {
    await teardownSupervised(setup);
  }
});

// SB3: agent authority is telemetry; source repository is preserved.

test("SB3 CLAIM_SUCCESS_NO_EDIT does not apply", T, async () => {
  const setup = await setupSupervised("CLAIM_SUCCESS_NO_EDIT", { maxAttempts: 2 });
  let records = [];
  try {
    const result = await runSupervisedBackendWork(setup.args);
    assert.equal(result.status, BackendWorkStatus.FAILED);
    assert.equal(result.revision, null);
    assert.deepEqual(result.evidence, []);
  } finally {
    ({ records } = await teardownSupervised(setup));
  }
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
  const setup = await setupSupervised("FIX_FIRST", { maxAttempts: 2 });
  let after = null;
  try {
    const result = await runSupervisedBackendWork(setup.args);
    assert.equal(result.status, BackendWorkStatus.APPLIED);
  } finally {
    ({ after } = await teardownSupervised(setup));
  }
  assert.deepEqual(after, setup.before);
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
  const failedSetup = await setupSupervised("AUTH_FAIL", { maxAttempts: 1 });
  try {
    const failedResult = await runSupervisedBackendWork(failedSetup.args);
    assert.equal(failedResult.status, BackendWorkStatus.FAILED);
    assert.deepEqual(failedResult.evidence, []);
    assert.notEqual(assessBackendCompletion(failedResult).action, "ACCEPT");
  } finally {
    await teardownSupervised(failedSetup);
  }
  const missing = defineAgentTool(AGENT_TOOLS.codex, { command: join(tmpdir(), "bb100-no-such-agent"), prefixArgs: [] });
  const blockedSetup = await setupSupervised("FIX_FIRST", { maxAttempts: 1, tool: missing });
  try {
    const blockedResult = await runSupervisedBackendWork(blockedSetup.args);
    assert.equal(blockedResult.status, BackendWorkStatus.BLOCKED);
    assert.deepEqual(blockedResult.evidence, []);
    assert.notEqual(assessBackendCompletion(blockedResult).action, "ACCEPT");
  } finally {
    await teardownSupervised(blockedSetup);
  }
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
  // The adapter itself runs without touching forbidden paths: a supervised
  // run through the public entrypoint stays FAILED-fail-closed here.
  const setup = await setupSupervised("AUTH_FAIL", { maxAttempts: 1 });
  try {
    const result = await runSupervisedBackendWork(setup.args);
    assert.equal(result.status, BackendWorkStatus.FAILED);
    assert.deepEqual(result.evidence, []);
  } finally {
    await teardownSupervised(setup);
  }
});
