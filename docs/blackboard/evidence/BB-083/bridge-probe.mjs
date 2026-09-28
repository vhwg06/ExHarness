import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const worker = process.argv[2] ?? new URL("./bridge-worker.py", import.meta.url).pathname;
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "bb083-bridge-state-"));
const budget = 3;
const ledger = [];

function reserve(attemptId, operationRef) {
  if (ledger.length >= budget) return null;
  const reservation = { attemptId, operationRef, status: "RESERVED" };
  ledger.push(reservation);
  return reservation;
}

function invoke(req, { killOnFirstOutput = false } = {}) {
  return new Promise((resolve) => {
    const child = spawn("python3", [worker], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let killed = false;
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (killOnFirstOutput && !killed) {
        killed = true;
        child.kill("SIGKILL");
      }
    });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code, signal) => resolve({ code, signal, stdout: stdout.trim(), stderr: stderr.trim() }));
    child.stdin.end(JSON.stringify({ ...req, stateDir }) + "\n");
  });
}

const a = reserve("attempt-a", "op-a");
const normal = await invoke({ operationRef: "op-a" });
a.status = normal.code === 0 ? "SETTLED" : "UNKNOWN";

const b = reserve("attempt-b", "op-b");
const crashed = await invoke({ operationRef: "op-b", mode: "crash_after_commit" });
b.status = "UNCERTAIN";
const reconciled = await invoke({ operationRef: "op-b", mode: "reconcile" });
const recovered = JSON.parse(reconciled.stdout);
b.status = recovered.status === "REPLAYED" ? "SETTLED_BY_RECONCILIATION" : "UNCERTAIN";

const c = reserve("attempt-c", "op-c");
const cancelled = await invoke(
  { operationRef: "op-c", mode: "block_before_commit" },
  { killOnFirstOutput: true },
);
c.status = "CANCELLED_UNKNOWN";

const denied = reserve("attempt-d", "op-d");
const dispatchCounts = JSON.parse(fs.readFileSync(path.join(stateDir, "dispatch-counts.json"), "utf8"));

const result = {
  evidenceClass: "DETERMINISTIC_JS_PYTHON_BRIDGE_PROBE",
  node: process.version,
  python: "python3",
  budget,
  reservations: ledger.length,
  fourthReservationDenied: denied === null,
  normalSettled: a.status === "SETTLED",
  crashExitCode: crashed.code,
  crashRecoveredFromDurableReceipt: b.status === "SETTLED_BY_RECONCILIATION",
  replayNoDuplicateDispatch: dispatchCounts["op-b"] === 1,
  dispatchCounts,
  cancellationSignal: cancelled.signal,
  cancellationStarted: cancelled.stdout.includes("STARTED"),
  cancellationConsumesReservation: ledger.length === budget,
  cancellationProducedNoReceipt: !fs.existsSync(path.join(stateDir, "op-c.receipt.json")),
  hardBudgetAdmissionBeforeDispatch: denied === null && !("op-d" in dispatchCounts),
  resultDigestRecovered: recovered.resultDigest,
  limitations: [
    "Deterministic fixture worker, not the GEPA engine",
    "Simulated durable receipt stands in for exact benchmark AttemptLedger/evidence reopening",
    "No provider/model calls; effectiveness is not measured",
  ],
};

const resultPath = new URL("./bridge-probe-result.json", import.meta.url);
fs.writeFileSync(resultPath, JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result));
