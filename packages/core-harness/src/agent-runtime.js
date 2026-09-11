import { invariant, requireText } from "./contracts.js";
import { CapabilityBudgetExceededError } from "./variation.js";

function clone(value) {
  return value == null ? value : structuredClone(value);
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

export function createAgentRuntime({ strategy, capabilities = [] }) {
  invariant(strategy && typeof strategy.run === "function", "agent runtime requires strategy.run()");

  const baseCapabilities = new Map();
  for (const definition of capabilities) {
    const capability = normalizeCapability(definition);
    invariant(!baseCapabilities.has(capability.name), `duplicate capability: ${capability.name}`);
    baseCapabilities.set(capability.name, capability);
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

  async function executeRun({
    input = null,
    context = null,
    events = [],
    capabilities: scopedCapabilities = [],
    budget = null,
    onCapabilityInvoke = null
  } = {}) {
    const resolved = resolveCapabilities(scopedCapabilities);
    const runInput = clone(input);
    const runContext = clone(context);
    const runEvents = clone(events) ?? [];
    const maxCapabilityCalls = budget?.maxCapabilityCalls ?? null;

    if (maxCapabilityCalls != null) {
      invariant(
        Number.isInteger(maxCapabilityCalls) && maxCapabilityCalls > 0,
        "agent run maxCapabilityCalls must be a positive integer"
      );
    }
    if (onCapabilityInvoke != null) {
      invariant(typeof onCapabilityInvoke === "function", "onCapabilityInvoke must be a function");
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

    const result = await strategy.run(Object.freeze({
      input: runInput,
      context: runContext,
      events: runEvents,
      capabilities: Object.freeze([...resolved.values()].map(capabilityView)),
      invoke
    }));

    return Object.freeze({
      result,
      usage: Object.freeze({
        capabilityCalls,
        budgetExhausted,
        maxCapabilityCalls
      })
    });
  }

  return Object.freeze({
    capabilities() {
      return Object.freeze([...baseCapabilities.values()].map(capabilityView));
    },

    async run(options = {}) {
      return (await executeRun(options)).result;
    },

    runWithReport: executeRun
  });
}
