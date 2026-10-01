// Owned agent-tools value suite: fixture loading, digests, materialization and calibration.
// A fixture is repo/** (agent-visible base with visible tests), hidden/** (held-out tests that
// only ever reach the independent evaluation checkout), solution.patch and task.json.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { InvocationStatus, runProcess } from "../process-runner.js";

export const SUITE_KIND = "AGENT_TOOLS_SUITE_V1";
export const DEFAULT_SUITE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../benchmarks/agent-tools/fixtures");
export const SUITE_REF = "benchmarks/agent-tools/fixtures";
export const FIXTURE_CATEGORIES = Object.freeze(["bug-fix", "feature", "test-guided-refactor", "multi-file"]);

const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const GIT_ENV = Object.freeze({
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "agent-tools-eval",
  GIT_AUTHOR_EMAIL: "agent-tools-eval@localhost.invalid",
  GIT_COMMITTER_NAME: "agent-tools-eval",
  GIT_COMMITTER_EMAIL: "agent-tools-eval@localhost.invalid",
  GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z",
  GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z"
});

export class SuiteError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "SuiteError";
    this.code = code;
  }
}

/** Runs git without a shell; throws with stderr on failure. */
export async function git(cwd, args, { env = {} } = {}) {
  const result = await runProcess("git", ["-c", "commit.gpgsign=false", ...args], { cwd, env: { ...GIT_ENV, ...env }, timeoutMs: 120000, maxOutputBytes: 16 * 1024 * 1024 });
  if (result.status !== InvocationStatus.COMPLETED || result.exitCode !== 0) {
    throw new Error(`git ${args[0]} failed (exit ${result.exitCode}): ${String(result.stderr).trim().slice(-400)}`);
  }
  return result.stdout;
}

async function listFiles(root) {
  const out = [];
  async function walk(dir) {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) out.push(relative(root, path).split(sep).join("/"));
    }
  }
  if (existsSync(root)) await walk(root);
  return out;
}

