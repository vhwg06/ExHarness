// Deterministic recovery-seam probe for BB-101 over CURRENT delivered code.
// No provider, credentials, network or real agent CLI.
// Usage from repository root: node docs/blackboard/evidence/BB-101/recovery-probe.mjs
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..", "..", "..");
const agentTools = await import(pathToFileURL(path.join(root, "packages/agent-tools/src/index.js")));
const core = await import(pathToFileURL(path.join(root, "packages/core-harness/src/index.js")));
const agentic = await import(pathToFileURL(path.join(root, "packages/agentic-system/src/index.js")));
const supervisorSrc = fs.readFileSync(path.join(root, "packages/agent-tools/src/supervisor.js"), "utf8");
const fakeSrc = fs.readFileSync(path.join(root, "packages/agent-tools/test/fixtures/fake-agent.mjs"), "utf8");
const runtimeSrc = fs.readFileSync(path.join(root, "packages/core-harness/src/resumable-agent-runtime.js"), "utf8");
const workspaceSrc = fs.readFileSync(path.join(root, "packages/agentic-system/src/local-git-workspace.js"), "utf8");

const destructuredKeys = (src, fnName) => {
  const match = src.match(new RegExp(`function ${fnName}\\(\\{([\\s\\S]*?)\\}\\)`));
  if (!match) return [];
  return match[1].split(",").map((part) => part.trim().split(/\s*(?:=|:)/)[0].trim()).filter((name) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name));
};

const gitEnv = { ...process.env, GIT_AUTHOR_NAME: "probe", GIT_AUTHOR_EMAIL: "probe@localhost.invalid", GIT_COMMITTER_NAME: "probe", GIT_COMMITTER_EMAIL: "probe@localhost.invalid" };
const git = (cwd, ...args) => {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: gitEnv });
  if (r.status !== 0) throw new Error(`git ${args[0]}: ${r.stderr}`);
  return r.stdout.trim();
};

function tempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb101-repo-"));
  git(dir, "init", "-q");
  fs.writeFileSync(path.join(dir, "f.txt"), "x\n");
  git(dir, "add", "-A");
  git(dir, "-c", "commit.gpgsign=false", "commit", "-q", "-m", "base");
  return { dir, base: git(dir, "rev-parse", "HEAD") };
}

const pingHarness = (sessionStore) => core.createHarness({
  strategy: { async run({ invoke }) { await invoke(core.AVOCapability.ACT, { kind: "PROBE" }); return { ok: true }; } },
  environment: { async observe() { return { files: [] }; }, async act({ candidate }) { return { mutated: false, candidate }; } },
  objective: { async evaluate() { return { validity: core.EvaluationValidity.VALID, verdict: core.EvaluationVerdict.GAP, evidence: ["probe"] }; } },
  sessionStore
});

