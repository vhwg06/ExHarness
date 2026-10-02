#!/usr/bin/env node
// exharness-agent: run a CLI coding agent under ExHarness supervision.
//   run   --tool <codex|kiro|agy|grok|opencode> --task <task.json> [--command <path>] [--max-attempts N]
//         [--timeout-ms T] [--permission WORKSPACE_EDIT|FULL_AUTO] [--model M] [--env KEY=VALUE]
//         [--trace-dir <dir> [--arm <label>]]  append AGENT_TOOL_RUN_TRACE_V1 lines per attempt
//         --env is repeatable; entries join the FAKE_AGENT_* overlay forwarded to the supervised child
//   eval  --tool <id>[,<id>] --out <dir> [--command <path>] [--model M] [--tasks a,b] [--repeats N]
//         [--max-invocations N] [--max-usd X] [--fake-scenario S] [--seed S]
//         pre-registered DIRECT_SINGLE / DIRECT_RETRY / EXHARNESS_SUPERVISED evaluation on the owned suite
//   deliver --slice <manifest.json> [--command <path>] [--recovery-dir <dir>]
//         run one local Backend-then-QA delivery slice with independent QA
//   report <trace-dir>        verify the trace chain and print the DESCRIPTIVE AGENT_TOOL_RUN_REPORT_V1
//   probe                     print the installed tool versions
//   smoke --tool <t> [--command <path>] [--timeout-ms T] [--env KEY=VALUE]
//         opt-in live check on a temporary repository with one failing test
// The agent CLI is not sandboxed: it runs with the user's permissions, with cwd at a temporary
// git worktree. ACCEPTED is printed only after every declared verification passed.
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AGENT_TOOLS,
  AgentTaskStatus,
  DeliverSliceStatus,
  InvocationStatus,
  PermissionProfile,
  binOverlayEnv,
  commandDeliver,
  createRunTraceWriter,
  createSupervisedObservation,
  defineAgentTool,
  readTraces,
  summarizeTraces,
  resolveExecutable,
  runProcess,
  runSupervisedTask
} from "../src/index.js";
import { EvalUsageError, runAgentToolsEval } from "../src/experiment/index.js";

const USAGE = "usage: exharness-agent run --tool <codex|kiro|agy|grok|opencode> --task <task.json> [--command <path>] [--max-attempts N] [--timeout-ms T] [--permission WORKSPACE_EDIT|FULL_AUTO] [--model M] [--env KEY=VALUE] [--trace-dir <dir> [--arm <label>]]\n       exharness-agent deliver --slice <manifest.json> [--command <path>] [--recovery-dir <dir>]\n       exharness-agent eval --tool <id> --out <dir> [--command <path>] [--model M] [--tasks a,b] [--repeats N] [--max-invocations N] [--max-usd X] [--fake-scenario S] [--seed S]\n       exharness-agent report <trace-dir>\n       exharness-agent probe\n       exharness-agent smoke --tool <codex|kiro|agy|grok|opencode> [--command <path>] [--timeout-ms T] [--env KEY=VALUE]";

class UsageError extends Error {}

function parseOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (!flag.startsWith("--")) throw new UsageError(`unexpected argument: ${flag}`);
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) throw new UsageError(`missing value for ${flag}`);
    const name = flag.slice(2);
    // --env is repeatable: every occurrence appends one KEY=VALUE entry.
    if (name === "env") {
      if (!Array.isArray(options.env)) options.env = [];
      options.env.push(value);
    } else {
      options[name] = value;
    }
    index += 1;
  }
  return options;
}

/** Parses one --env KEY=VALUE flag; malformed entries are usage errors (exit 64). */
function parseEnvFlag(entry) {
  const separator = entry.indexOf("=");
  if (separator <= 0) throw new UsageError(`--env must be KEY=VALUE, got: ${entry}`);
  const name = entry.slice(0, separator);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new UsageError(`--env name must match [A-Za-z_][A-Za-z0-9_]*, got: ${name}`);
  return { name, value: entry.slice(separator + 1) };
}

/** Parses the repeated --env flags into [{ name, value }] entries. */
function runEnvFlags(options) {
  return (options.env ?? []).map(parseEnvFlag);
}

function positiveInteger(value, flag, fallback) {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new UsageError(`${flag} must be a positive integer`);
  return number;
}

function baseTool(id) {
  const tool = AGENT_TOOLS[id];
  if (!tool) throw new UsageError(`unknown --tool: ${id ?? "(missing)"}`);
  return tool;
}

/** Resolves the launch tuple; null means the executable is not installed. */
function resolveTool(id, command) {
  const base = baseTool(id);
  const launch = resolveExecutable(command ?? base.command);
  return launch ? defineAgentTool(base, launch) : null;
}

const print = (value) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);

function unavailableResult(taskId, toolId) {
  return { taskId, tool: toolId, toolVersion: null, status: AgentTaskStatus.TOOL_UNAVAILABLE, attempts: [], acceptedSha: null };
}

