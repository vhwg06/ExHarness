import { randomUUID } from "node:crypto";
import { invariant, requireText } from "./contracts.js";

function safeClone(value) {
  try {
    return structuredClone(value);
  } catch {
    return value == null ? null : { uncloneable: true, type: typeof value };
  }
}

export function createEventBus({
  sinks = [],
  strict = false,
  clock = () => new Date().toISOString(),
  idFactory = () => randomUUID()
} = {}) {
  for (const sink of sinks) invariant(sink && typeof sink.write === "function", "event sink requires write()");
  const history = [];
  const sinkFailures = [];

  return Object.freeze({
    async emit(type, payload = {}) {
      const event = Object.freeze({
        id: idFactory(),
        type: requireText(type, "event type"),
        at: clock(),
        payload: safeClone(payload)
      });
      history.push(event);

      for (const sink of sinks) {
        try {
          await sink.write(event);
        } catch (error) {
          sinkFailures.push(Object.freeze({
            eventId: event.id,
            sink: sink.name ?? null,
            message: error?.message ?? String(error)
          }));
          if (strict) throw error;
        }
      }
      return event;
    },

    events() {
      return Object.freeze(structuredClone(history));
    },

    failures() {
      return Object.freeze(structuredClone(sinkFailures));
    }
  });
}

function wrapCapability(definition, eventBus) {
  invariant(definition && typeof definition === "object", "capability definition is required");
  invariant(typeof definition.execute === "function", "capability requires execute()");
  return {
    ...definition,
    async execute(input, runtime) {
      const started = await eventBus.emit("CAPABILITY_STARTED", {
        name: definition.name,
        mutatesCandidate: definition.mutatesCandidate === true
      });
      try {
        const output = await definition.execute(input, runtime);
        await eventBus.emit("CAPABILITY_COMPLETED", {
          invocationEventId: started.id,
          name: definition.name
        });
        return output;
      } catch (error) {
        await eventBus.emit("CAPABILITY_FAILED", {
          invocationEventId: started.id,
          name: definition.name,
          error: {
            name: error?.name ?? "Error",
            code: error?.code ?? null,
            message: error?.message ?? String(error)
          }
        });
        throw error;
      }
    }
  };
}

export function instrumentCapabilities(capabilities, eventBus) {
  invariant(eventBus && typeof eventBus.emit === "function", "instrumentation requires eventBus.emit()");
  return capabilities.map((definition) => wrapCapability(definition, eventBus));
}

export function instrumentAgentRuntime(agentRuntime, eventBus) {
  invariant(agentRuntime && typeof agentRuntime.runWithReport === "function", "agent runtime requires runWithReport()");
  invariant(eventBus && typeof eventBus.emit === "function", "instrumentation requires eventBus.emit()");

  async function runWithReport(options = {}) {
    const started = await eventBus.emit("AGENT_RUN_STARTED", {
      scopedCapabilityCount: options.capabilities?.length ?? 0
    });
    const originalInvoke = options.onCapabilityInvoke;
    const wrappedCapabilities = instrumentCapabilities(options.capabilities ?? [], eventBus);

    try {
      const report = await agentRuntime.runWithReport({
        ...options,
        capabilities: wrappedCapabilities,
        async onCapabilityInvoke(call) {
          await eventBus.emit("CAPABILITY_INVOKED", call);
          if (originalInvoke) await originalInvoke(call);
        }
      });
      await eventBus.emit("AGENT_RUN_COMPLETED", {
        runEventId: started.id,
        usage: safeClone(report.usage)
      });
      return report;
    } catch (error) {
      await eventBus.emit("AGENT_RUN_FAILED", {
        runEventId: started.id,
        error: {
          name: error?.name ?? "Error",
          code: error?.code ?? null,
          message: error?.message ?? String(error)
        }
      });
      throw error;
    }
  }

  const instrumented = {
    capabilities() {
      return agentRuntime.capabilities?.() ?? Object.freeze([]);
    },
    async run(options = {}) {
      return (await runWithReport(options)).result;
    },
    runWithReport
  };

  if (typeof agentRuntime.judgments === "function") {
    instrumented.judgments = () => agentRuntime.judgments();
  }
  if (typeof agentRuntime.agentEvents === "function") {
    instrumented.agentEvents = () => agentRuntime.agentEvents();
  }
  if (typeof agentRuntime.invokeJudgment === "function") {
    instrumented.invokeJudgment = (name, input, options = {}) => agentRuntime.invokeJudgment(name, input, options);
  }
  if (typeof agentRuntime.invokeJudgmentWithReport === "function") {
    instrumented.invokeJudgmentWithReport = (name, input, options = {}) => agentRuntime.invokeJudgmentWithReport(name, input, options);
  }

  return Object.freeze(instrumented);
}
