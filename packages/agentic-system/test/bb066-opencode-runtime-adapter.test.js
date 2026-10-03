// BB-066 unit tests: opencode runtime adapter (fake driver, no network).
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  OpencodeRecoveryRequiredError,
  createOpencodeRuntimeAdapter,
  hashWorkspaceTree,
  isPathAllowed,
} from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const FAKE_DRIVER = join(here, "fixtures", "fake-opencode-driver.mjs");
const sha256hex = (d) => createHash("sha256").update(d).digest("hex");

const INVOCATION_KEY = "execution-invocation:test-key-1";

function tempRoot() {
  return mkdtempSync(join(tmpdir(), "bb066-adapter-"));
}

function fixture({ scenario = {}, secret = null } = {}) {
  const root = tempRoot();
  const workspaceRoot = join(root, "ws");
  const outputRoot = join(root, "out");
  mkdirSync(workspaceRoot, { recursive: true });
  writeFileSync(join(workspaceRoot, "hello.js"), "module.exports = () => 1;\n");
  // The adapter allowlists the driver child env, so the fake driver scenario
  // travels via a file in the attempt dir.
  const attemptDir = join(outputRoot, "attempts", sha256hex(INVOCATION_KEY));
  mkdirSync(attemptDir, { recursive: true });
  writeFileSync(join(attemptDir, "fake-driver.json"), JSON.stringify({ mode: "success", changedPaths: [], ...scenario }));
  const evidence = new Map();
  const runtimeEvidenceStore = {
    async put(kind, body) {
      const ref = `${kind}:sha256:` + sha256hex(JSON.stringify(body));
      evidence.set(ref, body);
      return ref;
    },
  };
  const adapter = createOpencodeRuntimeAdapter({
    runtimeDeploymentRef: "opencode-cli:1.18.34",
    producerAuthorityRef: "authority:test-runtime",
    driverCommand: [process.execPath, FAKE_DRIVER],
    modelProfileResolver: async () => ({
      provider: "opencode",
      immutableModelId: "opencode/muse-spark-1.3-contributor-free",
      credentialEnvName: secret ? "BB066_TEST_SECRET" : null,
    }),
    workspaceResolver: async () => ({ root: workspaceRoot, allowedWriteGlobs: ["*.js"] }),
    runtimeEvidenceStore,
    opencodeBin: "opencode",
  });
  const binding = {
    executionAttemptId: "execution-attempt-id:test1",
    toolsetRef: "toolset:opencode-default-v1",
    harnessRef: "harness:test-v1",
    modelProfileRef: "model-profile:opencode-free-v1",
    runtimeBinding: {
      kind: "coding-agent-sdk",
      adapterRef: "runtime-adapter:opencode-v1",
      expectedRuntimeCodeRef: "opencode-cli:1.18.34",
      runtimeInvocationKey: INVOCATION_KEY,
    },
  };
  const input = {
    workspaceDescriptorRef: "workspace:test-v1",
    taskId: "TEST-01",
    promptRef: "prompt:test-v1",
    promptText: "Do the test thing.",
    outputRoot,
    timeoutMs: 30000,
  };
  const wrapped = Object.freeze({ ...adapter });
  const spawnLog = join(attemptDir, "fake-driver-spawns.log");
  const countSpawns = () => {
    try {
      return readFileSync(spawnLog, "utf8").split("\n").filter((l) => l.trim()).length;
    } catch { return 0; }
  };
  return {
    root, workspaceRoot, outputRoot, attemptDir, adapter: wrapped, binding, input, evidence,
    get spawns() { return countSpawns(); },
  };
}

async function withEnv(env, fn) {
  const prev = {};
  for (const k of Object.keys(env)) { prev[k] = process.env[k]; process.env[k] = env[k]; }
  try { return await fn(); }
  finally {
    for (const k of Object.keys(env)) {
      if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k];
    }
  }
}

const dispatchArgs = (fx) => ({
  binding: fx.binding, input: fx.input, runtimeInvocationKey: INVOCATION_KEY, signal: null,
});

test("dispatch creates exclusive manifest and returns a SUCCEEDED candidate", async () => {
  const fx = fixture();
  try {
    const result = await fx.adapter.dispatch(dispatchArgs(fx));
    assert.equal(result.status, "SUCCEEDED");
    assert.match(result.runtimeInvocationId, /^opencode-invocation:sha256:[a-f0-9]{64}$/);
    assert.equal(result.outputArtifactRefs.length, 1);
    assert.ok(result.outputArtifactRefs[0].ref.startsWith("opencode-candidate-source:sha256:"));
    assert.ok(result.verificationCandidateRefs.length >= 4);
    assert.equal(result.proposedDerivationEdges.length, 1);
    assert.ok(result.startedAt && result.finishedAt);
    assert.equal(fx.spawns, 1);
    assert.ok(existsSync(join(fx.attemptDir, "manifest.json")));
    assert.ok(existsSync(join(fx.attemptDir, "session-created.json")));
    assert.ok(existsSync(join(fx.attemptDir, "driver-result.json")));
    assert.ok(existsSync(join(fx.attemptDir, "evidence")));
  } finally { rmSync(fx.root, { recursive: true, force: true }); }
});

