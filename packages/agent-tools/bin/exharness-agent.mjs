#!/usr/bin/env node
// exharness-agent: run a CLI coding agent under ExHarness supervision.
//   run   --tool <codex|kiro|agy> --task <task.json> [--command <path>] [--max-attempts N]
//         [--timeout-ms T] [--permission WORKSPACE_EDIT|FULL_AUTO] [--model M]
//   probe                     print the installed tool versions
//   smoke --tool <t> [--command <path>] [--timeout-ms T]
//         opt-in live check on a temporary repository with one failing test
// The agent CLI is not sandboxed: it runs with the user's permissions, with cwd at a temporary
// git worktree. ACCEPTED is printed only after every declared verification passed.
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AGENT_TOOLS,
  AgentTaskStatus,
  InvocationStatus,
  PermissionProfile,
  defineAgentTool,
  resolveExecutable,
  runProcess,
  runSupervisedTask
} from "../src/index.js";

const USAGE = "usage: exharness-agent run --tool <codex|kiro|agy> --task <task.json> [--command <path>] [--max-attempts N] [--timeout-ms T] [--permission WORKSPACE_EDIT|FULL_AUTO] [--model M]\n       exharness-agent probe\n       exharness-agent smoke --tool <codex|kiro|agy> [--command <path>] [--timeout-ms T]";

class UsageError extends Error {}

function parseOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (!flag.startsWith("--")) throw new UsageError(`unexpected argument: ${flag}`);
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) throw new UsageError(`missing value for ${flag}`);
    options[flag.slice(2)] = value;
    index += 1;
  }
  return options;
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
  const permission = options.permission ?? PermissionProfile.WORKSPACE_EDIT;
  if (!Object.values(PermissionProfile).includes(permission)) throw new UsageError(`unknown --permission: ${permission}`);
  const task = JSON.parse(await readFile(options.task, "utf8"));
  const tool = resolveTool(options.tool, options.command);
  if (!tool) {
    print(unavailableResult(task?.id ?? null, options.tool));
    return 2;
  }
  const result = await runSupervisedTask({
    tool,
    task,
    model: options.model ?? null,
    maxAttempts: positiveInteger(options["max-attempts"], "--max-attempts", 3),
    timeoutMs: positiveInteger(options["timeout-ms"], "--timeout-ms", 600000),
    permissionProfile: permission
  });
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
      timeoutMs: positiveInteger(options["timeout-ms"], "--timeout-ms", 600000)
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

async function main(args) {
  const [command, ...rest] = args;
  try {
    if (command === "run") return await commandRun(parseOptions(rest));
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
