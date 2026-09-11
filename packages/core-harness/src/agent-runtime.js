import { invariant, requireText } from "./contracts.js";
import { AgentEventKind, createAgentEventStore } from "./agent-events.js";
import {
  contextBlockView,
  defineContextBlock,
  defineContextPolicy,
  defineContextSelection,
  renderAgentContext
} from "./context.js";
import { defineJudgment, judgmentView } from "./judgment.js";
import {
  ResourceLifetime,
  createResourceRegistry,
  defineResource,
  defineResourcePolicy
} from "./resource.js";
import { TraceSpanKind, createTraceRecorder } from "./tracing.js";
import { CapabilityBudgetExceededError } from "./variation.js";

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
  agentEventStore = createAgentEventStore(),
  contextBlocks = [],
  contextPolicy = {},
  resources = [],
  resourceRegistry = null,
  resourcePolicy = {},
  resourceAuthorize = null,
  tracer = createTraceRecorder()
}) {
  invariant(strategy && typeof strategy.run === "function", "agent runtime requires strategy.run()");
  invariant(agentEventStore && typeof agentEventStore.newCallId === "function", "agent runtime event store requires newCallId()");
  invariant(typeof agentEventStore.record === "function", "agent runtime event store requires record()");
  invariant(typeof agentEventStore.events === "function", "agent runtime event store requires events()");
  invariant(tracer && typeof tracer.runSpan === "function", "agent runtime tracer requires runSpan()");
  invariant(typeof tracer.current === "function", "agent runtime tracer requires current()");
  invariant(typeof tracer.spans === "function", "agent runtime tracer requires spans()");
  invariant(typeof tracer.failures === "function", "agent runtime tracer requires failures()");

  const traceSurface = Object.freeze({
    runSpan: tracer.runSpan,
    current: tracer.current
  });

  const resolvedResourceRegistry = resourceRegistry ?? createResourceRegistry({
    policy: defineResourcePolicy(resourcePolicy),
    authorize: resourceAuthorize
  });
  invariant(resolvedResourceRegistry && typeof resolvedResourceRegistry.register === "function", "agent runtime resource registry requires register()");
  invariant(typeof resolvedResourceRegistry.refs === "function", "agent runtime resource registry requires refs()");
  invariant(typeof resolvedResourceRegistry.describe === "function", "agent runtime resource registry requires describe()");
  invariant(typeof resolvedResourceRegistry.invoke === "function", "agent runtime resource registry requires invoke()");
  invariant(typeof resolvedResourceRegistry.revoke === "function", "agent runtime resource registry requires revoke()");
  invariant(typeof resolvedResourceRegistry.closeCall === "function", "agent runtime resource registry requires closeCall()");
  invariant(typeof resolvedResourceRegistry.policy === "function", "agent runtime resource registry requires policy()");

  const baseResourceRefs = new Map();
  const baseResourceNames = new Set();
  for (const definition of resources) {
    const resource = defineResource(definition);
    invariant(resource.lifetime === ResourceLifetime.AGENT, `runtime resource ${resource.name} must use AGENT lifetime`);
    invariant(!baseResourceNames.has(resource.name), `duplicate resource: ${resource.name}`);
    const ref = resolvedResourceRegistry.register(resource);
    baseResourceNames.add(resource.name);
    baseResourceRefs.set(ref.id, ref);
  }

  const resolvedContextPolicy = defineContextPolicy(contextPolicy);
  const baseContextBlocks = new Map();
  for (const definition of contextBlocks) {
    const block = defineContextBlock(definition);
    invariant(!baseContextBlocks.has(block.name), `duplicate context block: ${block.name}`);
    baseContextBlocks.set(block.name, block);
  }

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
    for (const blockName of judgment.context.blocks) {
      invariant(baseContextBlocks.has(blockName), `judgment ${judgment.name} references unknown context block: ${blockName}`);
    }
    baseJudgments.set(judgment.name, judgment);
  }

  function activeBaseResourceRefs() {
    const activeIds = new Set(
      resolvedResourceRegistry.refs({ lifetime: ResourceLifetime.AGENT }).map((ref) => ref.id)
    );
    return Object.freeze([...baseResourceRefs.values()]
      .filter((ref) => activeIds.has(ref.id))
      .map((ref) => clone(ref)));
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

  function normalizeCallResources(scopedResources = []) {
    invariant(Array.isArray(scopedResources), "agent run resources must be an array");
    const names = new Set();
    return scopedResources.map((definition) => {
      const resource = defineResource(definition);
      invariant(resource.lifetime === ResourceLifetime.CALL, `scoped resource ${resource.name} must use CALL lifetime`);
      invariant(!baseResourceNames.has(resource.name), `scoped resource cannot shadow runtime resource: ${resource.name}`);
      invariant(!names.has(resource.name), `duplicate scoped resource: ${resource.name}`);
      names.add(resource.name);
      return resource;
    });
  }

  function recordRuntimeEvent(type, callId, judgment, payload) {
    return agentEventStore.record(type, {
      callId,
      judgment,
      payload
    });
  }

  async function executeRunWithStrategy(selectedStrategy, {
    input = null,
    context = null,
    events = [],
    contextSelection = null,
    capabilities: scopedCapabilities = [],
    resources: scopedResources = [],
    budget = null,
    onCapabilityInvoke = null
  } = {}, runtimeContract = {}) {
    invariant(selectedStrategy && typeof selectedStrategy.run === "function", "agent run strategy requires run()");
    const resolved = resolveCapabilities(scopedCapabilities);
    const resolvedCallResources = normalizeCallResources(scopedResources);
    const runInput = clone(input);
    const runContext = clone(context);
    const runEvents = clone(events) ?? [];
    const maxCapabilityCalls = budget?.maxCapabilityCalls ?? null;
    const judgment = runtimeContract.judgment ?? null;
    const callId = requireText(runtimeContract.callId, "agent run callId");
    const priorAgentEvents = agentEventStore.events();
    const resolvedSelection = runtimeContract.contextSelection ?? defineContextSelection(contextSelection ?? {});
    const callResourceRefs = [];

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

    recordRuntimeEvent(AgentEventKind.TASK, callId, judgment, { input: runInput });

    try {
      for (const resource of resolvedCallResources) {
        callResourceRefs.push(resolvedResourceRegistry.register(resource, { callId }));
      }

      const promptContext = await renderAgentContext({
        blocks: [...baseContextBlocks.values()],
        selection: resolvedSelection,
        policy: resolvedContextPolicy,
        canonicalEvents: priorAgentEvents,
        callId,
        judgment
      });

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

        return tracer.runSpan(
          TraceSpanKind.CAPABILITY,
          capability.name,
          async () => {
            const parsedInput = capability.parseInput
              ? capability.parseInput(clone(payload))
              : clone(payload);

            const output = await capability.execute(parsedInput, Object.freeze({
              input: clone(runInput),
              context: clone(runContext)
            }));

            return capability.parseOutput ? capability.parseOutput(output) : output;
          },
          {
            callId,
            attributes: {
              index: capabilityCalls,
              mutatesCandidate: capability.mutatesCandidate
            }
          }
        );
      }

      async function describeResource(ref) {
        return tracer.runSpan(
          TraceSpanKind.RESOURCE_DESCRIBE,
          ref?.name ?? "resource.describe",
          () => resolvedResourceRegistry.describe(ref, { callId }),
          { callId, attributes: { resourceId: ref?.id ?? null } }
        );
      }

      async function invokeResource(ref, operationName, payload = null) {
        return tracer.runSpan(
          TraceSpanKind.RESOURCE,
          `${ref?.name ?? "resource"}.${operationName}`,
          () => resolvedResourceRegistry.invoke(ref, operationName, payload, {
            callId,
            input: runInput,
            context: runContext
          }),
          {
            callId,
            attributes: {
              resourceId: ref?.id ?? null,
              operation: operationName
            }
          }
        );
      }

      function recordAgentEvent(type, payload = null) {
        invariant(
          type === AgentEventKind.MODEL_OUTPUT ||
            type === AgentEventKind.VALIDATION_ERROR ||
            type === AgentEventKind.ACTION_OUTPUT ||
            type === AgentEventKind.ACTION_ERROR,
          "strategy may only record MODEL_OUTPUT or VALIDATION_ERROR working events; CodeAct may additionally record ACTION_OUTPUT or ACTION_ERROR"
        );
        return recordRuntimeEvent(type, callId, judgment, payload);
      }

      const selectedAgentEvents = promptContext.history.mode === "EVENTS"
        ? promptContext.history.events
        : Object.freeze([]);
      const visibleResourceRefs = Object.freeze([
        ...activeBaseResourceRefs(),
        ...callResourceRefs.map((ref) => clone(ref))
      ]);

      const strategyName = selectedStrategy.kind ?? selectedStrategy.name ?? "strategy";
      const result = await tracer.runSpan(
        TraceSpanKind.STRATEGY,
        strategyName,
        () => selectedStrategy.run(Object.freeze({
          input: runInput,
          context: runContext,
          callContext: runContext,
          promptContext,
          events: runEvents,
          agentEvents: selectedAgentEvents,
          history: promptContext.history,
          callId,
          recordAgentEvent,
          capabilities: Object.freeze([...resolved.values()].map(capabilityView)),
          invoke,
          resources: visibleResourceRefs,
          describeResource,
          invokeResource,
          judgment,
          validateResult: runtimeContract.validateResult ?? null,
          trace: traceSurface
        })),
        {
          callId,
          attributes: { judgment: judgment?.name ?? null }
        }
      );

      return Object.freeze({
        result,
        callId,
        usage: Object.freeze({
          capabilityCalls,
          budgetExhausted,
          maxCapabilityCalls
        }),
        promptContext: clone(promptContext)
      });
    } catch (error) {
      recordRuntimeEvent(AgentEventKind.ERROR, callId, judgment, { error: errorView(error) });
      throw error;
    } finally {
      resolvedResourceRegistry.closeCall(callId);
    }
  }

  async function executeRun(options = {}) {
    const callId = agentEventStore.newCallId();
    return tracer.runSpan(
      TraceSpanKind.AGENT_RUN,
      "agent.run",
      async () => {
        const report = await executeRunWithStrategy(strategy, options, { callId });
        recordRuntimeEvent(AgentEventKind.RESULT, report.callId, null, { result: report.result });
        return report;
      },
      { callId }
    );
  }

  async function executeJudgment(name, input, options = {}) {
    requireText(name, "judgment name");
    const judgment = baseJudgments.get(name);
    invariant(judgment, `judgment not found: ${name}`);
    const callId = agentEventStore.newCallId();

    return tracer.runSpan(
      TraceSpanKind.JUDGMENT,
      name,
      async () => {
        const parsedInput = judgment.parseInput
          ? judgment.parseInput(clone(input))
          : clone(input);

        let accepted = null;
        const validateResult = judgment.parseOutput
          ? (value) => {
              const parsed = judgment.parseOutput(value);
              accepted = { raw: value, parsed };
              return parsed;
            }
          : null;

        const report = await executeRunWithStrategy(
          judgment.strategy ?? strategy,
          { ...options, input: parsedInput },
          {
            callId,
            judgment: judgmentView(judgment),
            validateResult,
            contextSelection: judgment.context
          }
        );

        let parsedOutput;
        try {
          parsedOutput = judgment.parseOutput
            ? accepted && Object.is(report.result, accepted.raw)
              ? accepted.parsed
              : judgment.parseOutput(report.result)
            : report.result;
        } catch (error) {
          recordRuntimeEvent(AgentEventKind.ERROR, report.callId, judgmentView(judgment), { error: errorView(error) });
          throw error;
        }

        recordRuntimeEvent(AgentEventKind.RESULT, report.callId, judgmentView(judgment), { result: parsedOutput });

        return Object.freeze({
          result: parsedOutput,
          callId: report.callId,
          usage: report.usage,
          judgment: judgmentView(judgment),
          promptContext: clone(report.promptContext)
        });
      },
      { callId, attributes: { judgment: name } }
    );
  }

  return Object.freeze({
    capabilities() {
      return Object.freeze([...baseCapabilities.values()].map(capabilityView));
    },

    judgments() {
      return Object.freeze([...baseJudgments.values()].map(judgmentView));
    },

    contextBlocks() {
      return Object.freeze([...baseContextBlocks.values()].map(contextBlockView));
    },

    contextPolicy() {
      return clone(resolvedContextPolicy);
    },

    resourceRefs() {
      return activeBaseResourceRefs();
    },

    resourcePolicy() {
      return clone(resolvedResourceRegistry.policy());
    },

    describeResource(ref) {
      return tracer.runSpan(
        TraceSpanKind.RESOURCE_DESCRIBE,
        ref?.name ?? "resource.describe",
        () => resolvedResourceRegistry.describe(ref),
        { attributes: { resourceId: ref?.id ?? null } }
      );
    },

    invokeResource(ref, operationName, payload = null) {
      return tracer.runSpan(
        TraceSpanKind.RESOURCE,
        `${ref?.name ?? "resource"}.${operationName}`,
        () => resolvedResourceRegistry.invoke(ref, operationName, payload),
        { attributes: { resourceId: ref?.id ?? null, operation: operationName } }
      );
    },

    revokeResource(ref) {
      return resolvedResourceRegistry.revoke(ref);
    },

    agentEvents() {
      return agentEventStore.events();
    },

    traces() {
      return tracer.spans();
    },

    traceFailures() {
      return tracer.failures();
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
