#!/usr/bin/env node
// Deterministic fake OpenCode CLI for opencode adapter tests. It impersonates the opencode
// headless argv contract (run --format json [--dir <cwd>] [--model <m>] [--auto]
// [--session <id>|--continue] <message>), edits only its cwd, and records pid, argv and the
// positional message to FAKE_AGENT_RECORD. It never contacts a provider and never reads
// ~/.opencode. Stdin is always null: the message travels as the positional argument.
// Scenarios (FAKE_AGENT_SCENARIO): FIX_FIRST, FIX_AFTER_FEEDBACK, NEVER_FIX,
// CLAIM_SUCCESS_NO_EDIT, SELF_COMMIT, PARTIAL_THEN_FIX, AUTH_FAIL, HANG.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
const FEEDBACK_LINE = "ExHarness verification failed:";
export const BUILT_IN_FIX = "export const sum = (a, b) => a + b;\n";

if (argv.includes("--version")) {
  process.stdout.write(`fake-opencode ${process.env.FAKE_AGENT_VERSION ?? "0.0.0"}\n`);
  process.exit(0);
}

// The task message is the positional argument: the word after the `--` end-of-options
// separator (falling back to the last argv word when no separator is present).
const separator = argv.indexOf("--");
const prompt = separator >= 0 ? (argv[separator + 1] ?? "") : (argv.at(-1) ?? "");

const recordPath = process.env.FAKE_AGENT_RECORD ?? null;
const records = recordPath && existsSync(recordPath) ? JSON.parse(readFileSync(recordPath, "utf8")) : [];
const invocation = records.length + 1;
const record = { invocation, pid: process.pid, childPid: null, argv, stdin: "", prompt, cwd: process.cwd(), style: "opencode" };
const save = () => { if (recordPath) writeFileSync(recordPath, JSON.stringify([...records, record], null, 2)); };

const git = (...args) => {
  const result = spawnSync("git", args, {
    cwd: process.cwd(),
    shell: false,
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_NAME: "fake-opencode", GIT_AUTHOR_EMAIL: "fake-opencode@localhost.invalid", GIT_COMMITTER_NAME: "fake-opencode", GIT_COMMITTER_EMAIL: "fake-opencode@localhost.invalid" }
  });
  if (result.status !== 0) throw new Error(`fake-opencode git ${args[0]} failed: ${result.stderr}`);
};

function fix() {
  const patch = process.env.FAKE_AGENT_SOLUTION_PATCH;
  if (patch) git("apply", patch);
  else writeFileSync(join(process.cwd(), "sum.mjs"), BUILT_IN_FIX);
}

function tokensFor(n) {
  return { input: 1200 + n, output: 75, reasoning: 12, cache: { read: 400, write: 8 } };
}

let finished = false;
function finish(message, code = 0) {
  if (finished) return;
  finished = true;
  save();
  const sessionID = `fake-opencode-${invocation}`;
  const lines = [
    JSON.stringify({ type: "step_start", sessionID }),
    JSON.stringify({ type: "text", sessionID, part: { type: "text", text: message } }),
    JSON.stringify({ type: "step_finish", sessionID, part: { type: "step-finish", reason: "stop", tokens: tokensFor(invocation), cost: 0.0015 } })
  ];
  // Exit only after the pipe accepted everything, so no output is lost.
  process.stdout.write(`${lines.join("\n")}\n`, () => process.exit(code));
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
