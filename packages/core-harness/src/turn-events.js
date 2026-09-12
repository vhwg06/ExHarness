import { randomUUID } from "node:crypto";
import { invariant, requireText } from "./contracts.js";

export const TurnEventKind = Object.freeze({
  BEFORE_TURN: "BEFORE_TURN",
  AFTER_TURN: "AFTER_TURN"
});

export const TurnOutcome = Object.freeze({
  CONTINUE: "CONTINUE",
  RESULT: "RESULT",
  ERROR: "ERROR"
});

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function safeClone(value) {
  try {
    return clone(value);
  } catch {
    return value == null ? null : Object.freeze({ unavailable: true, type: typeof value });
  }
}

function normalizeSeedEvent(event) {
  invariant(event && typeof event === "object", "turn event is required");
  invariant(Object.values(TurnEventKind).includes(event.type), "turn event type is invalid");
  invariant(Number.isInteger(event.turn) && event.turn > 0, "turn event turn must be a positive integer");
  return Object.freeze({
    id: requireText(event.id, "turn event id"),
    type: event.type,
    at: requireText(event.at, "turn event at"),
    callId: requireText(event.callId, "turn event callId"),
    turn: event.turn,
    judgment: event.judgment == null ? null : safeClone(event.judgment),
    payload: safeClone(event.payload ?? null)
  });
}

export function createTurnEventStore({
  events = [],
  clock = () => new Date().toISOString(),
  idFactory = () => randomUUID()
} = {}) {
  invariant(Array.isArray(events), "turn events seed must be an array");
  invariant(typeof clock === "function", "turn event clock must be a function");
  invariant(typeof idFactory === "function", "turn event idFactory must be a function");

  const history = events.map(normalizeSeedEvent);
  const activeByCall = new Map();
  const lastTurnByCall = new Map();

  for (const event of history) {
    const last = lastTurnByCall.get(event.callId) ?? 0;
    lastTurnByCall.set(event.callId, Math.max(last, event.turn));
  }

  function record(type, { callId, turn, judgment = null, payload = null } = {}) {
    const event = Object.freeze({
      id: requireText(idFactory(), "turn event id"),
      type,
      at: requireText(clock(), "turn event at"),
      callId: requireText(callId, "turn event callId"),
      turn,
      judgment: judgment == null ? null : safeClone(judgment),
      payload: safeClone(payload)
    });
    history.push(event);
    return event;
  }

  return Object.freeze({
    begin({ callId, judgment = null, payload = null } = {}) {
      const resolvedCallId = requireText(callId, "turn begin callId");
      invariant(!activeByCall.has(resolvedCallId), `turn already active for call: ${resolvedCallId}`);
      const turn = (lastTurnByCall.get(resolvedCallId) ?? 0) + 1;
      const event = record(TurnEventKind.BEFORE_TURN, {
        callId: resolvedCallId,
        turn,
        judgment,
        payload
      });
      activeByCall.set(resolvedCallId, Object.freeze({ turn, beforeEventId: event.id }));
      return event;
    },

    end({ callId, judgment = null, outcome, final = false, error = null, payload = null } = {}) {
      const resolvedCallId = requireText(callId, "turn end callId");
      const active = activeByCall.get(resolvedCallId);
      invariant(active, `no active turn for call: ${resolvedCallId}`);
      invariant(Object.values(TurnOutcome).includes(outcome), "turn outcome is invalid");
      invariant(typeof final === "boolean", "turn final must be boolean");

      const event = record(TurnEventKind.AFTER_TURN, {
        callId: resolvedCallId,
        turn: active.turn,
        judgment,
        payload: {
          beforeEventId: active.beforeEventId,
          outcome,
          final,
          error: error == null ? null : safeClone(error),
          ...(payload == null ? {} : { detail: safeClone(payload) })
        }
      });
      activeByCall.delete(resolvedCallId);
      lastTurnByCall.set(resolvedCallId, active.turn);
      return event;
    },

    hasActive(callId) {
      return activeByCall.has(requireText(callId, "turn active callId"));
    },

    events() {
      return Object.freeze(safeClone(history));
    }
  });
}
