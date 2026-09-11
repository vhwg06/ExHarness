import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { invariant, requireText } from "./contracts.js";

export const TraceSpanKind = Object.freeze({
  AGENT_RUN: "AGENT_RUN",
  JUDGMENT: "JUDGMENT",
  STRATEGY: "STRATEGY",
  PREDICT_ATTEMPT: "PREDICT_ATTEMPT",
  CODEACT_TURN: "CODEACT_TURN",
  MODEL: "MODEL",
  ACTION: "ACTION",
  EXECUTION: "EXECUTION",
  CAPABILITY: "CAPABILITY",
  RESOURCE: "RESOURCE",
  RESOURCE_DESCRIBE: "RESOURCE_DESCRIBE"
});

export const TraceSpanStatus = Object.freeze({
  OK: "OK",
  ERROR: "ERROR"
});

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function errorView(error) {
  return Object.freeze({
    name: error?.name ?? "Error",
    code: error?.code ?? null,
    message: error?.message ?? String(error)
  });
}

function normalizeAttributes(attributes) {
  invariant(attributes == null || (typeof attributes === "object" && !Array.isArray(attributes)), "trace attributes must be an object or null");
  return attributes == null ? null : clone(attributes);
}

export function createTraceRecorder({
  sinks = [],
  strict = false,
  clock = () => Date.now(),
  idFactory = () => randomUUID()
} = {}) {
  invariant(typeof strict === "boolean", "trace strict must be boolean");
  invariant(typeof clock === "function", "trace clock must be a function");
  invariant(typeof idFactory === "function", "trace idFactory must be a function");
  for (const sink of sinks) invariant(sink && typeof sink.write === "function", "trace sink requires write()");

  const storage = new AsyncLocalStorage();
  const spans = [];
  const sinkFailures = [];

  async function writeSpan(span, primaryError = null) {
    let strictFailure = null;
    for (const sink of sinks) {
      try {
        await sink.write(span);
      } catch (error) {
        sinkFailures.push(Object.freeze({
          spanId: span.spanId,
          sink: sink.name ?? null,
          message: error?.message ?? String(error)
        }));
        if (strict && primaryError == null && strictFailure == null) strictFailure = error;
      }
    }
    if (strictFailure) throw strictFailure;
  }

  async function runSpan(kind, name, operation, {
    callId = null,
    attributes = null
  } = {}) {
    invariant(typeof operation === "function", "trace span requires operation()");
    const resolvedKind = requireText(kind, "trace span kind");
    const resolvedName = requireText(name, "trace span name");
    const parent = storage.getStore() ?? null;
    const spanId = idFactory();
    const traceId = parent?.traceId ?? spanId;
    const inheritedCallId = callId ?? parent?.callId ?? null;
    const startedAt = clock();
    invariant(Number.isFinite(startedAt), "trace clock must return a finite number");

    const context = Object.freeze({ traceId, spanId, callId: inheritedCallId });
    let result;
    let primaryError = null;

    try {
      result = await storage.run(context, operation);
    } catch (error) {
      primaryError = error;
    }

    const endedAt = clock();
    invariant(Number.isFinite(endedAt), "trace clock must return a finite number");
    const span = Object.freeze({
      traceId,
      spanId,
      parentSpanId: parent?.spanId ?? null,
      callId: inheritedCallId,
      kind: resolvedKind,
      name: resolvedName,
      startedAt,
      endedAt,
      durationMs: Math.max(0, endedAt - startedAt),
      status: primaryError == null ? TraceSpanStatus.OK : TraceSpanStatus.ERROR,
      error: primaryError == null ? null : errorView(primaryError),
      attributes: normalizeAttributes(attributes)
    });
    spans.push(span);

    try {
      await writeSpan(span, primaryError);
    } catch (sinkError) {
      throw sinkError;
    }

    if (primaryError != null) throw primaryError;
    return result;
  }

  return Object.freeze({
    runSpan,

    current() {
      const current = storage.getStore();
      return current == null ? null : clone(current);
    },

    spans() {
      return Object.freeze(clone(spans));
    },

    failures() {
      return Object.freeze(clone(sinkFailures));
    }
  });
}
