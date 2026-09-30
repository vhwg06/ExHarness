import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AGENT_TOOLS,
  AgentTaskStatus,
  REDACTED,
  TRACE_FILE,
  TraceMode,
  UsageUnavailableReason,
  createRedactor,
  createRunTraceWriter,
  createSupervisedObservation,
  defineAgentTool,
  parseCodexJsonl,
  parseToolOutput,
  readTraces,
  redactedExcerpt,
  runObservedInvocation,
  runSupervisedTask,
  summarizeTraces,
  traceDigest,
  verifyTraceFile
} from "../src/index.js";
import { auditPaths } from "./scope-audit.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(here, "fixtures");
const OBS = join(FIXTURES, "observation");
const FAKE = join(FIXTURES, "fake-agent.mjs");
const OBSERVED = join(FIXTURES, "fake-observed-agent.mjs");
const BIN = join(here, "..", "bin", "exharness-agent.mjs");
const REPO_ROOT = join(here, "..", "..", "..");
const T = { timeout: 60000 };
const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const tool = (id, fake = OBSERVED) => defineAgentTool(AGENT_TOOLS[id], { command: process.execPath, prefixArgs: [fake] });
const tempDir = (prefix) => mkdtempSync(join(tmpdir(), prefix));
const NO_TOKENS = ["inputTokens", "cachedInputTokens", "outputTokens", "reasoningOutputTokens"];

function git(cwd, ...args) {
  const result = spawnSync("git", args, {
    cwd, shell: false, encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@localhost.invalid", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@localhost.invalid" }
  });
  assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

function repository() {
  const root = tempDir("bb098-repo-");
  git(root, "init", "-q");
  git(root, "checkout", "-q", "-b", "main");
  writeFileSync(join(root, "sum.mjs"), "export const sum = (a, b) => a - b;\n");
  writeFileSync(join(root, "sum.test.mjs"), 'import test from "node:test";\nimport assert from "node:assert/strict";\nimport { sum } from "./sum.mjs";\ntest("sum adds", () => { assert.equal(sum(2, 3), 5); });\n');
  git(root, "add", "-A");
  git(root, "-c", "commit.gpgsign=false", "commit", "-q", "-m", "failing sum");
  return { root, baseRevision: git(root, "rev-parse", "HEAD") };
}

async function direct({ id = "codex", env = {}, prompt = "fix sum", dir = tempDir("bb098-traces-"), timeoutMs = 60000, maxOutputBytes, arm = "DIRECT_SINGLE", attemptIndex = 1, verification = [], launch } = {}) {
  const { root, baseRevision } = repository();
  const writer = createRunTraceWriter({ dir });
  const logFile = join(tempDir("bb098-log-"), "agy.log");
  const result = await runObservedInvocation({
    tool: launch ?? tool(id), request: { prompt, logFile }, cwd: root, env, timeoutMs, maxOutputBytes, baseRevision,
    taskId: "task-1", arm, attemptIndex, writer, verification
  });
  return { ...result, dir, root, baseRevision, writer };
}

const traceLines = (dir) => readFileSync(join(dir, TRACE_FILE), "utf8").split("\n").filter(Boolean);
const brokenCode = (dir) => { try { readTraces(dir); return null; } catch (error) { return error.code; } };

