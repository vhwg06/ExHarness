// Deterministic BB-100 composition probe over CURRENT delivered code. No provider, credentials, or real CLI.
// Usage from repository root: node docs/blackboard/evidence/BB-100/composition-probe.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..", "..", "..");
const at = await import(pathToFileURL(path.join(root, "packages/agent-tools/src/index.js")));
const ag = await import(pathToFileURL(path.join(root, "packages/agentic-system/src/index.js")));
const core = await import(pathToFileURL(path.join(root, "packages/core-harness/src/index.js")));
const fake = path.join(root, "packages/agent-tools/test/fixtures/fake-agent.mjs");
const gitEnv = { ...process.env, GIT_AUTHOR_NAME: "p", GIT_AUTHOR_EMAIL: "p@x.invalid", GIT_COMMITTER_NAME: "p", GIT_COMMITTER_EMAIL: "p@x.invalid", GIT_CONFIG_NOSYSTEM: "1" };
const git = (cwd, ...args) => {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: gitEnv, shell: false });
  if (r.status !== 0) throw new Error(`git ${args[0]}: ${r.stderr}`);
  return r.stdout.trim();
};
function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb100-"));
  git(dir, "init", "-q"); git(dir, "checkout", "-q", "-b", "main");
  fs.writeFileSync(path.join(dir, "sum.mjs"), "export const sum = (a, b) => a - b;\n");
  fs.writeFileSync(path.join(dir, "sum.test.mjs"), "import test from \"node:test\";\nimport assert from \"node:assert/strict\";\nimport { sum } from \"./sum.mjs\";\ntest(\"sum\", () => assert.equal(sum(2, 3), 5));\n");
  git(dir, "add", "-A"); git(dir, "-c", "commit.gpgsign=false", "commit", "-q", "-m", "base");
  return { dir, base: git(dir, "rev-parse", "HEAD") };
}
const tool = at.defineAgentTool(at.AGENT_TOOLS.codex, { command: process.execPath, prefixArgs: [fake] });
const task = (dir, base) => ({ id: "p", repositoryRoot: dir, baseRevision: base, prompt: "Fix sum", verifications: [{ name: "tests", command: process.execPath, args: ["--test", "sum.test.mjs"], timeoutMs: 30000 }] });
const snap = (dir) => ({ head: git(dir, "rev-parse", "HEAD"), refs: git(dir, "for-each-ref", "--format=%(refname) %(objectname)", "refs/heads"), status: git(dir, "status", "--porcelain", "--untracked-files=all") });

async function run(scenario, maxAttempts, checkout = false) {
  const { dir, base } = repo();
  const before = snap(dir);
  const observer = [];
  const result = await at.runSupervisedTask({
    tool, task: task(dir, base), maxAttempts, timeoutMs: 30000, env: { FAKE_AGENT_SCENARIO: scenario },
    invocationObserver: (facts) => { observer.push(facts.outcome); }
  });
  const after = snap(dir);
  let checkoutPass = null;
  const reachable = result.acceptedSha
    ? spawnSync("git", ["cat-file", "-e", `${result.acceptedSha}^{commit}`], { cwd: dir, encoding: "utf8", env: gitEnv, shell: false }).status === 0
    : null;
  if (checkout && result.acceptedSha && reachable) {
    const wt = path.join(os.tmpdir(), `bb100-wt-${process.pid}`);
    const ws = await ag.createLocalGitWorkspace({ repositoryRoot: dir, baseRevision: result.acceptedSha, worktreeRoot: wt });
    try {
      const v = await ag.createLocalCommandVerifier({
        name: "tests", claim: ag.BackendEvidenceClaim.TESTS, root: ws.root,
        command: process.execPath, args: ["--test", "sum.test.mjs"], timeoutMs: 30000
      }).verify({ candidate: { id: "p", version: result.acceptedSha } });
      checkoutPass = v.status === "PASS" && v.evidence.some((line) => line.includes(`revision=${result.acceptedSha}`));
    } finally { await ws.dispose(); }
  }
  fs.rmSync(dir, { recursive: true, force: true });
  return {
    status: result.status, acceptedSha: result.acceptedSha, outcomes: result.attempts.map((a) => a.outcome),
    claimed: result.attempts.map((a) => a.claimedSuccess), mutated: result.attempts.map((a) => a.mutated),
    sourceUnchanged: JSON.stringify(before) === JSON.stringify(after), reachable, checkoutPass,
    observer, fields: Object.keys(result).sort()
  };
}

