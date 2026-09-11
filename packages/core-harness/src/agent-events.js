import { randomUUID } from "node:crypto";
import { invariant, requireText } from "./contracts.js";

export const AgentEventKind = Object.freeze({
  TASK: "TASK",
  MODEL_OUTPUT: "MODEL_OUTPUT",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  ACTION_OUTPUT: "ACTION_OUTPUT",
  ACTION_ERROR: "ACTION_ERROR",
  RESULT: "RESULT",
  ERROR: "ERROR"
});

function safeClone(value) {
  try {
    return value == null ? value : structuredClone(value);
  } catch {
    return value == null ? null : Object.freeze({ unavailable: true, type: typeof value });
  }
}

function normalizeSeedEvent(event) {
  invariant(event && typeof event === "object", "agent event is required");
  invariant(Object.values(AgentEventKind).includes(event.type), "agent event type is invalid");
  return Object.freeze({
    id: requireText(event.id, "agent event id"),
    type: event.type,
    at: requireText(event.at, "agent event at"),
    callId: requireText(event.callId, "agent event callId"),
    judgment: event.judgment == null ? null : safeClone(event.judgment),
    payload: safeClone(event.payload ?? null)
  });
}

export function createAgentEventStore({
  events = [],
  clock = () => new Date().toISOString(),
  idFactory = () => randomUUID()
} = {}) {
  invariant(Array.isArray(events), "agent events seed must be an array");
  invariant(typeof clock === "function", "agent event clock must be a function");
  invariant(typeof idFactory === "function", "agent event idFactory must be a function");

  const history = events.map(normalizeSeedEvent);

  return Object.freeze({
    newCallId() {
      return requireText(idFactory(), "agent call id");
    },

    record(type, { callId, judgment = null, payload = null } = {}) {
      invariant(Object.values(AgentEventKind).includes(type), `unknown agent event type: ${type}`);
      const event = Object.freeze({
        id: requireText(idFactory(), "agent event id"),
        type,
        at: requireText(clock(), "agent event at"),
        callId: requireText(callId, "agent event callId"),
        judgment: judgment == null ? null : safeClone(judgment),
        payload: safeClone(payload)
      });
      history.push(event);
      return event;
    },

    events() {
      return Object.freeze(safeClone(history));
    }
  });
}