async function commandRun(options) {
  if (!options.task) throw new UsageError("run requires --task");
  const envFlags = runEnvFlags(options);
  const permission = options.permission ?? PermissionProfile.WORKSPACE_EDIT;
  if (!Object.values(PermissionProfile).includes(permission)) throw new UsageError(`unknown --permission: ${permission}`);
  const task = JSON.parse(await readFile(options.task, "utf8"));
  const tool = resolveTool(options.tool, options.command);
  if (!tool) {
    print(unavailableResult(task?.id ?? null, options.tool));
    return 2;
  }
  if (options.arm !== undefined && options["trace-dir"] === undefined) throw new UsageError("--arm requires --trace-dir");
  const observation = options["trace-dir"] === undefined
    ? null
    : createSupervisedObservation({ tool, arm: options.arm ?? "EXHARNESS_SUPERVISED", taskId: task.id, writer: createRunTraceWriter({ dir: options["trace-dir"] }) });
  const result = await runSupervisedTask({
    tool,
    task,
    model: options.model ?? null,
    maxAttempts: positiveInteger(options["max-attempts"], "--max-attempts", 3),
    timeoutMs: positiveInteger(options["timeout-ms"], "--timeout-ms", 600000),
    permissionProfile: permission,
    env: binOverlayEnv(process.env, envFlags),
    ...(observation === null ? {} : { invocationObserver: observation.invocationObserver, eventSinks: observation.eventSinks, tracer: observation.tracer })
  });
  if (observation !== null) await observation.finalize(result);
  print(result);
  return result.status === AgentTaskStatus.ACCEPTED ? 0 : result.status === AgentTaskStatus.EXHAUSTED ? 1 : 2;
}

async function commandProbe() {
  const tools = {};
  for (const [id, base] of Object.entries(AGENT_TOOLS)) {
    const launch = resolveExecutable(base.command);
    if (!launch) { tools[id] = { installed: false, version: null }; continue; }
    const probe = await runProcess(launch.command, [...launch.prefixArgs, ...base.versionArgs], { cwd: process.cwd(), timeoutMs: 30000, maxOutputBytes: 65536 });
    const version = probe.status === InvocationStatus.COMPLETED && probe.exitCode === 0
      ? `${probe.stdout}\n${probe.stderr}`.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? null
      : null;
    tools[id] = { installed: probe.status !== InvocationStatus.TOOL_UNAVAILABLE, version };
  }
  print({ tools });
  return 0;
}

const SMOKE_BROKEN = "export const sum = (a, b) => a - b;\n";
const SMOKE_TEST = [
  'import test from "node:test";',
  'import assert from "node:assert/strict";',
  'import { sum } from "./sum.mjs";',
  'test("sum adds two numbers", () => { assert.equal(sum(2, 3), 5); });',
  ""
].join("\n");
const SMOKE_PROMPT = "In sum.mjs, fix sum(a, b) so that it returns a + b. Do not modify sum.test.mjs.";

