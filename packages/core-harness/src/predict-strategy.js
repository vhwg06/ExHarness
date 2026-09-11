import { AgentEventKind, defineAgentEvent } from "./agent-events.js";
import { invariant } from "./contracts.js";
import { PredictValidationError } from "./errors.js";
import { defineModelAdapter, modelAdapterView } from "./model.js";

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function safeClone(value) {
  try {
    return clone(value);
  } catch {
    return Object.freeze({ unavailable: true });
  }
}

function normalizeAttempts(value) {
  invariant(Number.isInteger(value) && value > 0, "predict maxAttempts must be a positive integer");
  return value;
}

function validationFeedback(error, attempt, rejectedOutput) {
  return Object.freeze({
    attempt,
    rejectedOutput: safeClone(rejectedOutput),
    error: Object.freeze({
      name: error?.name ?? "Error",
      code: error?.code ?? null,
      message: error?.message ?? String(error)
    })
  });
}

export function createPredictStrategy({ model, maxAttempts = 3 }) {
  const resolvedModel = defineModelAdapter(model);
  const resolvedMaxAttempts = normalizeAttempts(maxAttempts);

  return Object.freeze({
    kind: "PREDICT",
    model: modelAdapterView(resolvedModel),
    maxAttempts: resolvedMaxAttempts,

    async run({ input, context, events = [], judgment = null, validateResult = null, emitEvent = null }) {
      const feedback = [];
      const workingEvents = [...events];

      function record(event) {
        const normalized = defineAgentEvent(event);
        const recorded = typeof emitEvent === "function" ? emitEvent(normalized) : normalized;
        workingEvents.push(recorded);
        return recorded;
      }

      for (let attempt = 1; attempt <= resolvedMaxAttempts; attempt += 1) {
        const candidate = await resolvedModel.generate(Object.freeze({
          mode: "PREDICT",
          attempt,
          input: clone(input),
          context: clone(context),
          events: clone(workingEvents),
          judgment: judgment == null ? null : clone(judgment),
          validationFeedback: Object.freeze(clone(feedback))
        }));

        record({
          kind: AgentEventKind.MODEL,
          content: safeClone(candidate),
          metadata: { strategy: "PREDICT", attempt }
        });

        if (typeof validateResult !== "function") return candidate;

        try {
          validateResult(candidate);
          return candidate;
        } catch (error) {
          const item = validationFeedback(error, attempt, candidate);
          feedback.push(item);
          record({
            kind: AgentEventKind.FEEDBACK,
            content: item,
            metadata: { strategy: "PREDICT", attempt, reason: "OUTPUT_VALIDATION" }
          });
        }
      }

      throw new PredictValidationError({
        attempts: resolvedMaxAttempts,
        lastValidationError: feedback.at(-1)?.error ?? null
      });
    }
  });
}
