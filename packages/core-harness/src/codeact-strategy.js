import { invariant, requireText } from "./contracts.js";
import { AgentEventKind } from "./agent-events.js";
import {
  CodeActBoundaryError,
  ExecutionError,
  ExHarnessErrorCode
} from "./errors.js";
import {
  defineExecutionPolicy,
  defineExecutor,
  executeWithPolicy
} from "./execution.js";
import { defineModelAdapter, modelAdapterView } from "./model.js";
import { TraceSpanKind } from "./tracing.js";
import { CapabilityBudgetExceededError } from "./variation.js";

export const CodeActActionType = Object.freeze({
  EXECUTE: "execute",
  RETURN_RESULT: "return_result"
});

export const CodeActExecutionTarget = Object.freeze({
  EXECUTOR: "EXECUTOR",
  CAPABILITY: "CAPABILITY",
  RESOURCE: "RESOURCE",
  RESOURCE_DESCRIBE: "RESOURCE_DESCRIBE"
});

export const CodeActRecovery = Object.freeze({
  RETRY: "RETRY",
  FAIL: "FAIL"
});

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

function normalizePositiveInteger(value, label) {
  invariant(Number.isInteger(value) && value > 0, `${label} must be a positive integer`);
  return value;
}

function normalizeDuration(value) {
  invariant(value == null || (Number.isInteger(value) && value > 0), "codeact maxDurationMs must be null or a positive integer");
  return value;
}

function normalizeRecovery(value, label) {
  invariant(Object.values(CodeActRecovery).includes(value), `${label} is invalid`);
  return value;
}

function validateTransportData(value, label, seen = new WeakSet()) {
  if (value == null) return;
  const type = typeof value;
  if (type === "string" || type === "boolean") return;
  if (type === "number") {
    invariant(Number.isFinite(value), `${label} numbers must be finite`);
    return;
  }
  invariant(type === "object", `${label} must contain only JSON-compatible data`);
  invariant(!seen.has(value), `${label} cannot contain cycles`);
  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((item, index) => validateTransportData(item, `${label}[${index}]`, seen));
    seen.delete(value);
    return;
  }

  const prototype = Object.getPrototypeOf(value);
  invariant(prototype === Object.prototype || prototype === null, `${label} must contain only plain objects and arrays`);
  invariant(Object.getOwnPropertySymbols(value).length === 0, `${label} cannot contain symbol keys`);
  for (const [key, child] of Object.entries(value)) {
    validateTransportData(child, `${label}.${key}`, seen);
  }
  seen.delete(value);
}

function normalizeTransportData(value, label) {
  let copied;
  try {
    copied = clone(value);
  } catch (error) {
    throw new TypeError(`${label} must be structured-cloneable`, { cause: error });
  }
  validateTransportData(copied, label);
  return copied;
}

function errorView(error) {
  return Object.freeze({
    name: error?.name ?? "Error",
    code: error?.code ?? null,
    message: error?.message ?? String(error)
  });
}

function protocolError(message, details = null) {
  return new CodeActBoundaryError(
    ExHarnessErrorCode.CODEACT_PROTOCOL_ERROR,
    message,
    details
  );
}

function normalizeAction(raw) {
  if (typeof raw === "string") {
    return Object.freeze({ kind: "TEXT", text: raw });
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw protocolError("codeact model output must be an action object");
  }

  const action = normalizeTransportData(raw, "codeact model action");
  if (action.type === CodeActActionType.RETURN_RESULT) {
    invariant(Object.prototype.hasOwnProperty.call(action, "value"), "codeact return_result requires value");
    return Object.freeze({
      kind: "ACTION",
      action: Object.freeze({ type: CodeActActionType.RETURN_RESULT, value: action.value })
    });
  }

  if (action.type !== CodeActActionType.EXECUTE) {
    throw protocolError(`unknown codeact action type: ${action.type ?? "null"}`);
  }

  invariant(Object.values(CodeActExecutionTarget).includes(action.target), "codeact execute target is invalid");
  const normalized = { type: CodeActActionType.EXECUTE, target: action.target };

  if (action.target === CodeActExecutionTarget.EXECUTOR) {
    normalized.request = action.request ?? null;
  } else if (action.target === CodeActExecutionTarget.CAPABILITY) {
    normalized.name = requireText(action.name, "codeact capability name");
    normalized.input = action.input ?? null;
  } else if (action.target === CodeActExecutionTarget.RESOURCE) {
    invariant(action.ref && typeof action.ref === "object", "codeact resource execute requires ref");
    normalized.ref = action.ref;
    normalized.operation = requireText(action.operation, "codeact resource operation");
    normalized.input = action.input ?? null;
  } else {
    invariant(action.ref && typeof action.ref === "object", "codeact resource describe requires ref");
    normalized.ref = action.ref;
  }

  return Object.freeze({ kind: "ACTION", action: Object.freeze(normalized) });
}