test("second dispatch for the same key throws recovery-required without spawning", async () => {
  const fx = fixture();
  try {
    await fx.adapter.dispatch(dispatchArgs(fx));
    await assert.rejects(fx.adapter.dispatch(dispatchArgs(fx)), OpencodeRecoveryRequiredError);
    assert.equal(fx.spawns, 1);
  } finally { rmSync(fx.root, { recursive: true, force: true }); }
});

test("dispatch rejects strategy kind mismatch before spawning", async () => {
  const fx = fixture();
  try {
    const bad = { ...fx.binding, runtimeBinding: { ...fx.binding.runtimeBinding, kind: "application-core-loop" } };
    await assert.rejects(fx.adapter.dispatch({ ...dispatchArgs(fx), binding: bad }), /unsupported runtime binding kind/);
    assert.equal(fx.spawns, 0);
  } finally { rmSync(fx.root, { recursive: true, force: true }); }
});

test("dispatch rejects changed paths outside allowed globs", async () => {
  const fx = fixture({ scenario: { changedPaths: ["../escape.txt"] } });
  try {
    await assert.rejects(fx.adapter.dispatch(dispatchArgs(fx)), /unsafe/);
  } finally { rmSync(fx.root, { recursive: true, force: true }); }
});

test("dispatch rejects driver envelope with forbidden acceptance fields", async () => {
  const fx = fixture({ scenario: { mode: "forbidden-field" } });
  try {
    await assert.rejects(fx.adapter.dispatch(dispatchArgs(fx)), /forbidden field: accepted/);
  } finally { rmSync(fx.root, { recursive: true, force: true }); }
});

test("dispatch timeout terminates the driver and throws recovery-required", async () => {
  const fx = fixture({ scenario: { mode: "hang" } });
  try {
    const input = { ...fx.input, timeoutMs: 800 };
    const start = Date.now();
    await assert.rejects(
      fx.adapter.dispatch({ ...dispatchArgs(fx), input }),
      OpencodeRecoveryRequiredError,
    );
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 30000, `bounded termination took ${elapsed}ms`);
    const procDocs = [...fx.evidence.values()].filter((b) => b?.kind === "OPENCODE_PROCESS_EVIDENCE");
    assert.equal(procDocs.length, 1);
    assert.equal(procDocs[0].timedOut, true);
  } finally { rmSync(fx.root, { recursive: true, force: true }); }
});

test("AbortSignal cancellation terminates the driver out-of-band", async () => {
  const fx = fixture({ scenario: { mode: "hang" } });
  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 500);
    await assert.rejects(
      fx.adapter.dispatch({ ...dispatchArgs(fx), signal: controller.signal }),
      OpencodeRecoveryRequiredError,
    );
    const procDocs = [...fx.evidence.values()].filter((b) => b?.kind === "OPENCODE_PROCESS_EVIDENCE");
    assert.equal(procDocs.length, 1);
    assert.equal(procDocs[0].cancelled, true);
  } finally { rmSync(fx.root, { recursive: true, force: true }); }
});

test("secrets never enter evidence digests unredacted", async () => {
  const secret = "sk-test-secret-value-abcdef123456";
  const fx = fixture({ scenario: { mode: "error-exit", secret }, secret });
  try {
    await withEnv({ BB066_TEST_SECRET: secret }, async () => {
      // error-exit leaks the secret on stderr; the adapter must redact before hashing.
      await assert.rejects(fx.adapter.dispatch(dispatchArgs(fx)), OpencodeRecoveryRequiredError);
      const procDocs = [...fx.evidence.values()].filter((b) => b?.kind === "OPENCODE_PROCESS_EVIDENCE");
      assert.equal(procDocs.length, 1);
      const expected = "sha256:" + sha256hex("fake driver: simulated failure\nleaked=[REDACTED]\n");
      assert.equal(procDocs[0].stderrDigest, expected);
    });
  } finally { rmSync(fx.root, { recursive: true, force: true }); }
});

