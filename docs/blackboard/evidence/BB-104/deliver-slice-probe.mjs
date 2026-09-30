// Deterministic BB-104 probe over CURRENT main. No provider, credentials, network, or real agent CLI.
// Usage: node docs/blackboard/evidence/BB-104/deliver-slice-probe.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdtemp, rm } from "node:fs/promises";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..", "..", "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(root, rel));
const sha = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim();
const at = await import(pathToFileURL(path.join(root, "packages/agent-tools/src/index.js")));
const ag = await import(pathToFileURL(path.join(root, "packages/agentic-system/src/index.js")));
const { VerificationStatus } = await import(pathToFileURL(path.join(root, "packages/core-harness/src/index.js")));
const fake = path.join(root, "packages/agent-tools/test/fixtures/fake-agent.mjs");
const { AGENT_TOOLS, AgentTaskStatus, defineAgentTool, runSupervisedTask } = at;
const { createLocalCommandVerifier, createLocalGitWorkspace, LocalVerificationReason } = ag;

const cli = read("packages/agent-tools/bin/exharness-agent.mjs");
const sup = read("packages/agent-tools/src/supervisor.js");
const idx = read("packages/agent-tools/src/index.js");
const comp = read("packages/agentic-system/src/composition.js");
const plan = (id) => JSON.parse(read(`docs/blackboard/artifacts/ready-implement-plan/${id}.json`));
const bb100 = plan("BB-100"), bb101 = plan("BB-101"), bb102 = plan("BB-102");
const has = (p, n) => JSON.stringify(p).includes(n);

const gitEnv = { ...process.env, GIT_AUTHOR_NAME: "probe", GIT_AUTHOR_EMAIL: "probe@localhost.invalid", GIT_COMMITTER_NAME: "probe", GIT_COMMITTER_EMAIL: "probe@localhost.invalid" };
const git = (cwd, ...args) => {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: gitEnv });
  if (r.status !== 0) throw new Error(`git ${args[0]}: ${r.stderr}`);
  return r.stdout.trim();
};
function tempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb104-probe-"));
  git(dir, "init", "-q");
  fs.writeFileSync(path.join(dir, "sum.mjs"), "export const sum = (a, b) => a - b;\n");
  fs.writeFileSync(path.join(dir, "sum.test.mjs"), 'import test from "node:test";\nimport assert from "node:assert/strict";\nimport { sum } from "./sum.mjs";\ntest("sum", () => assert.equal(sum(2, 3), 5));\n');
  git(dir, "add", "-A");
  git(dir, "-c", "commit.gpgsign=false", "commit", "-q", "-m", "base");
  return { dir, base: git(dir, "rev-parse", "HEAD") };
}

