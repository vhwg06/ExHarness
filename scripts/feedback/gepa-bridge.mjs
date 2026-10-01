/**
 * BB-083 S6 - offline GEPA bridge (Node orchestrator side).
 *
 * Node owns ALL orchestration: benchmark attempt reservation, hard budget
 * enforcement, child-process lifecycle, crash/reconcile recovery and
 * cancellation. The Python worker (scripts/feedback/gepa_adapter.py) only
 * computes over a JSON-lines protocol and never touches the repository,
 * the benchmark ledger, product state, or the policy head.
 *
 * Protocol per invocation: send one JSON line
 *   { op: "optimize"|"reconcile", stateDir, payload }
 * and read back one JSON line on stdout.
 *
 * Semantics:
 * - dispatch() reserves an attempt via the injected `reserveAttempt`
 *   BEFORE spawning. A null reservation throws and the worker is never
 *   spawned (hard budget). A bridge-local `budget` guard rejects before
 *   even calling `reserveAttempt`.
 * - Clean exit 0 with an adapter SETTLED/REPLAYED/UNAVAILABLE line ->
 *   terminal result { attemptId, operationRef, status, resultDigest?, usageCost: null }.
 * - Non-zero exit or a signal (crash, kill, cancellation) -> status
 *   "UNCERTAIN". Never retried automatically.
 * - reconcile() replays the durable receipt through a fresh worker
 *   invocation. The adapter is idempotent via its receipt, so reconcile
 *   never causes a duplicate dispatch: REPLAYED -> "SETTLED_BY_RECONCILIATION",
 *   UNKNOWN -> "UNCERTAIN".
 * - cancel(handle) SIGKILLs a dispatched child. The reservation stays
 *   consumed: no silent refund, no budget decrement.
 * - Provider usage/cost is unknown on this bridge and stays null - never
 *   coerced to 0. Results never contain accepted/promoted/verdict keys.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";

const DEFAULT_TIMEOUT_MS = 120_000;

function parseFirstJsonLine(stdout) {
  const line = String(stdout).split("\n").find((l) => l.trim().length > 0);
  if (!line) return null;
  try {
    const value = JSON.parse(line);
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

function interpretOptimize({ attemptId, operationRef, code, signal, stdout, spawnError }) {
  const base = { attemptId, operationRef, usageCost: null };
  if (!spawnError && code === 0 && signal == null) {
    const parsed = parseFirstJsonLine(stdout);
    if (parsed && parsed.status === "SETTLED") {
      return { ...base, status: "SETTLED", resultDigest: parsed.resultDigest ?? null };
    }
    if (parsed && parsed.status === "UNAVAILABLE") {
      return {
        ...base,
        status: "UNAVAILABLE",
        resultDigest: null,
        reason: parsed.reason ?? "gepa-not-installed",
      };
    }
    if (parsed && parsed.status === "REPLAYED") {
      // Idempotent replay of an already-committed operation: settled.
      return { ...base, status: "SETTLED", resultDigest: parsed.resultDigest ?? null };
    }
  }
  return {
    ...base,
    status: "UNCERTAIN",
    resultDigest: null,
    exitCode: code,
    signal: signal ?? null,
    ...(spawnError ? { spawnError } : {}),
  };
}

function interpretReconcile({ attemptId, operationRef, code, signal, stdout }) {
  const base = { attemptId, operationRef, usageCost: null };
  if (code === 0 && signal == null) {
    const parsed = parseFirstJsonLine(stdout);
    if (parsed && parsed.status === "REPLAYED") {
      return {
        ...base,
        status: "SETTLED_BY_RECONCILIATION",
        resultDigest: parsed.resultDigest ?? null,
      };
    }
  }
  return { ...base, status: "UNCERTAIN", resultDigest: null };
}

export function createGepaBridge({
  pythonBin = "python3",
  adapterPath,
  stateDir,
  budget,
  reserveAttempt,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (!adapterPath) throw new Error("GEPA_BRIDGE: adapterPath is required");
  if (!stateDir) throw new Error("GEPA_BRIDGE: stateDir is required");
  if (typeof reserveAttempt !== "function") {
    throw new Error("GEPA_BRIDGE: reserveAttempt ({attemptId, operationRef}) => reservation|null is required");
  }
  fs.mkdirSync(stateDir, { recursive: true });

  // Bridge-local reservation count. Never decremented: cancellations and
  // crashes consume their reservation (no silent refund).
  let reserved = 0;

  function startInvocation(handle, request, { env } = {}) {
    let firstLineResolve;
    const firstLine = new Promise((resolve) => {
      firstLineResolve = resolve;
    });

    const child = spawn(pythonBin, [adapterPath], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...env },
    });

    let stdout = "";
    let stderr = "";
    let firstLineSeen = false;
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
      if (!firstLineSeen) {
        const nl = stdout.indexOf("\n");
        if (nl !== -1) {
          firstLineSeen = true;
          firstLineResolve(stdout.slice(0, nl));
        }
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    // A failed spawn must resolve, not hang or throw unhandled.
    child.on("error", () => {});
    child.stdin.on("error", () => {});
    try {
      child.stdin.end(`${JSON.stringify(request)}\n`);
    } catch {
      // The close/error handlers below still settle the invocation.
    }

    let timer = null;
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // Already exited.
        }
      }, timeoutMs);
      if (typeof timer.unref === "function") timer.unref();
    }

    const closed = new Promise((resolve) => {
      let done = false;
      const finish = (info) => {
        if (done) return;
        done = true;
        if (timer) clearTimeout(timer);
        if (!firstLineSeen) {
          firstLineSeen = true;
          firstLineResolve(null);
        }
        resolve(info);
      };
      child.on("error", (err) => {
        finish({ code: null, signal: null, spawnError: err.message, stdout, stderr });
      });
      child.on("close", (code, signal) => {
        finish({ code, signal, spawnError: null, stdout, stderr });
      });
    });

    if (handle) handle.child = child;
    return { child, firstLine, closed };
  }

  /**
   * Reserve an attempt, then dispatch one optimize invocation.
   * Returns { handle, result } where result resolves to the terminal
   * outcome. Throws when the hard budget is exhausted - the worker is
   * never spawned in that case.
   */
  async function dispatch({ attemptId, operationRef, payload = {}, env } = {}) {
    if (!attemptId || !operationRef) {
      throw new Error("GEPA_BRIDGE: dispatch requires attemptId and operationRef");
    }
    if (typeof budget === "number" && reserved >= budget) {
      throw new Error(
        `GEPA_BRIDGE: hard budget exhausted (budget=${budget}, reserved=${reserved})`,
      );
    }
    const reservation = await reserveAttempt({ attemptId, operationRef });
    if (reservation == null) {
      throw new Error(
        `GEPA_BRIDGE: reservation denied for attemptId=${attemptId} operationRef=${operationRef}`,
      );
    }
    reserved += 1;

    const handle = {
      attemptId,
      operationRef,
      reservation,
      cancelled: false,
      child: null,
    };
    const request = {
      op: "optimize",
      stateDir,
      // The reserved operationRef always wins: it is the key the receipt
      // ledger and reconcile use.
      payload: { ...payload, operationRef },
    };
    const invocation = startInvocation(handle, request, { env });
    handle.firstLine = invocation.firstLine;
    const result = invocation.closed.then((closed) =>
      interpretOptimize({ attemptId, operationRef, ...closed }),
    );
    return { handle, result };
  }

  /**
   * Reopen an uncertain attempt: replay the durable receipt through a
   * fresh worker invocation. Never dispatches (adapter is idempotent via
   * its receipt), so no reservation is consumed.
   */
  async function reconcile({ attemptId, operationRef, env } = {}) {
    if (!attemptId || !operationRef) {
      throw new Error("GEPA_BRIDGE: reconcile requires attemptId and operationRef");
    }
    const request = { op: "reconcile", stateDir, payload: { operationRef } };
    const invocation = startInvocation(null, request, { env });
    const closed = await invocation.closed;
    return interpretReconcile({ attemptId, operationRef, ...closed });
  }

  /**
   * Kill a dispatched child. The reservation stays consumed (no refund,
   * no budget decrement); the pending result resolves UNCERTAIN.
   * Returns true when a live child was signalled.
   */
  function cancel(handle) {
    if (!handle || handle.cancelled) return false;
    handle.cancelled = true;
    const child = handle.child;
    if (child && child.exitCode == null && child.signalCode == null) {
      try {
        child.kill("SIGKILL");
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  return { dispatch, reconcile, cancel };
}
