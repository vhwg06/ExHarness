#!/usr/bin/env node
// Executed follow-up probe for BB-123: grok cost coercion + grounded-context worktree exclusion.
// Credential-free. Builds a scratch source repo plus a linked worktree under os.tmpdir() and
// removes them afterwards. Result stores observed values only (no paths, no timestamps) so a
// re-run reproduces the result file byte-identically.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseGrokJson } from "../../../../packages/agent-tools/src/output-parsers.js";
import { projectAgentTaskContext } from "../../../../packages/agent-tools/src/task-context.js";
import { createLocalGitWorkspace } from "../../../../packages/agentic-system/src/local-git-workspace.js";

const here = dirname(fileURLToPath(import.meta.url));

function grokCostOf(totalCostUsd) {
  const stdout = JSON.stringify({
    usage: { input_tokens: 10, output_tokens: 5 },
    total_cost_usd: totalCostUsd,
    num_turns: 1,
    stopReason: "stop"
  });
  return parseGrokJson(stdout).usage.totalCostUsd ?? null;
}

function git(cwd, args) {
  const run = spawnSync("git", args, {
    cwd,
    shell: false,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" }
  });
  if (run.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${String(run.stderr ?? "").trim().slice(-300)}`);
  return run.stdout.trim();
}

function readIfPresent(path) {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

const tmpBase = mkdtempSync(join(tmpdir(), "bb123-followup-"));
let workspace = null;
try {
  const sourceRoot = join(tmpBase, "src");
  const worktreeRoot = join(tmpBase, "work");
  git(tmpBase, ["init", "-q", sourceRoot]);
  git(sourceRoot, ["config", "user.email", "bb123-probe@localhost.invalid"]);
  git(sourceRoot, ["config", "user.name", "bb123-probe"]);
  git(sourceRoot, ["config", "commit.gpgsign", "false"]);
  writeFileSync(join(sourceRoot, "hello.txt"), "hello\n");
  git(sourceRoot, ["add", "-A"]);
  git(sourceRoot, ["commit", "-q", "--no-verify", "-m", "probe"]);
  const baseRevision = git(sourceRoot, ["rev-parse", "HEAD"]);

  const sourceExcludePath = join(sourceRoot, ".git", "info", "exclude");
  const sourceExcludeBefore = readIfPresent(sourceExcludePath);

  workspace = await createLocalGitWorkspace({ repositoryRoot: sourceRoot, baseRevision, worktreeRoot });
  const resolved = {
    used: true,
    items: [{ path: "hello.txt", sourceRef: `${baseRevision}:hello.txt`, snapshotRef: baseRevision, content: "hello\n" }]
  };
  const projection = await projectAgentTaskContext(resolved, { worktreeRoot });
  const sourceExcludeAfter = readIfPresent(sourceExcludePath);

  const excludeRef = git(worktreeRoot, ["rev-parse", "--git-path", "info/exclude"]);
  const excludeResolved = isAbsolute(excludeRef) ? excludeRef : resolve(worktreeRoot, excludeRef);

  const result = {
    kind: "BB-123_FOLLOWUP_PROBE_V1",
    grokNullCost: grokCostOf(null),
    grokEmptyStringCost: grokCostOf(""),
    grokTrueCost: grokCostOf(true),
    grokNumericStringCost: grokCostOf("0.5"),
    groundedProjected: projection.projected,
    groundedFiles: [...projection.files],
    excludeResolvedInsideWorktree: excludeResolved === worktreeRoot || excludeResolved.startsWith(`${worktreeRoot}/`),
    sourceExcludeBefore,
    sourceExcludeAfter,
    sourceExcludeChanged: sourceExcludeBefore !== sourceExcludeAfter
  };
  writeFileSync(join(here, "followup-probe-result.json"), `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  if (workspace) await workspace.dispose().catch(() => {});
  rmSync(tmpBase, { recursive: true, force: true });
}
