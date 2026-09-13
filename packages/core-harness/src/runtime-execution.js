import { AsyncLocalStorage } from "node:async_hooks";

import { invariant, requireText } from "./contracts.js";

const storage = new AsyncLocalStorage();

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function normalizeTurn(turn) {
  if (turn == null) return null;
  invariant(Number.isInteger(turn) && turn > 0, "runtime execution turn must be a positive integer");
  return turn;
}

function normalizeTrace(trace) {
  if (trace == null) return null;
  invariant(trace && typeof trace === "object", "runtime execution trace must be an object");
  return Object.freeze({
    traceId: requireText(trace.traceId, "runtime execution traceId"),
    spanId: requireText(trace.spanId, "runtime execution spanId")
  });
}

export function defineRuntimeExecution(metadata) {
  invariant(metadata && typeof metadata === "object", "runtime execution metadata is required");
  return Object.freeze({
    callId: requireText(metadata.callId, "runtime execution callId"),
    turn: normalizeTurn(metadata.turn),
    trace: normalizeTrace(metadata.trace)
  });
}

export function runWithRuntimeExecution(metadata, operation) {
  invariant(typeof operation === "function", "runtime execution requires operation()");
  return storage.run(defineRuntimeExecution(metadata), operation);
}

export function currentRuntimeExecution() {
  const current = storage.getStore();
  return current == null ? null : Object.freeze(clone(current));
}