async function treeDigest(root) {
  const hash = createHash("sha256");
  for (const path of await listFiles(root)) {
    hash.update(`${path}\0`);
    hash.update(await readFile(join(root, path)));
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

function validateVerification(item, where) {
  if (!item || typeof item.name !== "string" || typeof item.command !== "string" || !Array.isArray(item.args) || !Number.isInteger(item.timeoutMs)) {
    throw new SuiteError("FIXTURE_INVALID", `${where} verification must be { name, command, args, timeoutMs }`);
  }
}

// "node" in a fixture verification means the running Node.js, so calibration and evaluation do
// not depend on PATH.
const resolveCommand = (item) => ({ ...item, command: item.command === "node" ? process.execPath : item.command, args: [...item.args] });

/** Loads the suite (optionally a subset of task ids) with per-fixture and whole-suite digests. */
export async function loadSuite({ root = DEFAULT_SUITE_ROOT, tasks = null } = {}) {
  const suiteRoot = resolve(root);
  const manifestPath = join(suiteRoot, "manifest.json");
  if (!existsSync(manifestPath)) throw new SuiteError("SUITE_MISSING", `no manifest.json in ${suiteRoot}`);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest.kind !== SUITE_KIND || !Array.isArray(manifest.fixtures) || manifest.fixtures.length === 0) throw new SuiteError("SUITE_INVALID", "manifest must be AGENT_TOOLS_SUITE_V1 with fixtures");
  const selected = tasks === null ? manifest.fixtures : tasks;
  for (const id of selected) if (!manifest.fixtures.includes(id)) throw new SuiteError("UNKNOWN_TASK", `task ${id} is not in the suite`);
  const fixtures = [];
  for (const id of manifest.fixtures.filter((fixtureId) => selected.includes(fixtureId))) {
    const dir = join(suiteRoot, id);
    const task = JSON.parse(await readFile(join(dir, "task.json"), "utf8"));
    if (task.id !== id) throw new SuiteError("FIXTURE_INVALID", `task.json id ${task.id} does not match ${id}`);
    if (!FIXTURE_CATEGORIES.includes(task.category)) throw new SuiteError("FIXTURE_INVALID", `${id} has unknown category ${task.category}`);
    if (typeof task.prompt !== "string" || task.prompt.length === 0) throw new SuiteError("FIXTURE_INVALID", `${id} needs a prompt`);
    for (const key of ["visibleVerifications", "hiddenVerifications"]) {
      if (!Array.isArray(task[key]) || task[key].length === 0) throw new SuiteError("FIXTURE_INVALID", `${id} needs ${key}`);
      task[key].forEach((item) => validateVerification(item, `${id} ${key}`));
    }
    const hiddenFiles = await listFiles(join(dir, "hidden"));
    if (hiddenFiles.length === 0) throw new SuiteError("FIXTURE_INVALID", `${id} has no hidden/** files`);
    const repoFiles = await listFiles(join(dir, "repo"));
    for (const path of hiddenFiles) if (repoFiles.includes(path)) throw new SuiteError("FIXTURE_INVALID", `${id} hidden file ${path} is also in repo/**`);
    fixtures.push(Object.freeze({
      id,
      category: task.category,
      prompt: task.prompt,
      dir,
      repoDir: join(dir, "repo"),
      hiddenDir: join(dir, "hidden"),
      solutionPatch: join(dir, "solution.patch"),
      hiddenFiles: Object.freeze(hiddenFiles),
      visibleVerifications: Object.freeze(task.visibleVerifications.map(resolveCommand)),
      hiddenVerifications: Object.freeze(task.hiddenVerifications.map(resolveCommand)),
      bundleDigest: await treeDigest(dir),
      instructionDigest: sha256(task.prompt)
    }));
  }
  const suiteDigest = sha256(JSON.stringify(fixtures.map((fixture) => [fixture.id, fixture.bundleDigest])));
  return Object.freeze({ root: suiteRoot, ref: SUITE_REF, manifest, fixtures: Object.freeze(fixtures), suiteDigest });
}

/** Copies repo/** into dir, initializes git and commits the base. Returns the base sha. */
export async function materializeRepository(fixture, dir) {
  await mkdir(dir, { recursive: true });
  await cp(fixture.repoDir, dir, { recursive: true });
  await git(dir, ["init", "-q"]);
  await git(dir, ["add", "-A"]);
  await git(dir, ["commit", "-q", "--no-verify", "-m", `base ${fixture.id}`]);
  return (await git(dir, ["rev-parse", "HEAD"])).trim();
}

/** Copies hidden/** into an evaluation checkout (never into an agent worktree). */
export async function overlayHidden(fixture, checkoutRoot) {
  await cp(fixture.hiddenDir, checkoutRoot, { recursive: true });
}

/** Returns the hidden relative paths present under root (must always be empty for agent worktrees). */
export function hiddenPresent(fixture, root) {
  return fixture.hiddenFiles.filter((path) => existsSync(join(root, path)));
}

/** Runs verifications in cwd; PASS only for exit 0 within the timeout. */
export async function runVerifications(cwd, verifications) {
  const results = [];
  for (const item of verifications) {
    const outcome = await runProcess(item.command, item.args, { cwd, timeoutMs: item.timeoutMs, maxOutputBytes: 262144 });
    const status = outcome.status === InvocationStatus.COMPLETED ? (outcome.exitCode === 0 ? "PASS" : "FAIL") : "ERROR";
    results.push({ name: item.name, status, exitCode: outcome.exitCode ?? null });
  }
  return results;
}

const allPass = (results) => results.every((result) => result.status === "PASS");

/**
 * Calibrates every fixture: the base must fail its hidden and visible verifications, and
 * base + solution.patch must pass both. The agent-visible repository never contains hidden/**.
 */
export async function calibrateSuite({ root = DEFAULT_SUITE_ROOT, tasks = null } = {}) {
  const suite = await loadSuite({ root, tasks });
  const fixtures = [];
  for (const fixture of suite.fixtures) {
    const scratch = await mkdtemp(join(tmpdir(), "agent-tools-calibrate-"));
    const reasons = [];
    try {
      const repo = join(scratch, "repo");
      await materializeRepository(fixture, repo);
      if (hiddenPresent(fixture, repo).length > 0) reasons.push("HIDDEN_IN_AGENT_REPOSITORY");
      const baseVisible = await runVerifications(repo, fixture.visibleVerifications);
      const evalBase = join(scratch, "eval-base");
      await cp(repo, evalBase, { recursive: true });
      await overlayHidden(fixture, evalBase);
      const baseHidden = await runVerifications(evalBase, fixture.hiddenVerifications);
      const evalSolution = join(scratch, "eval-solution");
      await cp(repo, evalSolution, { recursive: true });
      await git(evalSolution, ["apply", fixture.solutionPatch]);
      const solutionVisible = await runVerifications(evalSolution, fixture.visibleVerifications);
      await overlayHidden(fixture, evalSolution);
      const solutionHidden = await runVerifications(evalSolution, fixture.hiddenVerifications);
      if (allPass(baseHidden)) reasons.push("BASE_PASSES_HIDDEN");
      if (allPass(baseVisible)) reasons.push("BASE_PASSES_VISIBLE");
      if (!allPass(solutionHidden)) reasons.push("SOLUTION_FAILS_HIDDEN");
      if (!allPass(solutionVisible)) reasons.push("SOLUTION_FAILS_VISIBLE");
      fixtures.push({ id: fixture.id, category: fixture.category, calibrated: reasons.length === 0, reasons, baseVisible, baseHidden, solutionVisible, solutionHidden });
    } catch (error) {
      fixtures.push({ id: fixture.id, category: fixture.category, calibrated: false, reasons: [`CALIBRATION_ERROR: ${error.message}`] });
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  }
  return { kind: "AGENT_TOOLS_SUITE_CALIBRATION_V1", suiteDigest: suite.suiteDigest, calibrated: fixtures.every((fixture) => fixture.calibrated), fixtures };
}
