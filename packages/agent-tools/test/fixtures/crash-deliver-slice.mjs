#!/usr/bin/env node
// Crash fixture for deliver-slice resume tests. Starts runDeliverSlice with a
// durable recoveryDir and kills the process with exit code 97 the first time
// onHandleWrite sees Backend attempt 1 ACT_COMPLETED. The Backend handle is
// already persisted before onHandleWrite runs, so a fresh process can resume
// the same slice through the same recoveryDir.
//
// Env: DELIVER_SLICE_JSON (slice manifest file), DELIVER_RECOVERY_DIR,
// DELIVER_SCENARIO (default FIX_FIRST), DELIVER_TOOL (codex|kiro|agy, default
// codex), DELIVER_TIMEOUT_MS (default 30000). FAKE_AGENT_RECORD passes through.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { agyTool, codexTool, defineAgentTool, kiroTool, runDeliverSlice } from "../../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const FAKE = join(here, "fake-agent.mjs");

const tools = { codex: codexTool, kiro: kiroTool, agy: agyTool };
const base = tools[process.env.DELIVER_TOOL ?? "codex"] ?? codexTool;
const tool = defineAgentTool(base, { command: process.execPath, prefixArgs: [FAKE] });
const slice = JSON.parse(readFileSync(process.env.DELIVER_SLICE_JSON, "utf8"));
const recoveryDir = process.env.DELIVER_RECOVERY_DIR;

const result = await runDeliverSlice(slice, {
  tool,
  recoveryDir,
  timeoutMs: Number(process.env.DELIVER_TIMEOUT_MS ?? "30000"),
  env: {
    FAKE_AGENT_SCENARIO: process.env.DELIVER_SCENARIO ?? "FIX_FIRST",
    ...(process.env.FAKE_AGENT_RECORD ? { FAKE_AGENT_RECORD: process.env.FAKE_AGENT_RECORD } : {}),
    ...(process.env.FAKE_AGENT_VERSION ? { FAKE_AGENT_VERSION: process.env.FAKE_AGENT_VERSION } : {})
  },
  async onHandleWrite(handle) {
    if (handle.attemptIndex === 1 && handle.phase === "ACT_COMPLETED") process.exit(97);
  }
});
process.stdout.write(`${JSON.stringify({ status: result.status })}\n`);
