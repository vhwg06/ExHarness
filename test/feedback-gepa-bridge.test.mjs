/**
 * BB-083 S6 - offline GEPA bridge tests (node:test).
 *
 * Covers the Node-owned orchestration contract in
 * scripts/feedback/gepa-bridge.mjs against the real Python worker
 * scripts/feedback/gepa_adapter.py:
 *
 * - Hard budget: a null reservation rejects dispatch and python is never spawned.
 * - Normal dispatch settles with a durable receipt and exactly one dispatch record.
 * - crash_after_commit -> UNCERTAIN, then reconcile replays the receipt with
 *   exactly one dispatch recorded (no duplicate dispatch).
 * - Cancellation consumes the reservation and produces no receipt.
 * - Adapter health works without gepa installed (graceful stub).
 * - Bridge results never contain accepted/promoted/verdict keys; unknown
 *   provider usage/cost stays null (never coerced to 0).
 *
 * Python-dependent tests skip gracefully when python3 is absent.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createGepaBridge } from "../scripts/feedback/gepa-bridge.mjs";

const ADAPTER = new URL("../scripts/feedback/gepa_adapter.py", import.meta.url).pathname;
const pythonAvailable = spawnSync("python3", ["--version"], { encoding: "utf8" }).status === 0;

const DIGEST_RE = /^[0-9a-f]{64}$/;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeStateDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "bb083-s6-bridge-"));
}

/** Fake @exharness/benchmark attempt ledger with a hard admission limit. */
function makeLedger(limit) {
  const reservations = [];
  let calls = 0;
  return {
    reservations,
    calls: () => calls,
    reserve: async ({ attemptId, operationRef }) => {
      calls += 1;
      if (reservations.length >= limit) return null;
      const reservation = { attemptId, operationRef, status: "RESERVED" };
      reservations.push(reservation);
      return reservation;
    },
  };
}

/** Stub `gepa` module on PYTHONPATH so the adapter takes the SETTLED path. */
function stubGepaEnv(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb083-s6-gepa-"));
  fs.writeFileSync(path.join(dir, "gepa.py"), '__version__ = "0.0.0-test-stub"\n');
  const sep = process.platform === "win32" ? ";" : ":";
  const inherited = process.env.PYTHONPATH ? `${sep}${process.env.PYTHONPATH}` : "";
  return { ...extra, PYTHONPATH: `${dir}${inherited}` };
}

/** Run the adapter directly: one JSON line in, one JSON line out. */
function runAdapter(request, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("python3", [ADAPTER], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => {
      stdout += c;
    });
    child.stderr.on("data", (c) => {
      stderr += c;
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      try {
        resolve({ code, signal, stderr, json: JSON.parse(stdout.trim()) });
      } catch (err) {
        reject(new Error(`adapter output not JSON (code=${code}): ${stdout} ${stderr} :: ${err.message}`));
      }
    });
    child.stdin.end(`${JSON.stringify(request)}\n`);
  });
}

