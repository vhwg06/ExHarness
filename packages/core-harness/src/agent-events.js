import { invariant, requireText } from "./contracts.js";

export const AgentEventKind = Object.freeze({
  TASK: "TASK",
  MODEL: "MODEL",
  REASONING: "REASONING",
  CODE: "CODE",
  CODE_OUTPUT: "CODE_OUTPUT",
  CAPABILITY: "CAPABILITY",
  ERROR: "ERROR",
  FEEDBACK: "FEEDBACK",
  SUMMARY: "SUMMARY",
  RESULT: "RESULT"
});

function cloneStructured(value, label) {
  if (value == null) return null;
  try {
    return structuredClone(value);
  } catch {
    throw new Error(`${label} must be structured-cloneable`);
  }
}

export function defineAgentEvent({ kind, content = null, metadata = null }) {
  invariant(Object.values(AgentEventKind).includes(kind), "agent event kind is invalid");
  return Object.freeze({
    kind,
    content: cloneStructured(content, "agent event content"),
    metadata: cloneStructured(metadata, "agent event metadata")
  });
}

export function createAgentEventLog(seedEvents = []) {
  invariant(Array.isArray(seedEvents), "agent events must be an array");
  const events = seedEvents.map((event) => defineAgentEvent(event));

  return Object.freeze({
    append(event) {
      const normalized = defineAgentEvent(event);
      events.push(normalized);
      return normalized;
    },

    snapshot() {
      return Object.freeze(events.map((event) => defineAgentEvent(event)));
    },

    size() {
      return events.length;
    }
  });
}

export function taskEvent({ input = null, judgment = null } = {}) {
  return defineAgentEvent({
    kind: AgentEventKind.TASK,
    content: { input },
    metadata: { judgment }
  });
}

export function resultEvent(result) {
  return defineAgentEvent({ kind: AgentEventKind.RESULT, content: result });
}

export function errorEvent(error, metadata = null) {
  return defineAgentEvent({
    kind: AgentEventKind.ERROR,
    content: {
      name: requireText(error?.name ?? "Error", "agent error name"),
      code: error?.code ?? null,
      message: error?.message ?? String(error)
    },
    metadata
  });
}