// 1. Supervisor surface.
const supervisor = {
  runSupervisedTaskOptions: destructuredKeys(supervisorSrc, "runSupervisedTask"),
  strategyOptions: destructuredKeys(supervisorSrc, "createSupervisedAgentStrategy"),
  exportedResumeSupervisedTask: typeof agentTools.resumeSupervisedTask === "function",
  exportedDisposeRecoverableRun: typeof agentTools.disposeRecoverableRun === "function",
  exportedHandleVersion: agentTools.AGENT_TOOL_RUN_HANDLE_VERSION ?? null,
  sessionIdUsesRandomUUID: supervisorSrc.includes("agent-task:${task.id}:${randomUUID()}"),
  scratchIsMkdtemp: supervisorSrc.includes('mkdtemp(join(tmpdir(), "exharness-agent-"))'),
  disposesWorktreeInFinally: supervisorSrc.includes("await workspace.dispose()") && supervisorSrc.includes("} finally {"),
  mentionsRecoveryDir: supervisorSrc.includes("recoveryDir"),
  mentionsResumeWorktree: supervisorSrc.includes("resumeWorktree"),
  passesSessionStore: /createHarness\(\{[\s\S]*sessionStore/.test(supervisorSrc),
  invocationObserverDefaultNull: supervisorSrc.includes("invocationObserver = null"),
  strategyLoopStartsAtOne: /for \(let index = 1; index <= maxAttempts; index \+= 1\)/.test(supervisorSrc),
  actThenVerifyThenEvaluate: supervisorSrc.indexOf("AVOCapability.ACT") < supervisorSrc.indexOf("input.verifiers") && supervisorSrc.indexOf("AVOCapability.EVALUATE") > supervisorSrc.indexOf("input.verifiers")
};

// 2. File-backed Core sessionStore survives a new harness; start() rejects duplicates;
//    recover({ force: true }) closes a RUNNING variation so vary() can run again.
const coreSession = { directory: fs.mkdtempSync(path.join(os.tmpdir(), "bb101-core-")) };
try {
  const sessionId = "agent-task:probe";
  const seed = { id: "probe", version: "a".repeat(40) };
  const work = { id: "probe", prompt: "p" };
  const storeA = agentic.createJsonBackendSessionStore({ directory: coreSession.directory });
  const harnessA = pingHarness(storeA);
  await harnessA.start({ sessionId, work, seedCandidate: seed });
  let startRejectedExisting = false;
  try { await harnessA.start({ sessionId, work, seedCandidate: seed }); } catch (error) { startRejectedExisting = /session already exists/.test(error.message); }
  const storeB = agentic.createJsonBackendSessionStore({ directory: coreSession.directory });
  const harnessB = pingHarness(storeB);
  const resumed = await harnessB.resume(sessionId);
  if (typeof harnessB.beginVariation !== "function") throw new Error("createHarness is missing beginVariation");
  await harnessB.beginVariation(sessionId);
  const harnessC = pingHarness(agentic.createJsonBackendSessionStore({ directory: coreSession.directory }));
  let varyWhileRunning = null;
  try { await harnessC.vary(sessionId); } catch (error) { varyWhileRunning = error.code ?? error.name; }
  const recovered = await harnessC.recover(sessionId, { force: true });
  const after = await harnessC.vary(sessionId);
  coreSession.facts = {
    inMemoryContract: ["load", "save", "supportsRevisions"].every((k) => k in core.createInMemorySessionStore()),
    jsonBackendContract: ["load", "save", "supportsRevisions"].every((k) => k in storeA) && storeA.supportsDurableRecovery === true,
    resumeAfterNewInstanceSeesSameId: resumed.id === sessionId,
    startRejectedExisting,
    varyWhileRunningCode: varyWhileRunning,
    recoverClosedRunning: recovered.recovered === true,
    secondVaryCompleted: after.failure == null && after.result?.ok === true,
    createHarnessHas: ["start", "resume", "recover", "vary"].every((k) => typeof harnessA[k] === "function")
  };
} finally {
  fs.rmSync(coreSession.directory, { recursive: true, force: true });
}

// 3. createResumableAgentRuntime is a runtime-snapshot factory, not a harness session API.
const runtimeKeys = [...runtimeSrc.matchAll(/^\s*(?:async )?([A-Za-z]+)\(/gm)].map((m) => m[1]);
const resumable = {
  exported: typeof core.createResumableAgentRuntime === "function",
  optionNames: destructuredKeys(runtimeSrc, "createResumableAgentRuntime").filter((name) => ["snapshot", "strategy", "runtimeCompatibilityTag"].includes(name)),
  hasStartVaryResume: ["start", "vary", "resume"].some((name) => runtimeKeys.includes(name)),
  snapshotsRuntimeConfiguration: runtimeSrc.includes("createRuntimeConfigurationManifest")
};

// 4. createLocalGitWorkspace always `git worktree add`; a second add on the same path fails.
const { dir, base } = tempRepo();
const worktreeRoot = path.join(dir, "..", `${path.basename(dir)}-wt`);
let firstWorkspace = null;
let secondAdd = { failed: false, message: null };
try {
  firstWorkspace = await agentic.createLocalGitWorkspace({ repositoryRoot: dir, baseRevision: base, worktreeRoot });
  try {
    await agentic.createLocalGitWorkspace({ repositoryRoot: dir, baseRevision: base, worktreeRoot });
  } catch (error) {
    secondAdd = { failed: true, message: String(error.message ?? error).slice(0, 180) };
  }
} finally {
  try { if (firstWorkspace) await firstWorkspace.dispose(); } catch { /* probe cleanup */ }
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(worktreeRoot, { recursive: true, force: true });
}
const workspace = {
  alwaysWorktreeAdd: workspaceSrc.includes('["worktree", "add", "--detach", root, baseRevision]'),
  exportsReopen: /reopen|resumeWorktree|existingWorktree/.test(workspaceSrc) === false && typeof agentic.reopenLocalGitWorkspace !== "function",
  secondAddFails: secondAdd.failed
};

const adapters = {
  codexResumeUsesSessionRef: fs.readFileSync(path.join(root, "packages/agent-tools/src/tool-adapters.js"), "utf8").includes('["exec", "resume", resume.sessionRef, "--json", "-"]'),
  kiroResumeFlagIgnoresSessionRef: fs.readFileSync(path.join(root, "packages/agent-tools/src/tool-adapters.js"), "utf8").includes("sessionRef is ignored"),
  fakeHasFixAfterFeedback: fakeSrc.includes('case "FIX_AFTER_FEEDBACK":'),
  canonicalJsonExported: typeof agentTools.canonicalJson === "function"
};

const probe = {
  kind: "BB101_RECOVERY_PROBE_RESULT",
  version: 1,
  node: process.version,
  headSha: spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim(),
  supervisor,
  coreSession: coreSession.facts,
  resumable,
  workspace,
  adapters,
  conclusions: {
    crashResumeSeamIsCreateHarnessSessionStore: coreSession.facts.createHarnessHas && coreSession.facts.jsonBackendContract && coreSession.facts.resumeAfterNewInstanceSeesSameId,
    inMemoryStoreIsNotCrashRecovery: core.createInMemorySessionStore().supportsRevisions === true && !("supportsDurableRecovery" in core.createInMemorySessionStore()),
    createResumableAgentRuntimeIsNotTheSeam: resumable.exported && resumable.hasStartVaryResume === false,
    interruptedVariationNeedsRecoverForce: coreSession.facts.varyWhileRunningCode === "RECOVERY_REQUIRED" && coreSession.facts.recoverClosedRunning && coreSession.facts.secondVaryCompleted,
    startCannotMintASecondSession: coreSession.facts.startRejectedExisting,
    worktreeMustBeReopenedNotAdded: workspace.alwaysWorktreeAdd && workspace.secondAddFails && workspace.exportsReopen,
    defaultSupervisorStillMkdtempUuidDispose: supervisor.sessionIdUsesRandomUUID && supervisor.scratchIsMkdtemp && supervisor.disposesWorktreeInFinally && supervisor.mentionsRecoveryDir === false,
    invocationObserverIsDeliveredPassThrough: supervisor.invocationObserverDefaultNull && supervisor.runSupervisedTaskOptions.includes("invocationObserver"),
    noResumeApiYet: supervisor.exportedResumeSupervisedTask === false && supervisor.passesSessionStore === false && supervisor.strategyLoopStartsAtOne,
    fakeFixAfterFeedbackExists: adapters.fakeHasFixAfterFeedback
  }
};
const out = path.join(here, "recovery-probe-result.json");
fs.writeFileSync(out, `${JSON.stringify(probe, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(probe.conclusions, null, 2)}\n`);
