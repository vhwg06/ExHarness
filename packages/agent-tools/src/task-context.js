// Oracle-grounded declared context for AGENT_TASK_V1.
//
// An agent-tools task may declare an optional `requiredFiles` list. Before any
// agent process starts, those paths are resolved through the delivered Oracle
// EXACT facade (`createOracleContextResolver`) pinned at the task baseRevision.
// Consumable items are projected into the agent prompt and into git-excluded
// worktree copies. Anything else (missing file, stale snapshot, exhausted
// budget) throws AgentTaskContextError before the worktree exists.
import { spawnSync } from "node:child_process";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { assertSafeWorkspacePath } from "../../agentic-system/src/index.js";
import {
  DurabilityFailure,
  assertConsumableContextResolution,
  createExactRepositoryProvider,
  createOracleContextResolver,
  createRetrievalPlanner,
  createSourceCatalog,
  defineContextRequirement
} from "../../oracle/src/index.js";

export const CONTEXT_UNSATISFIED = "CONTEXT_UNSATISFIED";
export const GROUNDED_CONTEXT_HEADER = "ExHarness grounded context:";

const EXCERPT_LIMIT = 4000;
const DEFAULT_MAX_MATERIALIZED_BYTES = 1048576;
const AGENT_TASK_VERSION = "AGENT_TASK_V1";

export class AgentTaskContextError extends Error {
  constructor({ status, unresolved = [], failures = [], reason = status } = {}) {
    super(`agent task context unsatisfied: ${status}${reason && reason !== status ? ` (${reason})` : ""}`);
    this.name = "AgentTaskContextError";
    this.code = CONTEXT_UNSATISFIED;
    this.status = status;
    this.unresolved = unresolved;
    this.failures = failures;
    this.reason = reason;
  }
}

/** Validates an optional requiredFiles list; returns the frozen list or undefined. */
export function validateRequiredFiles(value) {
  const invalid = (message) => { throw new TypeError(`${AGENT_TASK_VERSION} invalid: ${message}`); };
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) invalid("requiredFiles must be an array of relative POSIX paths");
  if (value.length === 0) return undefined;
  for (const entry of value) {
    if (typeof entry !== "string" || entry.length === 0) invalid("each requiredFiles entry must be a non-empty string");
    try {
      assertSafeWorkspacePath(entry);
    } catch (error) {
      invalid(`unsafe requiredFiles path: ${entry} (${error?.code ?? error?.message ?? error})`);
    }
  }
  if (new Set(value).size !== value.length) invalid("requiredFiles must list each path once");
  return Object.freeze([...value]);
}

/** Default repository reader: `git show <revision>:<path>` in the source repository. */
export function createGitRepositoryReader() {
  return {
    async readFile({ repositoryRef, revision, path }) {
      if (typeof repositoryRef !== "string" || repositoryRef.length === 0) throw new Error("repositoryReader.readFile requires repositoryRef");
      if (typeof revision !== "string" || revision.length === 0) throw new Error("repositoryReader.readFile requires revision");
      const shown = spawnSync("git", ["show", `${revision}:${path}`], {
        cwd: repositoryRef,
        shell: false,
        encoding: "utf8",
        env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" }
      });
      if (shown.status !== 0) throw new Error(`git show failed for ${path} at ${revision}: ${String(shown.stderr ?? "").trim().slice(-300)}`);
      return { content: shown.stdout, sourceRef: `${revision}:${path}` };
    }
  };
}

function sourceRefOf(item) {
  const ref = (item.provenance ?? []).find((entry) => entry?.kind === "SOURCE_REF")?.ref;
  return typeof ref === "string" && ref.length > 0 ? ref : `${item.source.snapshotRef}:${item.source.itemRef}`;
}

function excerptOf(content) {
  const text = typeof content === "string" ? content : JSON.stringify(content);
  if (text.length <= EXCERPT_LIMIT) return text;
  return `${text.slice(0, EXCERPT_LIMIT)}\n[truncated]`;
}

/** Builds the grounded prompt prefix for consumable items. */
export function buildGroundedPromptPrefix(items) {
  const lines = [GROUNDED_CONTEXT_HEADER];
  for (const item of items) {
    lines.push("", `path: ${item.path}`, `sourceRef: ${item.sourceRef}`, excerptOf(item.content));
  }
  return lines.join("\n");
}

function unsatisfiable(resolution, failures) {
  return new AgentTaskContextError({
    status: resolution.status,
    unresolved: resolution.unresolved,
    failures,
    reason: resolution.unresolved[0]?.reason ?? resolution.status
  });
}

/**
 * Resolves task.requiredFiles to EXACT snapshot-bound Oracle context.
 *
 * Tasks without requiredFiles (omitted or []) return
 * `{ used: false, items: [], promptPrefix: "" }` without constructing any
 * Oracle catalog, planner, provider or resolver and without calling the
 * repository reader. Anything unresolved throws AgentTaskContextError with
 * code CONTEXT_UNSATISFIED before any agent process starts.
 */
