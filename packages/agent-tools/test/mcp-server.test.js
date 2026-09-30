import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import {
  EXHARNESS_MCP_TOOLS,
  MCP_FORBIDDEN_TOOL,
  MCP_PROTOCOL_VERSION,
  MCP_SERVER_INFO,
  codexTool,
  createExharnessMcpVerifyServer,
  defineAgentTool,
  runSupervisedTask
} from "../src/index.js";
import { createLocalCommandVerifier } from "../../agentic-system/src/index.js";
import { FakeMcpClient } from "./fixtures/fake-mcp-client.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const FAKE = join(here, "fixtures", "fake-agent.mjs");
const REPO_ROOT = join(here, "..", "..", "..");
const T = { timeout: 60000 };

function tempDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

function git(cwd, ...args) {
  const result = spawnSync("git", args, {
    cwd,
    shell: false,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@localhost.invalid", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@localhost.invalid" }
  });
  assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

function sourceRepository() {
  const root = tempDir("bb103-mcp-source-");
  git(root, "init", "-q");
  git(root, "checkout", "-q", "-b", "main");
  writeFileSync(join(root, "sum.mjs"), "export const sum = (a, b) => a - b;\n");
  writeFileSync(join(root, "sum.test.mjs"), 'import test from "node:test";\nimport assert from "node:assert/strict";\nimport { sum } from "./sum.mjs";\ntest("sum adds", () => { assert.equal(sum(2, 3), 5); });\n');
  git(root, "add", "-A");
  git(root, "-c", "commit.gpgsign=false", "commit", "-q", "-m", "failing sum");
  return { root, base: git(root, "rev-parse", "HEAD") };
}

function taskFor(root, base, extra = {}) {
  return {
    id: "mcp-task",
    repositoryRoot: root,
    baseRevision: base,
    prompt: "Fix sum in sum.mjs so that sum(a, b) returns a + b.",
    verifications: [{ name: "unit", command: process.execPath, args: ["--test", "sum.test.mjs"], timeoutMs: 30000 }],
    ...extra
  };
}

const fakeTool = (base) => defineAgentTool(base, { command: process.execPath, prefixArgs: [FAKE] });

function unitVerifier(root) {
  return createLocalCommandVerifier({
    name: "unit",
    claim: "agent-task.unit",
    root,
    command: process.execPath,
    args: ["--test", "sum.test.mjs"],
    timeoutMs: 30000,
    requireUnchangedTree: true
  });
}

async function startedPair({ worktreeRoot, verifiers, status = null, tools = null }) {
  const serverStdin = new PassThrough();
  const serverStdout = new PassThrough();
  const server = createExharnessMcpVerifyServer({ worktreeRoot, verifiers, status, tools });
  await server.start({ stdin: serverStdin, stdout: serverStdout });
  const client = new FakeMcpClient({ writable: serverStdin, readable: serverStdout });
  return { server, client, serverStdin, serverStdout };
}

// ---------------------------------------------------------------- MCP1 tools