// ---------------------------------------------------------------- OB1 trace schema and chain
test("OB1 a direct invocation yields one chained trace with observed timing, status, exit, diff and verification", T, async () => {
  const before = Date.now();
  const { trace, invocation, dir } = await direct({ env: { FAKE_OBSERVED_EDIT: "1", FAKE_OBSERVED_EXIT: "3" }, verification: [{ name: "hidden", status: "FAIL", reason: "1 failing" }] });
  const [record] = readTraces(dir);
  assert.deepEqual(record, trace);
  assert.equal(record.kind, "AGENT_TOOL_RUN_TRACE_V1");
  assert.equal(record.sequence, 1);
  assert.equal(record.prevDigest, null);
  assert.equal(record.digest, traceDigest(record));
  assert.equal(record.mode, TraceMode.DIRECT);
  assert.equal(record.tool, "codex");
  assert.equal(record.arm, "DIRECT_SINGLE");
  assert.equal(record.status, "COMPLETED");
  assert.equal(record.exitCode, 3);
  assert.equal(record.timedOut, false);
  assert.equal(record.durationMs, invocation.durationMs);
  assert.ok(Date.parse(record.startedAt) >= before - 5 && Date.parse(record.endedAt) >= Date.parse(record.startedAt));
  assert.equal(record.stdout.sha256, invocation.stdoutSha256);
  assert.equal(record.promptSha256, sha256("fix sum"));
  // sum.mjs: 1 insertion + 1 deletion (tracked); notes.txt: untracked, 3 lines.
  assert.deepEqual(record.diff, { filesChanged: 2, insertions: 4, deletions: 1, binaryFiles: 0 });
  assert.deepEqual(record.verification, [{ name: "hidden", status: "FAIL", reason: "1 failing" }]);
  assert.equal(record.harness, null);
});

test("OB1 appended traces link sequence and prevDigest in order", T, async () => {
  const dir = tempDir("bb098-traces-");
  await direct({ dir, attemptIndex: 1 });
  await direct({ dir, attemptIndex: 2, arm: "DIRECT_RETRY" });
  await direct({ dir, attemptIndex: 3, arm: "DIRECT_RETRY" });
  const records = readTraces(dir);
  assert.deepEqual(records.map((r) => r.sequence), [1, 2, 3]);
  assert.equal(records[1].prevDigest, records[0].digest);
  assert.equal(records[2].prevDigest, records[1].digest);
});

test("OB1 editing, deleting, inserting or reordering a trace line throws TRACE_CHAIN_BROKEN", T, async () => {
  const dir = tempDir("bb098-traces-");
  for (const attemptIndex of [1, 2, 3]) await direct({ dir, attemptIndex });
  const path = join(dir, TRACE_FILE);
  const original = traceLines(dir);
  const write = (lines) => writeFileSync(path, `${lines.join("\n")}\n`);
  const edited = JSON.parse(original[1]);
  edited.exitCode = 0 === edited.exitCode ? 1 : 0;
  const cases = {
    edit: [original[0], JSON.stringify(edited), original[2]],
    delete: [original[0], original[2]],
    insert: [original[0], original[1], original[1], original[2]],
    reorder: [original[1], original[0], original[2]],
    truncateTail: [original[0], original[1], original[2].slice(0, 40)]
  };
  for (const [name, lines] of Object.entries(cases)) {
    write(lines);
    assert.equal(brokenCode(dir), "TRACE_CHAIN_BROKEN", name);
    assert.throws(() => verifyTraceFile(path), { code: "TRACE_CHAIN_BROKEN" }, name);
  }
  write(original);
  assert.equal(readTraces(dir).length, 3);
});

// ---------------------------------------------------------------- OB2 parsers
test("OB2 codex usage is summed only from turn.completed events and malformed lines are counted", T, () => {
  const parsed = parseCodexJsonl(readFileSync(join(OBS, "codex-usage.jsonl"), "utf8"));
  assert.deepEqual(parsed.usage, { inputTokens: 25763, cachedInputTokens: 25248, outputTokens: 172, reasoningOutputTokens: 10, source: "codex.turn.completed", unavailableReason: null });
  assert.equal(parsed.toolEvents.invalidLines, 2);
  assert.deepEqual(parsed.toolEvents.counts, { "item.completed": 2, "item.started": 1, "thread.started": 1, "turn.completed": 2, "turn.started": 2 });
});

