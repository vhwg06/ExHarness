import { invariant } from "./contracts.js";
import { AgentEventKind } from "./agent-events.js";
import { PredictValidationError } from "./errors.js";
import { defineModelAdapter, modelAdapterView } from "./model.js";
import { TraceSpanKind } from "./tracing.js";

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

async function traced(trace, kind, name, operation, options = {}) {
  return trace && typeof trace.runSpan === "function"
    ? trace.runSpan(kind, name, operation, options)
    : operation();
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
      recordAgentEvent = null,
      trace = null
    }) {
      if (recordAgentEvent != null) {
        invariant(typeof recordAgentEvent === "function", "recordAgentEvent must be a function");
      }

      const feedback = [];

      for (let attempt = 1; attempt <= resolvedMaxAttempts; attempt += 1) {
        const outcome = await traced(
          trace,
          TraceSpanKind.PREDICT_ATTEMPT,
          `predict.attempt.${attempt}`,
          async () => {
            const candidate = await traced(
              trace,
              TraceSpanKind.MODEL,
              resolvedModel.name ?? "model",
              () => resolvedModel.generate(Object.freeze({
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
              })),
              { attributes: { mode: "PREDICT", attempt } }
            );

            recordAgentEvent?.(AgentEventKind.MODEL_OUTPUT, {
              attempt,
              output: safeClone(candidate),
              model: modelAdapterView(resolvedModel)
            });

            if (typeof validateResult !== "function") {
              return Object.freeze({ accepted: true, candidate });
            }

            try {
              validateResult(candidate);
              return Object.freeze({ accepted: true, candidate });
            } catch (error) {
              const rejected = validationFeedback(error, attempt, candidate);
              feedback.push(rejected);
              recordAgentEvent?.(AgentEventKind.VALIDATION_ERROR, rejected);
              return Object.freeze({ accepted: false, candidate: null });
            }
          },
          { attributes: { attempt } }
        );

        if (outcome.accepted) return outcome.candidate;
      }

      throw new PredictValidationError({
        attempts: resolvedMaxAttempts,
        lastValidationError: feedback.at(-1)?.error ?? null
      });
    }
  });
}
