import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  AVOCapability,
  EvaluationVerdict,
  VerificationStatus,
  createCodeActStrategy,
  verificationCapabilityName
} from "../../core-harness/src/index.js";
import * as agentic from "../src/index.js";
import {
  BackendCompletionAction,
  BackendEvidenceClaim,
  BackendWorkStatus,
  QaCompletionAction,
  QaEvidenceClaim,
  QaWorkStatus,
  createBackendWorker,
  createLocalCommandVerifier,
  createLocalGitWorkspace,
  createQaHandoffFromBackendRun,
  createQaWorker,
  defineBackendObjective,
  defineQaObjective,
  runBackendObjective,
  runQaObjective
} from "../src/index.js";

const run = promisify(execFile);
const TIMEOUT = { timeout: 60000 };
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const FIXTURE_ENV = Object.freeze({
  GIT_AUTHOR_NAME: "fixture",
  GIT_AUTHOR_EMAIL: "fixture@localhost.invalid",
  GIT_COMMITTER_NAME: "fixture",
  GIT_COMMITTER_EMAIL: "fixture@localhost.invalid",
  GIT_CONFIG_NOSYSTEM: "1"
});

const SERVER_BROKEN = "export function health() {\n  return null;\n}\n";
const SERVER_FIXED = "export function health() {\n  return { status: \"ok\" };\n}\n";
const SERVER_TEST = [
  "import assert from \"node:assert/strict\";",
  "import test from \"node:test\";",
  "import { health } from \"../src/server.js\";",
  "",
  "test(\"health reports ok\", () => {",
  "  assert.deepEqual(health(), { status: \"ok\" });",
  "});",
  ""
].join("\n");

async function git(cwd, args) {
  const { stdout } = await run("git", args, { cwd, shell: false, encoding: "utf8", env: { ...process.env, ...FIXTURE_ENV } });
  return stdout;
}

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