test("OB2 a codex stream without a usage-bearing turn.completed is null with CODEX_USAGE_NOT_REPORTED, never zero", T, async () => {
  const parsed = parseCodexJsonl(readFileSync(join(OBS, "codex-no-usage.jsonl"), "utf8"));
  for (const field of NO_TOKENS) assert.equal(parsed.usage[field], null, field);
  assert.equal(parsed.usage.unavailableReason, UsageUnavailableReason.CODEX_USAGE_NOT_REPORTED);
  assert.equal(parsed.toolEvents.counts["turn.failed"], 1);
  // The BB-097 fake codex stream carries no usage either.
  const { trace } = await direct({ launch: tool("codex", FAKE), env: { FAKE_AGENT_SCENARIO: "FIX_FIRST" } });
  assert.equal(trace.usage.unavailableReason, UsageUnavailableReason.CODEX_USAGE_NOT_REPORTED);
  for (const field of NO_TOKENS) assert.equal(trace.usage[field], null);
  // A zero-valued but reported turn is reported as zero (observed), not null.
  assert.equal(parseCodexJsonl('{"type":"turn.completed","usage":{"input_tokens":0,"output_tokens":0}}').usage.inputTokens, 0);
  // A truncated usage-free stream says so.
  assert.equal(parseCodexJsonl('{"type":"turn.started"}', { truncated: true }).usage.unavailableReason, UsageUnavailableReason.CODEX_STREAM_TRUNCATED);
});

test("OB2 a live codex trace reports exact usage from the stream and counts events", T, async () => {
  const { trace } = await direct({ env: { FAKE_OBSERVED_STDOUT: join(OBS, "codex-usage.jsonl") } });
  assert.equal(trace.usage.inputTokens, 25763);
  assert.equal(trace.usage.outputTokens, 172);
  assert.equal(trace.toolEvents.invalidLines, 2);
});

test("OB2 kiro, agy, timed-out and unavailable traces never carry numeric token values", T, async () => {
  const kiro = await direct({ id: "kiro", env: { FAKE_OBSERVED_STDOUT: join(OBS, "kiro-stdout.txt") } });
  assert.equal(kiro.trace.usage.unavailableReason, UsageUnavailableReason.KIRO_TEXT_OUTPUT_NO_USAGE);
  assert.equal(kiro.trace.toolEvents, null);
  const agy = await direct({ id: "agy", env: { FAKE_OBSERVED_LOG: join(OBS, "agy.log") } });
  assert.equal(agy.trace.usage.unavailableReason, UsageUnavailableReason.AGY_USAGE_NOT_REPORTED);
  const logBytes = readFileSync(join(OBS, "agy.log"));
  assert.deepEqual({ sha256: agy.trace.logFile.sha256, bytes: agy.trace.logFile.bytes }, { sha256: sha256(logBytes), bytes: logBytes.length });
  assert.match(agy.trace.logFile.excerpt, /tool edit_file path=sum\.mjs/);
  const hung = await direct({ env: { FAKE_OBSERVED_HANG: "1", FAKE_OBSERVED_STDOUT: join(OBS, "codex-usage.jsonl") }, timeoutMs: 1500 });
  assert.equal(hung.trace.status, "TIMED_OUT");
  assert.equal(hung.trace.timedOut, true);
  assert.equal(hung.trace.usage.unavailableReason, UsageUnavailableReason.TIMED_OUT);
  const missing = await direct({ launch: defineAgentTool(AGENT_TOOLS.codex, { command: join(tmpdir(), "no-such-agent-cli-bb098"), prefixArgs: [] }) });
  assert.equal(missing.trace.status, "TOOL_UNAVAILABLE");
  assert.equal(missing.trace.usage.unavailableReason, UsageUnavailableReason.TOOL_UNAVAILABLE);
  for (const trace of [kiro.trace, agy.trace, hung.trace, missing.trace]) {
    for (const field of NO_TOKENS) assert.equal(trace.usage[field], null, `${trace.tool} ${field}`);
  }
  assert.equal(parseToolOutput("unknown", { status: "COMPLETED", stdout: "" }).usage.unavailableReason, UsageUnavailableReason.UNKNOWN_TOOL);
});

// ---------------------------------------------------------------- OB3 supervised observation
function supervisedTask(root, baseRevision) {
  return { id: "sup-1", repositoryRoot: root, baseRevision, prompt: "Fix sum(a, b) in sum.mjs.", verifications: [{ name: "unit", command: process.execPath, args: ["--test", "sum.test.mjs"], timeoutMs: 60000 }] };
}