const fix = await run("FIX_FIRST", 2, true);
const never = await run("NEVER_FIX", 2);
const claim = await run("CLAIM_SUCCESS_NO_EDIT", 2);
const auth = await run("AUTH_FAIL", 1);
const { dir: md, base: mb } = repo();
const missing = await at.runSupervisedTask({
  tool: at.defineAgentTool(at.AGENT_TOOLS.codex, { command: path.join(md, "no-codex") }),
  task: task(md, mb), maxAttempts: 1, timeoutMs: 5000
});
fs.rmSync(md, { recursive: true, force: true });

const sha = "a".repeat(40);
const parse = (raw) => { try { return { ok: true, v: ag.BackendWorkResultSchema.parse(raw) }; } catch (e) { return { ok: false, m: e.message }; } };
const applied = parse({ status: ag.BackendWorkStatus.APPLIED, summary: "ok", revision: sha, artifacts: [{ ref: `git:${sha}:sum.mjs`, path: "sum.mjs" }], evidence: [], gaps: [], blockers: [] });
const blocked = parse({ status: ag.BackendWorkStatus.BLOCKED, summary: "x", revision: null, artifacts: [], evidence: [], gaps: [], blockers: ["TOOL_UNAVAILABLE"] });
const emptyEv = ag.assessBackendCompletion(applied.v);
const sub = core.subjectFromValue({ r: sha }, { type: "backend-candidate", producer: { identity: "p", roles: ["executor"] } });
const env = core.environmentRefFromValue({ r: sha }, { name: "p" });
const atIso = "2026-01-01T00:00:00.000Z";
const ev = (claim, kind, extra) => core.createEvidenceArtifact({
  subject: sub, kind, producer: { identity: "p", roles: ["executor"] }, environment: env, generatedAt: atIso,
  metadata: { claim, verificationStatus: "PASS" }, content: extra
});
const grounded = ag.assessBackendCompletion(ag.BackendWorkResultSchema.parse({
  status: ag.BackendWorkStatus.APPLIED, summary: "ok", revision: sha, artifacts: [{ ref: `git:${sha}:sum.mjs`, path: "sum.mjs" }],
  evidence: [
    ev(ag.BackendEvidenceClaim.MUTATION, "BACKEND_MUTATION", { beforeRevision: sha, afterRevision: sha, lineageAdvanced: true }),
    ev(ag.BackendEvidenceClaim.TYPECHECK, "VERIFICATION", { claim: ag.BackendEvidenceClaim.TYPECHECK, status: "PASS" }),
    ev(ag.BackendEvidenceClaim.TESTS, "VERIFICATION", { claim: ag.BackendEvidenceClaim.TESTS, status: "PASS" })
  ], gaps: [], blockers: []
}));
const ctx = ag.BackendContextSchema.parse({ repository: { ref: "repo://probe", revision: sha }, files: [{ path: "sum.mjs", content: "x", sourceRef: "s" }] });
const order = ag.parseBackendWorkOrder(ag.makeBackendWorkOrder(ag.defineBackendObjective({ id: "h", task: "Fix", repository: { ref: "repo://probe", revision: sha }, requiredFiles: ["sum.mjs"] })));
const bw = fs.readFileSync(path.join(root, "packages/agentic-system/src/backend-worker.js"), "utf8");
const sv = fs.readFileSync(path.join(root, "packages/agent-tools/src/supervisor.js"), "utf8");
const idx = fs.readFileSync(path.join(root, "packages/agentic-system/src/index.js"), "utf8");
const start = sv.indexOf("export async function runSupervisedTask({");
const params = sv.slice(start, sv.indexOf("}) {", start)).split("\n").slice(1)
  .map((l) => l.trim().replace(/,$/, "").split("=")[0].trim().split(":")[0].trim()).filter(Boolean);

