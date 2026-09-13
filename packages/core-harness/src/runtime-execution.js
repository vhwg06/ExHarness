import { invariant, requireText } from "./contracts.js";

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