test("OB3 a supervised run yields one trace per attempt with its verification, diff and avo.act window", T, async () => {
  const { root, baseRevision } = repository();
  const dir = tempDir("bb098-traces-");
  const fake = tool("codex", FAKE);
  const observation = createSupervisedObservation({ tool: fake, arm: "EXHARNESS_SUPERVISED", taskId: "sup-1", writer: createRunTraceWriter({ dir }), env: { FAKE_AGENT_SCENARIO: "FIX_AFTER_FEEDBACK" } });
  const result = await runSupervisedTask({
    tool: fake, task: supervisedTask(root, baseRevision), maxAttempts: 3, env: { FAKE_AGENT_SCENARIO: "FIX_AFTER_FEEDBACK" },
    invocationObserver: observation.invocationObserver, eventSinks: observation.eventSinks, tracer: observation.tracer
  });
  assert.equal(result.status, AgentTaskStatus.ACCEPTED);
  const written = await observation.finalize(result);
  const records = readTraces(dir);
  assert.deepEqual(records, written);
  assert.equal(records.length, 2);
  assert.deepEqual(records.map((r) => [r.mode, r.attemptIndex, r.runId === observation.runId]), [[TraceMode.SUPERVISED, 1, true], [TraceMode.SUPERVISED, 2, true]]);
  assert.deepEqual(records.map((r) => r.verification.map((v) => `${v.name}:${v.status}`)), [["unit:FAIL"], ["unit:PASS"]]);
  assert.deepEqual(records[0].diff, { filesChanged: 0, insertions: 0, deletions: 0, binaryFiles: 0 });
  assert.deepEqual(records[1].diff, { filesChanged: 1, insertions: 1, deletions: 1, binaryFiles: 0 });
  assert.equal(records[0].toolVersion, result.toolVersion);
  for (const record of records) {
    const attemptSpans = record.harness.spans.filter((s) => s.scope === "ATTEMPT").map((s) => s.name);
    assert.deepEqual(attemptSpans.slice(0, 3), ["avo.act", "verify.unit", "avo.evaluate"]);
    assert.equal(record.harness.events.filter((e) => e.type === "CAPABILITY_INVOKED" && e.capability === "avo.act").length, 1);
    for (const event of record.harness.events) assert.deepEqual(Object.keys(event).sort(), ["capability", "scope", "type"]);
  }
  assert.ok(records[1].harness.spans.some((s) => s.name === "avo.promote"));
  // Run-level entries appear only on the last attempt trace.
  assert.equal(records[0].harness.events.some((e) => e.scope === "RUN"), false);
  assert.ok(records[1].harness.events.some((e) => e.type === "HARNESS_VARIATION_STARTED" && e.scope === "RUN"));
  assert.ok(records[1].harness.spans.some((s) => s.kind === "STRATEGY" && s.scope === "RUN"));
  // Captured summaries never carry payload values such as candidate or session ids.
  assert.equal(JSON.stringify(records).includes(result.acceptedSha), false);
});

test("OB3 direct traces carry harness null and an unobserved supervised run is unchanged", T, async () => {
  const { trace } = await direct();
  assert.equal(trace.harness, null);
  // Commit SHAs, durations and feedback text (which embeds test timings) vary between any two runs.
  const strip = ({ acceptedSha, ...result }) => ({ ...result, accepted: typeof acceptedSha === "string", attempts: result.attempts.map(({ durationMs, candidateSha, feedbackChars, ...rest }) => ({ ...rest, feedback: feedbackChars > 0 })) });
  const run = async (observed) => {
    const { root, baseRevision } = repository();
    const fake = tool("codex", FAKE);
    const observation = observed ? createSupervisedObservation({ tool: fake, arm: "S", taskId: "sup-1", writer: createRunTraceWriter({ dir: tempDir("bb098-traces-") }) }) : null;
    return runSupervisedTask({ tool: fake, task: supervisedTask(root, baseRevision), maxAttempts: 3, env: { FAKE_AGENT_SCENARIO: "FIX_AFTER_FEEDBACK" }, ...(observation ? { invocationObserver: observation.invocationObserver } : {}) });
  };
  assert.deepEqual(strip(await run(false)), strip(await run(true)));
});

