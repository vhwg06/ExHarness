// Deterministic BB-102 probe over CURRENT delivered code. No credentials, network, or real agent CLI.
// Usage from repository root: node docs/blackboard/evidence/BB-102/oracle-context-probe.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..", "..", "..");
const sha = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim();
const agentTools = await import(pathToFileURL(path.join(root, "packages/agent-tools/src/index.js")));
const oracle = await import(pathToFileURL(path.join(root, "packages/oracle/src/index.js")));
const agentic = await import(pathToFileURL(path.join(root, "packages/agentic-system/src/index.js")));
const supervisorSrc = fs.readFileSync(path.join(root, "packages/agent-tools/src/supervisor.js"), "utf8");
const gitEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "p", GIT_AUTHOR_EMAIL: "p@localhost.invalid", GIT_COMMITTER_NAME: "p", GIT_COMMITTER_EMAIL: "p@localhost.invalid" };
const git = (cwd, ...args) => {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: gitEnv });
  if (r.status !== 0) throw new Error(`git ${args[0]}: ${r.stderr}`);
  return r.stdout.trim();
};

const { AgentTaskStatus, validateAgentTask } = agentTools;
const { createOracleContextResolver, createExactRepositoryProvider, createSourceCatalog, createRetrievalPlanner, assertConsumableContextResolution, defineContextRequirement, DurabilityFailure } = oracle;
const { createLocalGitWorkspace, assertSafeWorkspacePath, OracleContextBlockedError } = agentic;
const optionBlock = supervisorSrc.split("export async function runSupervisedTask({")[1]?.split("})")[0] ?? "";
const optionNames = optionBlock.split("\n").map((l) => l.trim().replace(/,$/, "").replace(/:.*$/, "").split(/[\s=]/)[0]).filter((n) => n && !n.startsWith("//") && !n.startsWith("*"));

const validTask = { id: "t", repositoryRoot: "/tmp/repo", baseRevision: "a".repeat(40), prompt: "do", verifications: [{ name: "u", command: "node", args: ["--test"], timeoutMs: 1000 }] };
const validated = validateAgentTask({ ...validTask, requiredFiles: ["src/app.js"], extra: true });
let requiredFilesTypeError = null;
try { validateAgentTask({ ...validTask, requiredFiles: ["../escape.js"] }); } catch (e) { requiredFilesTypeError = e.name; }
const pathChecks = {};
for (const [label, p] of [["ok", "src/app.js"], ["dotdot", "src/../app.js"], ["abs", "/tmp/x"], ["git", ".git/config"]]) {
  try { assertSafeWorkspacePath(p); pathChecks[label] = "accepted"; } catch (e) { pathChecks[label] = e.code; }
}

function requirement(ref, revision, files, bytes) {
  return defineContextRequirement({
    consumerRef: "agent-task:probe", semanticNeed: "probe",
    evidence: files.map((file, i) => ({ id: `file-${i}`, necessity: "REQUIRED", need: file, source: { kind: "REPOSITORY", ref, snapshot: { mode: "EXACT", ref: revision }, itemRefs: [file] } })),
    budget: { maxItems: files.length, maxProviderCalls: files.length, maxResolutionSteps: 1, maxMaterializedBytes: bytes }
  });
}
async function resolveExact({ files, bytes, reader, observe, revision = "rev-1", ref = "repo://probe" }) {
  const req = requirement(ref, revision, files, bytes);
  const catalog = createSourceCatalog({ providers: [createExactRepositoryProvider({ repositoryReader: reader })], snapshotAuthorities: [{ sourceKind: "REPOSITORY", refPrefix: ref, observe }] });
  const resolver = createOracleContextResolver({ sourceCatalog: catalog, retrievalPlanner: createRetrievalPlanner({ catalog }) });
  try {
    const result = await resolver.resolve(req);
    let consumable = true;
    try { assertConsumableContextResolution(result.resolution, req); } catch { consumable = false; }
    const items = result.resolution.items;
    return { status: result.resolution.status, unresolved: result.resolution.unresolved, failures: (result.failures ?? []).map((f) => ({ evidenceId: f.evidenceId, reason: f.reason })), itemRefs: items.map((i) => i.source.itemRef), snapshotRefs: items.map((i) => i.source.snapshotRef), sourceRefs: items.flatMap((i) => i.provenance.filter((p) => p.kind === "SOURCE_REF").map((p) => p.ref)), contents: items.map((i) => i.content), consumable, thrown: null };
  } catch (error) {
    return { status: null, unresolved: [], failures: [], contents: [], thrown: { name: error.name, reason: error.reason ?? null, message: String(error.message).slice(0, 80) } };
  }
}

