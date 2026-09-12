import { invariant, requireText } from "./contracts.js";
import { AgentEventKind } from "./agent-events.js";
import { DiscoveryMode, renderLiveObjectDoc } from "./discovery.js";
import {
  CodeActBoundaryError,
  ExecutionError,
  ExHarnessErrorCode
} from "./errors.js";
import { defineModelAdapter, modelAdapterView } from "./model.js";
import { TraceSpanKind } from "./tracing.js";
import { CapabilityBudgetExceededError } from "./variation.js";

export const JavaScriptCodeActActionType = Object.freeze({
  EXECUTE_JAVASCRIPT: "execute_javascript"
});

export const JavaScriptHostRequestType = Object.freeze({
  CALL_CAPABILITY: "CALL_CAPABILITY",
  DOC_SELF: "DOC_SELF",
  DOC_LIVE: "DOC_LIVE",
  INVOKE_LIVE: "INVOKE_LIVE",
  READ_LIVE: "READ_LIVE",
  RETURN_RESULT: "RETURN_RESULT"
});

export const JavaScriptSessionFeature = Object.freeze({
  CELL_ABORT: "CELL_ABORT"
});

const JavaScriptTerminalInterruptCode = "EXHARNESS_JAVASCRIPT_TERMINAL_INTERRUPT";

export function isJavaScriptTerminalInterrupt(error) {
  return error?.code === JavaScriptTerminalInterruptCode;
}

function terminalInterrupt() {
  const error = new Error("javascript codeact cell terminated by return_result");
  error.name = "JavaScriptTerminalInterrupt";
  error.code = JavaScriptTerminalInterruptCode;
  return error;
}

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

function positiveInteger(value, label) {
  invariant(Number.isInteger(value) && value > 0, `${label} must be a positive integer`);
  return value;
}

function nullableDuration(value) {
  invariant(
    value == null || (Number.isInteger(value) && value > 0),
    "javascript codeact maxDurationMs must be null or a positive integer"
  );
  return value;
}

function errorView(error) {
  return Object.freeze({
    name: error?.name ?? "Error",
    code: error?.code ?? null,
    message: error?.message ?? String(error)
  });
}

function boundary(code, message, details = null, cause = null) {
  return new CodeActBoundaryError(code, message, details, cause);
}

function validateTransport(value, label, seen = new WeakSet()) {
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
    value.forEach((item, index) => validateTransport(item, `${label}[${index}]`, seen));
    seen.delete(value);
    return;
  }
  const prototype = Object.getPrototypeOf(value);
  invariant(
    prototype === Object.prototype || prototype === null,
    `${label} must contain only plain objects and arrays`
  );
  invariant(Object.getOwnPropertySymbols(value).length === 0, `${label} cannot contain symbol keys`);
  for (const [key, child] of Object.entries(value)) validateTransport(child, `${label}.${key}`, seen);
  seen.delete(value);
}

function transport(value, label) {
  validateTransport(value, label);
  return clone(value);
}

function normalizeAction(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw boundary(
      ExHarnessErrorCode.CODEACT_PROTOCOL_ERROR,
      "javascript codeact model output must be an action object"
    );
  }
  const action = transport(raw, "javascript codeact model action");
  if (action.type !== JavaScriptCodeActActionType.EXECUTE_JAVASCRIPT) {
    throw boundary(
      ExHarnessErrorCode.CODEACT_PROTOCOL_ERROR,
      `javascript codeact only accepts ${JavaScriptCodeActActionType.EXECUTE_JAVASCRIPT}`,
      { type: action.type ?? null }
    );
  }
  return Object.freeze({
    type: action.type,
    code: requireText(action.code, "javascript codeact source")
  });
}

function defineSessionExecutor(executor) {
  invariant(executor && typeof executor.open === "function", "javascript codeact executor requires open()");
  return executor;
}

function normalizeSessionFeatures(value) {
  if (value == null) return Object.freeze([]);
  invariant(Array.isArray(value), "javascript codeact session features must be an array");
  const features = value.map((item) => requireText(item, "javascript codeact session feature"));
  invariant(new Set(features).size === features.length, "javascript codeact session features cannot contain duplicates");
  return Object.freeze(features);
}