test("OB3 an observer error fails the supervised run instead of being swallowed", T, async () => {
  const { root, baseRevision } = repository();
  await assert.rejects(
    runSupervisedTask({ tool: tool("codex", FAKE), task: supervisedTask(root, baseRevision), env: { FAKE_AGENT_SCENARIO: "FIX_FIRST" }, invocationObserver: async () => { throw new Error("observer broke"); } }),
    /observer broke|supervised agent run failed/
  );
  await assert.rejects(runSupervisedTask({ tool: tool("codex", FAKE), task: supervisedTask(root, baseRevision), invocationObserver: "yes" }), /invocationObserver must be null or a function/);
});

// ---------------------------------------------------------------- OB4 redaction
const PLANTED = {
  env: "planted-env-secret-7f3a9c2e",
  openai: "sk-proj-AAAABBBBCCCCDDDDEEEE1234",
  github: "ghp_abcdefghijklmnopqrstuvwxyz0123",
  pat: "github_pat_11ABCDEFG0123456789_abcdefghij",
  aws: "AKIAIOSFODNN7EXAMPLE",
  google: "AIzaSyA1234567890abcdefghijklmnopqrstuv",
  bearer: "Bearer abcdefghijklmnop.qrstuvwxyz"
};

test("OB4 planted env and key-pattern secrets never appear in trace bytes", T, async () => {
  const text = `${Object.values(PLANTED).join("\n")}\n`;
  const scratch = tempDir("bb098-secret-");
  const stdoutPath = join(scratch, "stdout.txt");
  const logPath = join(scratch, "agy.log");
  writeFileSync(stdoutPath, text);
  writeFileSync(logPath, `log ${text}`);
  const dir = tempDir("bb098-traces-");
  const env = { FAKE_OBSERVED_STDOUT: stdoutPath, FAKE_OBSERVED_STDERR: text, FAKE_OBSERVED_LOG: logPath, MY_SERVICE_API_KEY: PLANTED.env };
  for (const id of ["codex", "kiro", "agy"]) {
    // kiro and agy carry the prompt in argv; the prompt itself contains a secret.
    await direct({ id, dir, env, prompt: `use ${PLANTED.env} and ${PLANTED.openai}`, verification: [{ name: "v", status: "FAIL", reason: `leaked ${PLANTED.github}` }] });
  }
  const bytes = readFileSync(join(dir, TRACE_FILE), "utf8");
  for (const [name, secret] of Object.entries(PLANTED)) assert.equal(bytes.includes(secret), false, name);
  assert.ok(bytes.includes(REDACTED));
  const records = readTraces(dir);
  assert.equal(records.length, 3);
  assert.match(records[1].argvRedacted.join(" "), /<prompt sha256=[0-9a-f]{64} chars=\d+>/);
});

test("OB4 a secret split at the capture truncation boundary is dropped with the partial line", T, async () => {
  const redactor = createRedactor({ env: { X_TOKEN: PLANTED.env } });
  const captured = `line one\nprefix ${PLANTED.env.slice(0, 12)}`;
  const excerpt = redactedExcerpt(captured, { redactor, truncated: true });
  assert.equal(excerpt, "line one\n");
  const scratch = tempDir("bb098-secret-");
  const stdoutPath = join(scratch, "stdout.txt");
  writeFileSync(stdoutPath, `${"x".repeat(60)}\nsecret ${PLANTED.openai}\n`);
  const { trace, dir } = await direct({ id: "kiro", env: { FAKE_OBSERVED_STDOUT: stdoutPath }, maxOutputBytes: 75 });
  assert.equal(trace.stdout.truncated, true);
  const bytes = readFileSync(join(dir, TRACE_FILE), "utf8");
  assert.equal(bytes.includes(PLANTED.openai.slice(0, 8)), false);
});

