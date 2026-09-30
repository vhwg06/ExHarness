#!/usr/bin/env node
// Deterministic fake CLI coding agent for BB-097 tests. It impersonates the codex, kiro and agy
// argv contracts, edits only its cwd, and records its pid, argv and stdin to FAKE_AGENT_RECORD.
// Scenarios (FAKE_AGENT_SCENARIO): FIX_FIRST, FIX_AFTER_FEEDBACK, NEVER_FIX, CLAIM_SUCCESS_NO_EDIT,
// SELF_COMMIT, PARTIAL_THEN_FIX, AUTH_FAIL, HANG.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
const FEEDBACK_LINE = "ExHarness verification failed:";
export const BUILT_IN_FIX = "export const sum = (a, b) => a + b;\n";

if (argv.includes("--version")) {
  process.stdout.write(`fake-agent ${process.env.FAKE_AGENT_VERSION ?? "0.0.0"}\n`);
  process.exit(0);
}

let stdin = "";
try { stdin = readFileSync(0, "utf8"); } catch { stdin = ""; }

const style = argv[0] === "exec" ? "codex" : argv[0] === "chat" ? "kiro" : "agy";
const prompt = style === "codex" ? stdin : style === "kiro" ? argv.at(-1) : argv[argv.indexOf("--print") + 1];

const recordPath = process.env.FAKE_AGENT_RECORD ?? null;
const records = recordPath && existsSync(recordPath) ? JSON.parse(readFileSync(recordPath, "utf8")) : [];
const invocation = records.length + 1;
const record = { invocation, pid: process.pid, childPid: null, argv, stdin, cwd: process.cwd(), style };
const save = () => { if (recordPath) writeFileSync(recordPath, JSON.stringify([...records, record], null, 2)); };

const git = (...args) => {
  const result = spawnSync("git", args, {
    cwd: process.cwd(),
    shell: false,
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_NAME: "fake-agent", GIT_AUTHOR_EMAIL: "fake@localhost.invalid", GIT_COMMITTER_NAME: "fake-agent", GIT_COMMITTER_EMAIL: "fake@localhost.invalid" }
  });
  if (result.status !== 0) throw new Error(`fake-agent git ${args[0]} failed: ${result.stderr}`);
};

function fix() {
  const patch = process.env.FAKE_AGENT_SOLUTION_PATCH;
  if (patch) git("apply", patch);
  else writeFileSync(join(process.cwd(), "sum.mjs"), BUILT_IN_FIX);
}

let finished = false;
function finish(message, code = 0) {
  if (finished) return;
  finished = true;
  save();
  const lines = style === "codex"
    ? `${JSON.stringify({ type: "thread.started", thread_id: `fake-${invocation}` })}\n${JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: message } })}\n`
    : `${message}\n`;
  const outputBytes = Number(process.env.FAKE_AGENT_OUTPUT_BYTES ?? 0);
  // Exit only after the pipe accepted everything, so no output is lost.
  process.stdout.write(lines + "o".repeat(outputBytes > 0 ? outputBytes : 0), () => process.exit(code));
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