function selfDocument(promptContext) {
  const block = promptContext?.blocks?.find?.((item) => item?.name === "__exharness_self_doc__");
  return block?.value == null ? null : clone(block.value);
}

function clipOutput(text, maximum) {
  const value = text == null ? "" : String(text);
  if (value.length <= maximum) {
    return Object.freeze({ value, truncated: false, originalChars: value.length });
  }
  return Object.freeze({
    value: value.slice(0, maximum),
    truncated: true,
    originalChars: value.length
  });
}

async function traced(trace, kind, name, operation, options = {}) {
  return trace && typeof trace.runSpan === "function"
    ? trace.runSpan(kind, name, operation, options)
    : operation();
}

function executionInfrastructureFailure(error) {
  return error instanceof ExecutionError || [
    ExHarnessErrorCode.EXECUTION_FAILED,
    ExHarnessErrorCode.EXECUTION_TIMED_OUT,
    ExHarnessErrorCode.EXECUTION_ABORTED,
    ExHarnessErrorCode.TRACE_SINK_FAILED
  ].includes(error?.code);
}

function kernelBoundaryFailure(error) {
  return error instanceof CapabilityBudgetExceededError || [
    ExHarnessErrorCode.CODEACT_ACTION_BUDGET_EXCEEDED,
    ExHarnessErrorCode.CODEACT_TIME_BUDGET_EXCEEDED,
    ExHarnessErrorCode.CODEACT_OBSERVATION_LIMIT_EXCEEDED,
    ExHarnessErrorCode.CODEACT_PROTOCOL_ERROR
  ].includes(error?.code) || executionInfrastructureFailure(error);
}

function bindingView(capabilities, liveObjects) {
  return Object.freeze({
    self: Object.freeze({
      kind: "CAPABILITY_PROXY",
      methods: Object.freeze((capabilities ?? []).map((item) => Object.freeze({
        name: item.name,
        description: item.description ?? null,
        mutatesCandidate: item.mutatesCandidate === true
      })))
    }),
    liveObjects: Object.freeze((liveObjects ?? []).map((item) => Object.freeze({
      name: item.name,
      ref: clone(item.ref)
    }))),
    helpers: Object.freeze({
      doc: "doc",
      returnResult: "return_result"
    })
  });
}