test("MCP1 verify and status over stdio", T, async () => {
  const { root, base } = sourceRepository();
  let pair = null;
  try {
    const status = { attemptIndex: 2, candidateSha: base, lastVerification: [{ name: "unit", status: "FAIL", reason: "FAIL" }] };
    pair = await startedPair({ worktreeRoot: root, verifiers: [unitVerifier(root)], status });
    const { server, client } = pair;
    assert.deepEqual([...server.tools], ["exharness_verify", "exharness_status"]);
    assert.ok(Object.isFrozen(server.tools));
    assert.equal(MCP_PROTOCOL_VERSION, "2025-03-26");
    assert.deepEqual({ ...MCP_SERVER_INFO }, { name: "exharness-verify", version: "1.0.0" });

    const init = await client.initialize();
    assert.equal(init.protocolVersion, "2025-03-26");
    assert.deepEqual(init.serverInfo, { name: "exharness-verify", version: "1.0.0" });
    assert.deepEqual(init.capabilities, { tools: {} });
    client.notify("notifications/initialized", {});

    const list = await client.listTools();
    assert.deepEqual(list.tools.map((item) => item.name), [EXHARNESS_MCP_TOOLS.VERIFY, EXHARNESS_MCP_TOOLS.STATUS]);
    for (const item of list.tools) {
      assert.deepEqual(item.inputSchema, { type: "object", properties: {}, additionalProperties: false });
    }

    const verifyFail = await client.callTool("exharness_verify");
    assert.equal(verifyFail.isError, false);
    const failPayload = JSON.parse(verifyFail.content[0].text);
    assert.equal(failPayload.ok, false);
    assert.deepEqual(failPayload.results, [{ name: "unit", status: "FAIL", reason: "FAIL" }]);

    writeFileSync(join(root, "sum.mjs"), "export const sum = (a, b) => a + b;\n");
    git(root, "add", "-A");
    git(root, "-c", "commit.gpgsign=false", "commit", "-q", "-m", "fix sum");
    const verifyPass = await client.callTool("exharness_verify");
    const passPayload = JSON.parse(verifyPass.content[0].text);
    assert.equal(passPayload.ok, true);
    assert.deepEqual(passPayload.results, [{ name: "unit", status: "PASS", reason: "PASS" }]);

    const statusCall = await client.callTool("exharness_status");
    assert.equal(statusCall.isError, false);
    const statusPayload = JSON.parse(statusCall.content[0].text);
    assert.deepEqual(statusPayload, { attemptIndex: 2, candidateSha: base, lastVerification: [{ name: "unit", status: "FAIL", reason: "FAIL" }] });

    const ping = await client.request("ping", {});
    assert.deepEqual(ping, {});
  } finally {
    if (pair) await pair.server.stop();
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- MCP2 forbidden

test("MCP2 planted promote tool is rejected", T, () => {
  const dir = tempDir("bb103-mcp-forbidden-");
  try {
    const verifiers = [{ name: "unit", verify: async () => ({ claim: "c", status: "PASS", evidence: [], summary: "s" }) }];
    assert.throws(
      () => createExharnessMcpVerifyServer({ worktreeRoot: dir, verifiers, tools: ["exharness_verify", "exharness_promote"] }),
      (error) => error instanceof TypeError && error.code === MCP_FORBIDDEN_TOOL
    );
    assert.throws(
      () => createExharnessMcpVerifyServer({ worktreeRoot: dir, verifiers, tools: ["exharness_verify", "merge_state"] }),
      (error) => error instanceof TypeError && error.code === MCP_FORBIDDEN_TOOL
    );
    assert.equal(MCP_FORBIDDEN_TOOL, "MCP_FORBIDDEN_TOOL");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("MCP2 tools list has no promote", T, async () => {
  const { root } = sourceRepository();
  let server = null;
  try {
    server = createExharnessMcpVerifyServer({ worktreeRoot: root, verifiers: [unitVerifier(root)] });
    const serverStdin = new PassThrough();
    const serverStdout = new PassThrough();
    await server.start({ stdin: serverStdin, stdout: serverStdout });
    const client = new FakeMcpClient({ writable: serverStdin, readable: serverStdout });
    await client.initialize();
    const list = await client.listTools();
    const names = list.tools.map((item) => item.name);
    assert.deepEqual(names, ["exharness_verify", "exharness_status"]);
    for (const name of names) {
      assert.match(name, /^exharness_(verify|status)$/);
      assert.doesNotMatch(name, /promote|accept|merge/i);
    }
    const joined = names.join(",");
    assert.doesNotMatch(joined, /promote/i);
    assert.doesNotMatch(joined, /accept/i);
    assert.doesNotMatch(joined, /merge/i);
  } finally {
    if (server) await server.stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test("MCP2 tools/call promote is unknown", T, async () => {
  const { root } = sourceRepository();
  let server = null;
  try {
    server = createExharnessMcpVerifyServer({ worktreeRoot: root, verifiers: [unitVerifier(root)] });
    const serverStdin = new PassThrough();
    const serverStdout = new PassThrough();
    await server.start({ stdin: serverStdin, stdout: serverStdout });
    const client = new FakeMcpClient({ writable: serverStdin, readable: serverStdout });
    await client.initialize();
    await assert.rejects(client.callTool("exharness_promote"), (error) => error.code === -32601);
    await assert.rejects(client.request("does/not-exist", {}), (error) => error.code === -32601);
  } finally {
    if (server) await server.stop();
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- MCP3 opt-in

test("MCP3 default run never listens", T, async () => {
  const { root, base } = sourceRepository();
  const scratch = tempDir("bb103-mcp3-records-");
  const record = join(scratch, "record.json");
  try {
    let observed = 0;
    const result = await runSupervisedTask({
      tool: fakeTool(codexTool),
      task: taskFor(root, base),
      maxAttempts: 1,
      timeoutMs: 30000,
      env: { FAKE_AGENT_SCENARIO: "FIX_FIRST", FAKE_AGENT_RECORD: record },
      invocationObserver: async () => { observed += 1; }
    });
    assert.deepEqual(Object.keys(result).sort(), ["acceptedSha", "attempts", "status", "taskId", "tool", "toolVersion"]);
    assert.ok(observed >= 1, "invocationObserver still fires without mcpVerify");
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("MCP3 mcpVerify opt-in run completes", T, async () => {
  const { root, base } = sourceRepository();
  const scratch = tempDir("bb103-mcp3optin-records-");
  const record = join(scratch, "record.json");
  try {
    let observed = 0;
    const result = await runSupervisedTask({
      tool: fakeTool(codexTool),
      task: taskFor(root, base),
      maxAttempts: 1,
      timeoutMs: 30000,
      env: { FAKE_AGENT_SCENARIO: "FIX_FIRST", FAKE_AGENT_RECORD: record },
      invocationObserver: async () => { observed += 1; },
      mcpVerify: true
    });
    assert.deepEqual(Object.keys(result).sort(), ["acceptedSha", "attempts", "status", "taskId", "tool", "toolVersion"]);
    assert.ok(observed >= 1, "invocationObserver still fires with mcpVerify");
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("MCP3 mcpVerify does not write user CLI config", T, async () => {
  const { root, base } = sourceRepository();
  const scratch = tempDir("bb103-mcp3home-records-");
  const home = tempDir("bb103-mcp3-home-");
  const record = join(scratch, "record.json");
  const previousHome = process.env.HOME;
  process.env.HOME = home;
  try {
    await runSupervisedTask({
      tool: fakeTool(codexTool),
      task: taskFor(root, base),
      maxAttempts: 1,
      timeoutMs: 30000,
      env: { FAKE_AGENT_SCENARIO: "FIX_FIRST", FAKE_AGENT_RECORD: record },
      mcpVerify: true
    });
    assert.equal(existsSync(join(home, ".codex")), false);
    assert.equal(existsSync(join(home, ".kiro")), false);
    assert.equal(existsSync(join(home, ".gemini")), false);
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    rmSync(root, { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- MCP4 authority

test("MCP4 verify call cannot promote", T, async () => {
  const { root, base } = sourceRepository();
  const scratch = tempDir("bb103-mcp4-records-");
  const record = join(scratch, "record.json");
  const serverStdin = new PassThrough();
  const serverStdout = new PassThrough();
  const client = new FakeMcpClient({ writable: serverStdin, readable: serverStdout });
  try {
    let verifyPayload = null;
    const result = await runSupervisedTask({
      tool: fakeTool(codexTool),
      task: taskFor(root, base),
      maxAttempts: 1,
      timeoutMs: 30000,
      env: { FAKE_AGENT_SCENARIO: "CLAIM_SUCCESS_NO_EDIT", FAKE_AGENT_RECORD: record },
      invocationObserver: async () => {
        if (!verifyPayload) {
          await client.initialize();
          const response = await client.callTool("exharness_verify");
          verifyPayload = JSON.parse(response.content[0].text);
        }
      },
      mcpVerify: { stdin: serverStdin, stdout: serverStdout }
    });
    assert.equal(result.status, "EXHAUSTED");
    assert.equal(result.acceptedSha, null);
    assert.deepEqual(Object.keys(result).sort(), ["acceptedSha", "attempts", "status", "taskId", "tool", "toolVersion"]);
    assert.equal(result.attempts.length, 1);
    assert.equal(result.attempts[0].mutated, false);
    assert.ok(verifyPayload !== null, "concurrent exharness_verify call completed");
    assert.equal(verifyPayload.results[0].name, "unit");
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- MCP5 docs and deps

test("MCP5 package.json has no MCP SDK runtime dependency", T, () => {
  const dir = tempDir("bb103-mcp5-deps-");
  try {
    const server = createExharnessMcpVerifyServer({
      worktreeRoot: dir,
      verifiers: [{ name: "unit", verify: async () => ({ claim: "c", status: "PASS", evidence: [], summary: "s" }) }]
    });
    assert.deepEqual([...server.tools], ["exharness_verify", "exharness_status"]);
    const agentPkg = JSON.parse(readFileSync(join(REPO_ROOT, "packages", "agent-tools", "package.json"), "utf8"));
    const rootPkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
    for (const pkg of [agentPkg, rootPkg]) {
      const deps = { ...(pkg.dependencies ?? {}), ...(pkg.optionalDependencies ?? {}) };
      assert.equal(deps["@modelcontextprotocol/server"] ?? null, null);
      assert.equal(deps["@modelcontextprotocol/sdk"] ?? null, null);
    }
    assert.equal(agentPkg.dependencies ?? null, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("MCP5 living docs describe verification-query transport", T, () => {
  const mcpDoc = readFileSync(join(REPO_ROOT, "docs", "living", "system", "agent-tools", "mcp.md"), "utf8");
  const stateDoc = readFileSync(join(REPO_ROOT, "docs", "living", "system", "agent-tools", "state.md"), "utf8");
  for (const body of [mcpDoc, stateDoc]) {
    assert.match(body, /transport for\s+verification queries/i);
    assert.match(body, /not acceptance authority/i);
    assert.match(body, /mcpVerify/i);
    assert.match(body, /2025-03-26/);
  }
  assert.match(mcpDoc, /exharness_verify/);
  assert.match(mcpDoc, /exharness_status/);
  assert.match(mcpDoc, /no .*runtime.*SDK|zero runtime|no runtime MCP SDK/i);
  const serverSrc = readFileSync(join(REPO_ROOT, "packages", "agent-tools", "src", "mcp-server.js"), "utf8");
  assert.doesNotMatch(serverSrc, /@modelcontextprotocol/);
});
