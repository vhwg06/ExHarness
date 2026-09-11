import { invariant } from "./contracts.js";
import { AgentEventKind } from "./agent-events.js";
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

    async run({
      input,
      context,
      callContext = context,
      promptContext = null,
      events = [],
      agentEvents = [],
      history = null,
      judgment = null,
      validateResult = null,
      recordAgentEvent = null
    }) {
      if (recordAgentEvent != null) {
        invariant(typeof recordAgentEvent === "function", "recordAgentEvent must be a function");
      }

      const feedback = [];

      for (let attempt = 1; attempt <= resolvedMaxAttempts; attempt += 1) {
        const candidate = await resolvedModel.generate(Object.freeze({
          mode: "PREDICT",
          attempt,
          input: clone(input),
          context: clone(context),
          callContext: clone(callContext),
          promptContext: clone(promptContext),
          events: clone(events) ?? [],
          agentEvents: clone(agentEvents) ?? [],
          history: clone(history),
          judgment: judgment == null ? null : clone(judgment),
          validationFeedback: Object.freeze(clone(feedback))
        }));

        recordAgentEvent?.(AgentEventKind.MODEL_OUTPUT, {
          attempt,
          output: safeClone(candidate),
          model: modelAdapterView(resolvedModel)
        });

        if (typeof validateResult !== "function") return candidate;

        try {
          validateResult(candidate);
          return candidate;
        } catch (error) {
          const rejected = validationFeedback(error, attempt, candidate);
          feedback.push(rejected);
          recordAgentEvent?.(AgentEventKind.VALIDATION_ERROR, rejected);
        }
      }

      throw new PredictValidationError({
        attempts: resolvedMaxAttempts,
        lastValidationError: feedback.at(-1)?.error ?? null
      });
    }
  });
}