export function createJavaScriptCodeActStrategy({
  model = null,
  executor,
  maxTurns = 16,
  maxCells = 16,
  maxHostCalls = 64,
  maxDurationMs = 120_000,
  maxOutputChars = 16_000,
  maxObservationChars = 64_000,
  discoveryPolicy = {},
  requireTerminalInterrupt = true,
  clock = () => Date.now()
} = {}) {
  const fallbackModel = model == null ? null : defineModelAdapter(model);
  const resolvedExecutor = defineSessionExecutor(executor);
  const resolvedMaxTurns = positiveInteger(maxTurns, "javascript codeact maxTurns");
  const resolvedMaxCells = positiveInteger(maxCells, "javascript codeact maxCells");
  const resolvedMaxHostCalls = positiveInteger(maxHostCalls, "javascript codeact maxHostCalls");
  const resolvedMaxDurationMs = nullableDuration(maxDurationMs);
  const resolvedMaxOutputChars = positiveInteger(maxOutputChars, "javascript codeact maxOutputChars");
  const resolvedMaxObservationChars = positiveInteger(
    maxObservationChars,
    "javascript codeact maxObservationChars"
  );
  invariant(typeof requireTerminalInterrupt === "boolean", "javascript codeact requireTerminalInterrupt must be boolean");
  invariant(typeof clock === "function", "javascript codeact clock must be a function");

  const requiredSessionFeatures = Object.freeze(
    requireTerminalInterrupt ? [JavaScriptSessionFeature.CELL_ABORT] : []
  );
  const protocol = Object.freeze({
    action: JavaScriptCodeActActionType.EXECUTE_JAVASCRIPT,
    terminal: "return_result(value) inside generated JavaScript",
    hostRequests: Object.freeze(Object.values(JavaScriptHostRequestType)),
    requiredSessionFeatures
  });

  return Object.freeze({
    kind: "JAVASCRIPT_CODEACT",
    acceptsRoutedModel: true,
    model: fallbackModel == null ? null : modelAdapterView(fallbackModel),
    protocol,
    limits: Object.freeze({
      maxTurns: resolvedMaxTurns,
      maxCells: resolvedMaxCells,
      maxHostCalls: resolvedMaxHostCalls,
      maxDurationMs: resolvedMaxDurationMs,
      maxOutputChars: resolvedMaxOutputChars,
      maxObservationChars: resolvedMaxObservationChars
    }),

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
      liveObjects = [],
      invoke,
      describeLiveObject,
      invokeLiveObject,
      readLiveObject,
      validateResult = null,
      recordAgentEvent = null,
      trace = null,
      model: routedModel = null,
      modelRoute = null,
      callId = null
    }) {
      invariant(typeof invoke === "function", "javascript codeact requires runtime invoke()");
      invariant(typeof describeLiveObject === "function", "javascript codeact requires runtime describeLiveObject()");
      invariant(typeof invokeLiveObject === "function", "javascript codeact requires runtime invokeLiveObject()");
      invariant(typeof readLiveObject === "function", "javascript codeact requires runtime readLiveObject()");
      if (validateResult != null) {
        invariant(typeof validateResult === "function", "javascript codeact validateResult must be a function");
      }
      if (recordAgentEvent != null) {
        invariant(typeof recordAgentEvent === "function", "javascript codeact recordAgentEvent must be a function");
      }

      const activeModel = routedModel == null ? fallbackModel : defineModelAdapter(routedModel);
      invariant(activeModel, "javascript codeact requires a routed model or constructor model");
      const activeModelView = modelAdapterView(activeModel);
      const routeView = modelRoute == null ? null : clone(modelRoute);
      const startedAt = clock();
      const observations = [];
      let hostCalls = 0;
      let cells = 0;
      let terminal = null;
      let session = null;
      let sessionFeatures = Object.freeze([]);
      let currentCellController = null;
      let closed = false;
      let lastValidationError = null;
      let primaryError = null;

      function timeError(stage) {
        return boundary(
          ExHarnessErrorCode.CODEACT_TIME_BUDGET_EXCEEDED,
          "javascript codeact time budget exhausted",
          {
            stage,
            maxDurationMs: resolvedMaxDurationMs,
            elapsedMs: Math.max(0, clock() - startedAt)
          }
        );
      }

      function remaining(stage) {
        if (resolvedMaxDurationMs == null) return null;
        const value = resolvedMaxDurationMs - (clock() - startedAt);
        if (value <= 0) throw timeError(stage);
        return value;
      }

      async function withinTime(stage, operation, controller = null) {
        const ms = remaining(stage);
        if (ms == null) return operation();
        let timer;
        try {
          return await Promise.race([
            Promise.resolve().then(operation),
            new Promise((_, reject) => {
              timer = setTimeout(() => {
                controller?.abort("javascript codeact time budget exhausted");
                reject(timeError(stage));
              }, ms);
            })
          ]);
        } finally {
          if (timer != null) clearTimeout(timer);
        }
      }

      function appendObservation(value) {
        const normalized = transport(value, "javascript codeact observation");
        const candidate = [...observations, normalized];
        const chars = JSON.stringify(candidate).length;
        if (chars > resolvedMaxObservationChars) {
          throw boundary(
            ExHarnessErrorCode.CODEACT_OBSERVATION_LIMIT_EXCEEDED,
            "javascript codeact observation buffer exceeded its serialized bound",
            { maxObservationChars: resolvedMaxObservationChars, serializedChars: chars }
          );
        }
        observations.push(Object.freeze(normalized));
        return normalized;
      }

      function reserveHost(type) {
        if (terminal != null) {
          throw boundary(
            ExHarnessErrorCode.CODEACT_PROTOCOL_ERROR,
            "host call attempted after return_result",
            { type }
          );
        }
        if (hostCalls >= resolvedMaxHostCalls) {
          throw boundary(
            ExHarnessErrorCode.CODEACT_ACTION_BUDGET_EXCEEDED,
            "javascript codeact host-call budget exhausted",
            { maxHostCalls: resolvedMaxHostCalls, hostCalls, type }
          );
        }
        hostCalls += 1;
      }

      const host = Object.freeze({
        async request(raw) {
          const request = transport(raw, "javascript codeact host request");
          const type = requireText(request.type, "javascript codeact host request type");
          invariant(
            Object.values(JavaScriptHostRequestType).includes(type),
            `unsupported javascript codeact host request: ${type}`
          );
          reserveHost(type);

          if (type === JavaScriptHostRequestType.CALL_CAPABILITY) {
            return transport(
              await invoke(requireText(request.name, "host capability name"), request.input ?? null),
              "host capability result"
            );
          }
          if (type === JavaScriptHostRequestType.DOC_SELF) {
            return transport(selfDocument(promptContext), "host self document");
          }
          if (type === JavaScriptHostRequestType.DOC_LIVE) {
            invariant(request.ref && typeof request.ref === "object", "DOC_LIVE requires ref");
            const described = await describeLiveObject(request.ref);
            return transport(
              renderLiveObjectDoc(described.surface, {
                mode: request.mode ?? DiscoveryMode.CONCISE,
                policy: discoveryPolicy
              }),
              "host live document"
            );
          }
          if (type === JavaScriptHostRequestType.INVOKE_LIVE) {
            invariant(request.ref && typeof request.ref === "object", "INVOKE_LIVE requires ref");
            invariant(Array.isArray(request.args ?? []), "INVOKE_LIVE args must be an array");
            return transport(
              await invokeLiveObject(
                request.ref,
                requireText(request.name, "host live method name"),
                request.args ?? []
              ),
              "host live invocation result"
            );
          }
          if (type === JavaScriptHostRequestType.READ_LIVE) {
            invariant(request.ref && typeof request.ref === "object", "READ_LIVE requires ref");
            return transport(
              await readLiveObject(request.ref, requireText(request.name, "host live property name")),
              "host live read result"
            );
          }

          invariant(Object.prototype.hasOwnProperty.call(request, "value"), "RETURN_RESULT requires value");
          terminal = Object.freeze({
            value: transport(request.value, "javascript codeact terminal value")
          });
          currentCellController?.abort("return_result");
          throw terminalInterrupt();
        }
      });

      try {
        session = await withinTime("session_open", () => resolvedExecutor.open(Object.freeze({
          callId,
          host,
          protocol,
          bindings: bindingView(capabilities, liveObjects),
          limits: Object.freeze({
            maxCells: resolvedMaxCells,
            maxHostCalls: resolvedMaxHostCalls,
            maxDurationMs: resolvedMaxDurationMs,
            maxOutputChars: resolvedMaxOutputChars
          })
        })));
        invariant(session && typeof session.execute === "function", "javascript codeact session requires execute()");
        invariant(typeof session.close === "function", "javascript codeact session requires close()");
        sessionFeatures = normalizeSessionFeatures(session.features);
        for (const feature of requiredSessionFeatures) {
          if (!sessionFeatures.includes(feature)) {
            throw boundary(
              ExHarnessErrorCode.CODEACT_PROTOCOL_ERROR,
              `javascript codeact session is missing required feature: ${feature}`,
              { feature, sessionFeatures }
            );
          }
        }

        for (let turn = 1; turn <= resolvedMaxTurns; turn += 1) {
          const request = Object.freeze({
            mode: "JAVASCRIPT_CODEACT",
            turn,
            input: clone(input),
            context: clone(context),
            callContext: clone(callContext),
            promptContext: clone(promptContext),
            events: clone(events) ?? [],
            agentEvents: clone(agentEvents) ?? [],
            history: clone(history),
            judgment: judgment == null ? null : clone(judgment),
            modelRoute: routeView,
            capabilities: clone(capabilities) ?? [],
            liveObjects: clone(liveObjects) ?? [],
            observations: clone(observations),
            protocol,
            lastValidationError
          });

          const raw = await traced(
            trace,
            TraceSpanKind.MODEL,
            activeModel.name ?? "model",
            () => withinTime("model", () => activeModel.generate(request)),
            {
              attributes: {
                mode: "JAVASCRIPT_CODEACT",
                turn,
                model: activeModelView,
                modelRoute: routeView
              }
            }
          );
          recordAgentEvent?.(AgentEventKind.MODEL_OUTPUT, {
            turn,
            output: safeClone(raw),
            model: activeModelView,
            modelRoute: routeView
          });

          let action;
          try {
            action = normalizeAction(raw);
          } catch (error) {
            const observation = appendObservation({
              turn,
              kind: "PROTOCOL_ERROR",
              status: "ERROR",
              error: errorView(error)
            });
            recordAgentEvent?.(AgentEventKind.ACTION_ERROR, observation);
            continue;
          }

          if (cells >= resolvedMaxCells) {
            throw boundary(
              ExHarnessErrorCode.CODEACT_ACTION_BUDGET_EXCEEDED,
              "javascript codeact cell budget exhausted",
              { maxCells: resolvedMaxCells, cells }
            );
          }
          cells += 1;
          terminal = null;
          currentCellController = new AbortController();

          try {
            const result = await traced(
              trace,
              TraceSpanKind.EXECUTION,
              "javascript.session.execute",
              () => withinTime(
                "cell_execute",
                () => session.execute(
                  Object.freeze({
                    index: cells,
                    code: action.code,
                    maxOutputChars: resolvedMaxOutputChars
                  }),
                  Object.freeze({ signal: currentCellController.signal })
                ),
                currentCellController
              ),
              { attributes: { turn, cell: cells } }
            );
            invariant(
              result && typeof result === "object" && !Array.isArray(result),
              "javascript codeact session execute must return an object"
            );
            if (terminal != null && requireTerminalInterrupt && result.terminated !== true) {
              throw boundary(
                ExHarnessErrorCode.CODEACT_PROTOCOL_ERROR,
                "javascript codeact executor did not confirm cell termination after return_result",
                { cell: cells, sessionFeatures }
              );
            }
            const stdout = clipOutput(result.stdout ?? "", resolvedMaxOutputChars);
            const stderr = clipOutput(result.stderr ?? "", resolvedMaxOutputChars);
            const value = result.value == null
              ? null
              : transport(result.value, "javascript codeact cell value");
            const observation = appendObservation({
              turn,
              cell: cells,
              kind: "JAVASCRIPT_RESULT",
              status: "SUCCESS",
              stdout: stdout.value,
              stderr: stderr.value,
              stdoutTruncated: stdout.truncated,
              stderrTruncated: stderr.truncated,
              terminated: result.terminated === true,
              value
            });
            recordAgentEvent?.(AgentEventKind.ACTION_OUTPUT, observation);
          } catch (error) {
            if (isJavaScriptTerminalInterrupt(error)) {
              throw boundary(
                ExHarnessErrorCode.CODEACT_PROTOCOL_ERROR,
                "javascript codeact executor leaked the internal terminal interrupt instead of terminating the cell",
                { cell: cells },
                error
              );
            }
            if (kernelBoundaryFailure(error)) throw error;
            const observation = appendObservation({
              turn,
              cell: cells,
              kind: "JAVASCRIPT_ERROR",
              status: "ERROR",
              error: errorView(error)
            });
            recordAgentEvent?.(AgentEventKind.ACTION_ERROR, observation);
            terminal = null;
            continue;
          } finally {
            currentCellController = null;
          }

          if (terminal != null) {
            if (validateResult == null) return terminal.value;
            try {
              validateResult(terminal.value);
              return terminal.value;
            } catch (error) {
              lastValidationError = errorView(error);
              recordAgentEvent?.(AgentEventKind.VALIDATION_ERROR, Object.freeze({
                turn,
                cell: cells,
                rejectedOutput: safeClone(terminal.value),
                error: lastValidationError
              }));
              appendObservation({
                turn,
                cell: cells,
                kind: "RETURN_VALIDATION_ERROR",
                status: "ERROR",
                error: lastValidationError
              });
              terminal = null;
            }
          }
        }

        throw boundary(
          ExHarnessErrorCode.CODEACT_TURN_LIMIT_EXCEEDED,
          "javascript codeact exhausted its model-turn budget without a valid return_result",
          { maxTurns: resolvedMaxTurns, cells, hostCalls, lastValidationError }
        );
      } catch (error) {
        primaryError = error;
        throw error;
      } finally {
        currentCellController?.abort("javascript codeact session closing");
        if (session != null && !closed) {
          closed = true;
          try {
            await session.close();
          } catch (closeError) {
            if (primaryError == null) throw closeError;
          }
        }
      }
    }
  });
}
