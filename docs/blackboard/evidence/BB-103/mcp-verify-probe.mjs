// Deterministic BB-103 probe over CURRENT agent-tools. No credentials, network or live CLI.
// Usage from repository root: node docs/blackboard/evidence/BB-103/mcp-verify-probe.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..", "..", "..");
const agentTools = await import(pathToFileURL(path.join(root, "packages/agent-tools/src/index.js")));
const { VerificationStatus } = await import(pathToFileURL(path.join(root, "packages/core-harness/src/index.js")));
const { createLocalCommandVerifier, LocalVerificationReason } = await import(pathToFileURL(path.join(root, "packages/agentic-system/src/index.js")));
const supervisorSrc = fs.readFileSync(path.join(root, "packages/agent-tools/src/supervisor.js"), "utf8");
const adaptersSrc = fs.readFileSync(path.join(root, "packages/agent-tools/src/tool-adapters.js"), "utf8");
const cliSrc = fs.readFileSync(path.join(root, "packages/agent-tools/bin/exharness-agent.mjs"), "utf8");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "packages/agent-tools/package.json"), "utf8"));
const fake = path.join(root, "packages/agent-tools/test/fixtures/fake-agent.mjs");
const { defineAgentTool, AGENT_TOOLS, runSupervisedTask, AgentTaskStatus } = agentTools;

const gitEnv = { ...process.env, GIT_AUTHOR_NAME: "probe", GIT_AUTHOR_EMAIL: "probe@localhost.invalid", GIT_COMMITTER_NAME: "probe", GIT_COMMITTER_EMAIL: "probe@localhost.invalid" };
const git = (cwd, ...args) => {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: gitEnv });
  if (r.status !== 0) throw new Error(`git ${args[0]}: ${r.stderr}`);
  return r.stdout.trim();
};
function repository() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb103-probe-"));
  git(dir, "init", "-q");
  fs.writeFileSync(path.join(dir, "sum.mjs"), "export const sum = (a, b) => a - b;\n");
  fs.writeFileSync(path.join(dir, "sum.test.mjs"), 'import test from "node:test";\nimport assert from "node:assert/strict";\nimport { sum } from "./sum.mjs";\ntest("sum", () => assert.equal(sum(2, 3), 5));\n');
  git(dir, "add", "-A");
  git(dir, "-c", "commit.gpgsign=false", "commit", "-q", "-m", "base");
  return { dir, base: git(dir, "rev-parse", "HEAD") };
}
function optionsOf(src, signature) {
  const start = src.indexOf(signature);
  const open = src.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}" && --depth === 0) {
      return src.slice(open + 1, i).split(",").map((p) => p.trim().split(/[\s:=]/)[0]).filter((p) => p && !p.startsWith("/") && !p.startsWith("*"));
    }
  }
  return [];
}
const reasonFrom = (artifact) => {
  const line = (artifact.evidence ?? []).find((item) => typeof item === "string" && item.includes(":reason="));
  return line ? line.slice(line.indexOf(":reason=") + ":reason=".length) : artifact.status;
};

const exportNames = Object.keys(agentTools).sort();
const runOpts = optionsOf(supervisorSrc, "export async function runSupervisedTask(");
const strategyOpts = optionsOf(supervisorSrc, "export function createSupervisedAgentStrategy(");

const { dir: vDir, base: vBase } = repository();
const verifier = createLocalCommandVerifier({
  name: "unit", claim: "agent-task.unit", root: vDir, command: process.execPath,
  args: ["--test", "sum.test.mjs"], timeoutMs: 30000, requireUnchangedTree: true
});
const failArt = await verifier.verify({ candidate: { id: "p", version: vBase } });
fs.writeFileSync(path.join(vDir, "sum.mjs"), "export const sum = (a, b) => a + b;\n");
git(vDir, "add", "-A");
git(vDir, "-c", "commit.gpgsign=false", "commit", "-q", "-m", "fix");
const passHead = git(vDir, "rev-parse", "HEAD");
const passArt = await verifier.verify({ candidate: { id: "p", version: passHead } });
const mismatchArt = await verifier.verify({ candidate: { id: "p", version: vBase } });

