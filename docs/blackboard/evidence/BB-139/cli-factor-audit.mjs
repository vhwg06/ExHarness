import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const bin = read("packages/agent-tools/bin/exharness-agent.mjs");
const deliver = read("packages/agent-tools/src/deliver-slice.js");
const evalIndex = read("packages/agent-tools/src/experiment/index.js");
const arms = read("packages/agent-tools/src/experiment/arms.js");

function sliceFn(src, name) {
  const asyncMark = `async function ${name}`;
  const syncMark = `function ${name}`;
  const start = src.includes(asyncMark) ? src.indexOf(asyncMark) : src.indexOf(syncMark);
  if (start < 0) throw new Error(`missing function ${name}`);
  const next = src.slice(start + 1).search(/\n(?:async )?function /);
  return next < 0 ? src.slice(start) : src.slice(start, start + 1 + next);
}

const commandDeliverCli = sliceFn(bin, "commandDeliverCli");
const commandEval = sliceFn(bin, "commandEval");
const commandSmoke = sliceFn(bin, "commandSmoke");
const commandRun = sliceFn(bin, "commandRun");
const commandDeliver = sliceFn(deliver, "commandDeliver");

const facts = {
  baselineSha: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  providerCalls: 0,
  deliverCliPassesMaxAttempts: /max-attempts|maxAttempts/.test(commandDeliverCli),
  deliverCliPassesTimeoutMs: /timeout-ms|timeoutMs/.test(commandDeliverCli),
  commandDeliverAcceptsMaxAttempts: /maxAttempts|max-attempts/.test(commandDeliver),
  commandDeliverAcceptsTimeoutMs: /timeoutMs|timeout-ms/.test(commandDeliver),
  runCliPassesMaxAttempts: /max-attempts/.test(commandRun),
  runCliPassesTimeoutMs: /timeout-ms/.test(commandRun),
  evalFlagsHasPermission: /EVAL_FLAGS[\s\S]*"permission"/.test(bin) || commandEval.includes("permission"),
  evalFlagsHasTimeoutMs: commandEval.includes("timeout-ms") || commandEval.includes("timeoutMs"),
  evalFlagsHasK: /\bK\b/.test(commandEval) || commandEval.includes("max-attempts"),
  evalApiAcceptsFactors: /factors = \{\}/.test(evalIndex),
  defaultFactorsHasPermission: /permissionProfile: PermissionProfile/.test(arms),
  defaultFactorsHasTimeoutMs: /timeoutMs: 600000/.test(arms),
  defaultFactorsHasK: /K: 3/.test(arms),
  smokePassesModel: /options\.model/.test(commandSmoke),
  smokePassesPermission: /permission/.test(commandSmoke),
  smokePassesTraceDir: /trace-dir/.test(commandSmoke),
  smokeCallsRunSupervisedTask: /runSupervisedTask\(/.test(commandSmoke)
};

const out = {
  kind: "ROADMAP_DISCOVERY_EVIDENCE",
  classification: "SOURCE_INSPECTION",
  checked: "2026-10-01",
  ...facts
};

const dest = path.join(root, "docs/blackboard/evidence/BB-139/cli-factor-audit.json");
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, `${JSON.stringify(out, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ ok: true, dest, facts }, null, 2)}\n`);
