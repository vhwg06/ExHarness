#!/usr/bin/env node
// Executed capability probe: agent-tools child env inherits process.env.
// Credential-free. Plants tagged values only for this process; result stores booleans, not secrets.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { runProcess } from "../../../../packages/agent-tools/src/process-runner.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../../../..");
const PLANTED = "exh-planted-bb120-not-a-real-secret";
const PLANTED_AWS = "exh-planted-aws-bb120-not-a-real-secret";
process.env.EXHARNESS_PLANTED_SECRET = PLANTED;
process.env.AWS_SECRET_ACCESS_KEY = PLANTED_AWS;

const runnerSrc = readFileSync(join(root, "packages/agent-tools/src/process-runner.js"), "utf8");
const dump = await runProcess(
  process.execPath,
  ["-e", "process.stdout.write(JSON.stringify(Object.keys(process.env).sort()))"],
  { cwd: process.cwd(), timeoutMs: 8000 }
);
let keys = [];
try { keys = JSON.parse(dump.stdout); } catch { keys = []; }
const result = {
  kind: "BB-120_ENV_ALLOWLIST_PROBE_V1",
  childEnvironmentSpreadsProcessEnv: runnerSrc.includes("const { NODE_TEST_CONTEXT, ...inherited } = process.env;"),
  childEnvironmentOverlaysCallerEnv: runnerSrc.includes("return { ...inherited, ...env };"),
  spawnUsesChildEnvironment: runnerSrc.includes("env: childEnvironment(env),"),
  childEnvironmentExported: runnerSrc.includes("export function childEnvironment") || /export \{[^}]*childEnvironment/.test(runnerSrc),
  invocationStatus: dump.status,
  plantedSecretInherited: keys.includes("EXHARNESS_PLANTED_SECRET"),
  awsSecretInherited: keys.includes("AWS_SECRET_ACCESS_KEY"),
  pathInherited: keys.includes("PATH"),
  homeInherited: keys.includes("HOME"),
  nodeTestContextInherited: keys.includes("NODE_TEST_CONTEXT"),
  childKeyCount: keys.length,
  parentKeyCount: Object.keys(process.env).length
};
writeFileSync(join(here, "env-allowlist-probe-result.json"), `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(result)}\n`);
