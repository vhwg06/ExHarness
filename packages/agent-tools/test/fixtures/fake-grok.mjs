#!/usr/bin/env node
// Deterministic fake Grok Build CLI for grok adapter tests. It impersonates the grok headless
// argv contract (--output-format json, --model, --cwd, permission flags, --resume/--continue,
// --prompt-file), edits only its cwd, and records pid, argv and the prompt-file contents to
// FAKE_AGENT_RECORD. It never contacts a provider and never reads ~/.grok.
// Scenarios (FAKE_AGENT_SCENARIO): FIX_FIRST, FIX_AFTER_FEEDBACK, NEVER_FIX,
// CLAIM_SUCCESS_NO_EDIT, SELF_COMMIT, PARTIAL_THEN_FIX, AUTH_FAIL, HANG.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
const FEEDBACK_LINE = "ExHarness verification failed:";
export const BUILT_IN_FIX = "export const sum = (a, b) => a + b;\n";

if (argv.includes("--version")) {
  process.stdout.write(`fake-grok ${process.env.FAKE_AGENT_VERSION ?? "0.0.0"}\n`);
  process.exit(0);
}

const promptIndex = argv.indexOf("--prompt-file");
const promptFile = promptIndex >= 0 ? argv[promptIndex + 1] : null;
let prompt = "";
if (typeof promptFile === "string" && promptFile.length > 0) {
  try { prompt = readFileSync(promptFile, "utf8"); } catch { prompt = ""; }
}

const recordPath = process.env.FAKE_AGENT_RECORD ?? null;
const records = recordPath && existsSync(recordPath) ? JSON.parse(readFileSync(recordPath, "utf8")) : [];
const invocation = records.length + 1;
const record = { invocation, pid: process.pid, childPid: null, argv, stdin: "", prompt, promptFile, cwd: process.cwd(), style: "grok" };
const save = () => { if (recordPath) writeFileSync(recordPath, JSON.stringify([...records, record], null, 2)); };

const git = (...args) => {
  const result = spawnSync("git", args, {
    cwd: process.cwd(),
    shell: false,
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_NAME: "fake-grok", GIT_AUTHOR_EMAIL: "fake-grok@localhost.invalid", GIT_COMMITTER_NAME: "fake-grok", GIT_COMMITTER_EMAIL: "fake-grok@localhost.invalid" }
  });
  if (result.status !== 0) throw new Error(`fake-grok git ${args[0]} failed: ${result.stderr}`);
};

function fix() {
  const patch = process.env.FAKE_AGENT_SOLUTION_PATCH;
  if (patch) git("apply", patch);
  else writeFileSync(join(process.cwd(), "sum.mjs"), BUILT_IN_FIX);
}

function usageFor(n) {
  const input_tokens = 50000 + n;
  const cache_read_input_tokens = 42752;
  const cache_creation_input_tokens = 0;
  const output_tokens = 239;
  const reasoning_tokens = 117;
  return {
    input_tokens,
    cache_read_input_tokens,
    cache_creation_input_tokens,
    output_tokens,
    reasoning_tokens,
    total_tokens: input_tokens + output_tokens + reasoning_tokens
  };
}

let finished = false;
function finish(message, code = 0) {
  if (finished) return;
  finished = true;
  save();
  const total_cost_usd = 0.01200404;
  const body = {
    text: message,
    stopReason: "end_turn",
    sessionId: `fake-grok-${invocation}`,
    requestId: `req-${invocation}`,
    num_turns: 1,
    usage: usageFor(invocation),
    total_cost_usd,
    total_cost_usd_ticks: Math.round(total_cost_usd * 1e10),
    modelUsage: {}
  };
  // Exactly one JSON object so the parser sees clean headless output.
  process.stdout.write(`${JSON.stringify(body)}\n`, () => process.exit(code));
}

const scenario = process.env.FAKE_AGENT_SCENARIO ?? "FIX_FIRST";
const hasFeedback = String(prompt ?? "").split(/\r?\n/).includes(FEEDBACK_LINE);

switch (scenario) {
  case "FIX_FIRST":
    fix();
    finish("Fixed sum.");
    break;
  case "FIX_AFTER_FEEDBACK":
    if (hasFeedback) { fix(); finish("Fixed sum after feedback."); break; }
    finish("Looked at the task; nothing to change.");
    break;
  case "NEVER_FIX":
    writeFileSync(join(process.cwd(), "sum.mjs"), `export const sum = (a, b) => a - b; // attempt ${invocation}\n`);
    finish("Done, all tests pass.");
    break;
  case "CLAIM_SUCCESS_NO_EDIT":
    finish("All tests pass. Task complete.");
    break;
  case "SELF_COMMIT":
    writeFileSync(join(process.cwd(), "notes.txt"), "working on sum\n");
    git("add", "-A");
    git("-c", "commit.gpgsign=false", "commit", "--no-verify", "-q", "-m", "agent: notes");
    fix();
    git("add", "-A");
    git("-c", "commit.gpgsign=false", "commit", "--no-verify", "-q", "-m", "agent: fix sum");
    finish("Committed the fix.");
    break;
  case "PARTIAL_THEN_FIX":
    if (hasFeedback) { fix(); finish("Fixed sum after feedback."); break; }
    writeFileSync(join(process.cwd(), "notes.txt"), "unrelated edit\n");
    finish("Done.");
    break;
  case "AUTH_FAIL":
    save();
    process.stderr.write("Error: not logged in. Run the login command first.\n");
    process.exit(3);
    break;
  case "HANG": {
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    record.childPid = child.pid;
    save();
    setInterval(() => {}, 1000);
    break;
  }
  default:
    save();
    process.stderr.write(`unknown FAKE_AGENT_SCENARIO: ${scenario}\n`);
    process.exit(64);
}