async function git(cwd, args) {
  const result = await runProcess("git", args, {
    cwd,
    env: { GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "exharness-smoke", GIT_AUTHOR_EMAIL: "smoke@localhost.invalid", GIT_COMMITTER_NAME: "exharness-smoke", GIT_COMMITTER_EMAIL: "smoke@localhost.invalid" }
  });
  if (result.exitCode !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr}`);
  return result.stdout.trim();
}

/** Creates a temporary repository with one failing test; returns { root, baseRevision }. */
async function createSmokeRepository(root) {
  await git(root, ["init", "-q"]);
  await writeFile(join(root, "sum.mjs"), SMOKE_BROKEN);
  await writeFile(join(root, "sum.test.mjs"), SMOKE_TEST);
  await git(root, ["add", "-A"]);
  await git(root, ["-c", "commit.gpgsign=false", "commit", "--no-verify", "-q", "-m", "smoke: failing sum"]);
  return { root, baseRevision: await git(root, ["rev-parse", "HEAD"]) };
}

async function commandSmoke(options) {
  const toolId = options.tool;
  baseTool(toolId);
  const envFlags = runEnvFlags(options);
  const tool = resolveTool(toolId, options.command);
  if (!tool) {
    print({ smoke: "SKIPPED", tool: toolId, reason: "NOT_INSTALLED" });
    return 0;
  }
  const root = await mkdtemp(join(tmpdir(), "exharness-agent-smoke-"));
  try {
    const { baseRevision } = await createSmokeRepository(root);
    const result = await runSupervisedTask({
      tool,
      task: {
        id: `smoke-${toolId}`,
        repositoryRoot: root,
        baseRevision,
        prompt: SMOKE_PROMPT,
        verifications: [{ name: "unit", command: process.execPath, args: ["--test", "sum.test.mjs"], timeoutMs: 60000 }]
      },
      maxAttempts: 2,
      timeoutMs: positiveInteger(options["timeout-ms"], "--timeout-ms", 600000),
      env: binOverlayEnv(process.env, envFlags)
    });
    if (result.status === AgentTaskStatus.TOOL_UNAVAILABLE) {
      print({ smoke: "SKIPPED", tool: toolId, reason: "NOT_INSTALLED", result });
      return 0;
    }
    const first = result.attempts[0];
    if (result.status !== AgentTaskStatus.ACCEPTED && first && first.exitCode !== 0 && !first.mutated) {
      // A missing login or credential surfaces as a non-zero exit with no edit on attempt 1.
      print({ smoke: "SKIPPED", tool: toolId, reason: "TOOL_FAILED_BEFORE_EDIT", result });
      return 0;
    }
    print({ smoke: result.status, tool: toolId, result });
    return result.status === AgentTaskStatus.ACCEPTED ? 0 : 1;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const EVAL_FLAGS = Object.freeze(["tool", "out", "command", "model", "tasks", "repeats", "max-invocations", "max-usd", "fake-scenario", "seed"]);

/** Runs the pre-registered evaluation; exit 0 when the report is written, whatever the verdicts. */
async function commandEval(options) {
  for (const flag of Object.keys(options)) if (!EVAL_FLAGS.includes(flag)) throw new UsageError(`unknown eval flag --${flag}`);
  if (!options.tool) throw new UsageError("eval requires --tool");
  if (!options.out) throw new UsageError("eval requires --out");
  let maxUsd = null;
  if (options["max-usd"] !== undefined) {
    maxUsd = Number(options["max-usd"]);
    if (!Number.isFinite(maxUsd) || maxUsd <= 0) throw new UsageError("--max-usd must be a positive number");
  }
  try {
    const { report, out } = await runAgentToolsEval({
      tools: options.tool.split(",").map((id) => id.trim()).filter(Boolean),
      out: options.out,
      command: options.command ?? null,
      model: options.model ?? null,
      tasks: options.tasks ? options.tasks.split(",").map((id) => id.trim()).filter(Boolean) : null,
      repeats: positiveInteger(options.repeats, "--repeats", 1),
      maxInvocations: positiveInteger(options["max-invocations"], "--max-invocations", null),
      maxUsd,
      fakeScenario: options["fake-scenario"] ?? null,
      seed: options.seed ?? 1
    });
    const summary = Object.fromEntries(Object.entries(report.tools).map(([id, tool]) => [id, {
      status: tool.status,
      notEvaluatedReason: tool.notEvaluatedReason,
      verdicts: Object.fromEntries(Object.entries(tool.comparisons).map(([versus, comparison]) => [versus, comparison.verdict]))
    }]));
    print({ out, report: join(out, "report.json"), tools: summary });
    return 0;
  } catch (error) {
    if (error instanceof EvalUsageError || error?.code === "UNKNOWN_TASK") throw new UsageError(error.message);
    throw error;
  }
}

/** Runs one local Backend-then-QA delivery slice; exit 0 only for ACCEPTED. */
async function commandDeliverCli(options) {
  if (!options.slice) throw new UsageError("deliver requires --slice");
  let result;
  try {
    result = await commandDeliver({
      slice: options.slice,
      command: options.command ?? null,
      recoveryDir: options["recovery-dir"] ?? null
    });
  } catch (error) {
    if (error instanceof UsageError) throw error;
    // Manifest problems surface before any process starts: unreadable file,
    // invalid JSON, or a manifest that fails validation are usage errors.
    const message = String(error?.message ?? error).split("\n")[0];
    if (error instanceof TypeError && message.includes("DELIVER_SLICE_V1 invalid")) {
      throw new UsageError(`deliver invalid slice manifest: ${message}`);
    }
    if (message.startsWith("deliver cannot read slice manifest")) {
      throw new UsageError(message);
    }
    throw error;
  }
  print(result);
  if (result.status === DeliverSliceStatus.ACCEPTED) return 0;
  if (result.status === DeliverSliceStatus.TOOL_UNAVAILABLE) return 2;
  return 1;
}

/** Verifies the trace chain (a broken chain exits 1) and prints the descriptive report. */
function commandReport(rest) {
  if (rest.length !== 1 || rest[0].startsWith("--")) throw new UsageError("report requires exactly one <trace-dir>");
  let records;
  try {
    records = readTraces(rest[0]);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return 1;
  }
  print(summarizeTraces(records));
  return 0;
}

async function main(args) {
  const [command, ...rest] = args;
  try {
    if (command === "run") return await commandRun(parseOptions(rest));
    if (command === "eval") return await commandEval(parseOptions(rest));
    if (command === "deliver") return await commandDeliverCli(parseOptions(rest));
    if (command === "report") return commandReport(rest);
    if (command === "probe") return await commandProbe();
    if (command === "smoke") return await commandSmoke(parseOptions(rest));
    throw new UsageError(command ? `unknown command: ${command}` : "missing command");
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`${error.message}\n${USAGE}\n`);
      return 64;
    }
    throw error;
  }
}

process.exitCode = await main(process.argv.slice(2));