test("OB4 a record that still contains a secret is refused with SECRET_IN_TRACE", T, async () => {
  const dir = tempDir("bb098-traces-");
  const writer = createRunTraceWriter({ dir, env: {} });
  await assert.rejects(writer.append({ traceId: "t", note: PLANTED.aws }), { code: "SECRET_IN_TRACE" });
  await assert.rejects(writer.append({ traceId: "t", note: PLANTED.env }, { extraEnv: { DB_PASSWORD: PLANTED.env } }), { code: "SECRET_IN_TRACE" });
  assert.equal(spawnSync("test", ["-e", join(dir, TRACE_FILE)]).status, 1);
});

// ---------------------------------------------------------------- OB5 report and CLI
async function reportFixture() {
  const dir = tempDir("bb098-traces-");
  await direct({ dir, env: { FAKE_OBSERVED_STDOUT: join(OBS, "codex-usage.jsonl") }, verification: [{ name: "hidden", status: "PASS" }] });
  await direct({ dir, env: { FAKE_OBSERVED_STDOUT: join(OBS, "codex-no-usage.jsonl") }, verification: [{ name: "hidden", status: "FAIL" }] });
  await direct({ dir, id: "kiro", env: { FAKE_OBSERVED_EDIT: "1" } });
  await direct({ dir, arm: "DIRECT_RETRY", env: { FAKE_OBSERVED_STDOUT: join(OBS, "codex-usage.jsonl") } });
  return dir;
}

const FORBIDDEN_KEYS = /^(accepted|acceptance|winner|superior|superiority|value|valueVerdict|verdict|promote|promotion|better|recommendation|passRate)$/i;
function keysOf(value, found = []) {
  if (Array.isArray(value)) value.forEach((item) => keysOf(item, found));
  else if (value && typeof value === "object") for (const [key, item] of Object.entries(value)) { found.push(key); keysOf(item, found); }
  return found;
}

test("OB5 the report is deterministic, coverage-aware and carries no acceptance, winner or value field", T, async () => {
  const dir = await reportFixture();
  const records = readTraces(dir);
  const report = summarizeTraces(records);
  assert.equal(JSON.stringify(summarizeTraces(readTraces(dir))), JSON.stringify(report));
  assert.equal(JSON.stringify(summarizeTraces([...records].reverse())), JSON.stringify(report));
  assert.equal(report.label, "DESCRIPTIVE");
  assert.deepEqual(report.groups.map((g) => [g.tool, g.arm, g.traces]), [["codex", "DIRECT_RETRY", 1], ["codex", "DIRECT_SINGLE", 2], ["kiro", "DIRECT_SINGLE", 1]]);
  const single = report.groups[1];
  assert.deepEqual(single.usage.totalsOverCoveredTraces, { inputTokens: 25763, cachedInputTokens: 25248, outputTokens: 172, reasoningOutputTokens: 10 });
  assert.equal(single.usage.coveredTraces, 1);
  assert.equal(single.usage.uncoveredTraces, 1);
  assert.deepEqual(single.usage.unavailableReasonCounts, { CODEX_USAGE_NOT_REPORTED: 1 });
  assert.deepEqual(single.verificationStatusCounts, { FAIL: 1, PASS: 1 });
  const kiro = report.groups[2];
  assert.deepEqual(kiro.usage.totalsOverCoveredTraces, { inputTokens: null, cachedInputTokens: null, outputTokens: null, reasoningOutputTokens: null });
  assert.equal(kiro.usage.coveredTraces, 0);
  assert.deepEqual(kiro.diffTotals, { filesChanged: 2, insertions: 4, deletions: 1, binaryFiles: 0 });
  assert.deepEqual(keysOf(report).filter((key) => FORBIDDEN_KEYS.test(key)), []);
});