const tool = defineAgentTool(AGENT_TOOLS.codex, { command: process.execPath, prefixArgs: [fake] });
const observerKeys = [];
const { dir: sDir, base: sBase } = repository();
const task = (id, dir, base) => ({ id, repositoryRoot: dir, baseRevision: base, prompt: "fix sum", verifications: [{ name: "unit", command: process.execPath, args: ["--test", "sum.test.mjs"], timeoutMs: 30000 }] });
const passed = await runSupervisedTask({
  tool, task: task("p-pass", sDir, sBase), maxAttempts: 2, env: { FAKE_AGENT_SCENARIO: "FIX_FIRST" },
  invocationObserver: async (payload) => { observerKeys.push(Object.keys(payload).sort()); }
});
const { dir: cDir, base: cBase } = repository();
const claimed = await runSupervisedTask({
  tool, task: task("p-claim", cDir, cBase), maxAttempts: 2, env: { FAKE_AGENT_SCENARIO: "CLAIM_SUCCESS_NO_EDIT" }
});

const ndjson = await new Promise((resolve, reject) => {
  const toServer = new PassThrough();
  const fromServer = new PassThrough();
  let buf = "";
  const t = setTimeout(() => reject(new Error("ndjson timeout")), 2000);
  fromServer.setEncoding("utf8");
  fromServer.on("data", (chunk) => {
    buf += chunk;
    const nl = buf.indexOf("\n");
    if (nl < 0) return;
    clearTimeout(t);
    resolve(JSON.parse(buf.slice(0, nl)));
  });
  toServer.setEncoding("utf8");
  toServer.on("data", (chunk) => {
    const req = JSON.parse(String(chunk).trim());
    fromServer.write(`${JSON.stringify({ jsonrpc: "2.0", id: req.id, result: { protocolVersion: req.params.protocolVersion, capabilities: { tools: {} } } })}\n`);
  });
  toServer.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } })}\n`);
});

const mcpRe = /\bmcp\b/i;
const probe = {
  kind: "BB103_MCP_VERIFY_PROBE_RESULT",
  version: 1,
  headSha: spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim(),
  runOpts,
  strategyOpts,
  verifier: {
    fail: { status: failArt.status, reason: reasonFrom(failArt) },
    pass: { status: passArt.status, reason: reasonFrom(passArt) },
    mismatch: { status: mismatchArt.status, reason: reasonFrom(mismatchArt) }
  },
  supervised: {
    passStatus: passed.status,
    resultFields: Object.keys(passed).sort(),
    claimStatus: claimed.status,
    claimOutcomes: claimed.attempts.map((a) => [a.outcome, a.mutated, a.claimedSuccess])
  },
  conclusions: {
    agentToolsHasNoMcpExport: exportNames.every((n) => !/mcp/i.test(n)),
    mcpVerifyOptionAbsent: !runOpts.includes("mcpVerify"),
    invocationObserverPresentDefaultNull: runOpts.includes("invocationObserver") && /invocationObserver = null/.test(supervisorSrc),
    strategyOptionsAreTaskMaxAttemptsMaxFeedbackChars: JSON.stringify(strategyOpts) === JSON.stringify(["task", "maxAttempts", "maxFeedbackChars"]),
    zeroRuntimeNpmDependencies: !pkg.dependencies,
    createLocalCommandVerifierIsIndependentVerifySeam: verifier.name === "unit" && failArt.status === VerificationStatus.FAIL && passArt.status === VerificationStatus.PASS,
    verifierReasonLivesInEvidenceLine: reasonFrom(failArt) === LocalVerificationReason.FAIL && reasonFrom(passArt) === LocalVerificationReason.PASS,
    revisionMismatchIsFail: mismatchArt.status === VerificationStatus.FAIL && reasonFrom(mismatchArt) === LocalVerificationReason.REVISION_MISMATCH,
    claimSuccessNoEditCannotPromote: claimed.status === AgentTaskStatus.EXHAUSTED,
    invocationObserverStillFires: observerKeys.length === 1,
    envWouldReachAgentChild: /runAgentInvocation\(tool, request, \{ cwd: root, env, timeoutMs \}\)/.test(supervisorSrc),
    adaptersDoNotCarryMcpArgv: !mcpRe.test(adaptersSrc) && !mcpRe.test(cliSrc),
    ndjsonFakeClientWorksWithoutSdkOrLiveCli: ndjson?.result?.protocolVersion === "2025-03-26",
    noListenApiInCurrentAgentTools: !/createServer|\.listen\(/.test(supervisorSrc + adaptersSrc + cliSrc)
  }
};
for (const dir of [vDir, sDir, cDir]) fs.rmSync(dir, { recursive: true, force: true });
fs.writeFileSync(path.join(here, "mcp-verify-probe-result.json"), `${JSON.stringify(probe, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(probe.conclusions)}\n`);