test("recover with missing manifest returns BLOCKED without spawning", async () => {
  const fx = fixture();
  try {
    // Point at a fresh output root so no manifest exists.
    const fresh = { ...fx.input, outputRoot: join(fx.root, "out2") };
    const result = await fx.adapter.recover({ ...dispatchArgs(fx), input: fresh });
    assert.equal(result.status, "BLOCKED");
    assert.equal(fx.spawns, 0);
  } finally { rmSync(fx.root, { recursive: true, force: true }); }
});

test("recover replays a complete driver result without spawning", async () => {
  const fx = fixture();
  try {
    const first = await fx.adapter.dispatch(dispatchArgs(fx));
    assert.equal(first.status, "SUCCEEDED");
    assert.equal(fx.spawns, 1);
    const replayed = await fx.adapter.recover(dispatchArgs(fx));
    assert.equal(replayed.status, "SUCCEEDED");
    assert.equal(replayed.sessionId, first.sessionId);
    assert.equal(replayed.runtimeInvocationId, first.runtimeInvocationId);
    assert.equal(fx.spawns, 1, "recover must not spawn the driver when a complete result exists");
  } finally { rmSync(fx.root, { recursive: true, force: true }); }
});

test("recover after interrupt continues the same session live", async () => {
  const fx = fixture();
  try {
    const first = await fx.adapter.dispatch(dispatchArgs(fx));
    // Simulate the interrupt: remove the complete result; the session marker stays.
    rmSync(join(fx.attemptDir, "driver-result.json"), { force: true });
    writeFileSync(join(fx.workspaceRoot, "hello.js"), "module.exports = () => 2;\n");
    const result = await fx.adapter.recover(dispatchArgs(fx));
    assert.equal(result.status, "SUCCEEDED");
    assert.equal(result.sessionId, first.sessionId, "no second session may be created");
    assert.equal(fx.spawns, 2, "live recover spawns the driver once in recover mode");
  } finally { rmSync(fx.root, { recursive: true, force: true }); }
});

test("recover after killed driver with no session marker returns BLOCKED", async () => {
  const fx = fixture({ scenario: { mode: "hang" } });
  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 500);
    await assert.rejects(
      fx.adapter.dispatch({ ...dispatchArgs(fx), signal: controller.signal }),
      OpencodeRecoveryRequiredError,
    );
    // The driver was killed before writing a session marker -> BLOCKED preflight.
    // Snapshot the spawn count: recover must not add any driver invocation.
    const spawnsBeforeRecover = fx.spawns;
    const result = await fx.adapter.recover(dispatchArgs(fx));
    assert.equal(result.status, "BLOCKED");
    assert.equal(fx.spawns, spawnsBeforeRecover, "recover must not spawn the driver when the session never started");
  } finally { rmSync(fx.root, { recursive: true, force: true }); }
});

test("recover rejects model profile mismatch", async () => {
  const fx = fixture();
  try {
    await fx.adapter.dispatch(dispatchArgs(fx));
    const evil = createOpencodeRuntimeAdapter({
      runtimeDeploymentRef: "opencode-cli:1.18.34",
      producerAuthorityRef: "authority:test-runtime",
      driverCommand: [process.execPath, FAKE_DRIVER],
      modelProfileResolver: async () => ({ provider: "opencode", immutableModelId: "opencode/other-model", credentialEnvName: null }),
      workspaceResolver: async () => ({ root: fx.workspaceRoot, allowedWriteGlobs: ["*.js"] }),
      runtimeEvidenceStore: {
        async put(kind, body) {
          const ref = `${kind}:sha256:` + sha256hex(JSON.stringify(body));
          fx.evidence.set(ref, body);
          return ref;
        },
      },
    });
    const result = await evil.recover(dispatchArgs(fx));
    assert.equal(result.status, "BLOCKED");
  } finally { rmSync(fx.root, { recursive: true, force: true }); }
});

test("hashWorkspaceTree is stable and content-sensitive", () => {
  const root = tempRoot();
  try {
    mkdirSync(join(root, "sub"), { recursive: true });
    writeFileSync(join(root, "a.txt"), "hello");
    writeFileSync(join(root, "sub", "b.txt"), "world");
    const t1 = hashWorkspaceTree(root);
    const t2 = hashWorkspaceTree(root);
    assert.equal(t1.digest, t2.digest);
    writeFileSync(join(root, "sub", "b.txt"), "WORLD");
    const t3 = hashWorkspaceTree(root);
    assert.notEqual(t1.digest, t3.digest);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("isPathAllowed enforces glob boundaries", () => {
  assert.ok(isPathAllowed("hello.js", ["*.js"]));
  assert.ok(isPathAllowed("src/a.js", ["src/**"]));
  assert.ok(!isPathAllowed("src/a.js", ["*.js"]));
  assert.ok(!isPathAllowed("../escape.js", ["*.js"]));
});