const FILE = "export const n = 1;\n";
const files = new Map([["src/app.js", FILE]]);
const reader = { async readFile({ repositoryRef, revision, path: p }) { if (!files.has(p)) throw new Error(`missing: ${p}`); return { content: files.get(p), sourceRef: `${repositoryRef}@${revision}:${p}` }; } };
const pin = async () => ({ snapshotRef: "rev-1" });
const complete = await resolveExact({ files: ["src/app.js"], bytes: 65536, reader, observe: pin });
const missing = await resolveExact({ files: ["src/missing.js"], bytes: 65536, reader, observe: pin });
const budget1 = await resolveExact({ files: ["src/app.js"], bytes: 1, reader, observe: pin });
const budget2 = await resolveExact({ files: ["src/app.js"], bytes: 2, reader, observe: pin });
const budget8192 = await resolveExact({ files: ["src/app.js"], bytes: 8192, reader, observe: pin });
let n = 0;
const stale = await resolveExact({ files: ["src/app.js"], bytes: 65536, reader, observe: async () => ({ snapshotRef: n++ === 0 ? "rev-1" : "b".repeat(40) }) });

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb102-"));
git(dir, "init", "-q");
fs.mkdirSync(path.join(dir, "src"));
fs.writeFileSync(path.join(dir, "src/app.js"), FILE);
git(dir, "add", "-A");
git(dir, "-c", "commit.gpgsign=false", "commit", "-q", "-m", "base");
const base = git(dir, "rev-parse", "HEAD");
const gitReader = {
  async readFile({ repositoryRef, revision, path: p }) {
    const shown = spawnSync("git", ["show", `${revision}:${p}`], { cwd: repositoryRef, encoding: "utf8", env: gitEnv });
    if (shown.status !== 0) throw new Error("git show failed");
    return { content: shown.stdout, sourceRef: `${revision}:${p}` };
  }
};
const gitExact = await resolveExact({ files: ["src/app.js"], bytes: 65536, reader: gitReader, observe: async () => ({ snapshotRef: base }), revision: base, ref: dir });
const workspace = await createLocalGitWorkspace({ repositoryRoot: dir, baseRevision: base, worktreeRoot: path.join(dir, "..", `${path.basename(dir)}-wt`) });
const contextFile = path.join(workspace.root, ".exharness", "context", "src", "app.js");
fs.mkdirSync(path.dirname(contextFile), { recursive: true });
fs.writeFileSync(contextFile, FILE);
const dirtyBeforeExclude = git(workspace.root, "status", "--porcelain", "--untracked-files=all");
const excludePath = git(workspace.root, "rev-parse", "--git-path", "info/exclude");
fs.mkdirSync(path.dirname(excludePath), { recursive: true });
fs.appendFileSync(excludePath, "\n.exharness/\n");
const dirtyAfterExclude = git(workspace.root, "status", "--porcelain", "--untracked-files=all");
const headAfterWrite = git(workspace.root, "rev-parse", "HEAD");
await workspace.dispose();

const names = ["createOracleContextResolver", "createExactRepositoryProvider", "createSourceCatalog", "createRetrievalPlanner", "assertConsumableContextResolution", "defineContextRequirement", "DurabilityFailure"];
const probe = {
  kind: "BB102_ORACLE_CONTEXT_PROBE_RESULT",
  version: 1,
  checkedSha: sha,
  identifiers: {
    oracleExports: names.filter((n) => n in oracle),
    agentTaskStatus: Object.keys(AgentTaskStatus),
    runSupervisedTaskOptions: optionNames
  },
  facade: {
    missing: missing.unresolved[0]?.reason ?? null,
    budget1: budget1.thrown?.message ?? null,
    budget2: budget2.unresolved[0]?.reason ?? null,
    stale: stale.thrown?.reason ?? null,
    gitExact: gitExact.status
  },
  conclusions: {
    facadeResolvesExactGitRevision: gitExact.status === "COMPLETE" && gitExact.contents[0] === FILE,
    missingFileIsUnsatisfiedSourceFailure: missing.status === "UNSATISFIED" && missing.unresolved[0]?.reason === "SOURCE_FAILURE",
    budgetOneThrowsConsumedBelowMaterialization: budget1.thrown?.name === "TypeError" && /consumed below materialization/.test(budget1.thrown.message),
    budgetTwoIsUnsatisfiedBudgetExhausted: budget2.status === "UNSATISFIED" && budget2.unresolved.some((u) => u.reason === "BUDGET_EXHAUSTED"),
    staleFenceThrowsDurabilityFailure: stale.thrown?.name === "DurabilityFailure" && stale.thrown?.reason === "STALE_DURING_RESOLUTION",
    agentTaskStatusHasNoContextValue: Object.keys(AgentTaskStatus).sort().join(",") === "ACCEPTED,EXHAUSTED,TOOL_UNAVAILABLE",
    validateAgentTaskCurrentlyDropsRequiredFiles: !("requiredFiles" in validated) && requiredFilesTypeError === null,
    invocationObserverPresentOnSupervisor: optionNames.includes("invocationObserver"),
    contextWriteDirtiesWorktreeUntilExcluded: dirtyBeforeExclude.includes(".exharness") && dirtyAfterExclude === "",
    assertSafeWorkspacePathRejectsEscape: pathChecks.ok === "accepted" && pathChecks.dotdot === "LOCAL_WORKSPACE_UNSAFE_PATH"
  }
};
fs.writeFileSync(path.join(here, "oracle-context-probe-result.json"), `${JSON.stringify(probe, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(probe.conclusions, null, 2)}\n`);
