#!/usr/bin/env node
// Crash fixture for durable-recovery tests. Starts a recoverable supervised run and
// kills the process with exit code 97 the first time onHandleWrite sees the configured
// attemptIndex + phase. The handle is already persisted before onHandleWrite runs, so
// a fresh process can resume the same semantic attempt.
//
// Env: CRASH_TASK_JSON (task file), CRASH_RECOVERY_DIR, CRASH_SCENARIO,
// CRASH_ATTEMPT (integer), CRASH_PHASE (ACT_COMPLETED|ATTEMPT_COMPLETED),
// CRASH_TOOL (codex|kiro|agy, default codex), CRASH_TIMEOUT_MS (default 30000).
// FAKE_AGENT_RECORD / FAKE_AGENT_VERSION pass through to the fake CLI.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { codexTool, kiroTool, agyTool, defineAgentTool, runSupervisedTask } from "../../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const FAKE = join(here, "fake-agent.mjs");

const tools = { codex: codexTool, kiro: kiroTool, agy: agyTool };
const base = tools[process.env.CRASH_TOOL ?? "codex"] ?? codexTool;
const tool = defineAgentTool(base, { command: process.execPath, prefixArgs: [FAKE] });
const task = JSON.parse(readFileSync(process.env.CRASH_TASK_JSON, "utf8"));
const recoveryDir = process.env.CRASH_RECOVERY_DIR;
const attempt = Number(process.env.CRASH_ATTEMPT ?? "1");
const phase = process.env.CRASH_PHASE ?? "ACT_COMPLETED";

const result = await runSupervisedTask({
  tool,
  task,
  timeoutMs: Number(process.env.CRASH_TIMEOUT_MS ?? "30000"),
  recoveryDir,
  env: {
    FAKE_AGENT_SCENARIO: process.env.CRASH_SCENARIO ?? "FIX_AFTER_FEEDBACK",
    ...(process.env.FAKE_AGENT_RECORD ? { FAKE_AGENT_RECORD: process.env.FAKE_AGENT_RECORD } : {}),
    ...(process.env.FAKE_AGENT_VERSION ? { FAKE_AGENT_VERSION: process.env.FAKE_AGENT_VERSION } : {})
  },
  async onHandleWrite(handle) {
    if (handle.attemptIndex === attempt && handle.phase === phase) process.exit(97);
  }
});
process.stdout.write(`${JSON.stringify({ status: result.status })}\n`);
