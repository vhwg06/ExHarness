import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseGrokJson } from "../src/output-parsers.js";
import { projectAgentTaskContext } from "../src/task-context.js";
import { auditPaths } from "./scope-audit.mjs";
import { createLocalGitWorkspace } from "../../agentic-system/src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(here, "..", "..", "..");
const T = { timeout: 120000 };
const PLAN = JSON.parse(readFileSync(join(REPO_ROOT, "docs", "blackboard", "artifacts", "ready-implement-plan", "BB-123.json"), "utf8"));

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
  const root = tempDir("bb123-source-");
  git(root, "init", "-q");
  git(root, "checkout", "-q", "-b", "main");
  writeFileSync(join(root, "app.js"), "export const app = 1;\n");
  git(root, "add", "-A");
  git(root, "-c", "commit.gpgsign=false", "commit", "-q", "-m", "base");
  return { root, base: git(root, "rev-parse", "HEAD") };
}

const grokJson = (totalCostUsd) => JSON.stringify({
  text: "done",
  stopReason: "end_turn",
  num_turns: 1,
  usage: { input_tokens: 10, output_tokens: 5 },
  total_cost_usd: totalCostUsd
});

// ---------------------------------------------------------------- FU1 observed-only cost

test("FU1 null total_cost_usd is observed as null", T, () => {
  const parsed = parseGrokJson(grokJson(null));
  assert.equal(parsed.usage.totalCostUsd, null, "null cost is null, not 0");
});

test("FU1 empty-string total_cost_usd is observed as null", T, () => {
  const parsed = parseGrokJson(grokJson(""));
  assert.equal(parsed.usage.totalCostUsd, null, "empty-string cost is null, not 0");
});

test("FU1 boolean total_cost_usd is observed as null", T, () => {
  const parsed = parseGrokJson(grokJson(true));
  assert.equal(parsed.usage.totalCostUsd, null, "boolean cost is null, not 1");
});

test("FU1 string total_cost_usd is observed as null", T, () => {
  const parsed = parseGrokJson(grokJson("0.5"));
  assert.equal(parsed.usage.totalCostUsd, null, "numeric-string cost is null, not 0.5");
});

test("FU1 non-finite and negative costs are observed as null", T, () => {
  assert.equal(parseGrokJson(grokJson(NaN)).usage.totalCostUsd, null, "NaN is null");
  assert.equal(parseGrokJson(grokJson(Infinity)).usage.totalCostUsd, null, "Infinity is null");
  assert.equal(parseGrokJson(grokJson(-1)).usage.totalCostUsd, null, "negative is null");
});

test("FU1 finite non-negative numbers stay observed", T, () => {
  assert.equal(parseGrokJson(grokJson(0)).usage.totalCostUsd, 0, "numeric zero stays an observed 0");
  assert.equal(parseGrokJson(grokJson(0.5)).usage.totalCostUsd, 0.5, "finite positive is observed");
  assert.equal(parseGrokJson(grokJson(0.01200404)).usage.totalCostUsd, 0.01200404, "usage-bearing cost is reported");
});

// ---------------------------------------------------------------- FU2 worktree-local exclusion

test("FU2 source info/exclude stays byte-identical", T, async () => {
  const { root, base } = sourceRepository();
  const scratch = tempDir("bb123-fu2-");
  let workspace = null;
  try {
    workspace = await createLocalGitWorkspace({ repositoryRoot: root, baseRevision: base, worktreeRoot: join(scratch, "worktree") });
    const excludePath = join(root, ".git", "info", "exclude");
    const before = existsSync(excludePath) ? readFileSync(excludePath, "utf8") : null;
    const resolved = { used: true, items: [{ path: "src/app.js", content: "export const app = 1;\n" }] };
    const projected = await projectAgentTaskContext(resolved, { worktreeRoot: workspace.root });
    assert.equal(projected.projected, 1);
    const after = existsSync(excludePath) ? readFileSync(excludePath, "utf8") : null;
    assert.equal(after, before, "the source repository info/exclude is byte-identical");
    assert.equal(existsSync(join(workspace.root, ".exharness", ".gitignore")), true, "exclusion is worktree-local");
    assert.equal(readFileSync(join(workspace.root, ".exharness", ".gitignore"), "utf8"), "*\n");
  } finally {
    if (workspace) await workspace.dispose().catch(() => {});
    rmSync(root, { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("FU2 grounded copies never enter the candidate commit", T, async () => {
  const { root, base } = sourceRepository();
  const scratch = tempDir("bb123-fu2c-");
  let workspace = null;
  try {
    workspace = await createLocalGitWorkspace({ repositoryRoot: root, baseRevision: base, worktreeRoot: join(scratch, "worktree") });
    const resolved = { used: true, items: [{ path: "src/app.js", content: "export const app = 1;\n" }] };
    await projectAgentTaskContext(resolved, { worktreeRoot: workspace.root });
    assert.equal(git(workspace.root, "status", "--porcelain", "--untracked-files=all"), "", "grounded copies do not dirty the worktree");
    git(workspace.root, "add", "-A");
    git(workspace.root, "-c", "commit.gpgsign=false", "commit", "-q", "-m", "candidate", "--allow-empty");
    const files = git(workspace.root, "show", "--name-only", "--format=", "HEAD").split("\n").filter(Boolean);
    assert.ok(!files.some((f) => f.startsWith(".exharness/")), "grounded copies never enter the candidate commit");
  } finally {
    if (workspace) await workspace.dispose().catch(() => {});
    rmSync(root, { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- FU3 docs and scope

test("FU3 living docs state observed-only cost and worktree-local exclusion", T, () => {
  const observation = readFileSync(join(REPO_ROOT, "docs", "living", "system", "agent-tools", "observation.md"), "utf8");
  const context = readFileSync(join(REPO_ROOT, "docs", "living", "system", "agent-tools", "context.md"), "utf8");
  assert.ok(observation.includes("is observed only for a finite `total_cost_usd` number >= 0"), "observation states observed-only cost");
  assert.ok(!/BB-\d+/.test(observation), "observation has no Blackboard ids");
  assert.ok(context.includes("worktree-local"), "context states worktree-local exclusion");
  assert.ok(!/BB-\d+/.test(context), "context has no Blackboard ids");
});

test("FU3 auditPaths rejects agentic-system and blackboard writes", T, () => {
  const result = auditPaths(
    ["packages/agent-tools/src/output-parsers.js", "packages/agentic-system/src/index.js", "docs/blackboard/state.md"],
    PLAN.sourceScope
  );
  assert.deepEqual(result.forbidden.sort(), ["docs/blackboard/state.md", "packages/agentic-system/src/index.js"].sort());
  assert.deepEqual(result.allowed, ["packages/agent-tools/src/output-parsers.js"]);
});