export async function resolveAgentTaskContext(task, { repositoryReader = null, maxMaterializedBytes = DEFAULT_MAX_MATERIALIZED_BYTES, snapshotObserve = null } = {}) {
  if (!Number.isInteger(maxMaterializedBytes) || maxMaterializedBytes <= 0) {
    throw new TypeError("maxMaterializedBytes must be a positive integer");
  }
  const requiredFiles = task?.requiredFiles;
  if (!Array.isArray(requiredFiles) || requiredFiles.length === 0) {
    return { used: false, items: [], promptPrefix: "" };
  }
  const files = validateRequiredFiles(requiredFiles);
  const count = files.length;
  const requirement = defineContextRequirement({
    consumerRef: `agent-task:${task.id}`,
    semanticNeed: "agent-task required files",
    evidence: files.map((file, index) => ({
      id: `file-${index}`,
      necessity: "REQUIRED",
      need: file,
      source: { kind: "REPOSITORY", ref: task.repositoryRoot, snapshot: { mode: "EXACT", ref: task.baseRevision }, itemRefs: [file] }
    })),
    budget: { maxItems: count, maxProviderCalls: count, maxResolutionSteps: 1, maxMaterializedBytes }
  });
  const reader = repositoryReader ?? createGitRepositoryReader();
  const observe = snapshotObserve ?? (() => ({ snapshotRef: task.baseRevision }));
  const catalog = createSourceCatalog({
    providers: [createExactRepositoryProvider({ repositoryReader: reader })],
    snapshotAuthorities: [{ sourceKind: "REPOSITORY", refPrefix: task.repositoryRoot, observe }]
  });
  const planner = createRetrievalPlanner({ catalog });
  const resolver = createOracleContextResolver({ sourceCatalog: catalog, retrievalPlanner: planner });
  let outcome;
  try {
    outcome = await resolver.resolve(requirement);
  } catch (error) {
    if (error instanceof DurabilityFailure || error?.name === "DurabilityFailure") {
      throw new AgentTaskContextError({ status: "STALE", unresolved: [], failures: [], reason: "STALE_DURING_RESOLUTION" });
    }
    if (error instanceof TypeError && /consumed below materialization\/step/.test(error.message)) {
      throw new AgentTaskContextError({
        status: "UNSATISFIED",
        unresolved: files.map((file, index) => ({ evidenceId: `file-${index}`, reason: "BUDGET_EXHAUSTED" })),
        failures: [],
        reason: "BUDGET_EXHAUSTED"
      });
    }
    throw error;
  }
  const { resolution, failures = [] } = outcome;
  if (resolution.status !== "COMPLETE") throw unsatisfiable(resolution, failures);
  try {
    assertConsumableContextResolution(resolution, requirement);
  } catch (error) {
    if (error instanceof TypeError) {
      throw new AgentTaskContextError({ status: "UNSATISFIED", unresolved: resolution.unresolved, failures, reason: error.message });
    }
    throw error;
  }
  const items = Object.freeze(resolution.items.map((item) => Object.freeze({
    evidenceId: item.evidenceId,
    path: item.source.itemRef,
    sourceRef: sourceRefOf(item),
    snapshotRef: item.source.snapshotRef,
    content: item.content
  })));
  return Object.freeze({ used: true, items, promptPrefix: buildGroundedPromptPrefix(items), requirement, resolution, failures: Object.freeze([...failures]) });
}

function gitPath(cwd, args) {
  const result = spawnSync("git", args, {
    cwd,
    shell: false,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" }
  });
  if (result.status !== 0) throw new Error(`git ${args[0]} failed: ${String(result.stderr ?? "").trim().slice(-300)}`);
  return result.stdout.trim();
}

/**
 * Projects resolved grounded context into a worktree: full file bytes at
 * `.exharness/context/<path>` plus a `.exharness/` line in the worktree's
 * `info/exclude` so the copies never enter the candidate. The source
 * repository is never written. Resolutions with `used: false` project nothing.
 */
export async function projectAgentTaskContext(resolved, { worktreeRoot } = {}) {
  if (typeof worktreeRoot !== "string" || worktreeRoot.length === 0) throw new TypeError("projectAgentTaskContext requires worktreeRoot");
  if (!resolved || resolved.used === false || (resolved.items ?? []).length === 0) {
    return Object.freeze({ projected: 0, files: Object.freeze([]) });
  }
  const written = [];
  for (const item of resolved.items) {
    assertSafeWorkspacePath(item.path);
    const target = join(worktreeRoot, ".exharness", "context", ...item.path.split("/"));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, typeof item.content === "string" ? item.content : JSON.stringify(item.content));
    written.push(`.exharness/context/${item.path}`);
  }
  const excludeRef = gitPath(worktreeRoot, ["rev-parse", "--git-path", "info/exclude"]);
  const excludePath = resolve(worktreeRoot, excludeRef);
  await mkdir(dirname(excludePath), { recursive: true });
  let current = "";
  try {
    current = await readFile(excludePath, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (!current.split("\n").some((line) => line.trim() === ".exharness/")) {
    await appendFile(excludePath, `${current.endsWith("\n") || current.length === 0 ? "" : "\n"}.exharness/\n`);
  }
  return Object.freeze({ projected: written.length, files: Object.freeze([...written]) });
}
