// BB-066 live contract test: the opencode runtime adapter against the REAL
// opencode backend. This is the "real coding-agent" half of BB-066.
//
// Contract asserted when the backend is reachable:
//   dispatch -> SUCCEEDED, exactly one session marker, envelope valid,
//   evidence bound, no second session on re-dispatch (collision).
//
// When opencode is unavailable (binary missing, auth/rate-limit failure), the
// test SKIPS (exit 0, skip reported) — an inconclusive backend is not a pass
// and not a failure. Run: node --test test/delivery/bb-066-live-contract.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, "..", "..");
const sha256hex = (d) => createHash("sha256").update(d).digest("hex");

function resolveOpencodeBin() {
  if (process.env.EXHARNESS_OPENCODE_BIN) return process.env.EXHARNESS_OPENCODE_BIN;
  const direct = spawnSync("opencode", ["--version"], { encoding: "utf8", timeout: 15000 });
  if (direct.status === 0) return "opencode";
  const homeBin = join(process.env.HOME ?? "", ".opencode", "bin", "opencode");
  if (existsSync(homeBin)) return homeBin;
  return null;
}

// Backend availability probe: binary present AND a trivial run completes.
// Anything else -> skip (INCONCLUSIVE, never a silent pass).
function backendAvailable() {
  const bin = resolveOpencodeBin();
  if (!bin) return { ok: false, reason: "no opencode binary found" };
  const probeDir = mkdtempSync(join(tmpdir(), "bb066-live-probe-"));
  try {
    const r = spawnSync(bin, ["run", "--format", "json", "--dir", probeDir, "--", "Reply with exactly: OK"], {
      encoding: "utf8", timeout: 90000,
    });
    if (r.status !== 0) return { ok: false, reason: `opencode smoke run failed (exit ${r.status}): ${(r.stderr ?? "").slice(0, 200)}` };
    return { ok: true, bin };
  } catch (e) {
    return { ok: false, reason: `opencode smoke run threw: ${String(e?.message ?? e).slice(0, 200)}` };
  } finally {
    rmSync(probeDir, { recursive: true, force: true });
  }
}

test("live contract: dispatch through the real opencode backend", async (t) => {
  const probe = backendAvailable();
  if (!probe.ok) {
    t.skip(`opencode backend unavailable (${probe.reason}); live contract INCONCLUSIVE, not passed`);
    return;
  }
  const { createOpencodeRuntimeAdapter, OpencodeRecoveryRequiredError } = await import(
    `file://${join(REPO_ROOT, "packages", "agentic-system", "src", "index.js")}`
  );
  const root = mkdtempSync(join(tmpdir(), "bb066-live-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const workspaceRoot = join(root, "ws");
  const outputRoot = join(root, "out");
  mkdirSync(workspaceRoot, { recursive: true });
  writeFileSync(join(workspaceRoot, "note.txt"), "replace me\n");

  const evidence = new Map();
  const adapter = createOpencodeRuntimeAdapter({
    runtimeDeploymentRef: "opencode-cli:1.18.34",
    producerAuthorityRef: "authority:bb066-live-test",
    modelProfileResolver: async () => ({
      provider: "opencode",
      immutableModelId: "opencode/muse-spark-1.3-contributor-free",
      credentialEnvName: null,
    }),
    workspaceResolver: async () => ({ root: workspaceRoot, allowedWriteGlobs: ["note.txt"] }),
    runtimeEvidenceStore: {
      async put(kind, body) {
        const ref = `${kind}:sha256:` + sha256hex(JSON.stringify(body));
        evidence.set(ref, body);
        return ref;
      },
    },
    opencodeBin: probe.bin,
  });

  const key = "execution-invocation:bb066-live-1";
  const binding = {
    executionAttemptId: "execution-attempt-id:bb066-live-1",
    toolsetRef: "toolset:opencode-default-v1",
    harnessRef: "harness:bb066-live-v1",
    modelProfileRef: "model-profile:opencode-free-v1",
    runtimeBinding: {
      kind: "coding-agent-sdk",
      adapterRef: "runtime-adapter:opencode-v1",
      expectedRuntimeCodeRef: "opencode-cli:1.18.34",
      runtimeInvocationKey: key,
    },
  };
  const input = {
    workspaceDescriptorRef: "workspace:bb066-live-v1",
    taskId: "LIVE-01",
    promptRef: "prompt:bb066-live-v1",
    promptText: "Write exactly the text LIVE-OK into note.txt and nothing else. Do not create other files.",
    outputRoot,
    timeoutMs: 240000,
  };

  const result = await adapter.dispatch({ binding, input, runtimeInvocationKey: key, signal: null });
  const attemptDir = join(outputRoot, "attempts", sha256hex(key));
  if (result.status !== "SUCCEEDED") {
    // Distinguish backend/infrastructure flakiness (free-tier rate limits)
    // from genuine contract violations: inspect the driver envelope.
    let envelope = null;
    try { envelope = JSON.parse(readFileSync(join(attemptDir, "driver-result.json"), "utf8")); } catch { /* ignore */ }
    const haystack = [envelope?.termination?.reason, envelope?.streamError].filter(Boolean).join(" | ");
    if (/rate limit|overload|429|503|ECONN|ETIMEDOUT|network|temporarily|unavailable/i.test(haystack)) {
      t.skip(`opencode backend errored mid-run (${haystack.slice(0, 160)}); live contract INCONCLUSIVE, not passed`);
      return;
    }
    assert.equal(result.status, "SUCCEEDED", `agent run failed without backend cause: ${haystack.slice(0, 300)}`);
  }
  assert.match(result.sessionId, /^ses_[A-Za-z0-9]+$/);
  assert.equal(result.outputArtifactRefs.length, 1);
  assert.ok(result.verificationCandidateRefs.length >= 4);

  const marker = JSON.parse(readFileSync(join(attemptDir, "session-created.json"), "utf8"));
  assert.equal(marker.sessionId, result.sessionId, "exactly one durable session");

  const note = readFileSync(join(workspaceRoot, "note.txt"), "utf8");
  assert.match(note, /LIVE-OK/, "the agent performed the task");

  // Re-dispatch must collide -> recovery required, never a second session.
  await assert.rejects(
    adapter.dispatch({ binding, input, runtimeInvocationKey: key, signal: null }),
    OpencodeRecoveryRequiredError,
  );
  const marker2 = JSON.parse(readFileSync(join(attemptDir, "session-created.json"), "utf8"));
  assert.equal(marker2.sessionId, result.sessionId, "no second session created");
});
