import { invariant, requireText } from "./contracts.js";
import { AgentEventKind, createAgentEventStore } from "./agent-events.js";
import { defineJudgment, judgmentView } from "./judgment.js";
import { CapabilityBudgetExceededError } from "./variation.js";

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function safeClone(value) {
  try {
    return clone(value);
  } catch {
    return value == null ? null : { unavailable: true, type: typeof value };
  }
}

function errorPayload(error) {
  return Object.freeze({
    name: error?.name ?? "Error",
    code: error?.code ?? null,
    message: error?.message ?? String(error)
  });
}

function normalizeCapability(definition) {
  invariant(definition && typeof definition === "object", "capability definition is required");
  const name = requireText(definition.name, "capability.name");
  invariant(typeof definition.execute === "function", `capability ${name} requires execute()`);

  if (definition.parseInput != null) {
    invariant(typeof definition.parseInput === "function", `capability ${name} parseInput must be a function`);
  }
  if (definition.parseOutput != null) {
    invariant(typeof definition.parseOutput === "function", `capability ${name} parseOutput must be a function`);
  }

  return Object.freeze({
    name,
    description: definition.description ?? null,
    mutatesCandidate: definition.mutatesCandidate === true,
    parseInput: definition.parseInput ?? null,
    parseOutput: definition.parseOutput ?? null,
    execute: definition.execute
  });
}

function capabilityView(capability) {
  return Object.freeze({
    name: capability.name,
    description: capability.description,
    mutatesCandidate: capability.mutatesCandidate
  });
}

export function defineCapability(definition) {
  return normalizeCapability(definition);
}