// Probe fixture shape: test/server.test.js fails until src/server.js returns { status: "ok" }.
async function withFixture(runTest) {
  const directory = await mkdtemp(join(tmpdir(), "exharness-bb096-"));
  const repo = join(directory, "repo");
  try {
    await mkdir(join(repo, "src"), { recursive: true });
    await mkdir(join(repo, "test"), { recursive: true });
    await writeFile(join(repo, "package.json"), `${JSON.stringify({ name: "probe", private: true, type: "module" }, null, 2)}\n`);
    await writeFile(join(repo, "src", "server.js"), SERVER_BROKEN);
    await writeFile(join(repo, "test", "server.test.js"), SERVER_TEST);
    await writeFile(join(repo, "README.md"), "probe\n");
    await git(repo, ["init", "-q", "-b", "main"]);
    await git(repo, ["add", "-A"]);
    await git(repo, ["-c", "commit.gpgsign=false", "commit", "-q", "-m", "base"]);
    const base = (await git(repo, ["rev-parse", "HEAD"])).trim();
    await runTest({ directory, repo, base, worktree: (name) => join(directory, name) });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function sourceSnapshot(repo) {
  return {
    head: (await git(repo, ["rev-parse", "HEAD"])).trim(),
    branches: await git(repo, ["for-each-ref", "--format=%(refname) %(objectname)", "refs/heads"]),
    status: await git(repo, ["status", "--porcelain", "--untracked-files=all"])
  };
}

function nodeVerifier(name, claim, root, args, options = {}) {
  return createLocalCommandVerifier({ name, claim, root, command: process.execPath, args, ...options });
}

function actionResults(request) {
  return request.observations;
}

const capability = (name, input = null) => ({ type: "execute", target: "CAPABILITY", name, input });

// Deterministic Core model adapter: the next action is a pure function of request.observations.
function backendModel(edits, seen = []) {
  return {
    name: "bb096-deterministic-backend",
    async generate(request) {
      const observations = actionResults(request);
      seen.splice(0, seen.length, ...observations);
      const act = observations[0];
      if (observations.length === 0) return capability(AVOCapability.ACT, { kind: "APPLY_BACKEND_CHANGE", edits });
      if (act.status !== "SUCCESS") return { type: "return_result", value: failed(`ACT failed: ${act.error?.message}`) };
      if (observations.length === 1) return capability(verificationCapabilityName("backend-typecheck"));
      if (observations.length === 2) return capability(verificationCapabilityName("backend-tests"));
      if (observations.length === 3) return capability(AVOCapability.EVALUATE);
      const evaluation = observations[3].output;
      if (evaluation?.verdict !== EvaluationVerdict.PASS) return { type: "return_result", value: failed("ExHarness evaluation did not pass") };
      if (observations.length === 4) return capability(AVOCapability.PROMOTE);
      return {
        type: "return_result",
        value: {
          status: BackendWorkStatus.APPLIED,
          summary: "Applied declared edits through the local git workspace.",
          revision: act.output.candidate.version,
          artifacts: act.output.result.artifacts,
          gaps: [],
          blockers: []
        }
      };
    }
  };
}

function failed(summary) {
  return { status: BackendWorkStatus.FAILED, summary, revision: null, artifacts: [], gaps: [], blockers: [] };
}

function qaModel() {
  return {
    name: "bb096-deterministic-qa",
    async generate(request) {
      const observations = actionResults(request);
      if (observations.length === 0) return capability(verificationCapabilityName("qa-behavior"));
      if (observations.length === 1) return capability(verificationCapabilityName("qa-regression"));
      if (observations.length === 2) return capability(AVOCapability.EVALUATE);
      const work = request.input.work;
      if (observations[2].output?.verdict !== EvaluationVerdict.PASS) {
        return {
          type: "return_result",
          value: { status: QaWorkStatus.FAILED, summary: "QA evaluation did not pass.", verifiedRevision: null, inspectedArtifacts: [], evidence: [], issues: [], blockers: [] }
        };
      }
      return {
        type: "return_result",
        value: {
          status: QaWorkStatus.VERIFIED,
          summary: "QA commands executed on the accepted revision.",
          verifiedRevision: work.context.upstream.revision,
          inspectedArtifacts: work.context.artifacts.map(({ ref, path }) => (path == null ? { ref } : { ref, path })),
          evidence: [],
          issues: [],
          blockers: []
        }
      };
    }
  };
}

const executor = { async execute() { return { status: "SUCCESS" }; } };
const strategyFor = (model) => createCodeActStrategy({ model, executor, maxTurns: 12, maxDurationMs: 30000 });

function backendObjective(base) {
  return defineBackendObjective({
    id: "probe-health",
    task: "Make health() return { status: \"ok\" } so the repository test passes.",
    repository: { ref: "repo://bb096-probe", revision: base },
    requiredFiles: ["src/server.js", "test/server.test.js"],
    constraints: ["only edit src/server.js"]
  });
}

function qaObjective() {
  return defineQaObjective({
    id: "probe-health-qa",
    task: "Verify health() on the accepted revision.",
    requiredArtifactPaths: ["src/server.js"],
    acceptanceCriteria: ["health() returns { status: \"ok\" }", "the repository test suite still passes"]
  });
}

function gitRepositoryReader(repo) {
  return {
    async readFile({ repositoryRef, revision, path }) {
      return { content: await git(repo, ["show", `${revision}:${path}`]), sourceRef: `${repositoryRef}@${revision}:${path}` };
    }
  };
}

function gitArtifactReader(repo) {
  return {
    async readArtifact({ ref }) {
      const match = /^git:([0-9a-f]{40}):(.+)$/.exec(ref);
      assert.ok(match, `unexpected artifact ref ${ref}`);
      return { content: await git(repo, ["show", `${match[1]}:${match[2]}`]), sourceRef: ref };
    }
  };
}

async function runBackend({ repo, base, root, edits, seen = [] }) {
  const workspace = await createLocalGitWorkspace({ repositoryRoot: repo, baseRevision: base, worktreeRoot: root });
  try {
    const backendWorker = createBackendWorker({
      strategy: strategyFor(backendModel(edits, seen)),
      workspace,
      verifiers: [
        nodeVerifier("backend-typecheck", BackendEvidenceClaim.TYPECHECK, workspace.root, ["--check", "src/server.js"]),
        nodeVerifier("backend-tests", BackendEvidenceClaim.TESTS, workspace.root, ["--test", "test/server.test.js"])
      ]
    });
    const backendRun = await runBackendObjective(backendObjective(base), { repositoryReader: gitRepositoryReader(repo), backendWorker });
    return { backendRun, head: await workspace.head() };
  } finally {
    await workspace.dispose();
  }
}

const evidenceFor = (evidence, claim) => evidence.find((artifact) => artifact.metadata?.claim === claim);
const recordText = (artifact) => JSON.stringify(artifact);

// RB1 — local git workspace

test("RB1 commits declared edits in an isolated worktree and leaves the source repository unchanged", TIMEOUT, async () => {
  await withFixture(async ({ repo, base, worktree }) => {
    const before = await sourceSnapshot(repo);
    const workspace = await createLocalGitWorkspace({ repositoryRoot: repo, baseRevision: base, worktreeRoot: worktree("ws") });
    try {
      const candidate = { id: "repo://bb096-probe", version: base };
      const acted = await workspace.act({ candidate, action: { kind: "APPLY_BACKEND_CHANGE", edits: [{ path: "src/server.js", content: SERVER_FIXED }] } });
      assert.equal(acted.mutated, true);
      assert.match(acted.candidate.version, /^[0-9a-f]{40}$/);
      assert.notEqual(acted.candidate.version, base);
      assert.equal(acted.candidate.version, await workspace.head());
      assert.deepEqual(acted.result.artifacts, [{ ref: `git:${acted.candidate.version}:src/server.js`, path: "src/server.js" }]);
      assert.equal(await git(repo, ["show", `${acted.candidate.version}:src/server.js`]), SERVER_FIXED);
      assert.equal((await git(repo, ["log", "-1", "--format=%an <%ae>|%cn", acted.candidate.version])).trim(),
        "EXHARNESS_LOCAL_WORKSPACE <exharness-local-workspace@localhost.invalid>|EXHARNESS_LOCAL_WORKSPACE");
      const observed = await workspace.observe({ candidate: acted.candidate });
      assert.equal(observed.head, acted.candidate.version);
      assert.ok(observed.files.includes("src/server.js"));
    } finally {
      await workspace.dispose();
    }
    assert.deepEqual(await sourceSnapshot(repo), before);
    assert.equal(existsSync(worktree("ws")), false);
  });
});

test("RB1 an edit that changes nothing reports mutated:false without a commit", TIMEOUT, async () => {
  await withFixture(async ({ repo, base, worktree }) => {
    const workspace = await createLocalGitWorkspace({ repositoryRoot: repo, baseRevision: base, worktreeRoot: worktree("ws") });
    try {
      const candidate = { id: "repo://bb096-probe", version: base };
      const acted = await workspace.act({ candidate, action: { kind: "APPLY_BACKEND_CHANGE", edits: [{ path: "src/server.js", content: SERVER_BROKEN }] } });
      assert.deepEqual(acted, { mutated: false, candidate });
      assert.equal(await workspace.head(), base);
    } finally {
      await workspace.dispose();
    }
  });
});

test("RB1 rejects every unsafe path class before writing anything", TIMEOUT, async () => {
  await withFixture(async ({ repo, base, worktree, directory }) => {
    const before = await sourceSnapshot(repo);
    const workspace = await createLocalGitWorkspace({ repositoryRoot: repo, baseRevision: base, worktreeRoot: worktree("ws") });
    try {
      const candidate = { id: "repo://bb096-probe", version: base };
      const unsafe = [join(directory, "escape.txt"), "../escape.txt", "src/../../escape.txt", "C:/escape.txt", ".git/config", "src/.git/hooks", "src\\escape.txt"];
      for (const path of unsafe) {
        await assert.rejects(
          () => workspace.act({ candidate, action: { kind: "APPLY_BACKEND_CHANGE", edits: [{ path: "src/server.js", content: SERVER_FIXED }, { path, content: "x" }] } }),
          (error) => error.code === agentic.LocalWorkspaceErrorCode.UNSAFE_PATH,
          `expected unsafe path rejection for ${path}`
        );
      }
      assert.equal(await workspace.head(), base);
      assert.equal(await git(workspace.root, ["status", "--porcelain", "--untracked-files=all"]), "");
      assert.equal(existsSync(join(directory, "escape.txt")), false);
    } finally {
      await workspace.dispose();
    }
    assert.deepEqual(await sourceSnapshot(repo), before);
  });
});

test("RB1 rejects a candidate revision that differs from the worktree HEAD", TIMEOUT, async () => {
  await withFixture(async ({ repo, base, worktree }) => {
    const workspace = await createLocalGitWorkspace({ repositoryRoot: repo, baseRevision: base, worktreeRoot: worktree("ws") });
    try {
      await assert.rejects(
        () => workspace.act({ candidate: { id: "repo://bb096-probe", version: "0".repeat(40) }, action: { kind: "APPLY_BACKEND_CHANGE", edits: [{ path: "src/server.js", content: SERVER_FIXED }] } }),
        (error) => error.code === agentic.LocalWorkspaceErrorCode.REVISION_MISMATCH
      );
      assert.equal(await git(workspace.root, ["status", "--porcelain", "--untracked-files=all"]), "");
    } finally {
      await workspace.dispose();
    }
    await assert.rejects(
      () => createLocalGitWorkspace({ repositoryRoot: repo, baseRevision: "f".repeat(40), worktreeRoot: worktree("missing") }),
      (error) => error.code === agentic.LocalWorkspaceErrorCode.INVALID_REVISION
    );
  });
});

// RB2 — local command verifier

test("RB2 maps exit 0 to PASS and non-zero exit to FAIL with revision-bound evidence", TIMEOUT, async () => {
  await withFixture(async ({ repo, base }) => {
    const candidate = { id: "repo://bb096-probe", version: base };
    const pass = await nodeVerifier("ok", "c.ok", repo, ["-e", "process.stdout.write('fine')"]).verify({ candidate });
    assert.equal(pass.status, VerificationStatus.PASS);
    assert.equal(pass.claim, "c.ok");
    assert.ok(pass.evidence.includes(`ok:revision=${base}`));
    assert.ok(pass.evidence.includes("ok:exit=0"));
    assert.ok(pass.evidence.includes("ok:reason=PASS"));
    assert.ok(pass.evidence.includes(`ok:stdout-sha256=${sha256("fine")}`));
    const fail = await nodeVerifier("bad", "c.bad", repo, ["-e", "process.exit(1)"]).verify({ candidate });
    assert.equal(fail.status, VerificationStatus.FAIL);
    assert.ok(fail.evidence.includes("bad:exit=1"));
    assert.ok(fail.evidence.includes("bad:reason=FAIL"));
  });
});

test("RB2 a revision mismatch fails without spawning the command", TIMEOUT, async () => {
  await withFixture(async ({ repo, directory }) => {
    const marker = join(directory, "spawned.marker");
    const verifier = nodeVerifier("guard", "c.guard", repo, ["-e", `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'x')`]);
    const result = await verifier.verify({ candidate: { id: "repo://bb096-probe", version: "0".repeat(40) } });
    assert.equal(result.status, VerificationStatus.FAIL);
    assert.ok(result.evidence.includes("guard:reason=REVISION_MISMATCH"));
    assert.equal(existsSync(marker), false);
  });
});

test("RB2 a command that mutates the checkout is TREE_MUTATED", TIMEOUT, async () => {
  await withFixture(async ({ repo, base }) => {
    const result = await nodeVerifier("writer", "c.writer", repo, ["-e", "require('node:fs').writeFileSync('generated.txt', 'x')"])
      .verify({ candidate: { id: "repo://bb096-probe", version: base } });
    assert.equal(result.status, VerificationStatus.FAIL);
    assert.ok(result.evidence.includes("writer:exit=0"));
    assert.ok(result.evidence.includes("writer:reason=TREE_MUTATED"));
  });
});

test("RB2 a timeout kills the whole process tree and is INCONCLUSIVE", TIMEOUT, async () => {
  await withFixture(async ({ repo, base, directory }) => {
    const pidFile = join(directory, "pids.json");
    const script = [
      "const { spawn } = require('node:child_process');",
      "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
      `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, JSON.stringify([process.pid, child.pid]));`,
      "setInterval(() => {}, 1000);"
    ].join("\n");
    const result = await nodeVerifier("hang", "c.hang", repo, ["-e", script], { timeoutMs: 300, requireUnchangedTree: false })
      .verify({ candidate: { id: "repo://bb096-probe", version: base } });
    assert.equal(result.status, VerificationStatus.INCONCLUSIVE);
    assert.ok(result.evidence.includes("hang:reason=TIMEOUT"));
    const pids = JSON.parse(await readFile(pidFile, "utf8"));
    assert.equal(pids.length, 2);
    const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
    for (let attempt = 0; attempt < 50 && pids.some(alive); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.deepEqual(pids.filter(alive), []);
  });
});

test("RB2 arguments are passed literally without a shell", TIMEOUT, async () => {
  await withFixture(async ({ repo, base }) => {
    const literal = "x; echo injected";
    const result = await nodeVerifier("literal", "c.literal", repo, ["-e", "process.stdout.write(process.argv[1])", literal])
      .verify({ candidate: { id: "repo://bb096-probe", version: base } });
    assert.equal(result.status, VerificationStatus.PASS);
    assert.ok(result.evidence.includes(`literal:stdout-sha256=${sha256(literal)}`));
  });
});

// RB3 — Backend end-to-end through a Core CodeAct strategy

test("RB3 the correct edit ACCEPTs with evidence bound to the committed worktree HEAD", TIMEOUT, async () => {
  await withFixture(async ({ repo, base, worktree }) => {
    const before = await sourceSnapshot(repo);
    const { backendRun, head } = await runBackend({ repo, base, root: worktree("backend"), edits: [{ path: "src/server.js", content: SERVER_FIXED }] });
    assert.equal(backendRun.completion.action, BackendCompletionAction.ACCEPT);
    assert.notEqual(head, base);
    assert.equal(backendRun.result.revision, head);
    const evidence = backendRun.result.evidence;
    assert.equal(evidenceFor(evidence, BackendEvidenceClaim.MUTATION).content.afterRevision, head);
    assert.match(recordText(evidenceFor(evidence, BackendEvidenceClaim.TESTS)), new RegExp(`backend-tests:revision=${head}`));
    assert.match(recordText(evidenceFor(evidence, BackendEvidenceClaim.TYPECHECK)), new RegExp(`backend-typecheck:revision=${head}`));
    assert.deepEqual(await sourceSnapshot(repo), before);
  });
});

test("RB3 the probe shape with no edit never ACCEPTs", TIMEOUT, async () => {
  await withFixture(async ({ repo, base, worktree }) => {
    const before = await sourceSnapshot(repo);
    const { backendRun, head } = await runBackend({ repo, base, root: worktree("backend"), edits: [] });
    assert.notEqual(backendRun.completion.action, BackendCompletionAction.ACCEPT);
    assert.equal(backendRun.result.status, BackendWorkStatus.FAILED);
    assert.equal(head, base);
    assert.deepEqual(await sourceSnapshot(repo), before);
  });
});

test("RB3 the probe shape with an unrelated edit never ACCEPTs", TIMEOUT, async () => {
  await withFixture(async ({ repo, base, worktree }) => {
    const before = await sourceSnapshot(repo);
    const seen = [];
    const { backendRun, head } = await runBackend({ repo, base, root: worktree("backend"), edits: [{ path: "README.md", content: "probe, edited\n" }], seen });
    assert.notEqual(backendRun.completion.action, BackendCompletionAction.ACCEPT);
    assert.notEqual(head, base);
    const tests = seen[2].output;
    assert.equal(tests.claim, BackendEvidenceClaim.TESTS);
    assert.equal(tests.status, VerificationStatus.FAIL);
    assert.ok(tests.evidence.includes(`backend-tests:revision=${head}`));
    assert.ok(tests.evidence.includes("backend-tests:exit=1"));
    assert.notEqual(seen[3].output.verdict, EvaluationVerdict.PASS);
    assert.equal(backendRun.result.status, BackendWorkStatus.FAILED);
    assert.deepEqual(await sourceSnapshot(repo), before);
  });
});

// RB4 — QA end-to-end on the accepted revision

async function runQa({ repo, backendRun, checkoutRevision, root, regressionArgs = ["--test", "test/server.test.js"] }) {
  const checkout = await createLocalGitWorkspace({ repositoryRoot: repo, baseRevision: checkoutRevision, worktreeRoot: root });
  try {
    const qaWorker = createQaWorker({
      strategy: strategyFor(qaModel()),
      verifiers: [
        nodeVerifier("qa-behavior", QaEvidenceClaim.BEHAVIOR, checkout.root, ["--input-type=module", "-e",
          "import assert from 'node:assert/strict'; import { health } from './src/server.js'; assert.deepEqual(health(), { status: 'ok' });"]),
        nodeVerifier("qa-regression", QaEvidenceClaim.REGRESSION, checkout.root, regressionArgs)
      ]
    });
    return await runQaObjective(qaObjective(), {
      handoff: createQaHandoffFromBackendRun(backendRun),
      artifactReader: gitArtifactReader(repo),
      qaWorker
    });
  } finally {
    await checkout.dispose();
  }
}

async function acceptedBackend({ repo, base, worktree }) {
  const { backendRun, head } = await runBackend({ repo, base, root: worktree("backend"), edits: [{ path: "src/server.js", content: SERVER_FIXED }] });
  assert.equal(backendRun.completion.action, BackendCompletionAction.ACCEPT);
  return { backendRun, head };
}

test("RB4 QA ACCEPTs on the accepted sha with both QA records PASS at that revision", TIMEOUT, async () => {
  await withFixture(async ({ repo, base, worktree }) => {
    const before = await sourceSnapshot(repo);
    const { backendRun, head } = await acceptedBackend({ repo, base, worktree });
    const qaRun = await runQa({ repo, backendRun, checkoutRevision: head, root: worktree("qa") });
    assert.equal(qaRun.completion.action, QaCompletionAction.ACCEPT);
    assert.equal(qaRun.result.verifiedRevision, head);
    for (const [name, claim] of [["qa-behavior", QaEvidenceClaim.BEHAVIOR], ["qa-regression", QaEvidenceClaim.REGRESSION]]) {
      const record = evidenceFor(qaRun.result.evidence, claim);
      assert.equal(record.metadata.verificationStatus, VerificationStatus.PASS);
      assert.match(recordText(record), new RegExp(`${name}:revision=${head}`));
    }
    assert.deepEqual(await sourceSnapshot(repo), before);
  });
});

test("RB4 a mutating QA command is TREE_MUTATED and QA does not ACCEPT", TIMEOUT, async () => {
  await withFixture(async ({ repo, base, worktree }) => {
    const { backendRun } = await acceptedBackend({ repo, base, worktree });
    const qaRun = await runQa({
      repo,
      backendRun,
      checkoutRevision: backendRun.result.revision,
      root: worktree("qa"),
      regressionArgs: ["-e", "require('node:fs').writeFileSync('qa-output.txt', 'x')"]
    });
    assert.notEqual(qaRun.completion.action, QaCompletionAction.ACCEPT);
    assert.match(recordText(evidenceFor(qaRun.result.evidence, QaEvidenceClaim.REGRESSION)), /qa-regression:reason=TREE_MUTATED/);
  });
});

test("RB4 a checkout at the base sha instead of the accepted sha is REVISION_MISMATCH", TIMEOUT, async () => {
  await withFixture(async ({ repo, base, worktree }) => {
    const { backendRun } = await acceptedBackend({ repo, base, worktree });
    const qaRun = await runQa({ repo, backendRun, checkoutRevision: base, root: worktree("qa") });
    assert.notEqual(qaRun.completion.action, QaCompletionAction.ACCEPT);
    assert.match(recordText(evidenceFor(qaRun.result.evidence, QaEvidenceClaim.BEHAVIOR)), /qa-behavior:reason=REVISION_MISMATCH/);
    assert.match(recordText(evidenceFor(qaRun.result.evidence, QaEvidenceClaim.REGRESSION)), /qa-regression:reason=REVISION_MISMATCH/);
  });
});

// RB5 — exports and documentation

test("RB5 the package exports both local adapter factories", TIMEOUT, () => {
  assert.equal(typeof agentic.createLocalGitWorkspace, "function");
  assert.equal(typeof agentic.createLocalCommandVerifier, "function");
});

test("RB5 README and Living agentic docs describe the delivered adapters and their limits", TIMEOUT, async () => {
  const readme = await readFile(join(REPO_ROOT, "README.md"), "utf8");
  assert.match(readme, /injected adapters/);
  assert.match(readme, /createLocalGitWorkspace/);
  assert.match(readme, /createLocalCommandVerifier/);
  for (const doc of ["state.md", "capabilities.md"]) {
    const text = await readFile(join(REPO_ROOT, "docs", "living", "system", "agentic-application", doc), "utf8");
    assert.match(text, /createLocalGitWorkspace/, doc);
    assert.match(text, /createLocalCommandVerifier/, doc);
    assert.match(text, /not a sandbox/i, doc);
    assert.match(text, /injected fixtures/i, doc);
    assert.match(text, /no live model provider/i, doc);
  }
});

test("RB5 reports agentic diff paths outside the declared write scope as a diagnostic", TIMEOUT, async (t) => {
  const forbidden = /^packages\/(core-harness|oracle)\/|^packages\/agentic-system\/src\/(backend-|qa-).*\.js$|^docs\/blackboard\/|^scripts\/blackboard-/;
  let changed = [];
  try {
    const mergeBase = (await git(REPO_ROOT, ["merge-base", "HEAD", "origin/main"])).trim();
    changed = (await git(REPO_ROOT, ["diff", "--name-only", mergeBase, "HEAD"])).split("\n").filter(Boolean);
  } catch {
    t.diagnostic("origin/main is unavailable; write-scope diagnostic skipped");
    return;
  }
  const outside = changed.filter((path) => forbidden.test(path));
  t.diagnostic(outside.length === 0 ? "no forbidden paths changed" : `forbidden paths changed: ${outside.join(", ")}`);
});
