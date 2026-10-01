import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const adapter = read("packages/agentic-system/src/supervised-backend.js");
const supervisor = read("packages/agent-tools/src/supervisor.js");
const bin = read("packages/agent-tools/bin/exharness-agent.mjs");
const deliver = read("packages/agent-tools/src/deliver-slice.js");

function sliceFn(src, name) {
  const asyncMark = `async function ${name}`;
  const syncMark = `function ${name}`;
  const start = src.includes(asyncMark) ? src.indexOf(asyncMark) : src.indexOf(syncMark);
  if (start < 0) throw new Error(`missing function ${name}`);
  const next = src.slice(start + 1).search(/\n(?:export )?(?:async )?function /);
  return next < 0 ? src.slice(start) : src.slice(start, start + 1 + next);
}

const runSupervisedBackendWork = sliceFn(adapter, "runSupervisedBackendWork");
const commandDeliverCli = sliceFn(bin, "commandDeliverCli");
const commandDeliver = sliceFn(deliver, "commandDeliver");
const runSupervisedTask = sliceFn(supervisor, "runSupervisedTask");

const usageLiteral = bin.match(/const USAGE = "([^"]*)"/)?.[1] ?? "";
const deliverUsage = usageLiteral.split("\\n").find((line) => line.includes("deliver --slice")) ?? "";

const facts = {
  baselineSha: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  providerCalls: 0,
  adapterMentionsRecoveryDir: /recoveryDir|recovery-dir/.test(runSupervisedBackendWork),
  adapterMentionsMcpVerify: /mcpVerify/.test(runSupervisedBackendWork),
  adapterCallsRunSupervisedTask: /runSupervisedTask\(/.test(runSupervisedBackendWork),
  supervisorAcceptsRecoveryDir: /recoveryDir = null/.test(runSupervisedTask),
  supervisorAcceptsMcpVerify: /mcpVerify = false/.test(runSupervisedTask),
  deliverCliPassesTool: /\btool\b/.test(commandDeliverCli),
  commandDeliverAcceptsTool: /options\.tool/.test(commandDeliver),
  deliverUsageListsTool: /--tool/.test(deliverUsage)
};

const out = {
  kind: "ROADMAP_DISCOVERY_EVIDENCE",
  classification: "SOURCE_INSPECTION",
  checked: "2026-10-01",
  ...facts
};

const dest = path.join(root, "docs/blackboard/evidence/BB-141/adapter-composition-audit.json");
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, `${JSON.stringify(out, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ ok: true, dest, facts }, null, 2)}\n`);