test("OB5 the report CLI verifies the chain, prints the report and exits non-zero on a broken chain", T, async () => {
  const dir = await reportFixture();
  const ok = spawnSync(process.execPath, [BIN, "report", dir], { encoding: "utf8" });
  assert.equal(ok.status, 0, ok.stderr);
  assert.deepEqual(JSON.parse(ok.stdout), summarizeTraces(readTraces(dir)));
  const lines = traceLines(dir);
  writeFileSync(join(dir, TRACE_FILE), `${[lines[1], lines[0], ...lines.slice(2)].join("\n")}\n`);
  const broken = spawnSync(process.execPath, [BIN, "report", dir], { encoding: "utf8" });
  assert.equal(broken.status, 1);
  assert.match(broken.stderr, /TRACE_CHAIN_BROKEN/);
  assert.equal(spawnSync(process.execPath, [BIN, "report"], { encoding: "utf8" }).status, 64);
});

test("OB5 run --trace-dir writes supervised traces that the report reads", T, async () => {
  const { root, baseRevision } = repository();
  const scratch = tempDir("bb098-cli-");
  const taskPath = join(scratch, "task.json");
  writeFileSync(taskPath, JSON.stringify(supervisedTask(root, baseRevision)));
  const dir = join(scratch, "traces");
  const run = spawnSync(process.execPath, [BIN, "run", "--tool", "codex", "--command", FAKE, "--task", taskPath, "--trace-dir", dir, "--arm", "EXHARNESS_SUPERVISED"], { encoding: "utf8", env: { ...process.env, FAKE_AGENT_SCENARIO: "FIX_FIRST" } });
  assert.equal(run.status, 0, run.stderr);
  const records = readTraces(dir);
  assert.equal(records.length, 1);
  assert.equal(records[0].arm, "EXHARNESS_SUPERVISED");
  assert.equal(records[0].mode, TraceMode.SUPERVISED);
  assert.deepEqual(records[0].verification.map((v) => v.status), ["PASS"]);
  const report = spawnSync(process.execPath, [BIN, "report", dir], { encoding: "utf8" });
  assert.equal(JSON.parse(report.stdout).groups[0].traces, 1);
});

test("OB5 the Living doc describes observation limits and redaction", T, () => {
  const doc = readFileSync(join(REPO_ROOT, "docs/living/system/agent-tools/observation.md"), "utf8");
  for (const phrase of ["AGENT_TOOL_RUN_TRACE_V1", "TRACE_CHAIN_BROKEN", "turn.completed", "KIRO_TEXT_OUTPUT_NO_USAGE", "AGY_USAGE_NOT_REPORTED", "invocationObserver", "[REDACTED]", "DESCRIPTIVE"]) {
    assert.ok(doc.includes(phrase), phrase);
  }
});

// ---------------------------------------------------------------- OB6 scope
test("OB6 the scope matcher accepts write-scope paths and rejects forbidden product and Blackboard paths", T, () => {
  const plan = JSON.parse(readFileSync(join(REPO_ROOT, "docs/blackboard/artifacts/ready-implement-plan/BB-098.json"), "utf8"));
  const allowed = [
    "packages/agent-tools/src/run-trace.js", "packages/agent-tools/src/supervisor.js", "packages/agent-tools/bin/exharness-agent.mjs",
    "packages/agent-tools/test/run-trace.test.js", "packages/agent-tools/test/fixtures/observation/agy.log", "docs/living/system/agent-tools/observation.md"
  ];
  const forbidden = [
    "packages/core-harness/src/harness.js", "packages/agentic-system/src/index.js", "packages/benchmark/src/index.js", "packages/oracle/src/x.js",
    "packages/agent-tools/src/tool-adapters.js", "packages/agent-tools/src/process-runner.js", "packages/agent-tools/test/agent-tools.test.js",
    "docs/blackboard/work-graph.json", ".github/workflows/ci.yml"
  ];
  const result = auditPaths([...allowed, ...forbidden, "README.md"], plan.sourceScope);
  assert.deepEqual(result.allowed, allowed);
  assert.deepEqual(result.forbidden, forbidden);
  assert.deepEqual(result.outOfScope, ["README.md"]);
});