function observationView(observation) {
  return Object.freeze(normalizeTransportData(observation, "codeact observation"));
}

async function traced(trace, kind, name, operation, options = {}) {
  return trace && typeof trace.runSpan === "function"
    ? trace.runSpan(kind, name, operation, options)
    : operation();
}

export function createCodeActStrategy({
  model = null,
  executor,
  executionPolicy = {},
  maxTurns = 16,
  maxActionCalls = 32,
  maxDurationMs = 120_000,
  maxObservationChars = 64_000,
  textResponseRecovery = CodeActRecovery.RETRY,
  malformedActionRecovery = CodeActRecovery.RETRY,
  observeActionErrors = true,
  clock = () => Date.now()
}) {
  const fallbackModel = model == null ? null : defineModelAdapter(model);
  const resolvedExecutor = defineExecutor(executor);
  const resolvedExecutionPolicy = defineExecutionPolicy(executionPolicy);
  const resolvedMaxTurns = normalizePositiveInteger(maxTurns, "codeact maxTurns");
  const resolvedMaxActionCalls = normalizePositiveInteger(maxActionCalls, "codeact maxActionCalls");
  const resolvedMaxDurationMs = normalizeDuration(maxDurationMs);
  const resolvedMaxObservationChars = normalizePositiveInteger(maxObservationChars, "codeact maxObservationChars");
  const resolvedTextRecovery = normalizeRecovery(textResponseRecovery, "codeact textResponseRecovery");
  const resolvedMalformedRecovery = normalizeRecovery(malformedActionRecovery, "codeact malformedActionRecovery");
  invariant(typeof observeActionErrors === "boolean", "codeact observeActionErrors must be boolean");
  invariant(typeof clock === "function", "codeact clock must be a function");

  const protocol = Object.freeze({
    actions: Object.freeze(Object.values(CodeActActionType)),
    executeTargets: Object.freeze(Object.values(CodeActExecutionTarget)),
    terminalAction: CodeActActionType.RETURN_RESULT
  });

  return Object.freeze({
    kind: "CODEACT",
    acceptsRoutedModel: true,
    turnAwareContext: true,
    model: fallbackModel == null ? null : modelAdapterView(fallbackModel),
    limits: Object.freeze({
      maxTurns: resolvedMaxTurns,
      maxActionCalls: resolvedMaxActionCalls,
      maxDurationMs: resolvedMaxDurationMs,
      maxObservationChars: resolvedMaxObservationChars
    }),
    protocol,

    async run({
      input,
      context,
      callContext = context,
      promptContext = null,
      events = [],
      agentEvents = [],
      history = null,
      judgment = null,
      capabilities = [],
      resources = [],
      invoke,
      describeResource,
      invokeResource,
      validateResult = null,
      recordAgentEvent = null,
      prepareTurn = null,
      trace = null,
      model: routedModel = null,
      modelRoute = null
    }) {
      invariant(typeof invoke === "function", "codeact requires runtime invoke()");
      invariant(typeof describeResource === "function", "codeact requires runtime describeResource()");
      invariant(typeof invokeResource === "function", "codeact requires runtime invokeResource()");
      if (validateResult != null) invariant(typeof validateResult === "function", "codeact validateResult must be a function");
      if (recordAgentEvent != null) invariant(typeof recordAgentEvent === "function", "codeact recordAgentEvent must be a function");
      if (prepareTurn != null) invariant(typeof prepareTurn === "function", "prepareTurn must be a function");

      const activeModel = routedModel == null ? fallbackModel : defineModelAdapter(routedModel);
      invariant(activeModel, "codeact requires a routed model or constructor model");
      const activeModelView = modelAdapterView(activeModel);
      const routeView = modelRoute == null ? null : clone(modelRoute);
      const startedAt = clock();
      const observations = [];
      let actionCalls = 0;
      let lastValidationError = null;

      function timeBudgetError(stage) {
        return new CodeActBoundaryError(
          ExHarnessErrorCode.CODEACT_TIME_BUDGET_EXCEEDED,
          "codeact time budget exhausted",
          {
            stage,
            maxDurationMs: resolvedMaxDurationMs,
            elapsedMs: Math.max(0, clock() - startedAt)
          }
        );
      }

      function remainingTime(stage) {
        if (resolvedMaxDurationMs == null) return null;
        const remainingMs = resolvedMaxDurationMs - (clock() - startedAt);
        if (remainingMs <= 0) throw timeBudgetError(stage);
        return remainingMs;
      }

      function assertWithinTime(stage) {
        remainingTime(stage);
      }

      async function awaitWithinTime(stage, operation) {
        const remainingMs = remainingTime(stage);
        if (remainingMs == null) return operation();

        let timer = null;
        try {
          return await Promise.race([
            Promise.resolve().then(operation),
            new Promise((_, reject) => {
              timer = setTimeout(() => reject(timeBudgetError(stage)), remainingMs);
            })
          ]);
        } finally {
          if (timer != null) clearTimeout(timer);
        }
      }

      function reserveActionCall(turn, target) {
        if (actionCalls >= resolvedMaxActionCalls) {
          throw new CodeActBoundaryError(
            ExHarnessErrorCode.CODEACT_ACTION_BUDGET_EXCEEDED,
            "codeact action budget exhausted",
            { turn, target, maxActionCalls: resolvedMaxActionCalls, actionCalls }
          );
        }
        actionCalls += 1;
      }

      function appendObservation(observation) {
        const normalized = observationView(observation);
        const candidate = [...observations, normalized];
        const serializedChars = JSON.stringify(candidate).length;
        if (serializedChars > resolvedMaxObservationChars) {
          throw new CodeActBoundaryError(
            ExHarnessErrorCode.CODEACT_OBSERVATION_LIMIT_EXCEEDED,
            "codeact observation buffer exceeded its serialized bound",
            {
              maxObservationChars: resolvedMaxObservationChars,
              serializedChars,
              observationCount: candidate.length
            }
          );
        }
        observations.push(normalized);
        return normalized;
      }

      for (let turn = 1; turn <= resolvedMaxTurns; turn += 1) {
        assertWithinTime("before_model");
        const turnContext = prepareTurn == null
          ? Object.freeze({ promptContext, agentEvents, history })
          : await prepareTurn({ reportedTurn: turn, model: activeModelView });
        const request = Object.freeze({
          mode: "CODEACT",
          turn,
          input: clone(input),
          context: clone(context),
          callContext: clone(callContext),
          promptContext: clone(turnContext.promptContext),
          events: clone(events) ?? [],
          agentEvents: clone(turnContext.agentEvents) ?? [],
          history: clone(turnContext.history),
          judgment: judgment == null ? null : clone(judgment),
          modelRoute: routeView,
          capabilities: clone(capabilities) ?? [],
          resources: clone(resources) ?? [],
          observations: clone(observations),
          protocol
        });
        const raw = await traced(
          trace,
          TraceSpanKind.MODEL,
          activeModel.name ?? "model",
          () => awaitWithinTime("model", () => activeModel.generate(request)),
          { attributes: { mode: "CODEACT", turn, model: activeModelView, modelRoute: routeView } }
        );
        assertWithinTime("after_model");

        recordAgentEvent?.(AgentEventKind.MODEL_OUTPUT, {
          turn,
          output: safeClone(raw),
          model: activeModelView,
          modelRoute: routeView
        });

        let normalized;
        try {
          normalized = normalizeAction(raw);
        } catch (error) {
          if (resolvedMalformedRecovery === CodeActRecovery.FAIL) throw error;
          const observation = appendObservation({
            turn,
            kind: "PROTOCOL_ERROR",
            status: "ERROR",
            error: errorView(error)
          });
          recordAgentEvent?.(AgentEventKind.ACTION_ERROR, observation);
          continue;
        }

        if (normalized.kind === "TEXT") {
          const error = new CodeActBoundaryError(
            ExHarnessErrorCode.CODEACT_TEXT_RESPONSE,
            "codeact model returned text instead of an action",
            { turn, text: normalized.text }
          );
          if (resolvedTextRecovery === CodeActRecovery.FAIL) throw error;
          const observation = appendObservation({
            turn,
            kind: "TEXT_RESPONSE",
            status: "ERROR",
            error: errorView(error)
          });
          recordAgentEvent?.(AgentEventKind.ACTION_ERROR, observation);
          continue;
        }

        const action = normalized.action;
        if (action.type === CodeActActionType.RETURN_RESULT) {
          if (validateResult == null) return action.value;
          try {
            validateResult(action.value);
            return action.value;
          } catch (error) {
            lastValidationError = errorView(error);
            const feedback = Object.freeze({
              turn,
              rejectedOutput: safeClone(action.value),
              error: lastValidationError
            });
            recordAgentEvent?.(AgentEventKind.VALIDATION_ERROR, feedback);
            appendObservation({
              turn,
              kind: "RETURN_VALIDATION_ERROR",
              status: "ERROR",
              error: lastValidationError
            });
            continue;
          }
        }

        reserveActionCall(turn, action.target);
        assertWithinTime("before_action");

        try {
          const output = await traced(
            trace,
            TraceSpanKind.ACTION,
            `codeact.${action.target.toLowerCase()}`,
            async () => {
              if (action.target === CodeActExecutionTarget.EXECUTOR) {
                return traced(
                  trace,
                  TraceSpanKind.EXECUTION,
                  "executor.execute",
                  () => awaitWithinTime("executor_action", () => executeWithPolicy(
                    resolvedExecutor,
                    { mode: "CODEACT", turn, request: clone(action.request) },
                    { policy: resolvedExecutionPolicy }
                  )),
                  { attributes: { turn } }
                );
              }
              if (action.target === CodeActExecutionTarget.CAPABILITY) {
                return awaitWithinTime("capability_action", () => invoke(action.name, clone(action.input)));
              }
              if (action.target === CodeActExecutionTarget.RESOURCE) {
                return awaitWithinTime(
                  "resource_action",
                  () => invokeResource(clone(action.ref), action.operation, clone(action.input))
                );
              }
              return awaitWithinTime("resource_describe", () => describeResource(clone(action.ref)));
            },
            { attributes: { turn, target: action.target } }
          );

          assertWithinTime("after_action");
          const transportOutput = normalizeTransportData(output, "codeact action output");
          const observation = appendObservation({
            turn,
            kind: "ACTION_RESULT",
            status: "SUCCESS",
            target: action.target,
            output: transportOutput
          });
          recordAgentEvent?.(AgentEventKind.ACTION_OUTPUT, observation);
        } catch (error) {
          if (
            error instanceof CapabilityBudgetExceededError ||
            error instanceof CodeActBoundaryError ||
            error?.code === ExHarnessErrorCode.TRACE_SINK_FAILED
          ) {
            recordAgentEvent?.(AgentEventKind.ACTION_ERROR, {
              turn,
              kind: "BOUNDARY_ERROR",
              status: "ERROR",
              target: action.target,
              error: errorView(error)
            });
            throw error;
          }

          const observation = appendObservation({
            turn,
            kind: "ACTION_RESULT",
            status: "ERROR",
            target: action.target,
            error: errorView(error)
          });
          recordAgentEvent?.(AgentEventKind.ACTION_ERROR, observation);

          if (error instanceof ExecutionError && observeActionErrors) continue;
          if (observeActionErrors) continue;
          throw error;
        }
      }

      throw new CodeActBoundaryError(
        ExHarnessErrorCode.CODEACT_TURN_LIMIT_EXCEEDED,
        "codeact turn limit exhausted before a valid terminal result",
        {
          maxTurns: resolvedMaxTurns,
          actionCalls,
          lastValidationError
        }
      );
    }
  });
}