export function createAgentRuntime({
  strategy,
  capabilities = [],
  judgments = [],
  agentEventStore = null,
  clock,
  idFactory
}) {
  invariant(strategy && typeof strategy.run === "function", "agent runtime requires strategy.run()");
  if (agentEventStore != null) {
    invariant(typeof agentEventStore.newCallId === "function", "agentEventStore requires newCallId()");
    invariant(typeof agentEventStore.record === "function", "agentEventStore requires record()");
    invariant(typeof agentEventStore.events === "function", "agentEventStore requires events()");
  }
  const workingHistory = agentEventStore ?? createAgentEventStore({ clock, idFactory });

  const baseCapabilities = new Map();
  for (const definition of capabilities) {
    const capability = normalizeCapability(definition);
    invariant(!baseCapabilities.has(capability.name), `duplicate capability: ${capability.name}`);
    baseCapabilities.set(capability.name, capability);
  }

  const baseJudgments = new Map();
  for (const definition of judgments) {
    const judgment = defineJudgment(definition);
    invariant(!baseJudgments.has(judgment.name), `duplicate judgment: ${judgment.name}`);
    baseJudgments.set(judgment.name, judgment);
  }

  function resolveCapabilities(scopedCapabilities = []) {
    const resolved = new Map(baseCapabilities);

    for (const definition of scopedCapabilities) {
      const capability = normalizeCapability(definition);
      invariant(!resolved.has(capability.name), `duplicate capability: ${capability.name}`);
      resolved.set(capability.name, capability);
    }

    return resolved;
  }

  async function executeRunWithStrategy(selectedStrategy, {
    input = null,
    context = null,
    events = [],
    capabilities: scopedCapabilities = [],
    budget = null,
    onCapabilityInvoke = null
  } = {}, runtimeContract = {}) {
    invariant(selectedStrategy && typeof selectedStrategy.run === "function", "agent run strategy requires run()");
    const resolved = resolveCapabilities(scopedCapabilities);
    const runInput = clone(input);
    const runContext = clone(context);
    const runEvents = clone(events) ?? [];
    const judgment = runtimeContract.judgment ?? null;
    const maxCapabilityCalls = budget?.maxCapabilityCalls ?? null;
    const callId = workingHistory.newCallId();

    workingHistory.record(AgentEventKind.TASK, {
      callId,
      judgment,
      payload: {
        input: safeClone(runInput),
        externalEventCount: runEvents.length
      }
    });

    if (maxCapabilityCalls != null) {
      invariant(
        Number.isInteger(maxCapabilityCalls) && maxCapabilityCalls > 0,
        "agent run maxCapabilityCalls must be a positive integer"
      );
    }
    if (onCapabilityInvoke != null) {
      invariant(typeof onCapabilityInvoke === "function", "onCapabilityInvoke must be a function");
    }
    if (runtimeContract.validateResult != null) {
      invariant(typeof runtimeContract.validateResult === "function", "runtime validateResult must be a function");
    }

    let capabilityCalls = 0;
    let budgetExhausted = false;

    async function invoke(name, payload = null) {
      requireText(name, "capability name");
      const capability = resolved.get(name);
      invariant(capability, `capability not found: ${name}`);

      if (maxCapabilityCalls != null && capabilityCalls >= maxCapabilityCalls) {
        budgetExhausted = true;
        throw new CapabilityBudgetExceededError({
          maxCapabilityCalls,
          attemptedCapability: name
        });
      }

      capabilityCalls += 1;
      if (onCapabilityInvoke) {
        await onCapabilityInvoke(Object.freeze({
          index: capabilityCalls,
          name: capability.name,
          mutatesCandidate: capability.mutatesCandidate
        }));
      }

      const parsedInput = capability.parseInput
        ? capability.parseInput(clone(payload))
        : clone(payload);

      const output = await capability.execute(parsedInput, Object.freeze({
        input: clone(runInput),
        context: clone(runContext)
      }));

      return capability.parseOutput ? capability.parseOutput(output) : output;
    }

    function recordAgentEvent(type, payload = null) {
      return workingHistory.record(type, { callId, judgment, payload });
    }

    try {
      const rawResult = await selectedStrategy.run(Object.freeze({
        input: runInput,
        context: runContext,
        events: runEvents,
        agentEvents: workingHistory.events(),
        capabilities: Object.freeze([...resolved.values()].map(capabilityView)),
        invoke,
        judgment,
        validateResult: runtimeContract.validateResult ?? null,
        recordAgentEvent
      }));

      let result = rawResult;
      if (runtimeContract.validateResult) {
        try {
          result = runtimeContract.validateResult(rawResult);
        } catch (error) {
          recordAgentEvent(AgentEventKind.VALIDATION_ERROR, {
            rejectedOutput: safeClone(rawResult),
            error: errorPayload(error)
          });
          throw error;
        }
      }

      recordAgentEvent(AgentEventKind.RESULT, { result: safeClone(result) });
      return Object.freeze({
        result,
        callId,
        usage: Object.freeze({
          capabilityCalls,
          budgetExhausted,
          maxCapabilityCalls
        })
      });
    } catch (error) {
      recordAgentEvent(AgentEventKind.ERROR, { error: errorPayload(error) });
      throw error;
    }
  }

  async function executeRun(options = {}) {
    return executeRunWithStrategy(strategy, options);
  }

  async function executeJudgment(name, input, options = {}) {
    requireText(name, "judgment name");
    const judgment = baseJudgments.get(name);
    invariant(judgment, `judgment not found: ${name}`);

    const parsedInput = judgment.parseInput
      ? judgment.parseInput(clone(input))
      : clone(input);

    let accepted = null;
    const validateResult = judgment.parseOutput
      ? (value) => {
          if (accepted && Object.is(value, accepted.raw)) return accepted.parsed;
          const parsed = judgment.parseOutput(value);
          accepted = { raw: value, parsed };
          return parsed;
        }
      : null;

    const report = await executeRunWithStrategy(
      judgment.strategy ?? strategy,
      { ...options, input: parsedInput },
      {
        judgment: judgmentView(judgment),
        validateResult
      }
    );

    return Object.freeze({
      result: report.result,
      callId: report.callId,
      usage: report.usage,
      judgment: judgmentView(judgment)
    });
  }

  return Object.freeze({
    capabilities() {
      return Object.freeze([...baseCapabilities.values()].map(capabilityView));
    },

    judgments() {
      return Object.freeze([...baseJudgments.values()].map(judgmentView));
    },

    agentEvents() {
      return workingHistory.events();
    },

    async run(options = {}) {
      return (await executeRun(options)).result;
    },

    runWithReport: executeRun,

    async invokeJudgment(name, input, options = {}) {
      return (await executeJudgment(name, input, options)).result;
    },

    invokeJudgmentWithReport: executeJudgment
  });
}
