#!/usr/bin/env node
// Deterministic BB-099 evaluation probe over DELIVERED agent-tools + this host.
// No provider, no credentials, no live agent prompt. Writes evaluation-probe-result.json.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..", "..", "..");
const agentTools = await import(pathToFileURL(path.join(root, "packages/agent-tools/src/index.js")));
const agentic = await import(pathToFileURL(path.join(root, "packages/agentic-system/src/index.js")));
const supervisorSrc = fs.readFileSync(path.join(root, "packages/agent-tools/src/supervisor.js"), "utf8");
const observationSrc = fs.readFileSync(path.join(root, "packages/agent-tools/src/observation.js"), "utf8");
const processRunnerSrc = fs.readFileSync(path.join(root, "packages/agent-tools/src/process-runner.js"), "utf8");
const fakeSrc = fs.readFileSync(path.join(root, "packages/agent-tools/test/fixtures/fake-agent.mjs"), "utf8");
const bb065 = JSON.parse(fs.readFileSync(path.join(root, "docs/blackboard/artifacts/ready-implement-plan/BB-065.json"), "utf8"));
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const agentPkg = JSON.parse(fs.readFileSync(path.join(root, "packages/agent-tools/package.json"), "utf8"));

const which = (command) => {
  const result = spawnSync("sh", ["-c", `command -v ${JSON.stringify(command)} || true`], { encoding: "utf8" });
  const resolved = result.stdout.trim();
  return resolved.length === 0 ? null : resolved;
};
const grokHome = "/home/box/.grok/bin/grok";
const grokOnPath = which("grok");
const grokBin = fs.existsSync(grokHome) ? grokHome : grokOnPath;
const grokHelp = grokBin
  ? spawnSync(grokBin, ["--help"], { encoding: "utf8", timeout: 15000 }).stdout
  : "";
const grokVersion = grokBin
  ? spawnSync(grokBin, ["--version"], { encoding: "utf8", timeout: 15000 }).stdout.trim()
  : null;

let benchmarkImport = { ok: false, errorCode: null, message: null };
try {
  await import("@exharness/benchmark");
  benchmarkImport = { ok: true, errorCode: null, message: null };
} catch (error) {
  benchmarkImport = { ok: false, errorCode: error?.code ?? null, message: String(error?.message ?? error).slice(0, 200) };
}

const d1 = bb065.architectureDecisions.find((line) => line.startsWith("D1 —"));
const d2 = bb065.architectureDecisions.find((line) => line.startsWith("D2 —"));
const d5 = bb065.architectureDecisions.find((line) => line.startsWith("D5 —"));
const d8 = bb065.architectureDecisions.find((line) => line.startsWith("D8 —"));
const d11 = bb065.architectureDecisions.find((line) => line.startsWith("D11 —"));
const d12 = bb065.architectureDecisions.find((line) => line.startsWith("D12 —"));

const fakeScenarios = [...fakeSrc.matchAll(/case "([A-Z_]+)":/g)].map((match) => match[1]);
const sha = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim();

const result = {
  kind: "BB099_EVALUATION_PROBE_RESULT",
  version: 1,
  sha,
  platform: `${os.platform()}-${os.arch()}`,
  node: process.version,
  deliveredExports: {
    names: Object.keys(agentTools).sort(),
    hasObserveInvocation: "observeInvocation" in agentTools,
    hasRunObservedInvocation: typeof agentTools.runObservedInvocation === "function",
    hasCreateSupervisedObservation: typeof agentTools.createSupervisedObservation === "function",
    hasRunSupervisedTask: typeof agentTools.runSupervisedTask === "function",
    hasRunAgentInvocation: typeof agentTools.runAgentInvocation === "function",
    hasDefineAgentTool: typeof agentTools.defineAgentTool === "function",
    agentToolsKeys: Object.keys(agentTools.AGENT_TOOLS).sort(),
    agentTaskStatus: { ...agentTools.AgentTaskStatus },
    invocationStatus: { ...agentTools.InvocationStatus },
    permissionProfile: { ...agentTools.PermissionProfile }
  },
  sourceSeams: {
    supervisorHasInvocationObserverDefaultNull: /invocationObserver = null/.test(supervisorSrc),
    observationExportsRunObservedInvocation: /export async function runObservedInvocation\(/.test(observationSrc),
    observationExportsCreateSupervisedObservation: /export function createSupervisedObservation\(/.test(observationSrc),
    childEnvironmentSpreadsProcessEnv: /const \{ NODE_TEST_CONTEXT, \.\.\.inherited \} = process\.env/.test(processRunnerSrc),
    fakeScenarios,
    hasCreateLocalGitWorkspace: typeof agentic.createLocalGitWorkspace === "function",
    hasCreateLocalCommandVerifier: typeof agentic.createLocalCommandVerifier === "function"
  },
  hostTools: {
    codex: which("codex"),
    kiro: which("kiro"),
    "kiro-cli": which("kiro-cli"),
    agy: which("agy"),
    grokOnPath,
    grokHomeExists: fs.existsSync(grokHome),
    grokBin,
    grokVersion,
    grokHelpFlags: {
      outputFormat: /--output-format/.test(grokHelp),
      json: /\bjson\b/.test(grokHelp),
      singleDashP: /-p, --single/.test(grokHelp),
      resume: /--resume/.test(grokHelp),
      continue: /-c, --continue/.test(grokHelp),
      alwaysApprove: /--always-approve/.test(grokHelp),
      permissionMode: /--permission-mode/.test(grokHelp),
      model: /-m, --model/.test(grokHelp),
      usageCommand: /^\s+usage\s/m.test(grokHelp),
      agentCommand: /^\s+agent\s/m.test(grokHelp)
    }
  },
  bb065: {
    planStatus: bb065.status,
    d1ExposesOnlyPackageRoot: /exposes only the package root/.test(d1 ?? ""),
    d1NoDeepImport: /no deep-import contract/.test(d1 ?? ""),
    d2PublicExports: d2 ?? null,
    d5AdaptersOwnProcessInvocation: /Adapters own real reset, process invocation/.test(d5 ?? ""),
    d8Lifecycle: d8 ?? null,
    d11ExperimentOwnedAdapter: /owns DIRECT_CODEACT\/CORE_SYNC adapters/.test(d11 ?? ""),
    d12ReuseKernel: /reuse the same experiment\/unit\/attempt\/evidence\/accounting backbone/.test(d12 ?? ""),
    packagesBenchmarkExists: fs.existsSync(path.join(root, "packages/benchmark")),
    benchmarkImport
  },
  workspace: {
    workspaces: pkg.workspaces,
    hasEvalAgentTools: Object.prototype.hasOwnProperty.call(pkg.scripts, "eval:agent-tools"),
    agentToolsExports: agentPkg.exports
  }
};

const out = path.join(here, "evaluation-probe-result.json");
fs.writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(`${out} bytes=${fs.statSync(out).size}\n`);
