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

export const AgentEventRefKind = Object.freeze({
  AGENT_EVENT: "AGENT_EVENT"
});

export const AgentEventLinkKind = Object.freeze({
  PRODUCED_ARTIFACT: "PRODUCED_ARTIFACT"
});

function safeClone(value) {
  try {
    return value == null ? value : structuredClone(value);
  } catch {
    return value == null ? null : Object.freeze({ unavailable: true, type: typeof value });
  }
}

function defineEventRef(id) {
  return Object.freeze({
    kind: AgentEventRefKind.AGENT_EVENT,
    id: requireText(id, "agent event ref id")
  });
}

function defineArtifactRef(ref) {
  invariant(ref && typeof ref === "object" && !Array.isArray(ref), "agent event artifact ref must be an object");
  return Object.freeze({
    kind: requireText(ref.kind, "agent event artifact ref kind"),
    id: requireText(ref.id, "agent event artifact ref id")
  });
}

function deriveLinks(type, payload, callId) {
  if (type !== AgentEventKind.ACTION_OUTPUT) return Object.freeze([]);

  const artifact = payload?.output;
  if (artifact?.artifactRef == null) return Object.freeze([]);

  const runtimeCallId = artifact?.provenance?.runtime?.callId ?? null;
  if (runtimeCallId != null) {
    invariant(runtimeCallId === callId, "agent event cannot link an artifact from another runtime call");
  }

  return Object.freeze([
    Object.freeze({
      kind: AgentEventLinkKind.PRODUCED_ARTIFACT,
      target: defineArtifactRef(artifact.artifactRef)
    })
  ]);
}

function normalizeLinks(type, event, callId) {
  if (event.links == null) return deriveLinks(type, event.payload, callId);
  invariant(Array.isArray(event.links), "agent event links must be an array");
  return Object.freeze(event.links.map((link) => {
    invariant(link && typeof link === "object" && !Array.isArray(link), "agent event link must be an object");
    invariant(Object.values(AgentEventLinkKind).includes(link.kind), "agent event link kind is invalid");
    return Object.freeze({
      kind: link.kind,
      target: defineArtifactRef(link.target)
    });
  }));
}

function normalizeSeedEvent(event) {
  invariant(event && typeof event === "object", "agent event is required");
  invariant(Object.values(AgentEventKind).includes(event.type), "agent event type is invalid");
  const id = requireText(event.id, "agent event id");
  const callId = requireText(event.callId, "agent event callId");
  return Object.freeze({
    id,
    eventRef: event.eventRef == null ? defineEventRef(id) : defineEventRef(event.eventRef.id),
    type: event.type,
    at: requireText(event.at, "agent event at"),
    callId,
    judgment: event.judgment == null ? null : safeClone(event.judgment),
    payload: safeClone(event.payload ?? null),
    links: normalizeLinks(event.type, event, callId)
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
      const id = requireText(idFactory(), "agent event id");
      const resolvedCallId = requireText(callId, "agent event callId");
      const clonedPayload = safeClone(payload);
      const event = Object.freeze({
        id,
        eventRef: defineEventRef(id),
        type,
        at: requireText(clock(), "agent event at"),
        callId: resolvedCallId,
        judgment: judgment == null ? null : safeClone(judgment),
        payload: clonedPayload,
        links: deriveLinks(type, clonedPayload, resolvedCallId)
      });
      history.push(event);
      return event;
    },

    events() {
      return Object.freeze(safeClone(history));
    }
  });
}