const probe = {
  kind: "BB100_COMPOSITION_PROBE_RESULT",
  version: 1,
  node: process.version,
  checkedSha: spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", shell: false }).stdout.trim(),
  realCliInstalledOnProbeHost: Object.fromEntries(["codex", "kiro-cli", "agy"].map((b) => [b, spawnSync(b, ["--version"], { encoding: "utf8" }).error?.code !== "ENOENT"])),
  identifiers: {
    AGENT_TASK_VERSION: at.AGENT_TASK_VERSION,
    AGENT_SUPERVISED_RESULT_VERSION: at.AGENT_SUPERVISED_RESULT_VERSION,
    AgentTaskStatus: at.AgentTaskStatus,
    AttemptOutcome: at.AttemptOutcome,
    BackendWorkStatus: ag.BackendWorkStatus,
    BackendEvidenceClaim: ag.BackendEvidenceClaim,
    PermissionProfile: at.PermissionProfile,
    runSupervisedTaskParams: params,
    resultFields: fix.fields,
    agentTaskFields: Object.keys(at.validateAgentTask({ id: "x", repositoryRoot: "/tmp", baseRevision: sha, prompt: "p", verifications: [{ name: "t", command: "node", args: [], timeoutMs: 1 }] })),
    coreEvidenceApis: ["createEvidenceArtifact", "evidenceFromVerificationArtifact", "subjectFromValue", "environmentRefFromValue"].filter((n) => typeof core[n] === "function")
  },
  schema: {
    backendWorkResultKeys: Object.keys(applied.v).sort(),
    hasReasonField: Object.hasOwn(applied.v, "reason"),
    appliedWithoutWorker: applied.ok,
    appliedNeedsRevision: parse({ status: "APPLIED", summary: "x", artifacts: [], evidence: [], gaps: [], blockers: [] }).ok === false,
    blockedNeedsBlockers: parse({ status: "BLOCKED", summary: "x", revision: null, artifacts: [], evidence: [], gaps: [], blockers: [] }).ok === false,
    blockedToolUnavailable: blocked.ok && blocked.v.blockers[0] === "TOOL_UNAVAILABLE",
    contextRepositoryKeys: Object.keys(ctx.repository).sort(),
    orderKeys: Object.keys(order).sort()
  },
  completion: { emptyEvidence: emptyEv.action, grounded: grounded.action },
  supervisor: {
    invocationObserverDefaultNull: params.includes("invocationObserver") && /invocationObserver = null/.test(sv),
    evaluateIsVerifierPass: sv.includes("verdict: missing.length === 0 ? EvaluationVerdict.PASS"),
    importsAgenticIndex: sv.includes('from "../../agentic-system/src/index.js"'),
    workerEvaluateIsMutationOnly: bw.includes("candidate.version !== order.revision"),
    workerImportsAgentTools: /agent-tools|runSupervisedTask/.test(bw),
    indexImportsAgentTools: /agent-tools|runSupervisedTask/.test(idx),
    mutationEvidenceExported: /\bexport\s+(?:async\s+)?function\s+mutationEvidence\b/.test(bw),
    localWorkspaceExported: idx.includes("createLocalGitWorkspace") && idx.includes("createLocalCommandVerifier")
  },
  scenarios: {
    FIX_FIRST: { status: fix.status, sourceUnchanged: fix.sourceUnchanged, reachable: fix.reachable, checkoutPass: fix.checkoutPass, observer: fix.observer },
    NEVER_FIX: { status: never.status, claimed: never.claimed, sourceUnchanged: never.sourceUnchanged },
    CLAIM_SUCCESS_NO_EDIT: { status: claim.status, outcomes: claim.outcomes, claimed: claim.claimed, mutated: claim.mutated },
    AUTH_FAIL: { status: auth.status, mutated: auth.mutated, claimed: auth.claimed },
    missingExecutable: { status: missing.status, acceptedSha: missing.acceptedSha }
  },
  conclusions: {
    backendStatusEnumIsAppliedFailedBlocked: ag.BackendWorkStatus.APPLIED === "APPLIED" && ag.BackendWorkStatus.FAILED === "FAILED" && ag.BackendWorkStatus.BLOCKED === "BLOCKED",
    schemaParsesAppliedWithoutBackendWorker: applied.ok,
    blockersNotReason: !Object.hasOwn(applied.v, "reason") && blocked.v.blockers.includes("TOOL_UNAVAILABLE"),
    repositoryRootIsCallerPathNotContextRef: ctx.repository.ref === "repo://probe" && !("repositoryRoot" in ctx),
    noChangeIsAttemptOutcome: at.AttemptOutcome.NO_CHANGE === "NO_CHANGE" && !Object.values(at.AgentTaskStatus).includes("NO_CHANGE"),
    claimSuccessNoEditIsExhausted: claim.status === at.AgentTaskStatus.EXHAUSTED,
    neverFixIsExhausted: never.status === at.AgentTaskStatus.EXHAUSTED,
    authFailIsExhaustedNotUnavailable: auth.status === at.AgentTaskStatus.EXHAUSTED,
    missingExecutableIsToolUnavailable: missing.status === at.AgentTaskStatus.TOOL_UNAVAILABLE,
    acceptedShaCheckoutableAfterDispose: fix.reachable === true && fix.checkoutPass === true,
    invocationObserverPresentDefaultNull: params.includes("invocationObserver"),
    mutationHelpersArePrivate: /\bexport\s+(?:async\s+)?function\s+mutationEvidence\b/.test(bw) === false,
    completionNeedsClaimsAndArtifacts: emptyEv.action !== ag.BackendCompletionAction.ACCEPT && grounded.action === ag.BackendCompletionAction.ACCEPT,
    defaultWorkerDoesNotImportAgentTools: /agent-tools|runSupervisedTask/.test(bw) === false
  }
};
fs.writeFileSync(path.join(here, "composition-probe-result.json"), `${JSON.stringify(probe, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(probe.conclusions, null, 2)}\n`);
