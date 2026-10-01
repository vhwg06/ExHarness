import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const bin = read("packages/agent-tools/bin/exharness-agent.mjs");
const deliver = read("packages/agent-tools/src/deliver-slice.js");
const supervisor = read("packages/agent-tools/src/supervisor.js");

function count(haystack, needle) {
  return haystack.split(needle).length - 1;
}

const commandRun = bin.slice(bin.indexOf("async function commandRun"), bin.indexOf("async function commandProbe"));
const facts = {
  baselineSha: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  providerCalls: 0,
  runCliPassesRecoveryDir: /recoveryDir|recovery-dir/.test(commandRun),
  runCliPassesMcpVerify: /mcpVerify/.test(commandRun),
  runCliPassesTraceDir: /trace-dir/.test(commandRun),
  runCliPassesPermission: /permission/.test(commandRun),
  runCliPassesModel: /options\.model/.test(commandRun),
  binMentionsMcp: /mcp/i.test(bin),
  supervisorAcceptsRecoveryDir: /recoveryDir = null/.test(supervisor),
  supervisorAcceptsMcpVerify: /mcpVerify = false/.test(supervisor),
  supervisorAcceptsPermission: /permissionProfile = PermissionProfile/.test(supervisor),
  supervisorAcceptsModel: /model = null/.test(supervisor),
  deliverObserverNullCount: count(deliver, "invocationObserver: null"),
  deliverMentionsPermissionProfile: /permissionProfile/.test(deliver),
  deliverMentionsModel: /\bmodel\b/.test(deliver),
  validateRejectsUnknownToolWhitelist: /tool must be one of codex\|kiro\|agy/.test(deliver)
};

const out = {
  kind: "ROADMAP_DISCOVERY_EVIDENCE",
  classification: "SOURCE_INSPECTION",
  checked: "2026-10-01",
  ...facts
};

const dest = path.join(root, "docs/blackboard/evidence/BB-134/cli-composition-audit.json");
fs.writeFileSync(dest, `${JSON.stringify(out, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ ok: true, dest, facts }, null, 2)}\n`);