const qaRepo = tempRepo();
const qaRoot = await mkdtemp(path.join(os.tmpdir(), "bb104-qa-"));
const qaWs = await createLocalGitWorkspace({ repositoryRoot: qaRepo.dir, baseRevision: qaRepo.base, worktreeRoot: path.join(qaRoot, "worktree") });
const mutated = await createLocalCommandVerifier({
  name: "qa-mutate", claim: "qa.mutate", root: qaWs.root, command: process.execPath,
  args: ["-e", "require('fs').writeFileSync('mutated.txt','x')"], timeoutMs: 15000, requireUnchangedTree: true
}).verify({ candidate: { id: "qa", version: qaRepo.base } });
const mismatched = await createLocalCommandVerifier({
  name: "qa-rev", claim: "qa.rev", root: qaWs.root, command: process.execPath,
  args: ["-e", "process.exit(0)"], timeoutMs: 15000, requireUnchangedTree: true
}).verify({ candidate: { id: "qa", version: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" } });
const qaSourceHead = git(qaRepo.dir, "rev-parse", "HEAD");
await qaWs.dispose();
await rm(qaRoot, { recursive: true, force: true });

const beRepo = tempRepo();
const sourceHead = git(beRepo.dir, "rev-parse", "HEAD");
const tool = defineAgentTool(AGENT_TOOLS.codex, { command: process.execPath, prefixArgs: [fake] });
const supervised = await runSupervisedTask({
  tool,
  task: {
    id: "bb104-probe", repositoryRoot: beRepo.dir, baseRevision: beRepo.base, prompt: "fix sum",
    verifications: [{ name: "unit", command: process.execPath, args: ["--test", "sum.test.mjs"], timeoutMs: 30000 }]
  },
  maxAttempts: 2, timeoutMs: 60000, env: { FAKE_AGENT_SCENARIO: "FIX_FIRST" }
});
let acceptedCheckout = { ok: false, qaPass: false };
if (supervised.status === AgentTaskStatus.ACCEPTED && /^[0-9a-f]{40}$/.test(supervised.acceptedSha ?? "")) {
  const checkoutRoot = await mkdtemp(path.join(os.tmpdir(), "bb104-acc-"));
  try {
    const ws = await createLocalGitWorkspace({
      repositoryRoot: beRepo.dir, baseRevision: supervised.acceptedSha, worktreeRoot: path.join(checkoutRoot, "worktree")
    });
    const rec = await createLocalCommandVerifier({
      name: "qa-unit", claim: "qa.unit", root: ws.root, command: process.execPath,
      args: ["--test", "sum.test.mjs"], timeoutMs: 30000, requireUnchangedTree: true
    }).verify({ candidate: { id: "qa", version: supervised.acceptedSha } });
    acceptedCheckout = { ok: true, qaPass: rec.status === VerificationStatus.PASS, head: await ws.head() };
    await ws.dispose();
  } finally { await rm(checkoutRoot, { recursive: true, force: true }); }
}

const probe = {
  kind: "BB104_DELIVER_SLICE_PROBE_RESULT",
  version: 1,
  checkedSha: sha,
  cli: {
    commands: [...cli.matchAll(/if \(command === "([^"]+)"\)/g)].map((m) => m[1]),
    hasDeliver: /\bdeliver\b/.test(cli),
    toolUnavailable: cli.includes("AgentTaskStatus.TOOL_UNAVAILABLE"),
    notInstalled: cli.includes('reason: "NOT_INSTALLED"')
  },
  delivered: {
    agentTaskStatus: { ...AgentTaskStatus },
    localVerificationReason: { ...LocalVerificationReason },
    toolIds: Object.keys(AGENT_TOOLS).sort(),
    hasRunSupervisedBackendWork: typeof at.runSupervisedBackendWork === "function" || typeof ag.runSupervisedBackendWork === "function",
    hasResumeSupervisedTask: typeof at.resumeSupervisedTask === "function",
    hasRunDeliverSlice: typeof at.runDeliverSlice === "function",
    invocationObserver: /invocationObserver = null/.test(sup),
    recoveryDir: /recoveryDir/.test(sup),
    requiredFiles: /requiredFiles/.test(sup),
    compositionImportsAgentTools: /agent-tools|runSupervisedTask/.test(comp),
    indexExportsDeliver: /deliver-slice|runDeliverSlice/.test(idx),
    operatorMd: fs.existsSync(path.join(root, "docs/living/system/agent-tools/operator.md")),
    supervisedBackendJs: exists("packages/agentic-system/src/supervised-backend.js"),
    recoveryJs: exists("packages/agent-tools/src/recovery.js")
  },
  planned: {
    bb100: { status: bb100.status, runSupervisedBackendWork: has(bb100, "runSupervisedBackendWork"), noRequiredFiles: has(bb100, "No requiredFiles field (BB-102)"), noRecoveryDir: !has(bb100, "recoveryDir") },
    bb101: { status: bb101.status, resumeSupervisedTask: has(bb101, "resumeSupervisedTask"), handleComplete: has(bb101, "HANDLE_COMPLETE (resume when status is ACCEPTED"), recoveryDir: has(bb101, "recoveryDir = null") },
    bb102: { status: bb102.status, optionalRequiredFiles: has(bb102, "requiredFiles is optional") }
  },
  verifierSeam: {
    mutatedFail: mutated.status === VerificationStatus.FAIL && JSON.stringify(mutated).includes("TREE_MUTATED"),
    mismatchFail: mismatched.status === VerificationStatus.FAIL && JSON.stringify(mismatched).includes("REVISION_MISMATCH"),
    qaSourceUnchanged: qaSourceHead === qaRepo.base
  },
  backendThenQa: {
    status: supervised.status,
    acceptedCheckout,
    sourceHeadPreserved: git(beRepo.dir, "rev-parse", "HEAD") === sourceHead
  },
  conclusions: {}
};
probe.conclusions = {
  hasDeliverCommand: probe.cli.hasDeliver,
  cliCommandsAreRunReportProbeSmoke: probe.cli.commands.join(",") === "run,report,probe,smoke",
  runSupervisedBackendWorkNotExported: !probe.delivered.hasRunSupervisedBackendWork,
  resumeSupervisedTaskNotExported: !probe.delivered.hasResumeSupervisedTask,
  runDeliverSliceNotExported: !probe.delivered.hasRunDeliverSlice,
  agentTaskStatusTrio: AgentTaskStatus.ACCEPTED === "ACCEPTED" && AgentTaskStatus.EXHAUSTED === "EXHAUSTED" && AgentTaskStatus.TOOL_UNAVAILABLE === "TOOL_UNAVAILABLE" && Object.keys(AgentTaskStatus).length === 3,
  invocationObserverDelivered: probe.delivered.invocationObserver,
  recoveryDirNotDelivered: !probe.delivered.recoveryDir,
  validateAgentTaskDropsRequiredFiles: !probe.delivered.requiredFiles,
  compositionDoesNotImportAgentTools: !probe.delivered.compositionImportsAgentTools,
  qaMutationFailsWithTreeMutated: probe.verifierSeam.mutatedFail,
  qaDifferentRevisionFailsWithRevisionMismatch: probe.verifierSeam.mismatchFail,
  acceptedShaCheckoutableAfterDispose: acceptedCheckout.ok,
  qaOnAcceptedShaPasses: acceptedCheckout.qaPass === true,
  sourceRepositoryHeadPreserved: probe.verifierSeam.qaSourceUnchanged && probe.backendThenQa.sourceHeadPreserved,
  bb100OmitsRequiredFilesAndRecoveryDir: probe.planned.bb100.runSupervisedBackendWork && probe.planned.bb100.noRequiredFiles && probe.planned.bb100.noRecoveryDir,
  bb101PlansResumeAndHandleComplete: probe.planned.bb101.resumeSupervisedTask && probe.planned.bb101.handleComplete,
  bb102PlansOptionalRequiredFiles: probe.planned.bb102.optionalRequiredFiles,
  smokePrintsNotInstalled: probe.cli.notInstalled,
  operatorLivingDocMissing: !probe.delivered.operatorMd,
  toolIdsAreCodexKiroAgy: probe.delivered.toolIds.join(",") === "agy,codex,kiro"
};
const out = path.join(here, "deliver-slice-probe-result.json");
fs.writeFileSync(out, `${JSON.stringify(probe, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(probe.conclusions, null, 2)}\n`);