/** Shell shim standing in for pythonBin: records every spawn. */
function writeSpawnShim(dir) {
  const log = path.join(dir, "spawn.log");
  const shim = path.join(dir, "python-shim.sh");
  const escaped = log.replace(/'/g, "'\\''");
  fs.writeFileSync(shim, `#!/bin/sh\necho spawned >> '${escaped}'\nexit 0\n`, { mode: 0o755 });
  return { shim, log };
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function dispatchCounts(stateDir) {
  const file = path.join(stateDir, "dispatch-counts.json");
  return fs.existsSync(file) ? readJson(file) : {};
}

function receiptExists(stateDir, operationRef) {
  return fs.existsSync(path.join(stateDir, `${operationRef}.receipt.json`));
}

const FORBIDDEN_KEYS = ["accepted", "promoted", "verdict"];

function findForbiddenKeys(value, trail = "$", found = []) {
  if (Array.isArray(value)) {
    value.forEach((v, i) => findForbiddenKeys(v, `${trail}[${i}]`, found));
  } else if (value && typeof value === "object") {
    for (const [key, val] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.includes(key)) found.push(`${trail}.${key}`);
      findForbiddenKeys(val, `${trail}.${key}`, found);
    }
  }
  return found;
}

function assertCleanEnvelope(result, label) {
  assert.deepEqual(findForbiddenKeys(result), [], `${label}: must not contain accepted/promoted/verdict`);
  assert.ok("usageCost" in result, `${label}: usageCost key must be present`);
  assert.equal(result.usageCost, null, `${label}: usageCost must stay null, never coerced to 0`);
}

const SAMPLE_PAYLOAD = { prompt: "improve the greeting", seedCandidates: [{ policy: "baseline" }] };

// ---------------------------------------------------------------------------
// Hard budget
// ---------------------------------------------------------------------------

test("hard budget: null reservation rejects dispatch and never spawns python", async () => {
  const stateDir = makeStateDir();
  const { shim, log } = writeSpawnShim(stateDir);
  const ledger = makeLedger(10);
  const bridge = createGepaBridge({
    pythonBin: shim,
    adapterPath: ADAPTER,
    stateDir,
    budget: 10,
    reserveAttempt: async () => null,
  });
  await assert.rejects(
    () => bridge.dispatch({ attemptId: "a-denied", operationRef: "op-denied", payload: SAMPLE_PAYLOAD }),
    /reservation denied/i,
  );
  assert.equal(fs.existsSync(log), false, "python must never be spawned when the reservation is denied");
  assert.equal(receiptExists(stateDir, "op-denied"), false);
});

test("hard budget: bridge-level budget 0 rejects before reserveAttempt is called", async () => {
  const stateDir = makeStateDir();
  let reserveCalls = 0;
  const bridge = createGepaBridge({
    adapterPath: ADAPTER,
    stateDir,
    budget: 0,
    reserveAttempt: async ({ attemptId, operationRef }) => {
      reserveCalls += 1;
      return { attemptId, operationRef, status: "RESERVED" };
    },
  });
  await assert.rejects(
    () => bridge.dispatch({ attemptId: "a-zero", operationRef: "op-zero", payload: SAMPLE_PAYLOAD }),
    /hard budget exhausted/i,
  );
  assert.equal(reserveCalls, 0, "reserveAttempt must not be consulted once the bridge budget is spent");
});

// ---------------------------------------------------------------------------
// Normal dispatch
// ---------------------------------------------------------------------------

test(
  "normal dispatch settles with a durable receipt and exactly one dispatch record",
  { skip: !pythonAvailable },
  async () => {
    const stateDir = makeStateDir();
    const ledger = makeLedger(5);
    const bridge = createGepaBridge({
      adapterPath: ADAPTER,
      stateDir,
      budget: 5,
      reserveAttempt: ledger.reserve,
    });

    const { result } = await bridge.dispatch({
      attemptId: "a-ok",
      operationRef: "op-ok",
      payload: SAMPLE_PAYLOAD,
      env: stubGepaEnv(),
    });
    const out = await result;

    assert.equal(out.status, "SETTLED");
    assert.equal(out.attemptId, "a-ok");
    assert.equal(out.operationRef, "op-ok");
    assert.match(out.resultDigest, DIGEST_RE);
    assertCleanEnvelope(out, "dispatch result");

    const receipt = readJson(path.join(stateDir, "op-ok.receipt.json"));
    assert.equal(receipt.status, "SETTLED");
    assert.equal(receipt.resultDigest, out.resultDigest);

    assert.equal(dispatchCounts(stateDir)["op-ok"], 1);
    assert.equal(ledger.reservations.length, 1);
  },
);

test(
  "optimize degrades to UNAVAILABLE when gepa is not installed",
  { skip: !pythonAvailable },
  async () => {
    const stateDir = makeStateDir();
    const ledger = makeLedger(5);
    const bridge = createGepaBridge({
      adapterPath: ADAPTER,
      stateDir,
      budget: 5,
      reserveAttempt: ledger.reserve,
    });

    const { result } = await bridge.dispatch({
      attemptId: "a-un",
      operationRef: "op-un",
      payload: SAMPLE_PAYLOAD,
      env: { GEPA_BRIDGE_FORCE_NO_GEPA: "1" },
    });
    const out = await result;

    assert.equal(out.status, "UNAVAILABLE");
    assert.equal(out.resultDigest, null);
    assertCleanEnvelope(out, "unavailable result");
    // Nothing was committed: no receipt, no dispatch-count record.
    assert.equal(receiptExists(stateDir, "op-un"), false);
    assert.equal("op-un" in dispatchCounts(stateDir), false);
  },
);

// ---------------------------------------------------------------------------
// Crash recovery
// ---------------------------------------------------------------------------

test(
  "crash_after_commit reconciles without duplicate dispatch",
  { skip: !pythonAvailable },
  async () => {
    const stateDir = makeStateDir();
    const ledger = makeLedger(5);
    const bridge = createGepaBridge({
      adapterPath: ADAPTER,
      stateDir,
      budget: 5,
      reserveAttempt: ledger.reserve,
    });
    const env = stubGepaEnv({ GEPA_BRIDGE_CRASH_AFTER_COMMIT: "1" });

    const { result } = await bridge.dispatch({
      attemptId: "a-crash",
      operationRef: "op-crash",
      payload: SAMPLE_PAYLOAD,
      env,
    });
    const crashed = await result;
    assert.equal(crashed.status, "UNCERTAIN", "crashed dispatch must not be retried automatically");
    assertCleanEnvelope(crashed, "crashed result");

    const recovered = await bridge.reconcile({ attemptId: "a-crash", operationRef: "op-crash" });
    assert.equal(recovered.status, "SETTLED_BY_RECONCILIATION");
    assert.match(recovered.resultDigest, DIGEST_RE);
    assertCleanEnvelope(recovered, "reconcile result");

    // The receipt survived the crash; exactly one dispatch was recorded.
    assert.equal(receiptExists(stateDir, "op-crash"), true);
    assert.equal(dispatchCounts(stateDir)["op-crash"], 1, "exactly one dispatch recorded");

    // Re-dispatching the same operationRef replays the receipt - still no duplicate.
    const replay = await bridge.dispatch({
      attemptId: "a-crash-retry",
      operationRef: "op-crash",
      payload: SAMPLE_PAYLOAD,
      env: stubGepaEnv(),
    });
    const replayed = await replay.result;
    assert.equal(replayed.status, "SETTLED");
    assert.equal(replayed.resultDigest, recovered.resultDigest);
    assert.equal(dispatchCounts(stateDir)["op-crash"], 1, "replay must not increment the dispatch count");
  },
);

test(
  "reconcile of an unknown operationRef stays UNCERTAIN",
  { skip: !pythonAvailable },
  async () => {
    const stateDir = makeStateDir();
    const ledger = makeLedger(5);
    const bridge = createGepaBridge({
      adapterPath: ADAPTER,
      stateDir,
      budget: 5,
      reserveAttempt: ledger.reserve,
    });
    const out = await bridge.reconcile({ attemptId: "a-missing", operationRef: "op-never-dispatched" });
    assert.equal(out.status, "UNCERTAIN");
    assertCleanEnvelope(out, "unknown reconcile result");
  },
);

// ---------------------------------------------------------------------------
// Cancellation
// ---------------------------------------------------------------------------

test(
  "cancellation consumes the reservation and produces no receipt",
  { skip: !pythonAvailable },
  async () => {
    const stateDir = makeStateDir();
    const ledger = makeLedger(5);
    const bridge = createGepaBridge({
      adapterPath: ADAPTER,
      stateDir,
      budget: 5,
      reserveAttempt: ledger.reserve,
    });
    const env = stubGepaEnv({ GEPA_BRIDGE_BLOCK_BEFORE_COMMIT: "1" });

    const { handle, result } = await bridge.dispatch({
      attemptId: "a-cancel",
      operationRef: "op-cancel",
      payload: SAMPLE_PAYLOAD,
      env,
    });

    // Wait for the worker to confirm it started before cancelling.
    const firstLine = await handle.firstLine;
    assert.ok(firstLine && firstLine.includes("STARTED"), "worker must signal STARTED before cancellation");

    assert.equal(bridge.cancel(handle), true, "cancel must signal the live child");
    const out = await result;
    assert.equal(out.status, "UNCERTAIN");
    assertCleanEnvelope(out, "cancelled result");

    // Reservation stays consumed: no silent refund.
    assert.equal(ledger.reservations.length, 1, "cancellation must consume the reservation");
    // Nothing was committed.
    assert.equal(receiptExists(stateDir, "op-cancel"), false, "cancelled dispatch must produce no receipt");
    assert.equal("op-cancel" in dispatchCounts(stateDir), false);
  },
);

// ---------------------------------------------------------------------------
// Adapter health
// ---------------------------------------------------------------------------

test(
  "adapter health works without gepa installed",
  { skip: !pythonAvailable },
  async () => {
    const { code, json } = await runAdapter(
      { op: "health", stateDir: makeStateDir(), payload: {} },
      { GEPA_BRIDGE_FORCE_NO_GEPA: "1" },
    );
    assert.equal(code, 0);
    assert.equal(json.status, "OK");
    assert.equal(json.gepa, "stub");
  },
);

test(
  "adapter health reports the gepa version when importable",
  { skip: !pythonAvailable },
  async () => {
    const { code, json } = await runAdapter(
      { op: "health", stateDir: makeStateDir(), payload: {} },
      stubGepaEnv(),
    );
    assert.equal(code, 0);
    assert.equal(json.status, "OK");
    assert.equal(json.gepa, "0.0.0-test-stub");
  },
);
