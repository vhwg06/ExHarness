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
  createModelRegistry,
  defineModelSelector,
  resolveModelRoute,
  selectModelRoute,
  ModelRouteScope
} from "./model-routing.js";
import {
  ResourceLifetime,
  createResourceRegistry,
  defineResource,
  defineResourcePolicy
} from "./resource.js";
import {
  createLiveObjectRegistry,
  defineLiveObject,
  defineLiveObjectPolicy
} from "./live-object.js";
import { TraceSpanKind, createNoopTracer } from "./tracing.js";
import { TurnOutcome, createTurnEventStore } from "./turn-events.js";
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
  turnEventStore = createTurnEventStore(),
  contextBlocks = [],
  contextPolicy = {},
  models = [],
  model = null,
  modelRegistry = null,
  resources = [],
  resourceRegistry = null,
  resourcePolicy = {},
  resourceAuthorize = null,
  liveObjects = [],
  liveObjectRegistry = null,
  liveObjectPolicy = {},
  liveObjectAuthorize = null,
  tracer = createNoopTracer()
}) {
  invariant(strategy && typeof strategy.run === "function", "agent runtime requires strategy.run()");
  invariant(agentEventStore && typeof agentEventStore.newCallId === "function", "agent runtime event store requires newCallId()");
  invariant(typeof agentEventStore.record === "function", "agent runtime event store requires record()");
  invariant(typeof agentEventStore.events === "function", "agent runtime event store requires events()");
  invariant(turnEventStore && typeof turnEventStore.begin === "function", "agent runtime turn event store requires begin()");
  invariant(typeof turnEventStore.end === "function", "agent runtime turn event store requires end()");
  invariant(typeof turnEventStore.hasActive === "function", "agent runtime turn event store requires hasActive()");
  invariant(typeof turnEventStore.events === "function", "agent runtime turn event store requires events()");
  invariant(tracer && typeof tracer.runSpan === "function", "agent runtime tracer requires runSpan()");
  invariant(typeof tracer.current === "function", "agent runtime tracer requires current()");
  invariant(typeof tracer.spans === "function", "agent runtime tracer requires spans()");
  invariant(typeof tracer.failures === "function", "agent runtime tracer requires failures()");

  const runtimeModel = defineModelSelector(model, "runtime model");
  const resolvedModelRegistry = modelRegistry ?? createModelRegistry({ models });
  invariant(resolvedModelRegistry && typeof resolvedModelRegistry.resolve === "function", "agent runtime model registry requires resolve()");
  invariant(typeof resolvedModelRegistry.registrations === "function", "agent runtime model registry requires registrations()");
  invariant(typeof resolvedModelRegistry.loaded === "function", "agent runtime model registry requires loaded()");

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

  const sharedRegistryId = typeof resolvedResourceRegistry.registryId === "string" && resolvedResourceRegistry.registryId.length > 0
    ? resolvedResourceRegistry.registryId
    : null;
  const resolvedLiveObjectRegistry = liveObjectRegistry ?? createLiveObjectRegistry({
    ...(sharedRegistryId == null ? {} : { registryId: sharedRegistryId }),
    policy: defineLiveObjectPolicy(liveObjectPolicy),
    authorize: liveObjectAuthorize
  });
  invariant(resolvedLiveObjectRegistry && typeof resolvedLiveObjectRegistry.expose === "function", "agent runtime live object registry requires expose()");
  invariant(typeof resolvedLiveObjectRegistry.refs === "function", "agent runtime live object registry requires refs()");
  invariant(typeof resolvedLiveObjectRegistry.describe === "function", "agent runtime live object registry requires describe()");
  invariant(typeof resolvedLiveObjectRegistry.invoke === "function", "agent runtime live object registry requires invoke()");
  invariant(typeof resolvedLiveObjectRegistry.read === "function", "agent runtime live object registry requires read()");
  invariant(typeof resolvedLiveObjectRegistry.revoke === "function", "agent runtime live object registry requires revoke()");
  invariant(typeof resolvedLiveObjectRegistry.closeCall === "function", "agent runtime live object registry requires closeCall()");
  invariant(typeof resolvedLiveObjectRegistry.policy === "function", "agent runtime live object registry requires policy()");
  if (sharedRegistryId != null && resolvedLiveObjectRegistry.registryId != null) {
    invariant(
      resolvedLiveObjectRegistry.registryId === sharedRegistryId,
      "agent runtime live object registry must share the declared resource registryId authority domain"
    );
  }

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

  const baseLiveObjects = new Map();
  for (const definition of liveObjects) {
    const liveObject = defineLiveObject(definition);
    invariant(liveObject.lifetime === ResourceLifetime.AGENT, `runtime live object ${liveObject.name} must use AGENT lifetime`);
    invariant(!baseLiveObjects.has(liveObject.name), `duplicate live object: ${liveObject.name}`);
    const ref = resolvedLiveObjectRegistry.expose(liveObject.value, liveObject.surface);
    baseLiveObjects.set(liveObject.name, Object.freeze({ name: liveObject.name, ref }));
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

  function activeBaseLiveObjects() {
    const activeIds = new Set(
      resolvedLiveObjectRegistry.refs({ lifetime: ResourceLifetime.AGENT }).map((ref) => ref.id)
    );
    return Object.freeze([...baseLiveObjects.values()]
      .filter((entry) => activeIds.has(entry.ref.id))
      .map((entry) => Object.freeze({ name: entry.name, ref: clone(entry.ref) })));
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

  function normalizeCallLiveObjects(scopedLiveObjects = []) {
    invariant(Array.isArray(scopedLiveObjects), "agent run liveObjects must be an array");
    const names = new Set();
    return scopedLiveObjects.map((definition) => {
      const liveObject = defineLiveObject(definition);
      invariant(liveObject.lifetime === ResourceLifetime.CALL, `scoped live object ${liveObject.name} must use CALL lifetime`);
      invariant(!baseLiveObjects.has(liveObject.name), `scoped live object cannot shadow runtime live object: ${liveObject.name}`);
      invariant(!names.has(liveObject.name), `duplicate scoped live object: ${liveObject.name}`);
      names.add(liveObject.name);
      return liveObject;
    });
  }

  function recordRuntimeEvent(type, callId, judgment, payload) {
    return agentEventStore.record(type, {
      callId,
      judgment,
      payload
    });
  }

  async function resolveRunModel(selectedStrategy, invocationModel, judgmentModel) {
    const route = selectModelRoute({
      invocation: invocationModel,
      judgment: judgmentModel,
      runtime: runtimeModel
    });

    if (route != null) {
      invariant(
        selectedStrategy.acceptsRoutedModel === true,
        `strategy ${selectedStrategy.kind ?? selectedStrategy.name ?? "strategy"} does not support model routing`
      );
      return resolveModelRoute(resolvedModelRegistry, route);
    }

    if (selectedStrategy.acceptsRoutedModel === true && selectedStrategy.model != null) {
      return Object.freeze({
        scope: ModelRouteScope.STRATEGY,
        requested: null,
        adapter: null,
        provenance: Object.freeze({
          scope: ModelRouteScope.STRATEGY,
          requested: null,
          adapter: clone(selectedStrategy.model)
        }),
        usage: null
      });
    }

    return null;
  }

  async function executeRunWithStrategy(selectedStrategy, {
    input = null,
    context = null,
    events = [],
    contextSelection = null,
    capabilities: scopedCapabilities = [],
    resources: scopedResources = [],
    liveObjects: scopedLiveObjects = [],
    model: invocationModel = null,
    budget = null,
    onCapabilityInvoke = null
  } = {}, runtimeContract = {}) {
    invariant(selectedStrategy && typeof selectedStrategy.run === "function", "agent run strategy requires run()");
    const resolved = resolveCapabilities(scopedCapabilities);
    const resolvedCallResources = normalizeCallResources(scopedResources);
    const resolvedCallLiveObjects = normalizeCallLiveObjects(scopedLiveObjects);
    const runInput = clone(input);
    const runContext = clone(context);
    const runEvents = clone(events) ?? [];
    const maxCapabilityCalls = budget?.maxCapabilityCalls ?? null;
    const judgment = runtimeContract.judgment ?? null;
    const callId = requireText(runtimeContract.callId, "agent run callId");
    const priorAgentEvents = agentEventStore.events();
    const resolvedSelection = runtimeContract.contextSelection ?? defineContextSelection(contextSelection ?? {});
    const turnAwareContext = selectedStrategy.turnAwareContext === true;
    let resolvedModelRoute = null;
    let latestPromptContext = null;
    const callResourceRefs = [];
    const callLiveObjectEntries = [];

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
      resolvedModelRoute = await resolveRunModel(selectedStrategy, invocationModel, runtimeContract.model ?? null);
      for (const resource of resolvedCallResources) {
        callResourceRefs.push(resolvedResourceRegistry.register(resource, { callId }));
      }
      for (const liveObject of resolvedCallLiveObjects) {
        const ref = resolvedLiveObjectRegistry.expose(liveObject.value, liveObject.surface, {
          lifetime: ResourceLifetime.CALL,
          callId
        });
        callLiveObjectEntries.push(Object.freeze({ name: liveObject.name, ref }));
      }

      if (!turnAwareContext) {
        latestPromptContext = await renderAgentContext({
          blocks: [...baseContextBlocks.values()],
          selection: resolvedSelection,
          policy: resolvedContextPolicy,
          canonicalEvents: priorAgentEvents,
          callId,
          judgment
        });
      }

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

      async function describeLiveObject(ref) {
        return tracer.runSpan(
          TraceSpanKind.LIVE_OBJECT_DESCRIBE,
          ref?.surfaceId ?? "live-object.describe",
          () => resolvedLiveObjectRegistry.describe(ref, { callId }),
          { callId, attributes: { liveObjectRefId: ref?.id ?? null, surfaceId: ref?.surfaceId ?? null } }
        );
      }

      async function invokeLiveObject(ref, methodName, args = []) {
        return tracer.runSpan(
          TraceSpanKind.LIVE_OBJECT,
          `${ref?.surfaceId ?? "live-object"}.${methodName}`,
          () => resolvedLiveObjectRegistry.invoke(ref, methodName, args, {
            callId,
            input: runInput,
            context: runContext
          }),
          {
            callId,
            attributes: {
              liveObjectRefId: ref?.id ?? null,
              surfaceId: ref?.surfaceId ?? null,
              member: methodName,
              action: "INVOKE"
            }
          }
        );
      }

      async function readLiveObject(ref, propertyName) {
        return tracer.runSpan(
          TraceSpanKind.LIVE_OBJECT,
          `${ref?.surfaceId ?? "live-object"}.${propertyName}`,
          () => resolvedLiveObjectRegistry.read(ref, propertyName, {
            callId,
            input: runInput,
            context: runContext
          }),
          {
            callId,
            attributes: {
              liveObjectRefId: ref?.id ?? null,
              surfaceId: ref?.surfaceId ?? null,
              member: propertyName,
              action: "READ"
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

      function contextProjection(promptContext) {
        return Object.freeze({
          promptContext,
          agentEvents: promptContext?.history?.mode === "EVENTS"
            ? promptContext.history.events
            : Object.freeze([]),
          history: promptContext?.history ?? null
        });
      }

      function currentTurnHistoryEvents() {
        return agentEventStore.events().filter((event) => !(
          event.callId === callId && event.type === AgentEventKind.TASK
        ));
      }

      const initialProjection = latestPromptContext == null
        ? Object.freeze({ promptContext: null, agentEvents: Object.freeze([]), history: null })
        : contextProjection(latestPromptContext);
      const visibleResourceRefs = Object.freeze([
        ...activeBaseResourceRefs(),
        ...callResourceRefs.map((ref) => clone(ref))
      ]);
      const visibleLiveObjects = Object.freeze([
        ...activeBaseLiveObjects(),
        ...callLiveObjectEntries.map((entry) => Object.freeze({ name: entry.name, ref: clone(entry.ref) }))
      ]);
      const modelRouteView = resolvedModelRoute?.provenance ?? null;
      const strategyName = selectedStrategy.kind ?? selectedStrategy.name ?? "strategy";
      let modelInFlight = false;
      let preparedForModel = false;

      function closeActiveTurn(outcome, final, error = null, payload = null) {
        if (!turnEventStore.hasActive(callId)) return null;
        preparedForModel = false;
        return turnEventStore.end({
          callId,
          judgment,
          outcome,
          final,
          error,
          payload: {
            strategy: strategyName,
            ...(payload == null ? {} : payload)
          }
        });
      }

      function beginTurn({ reportedTurn = null, model = null } = {}) {
        invariant(!modelInFlight, "cannot prepare a turn while a model generation is active");
        invariant(!preparedForModel, "a model turn is already prepared for this invocation");
        closeActiveTurn(TurnOutcome.CONTINUE, false, null, {
          nextModel: model?.name ?? null
        });
        const before = turnEventStore.begin({
          callId,
          judgment,
          payload: {
            strategy: strategyName,
            model: model ?? modelRouteView?.adapter ?? null,
            reportedTurn
          }
        });
        preparedForModel = true;
        return before;
      }

      async function prepareTurn({ reportedTurn = null, model = null } = {}) {
        const before = beginTurn({ reportedTurn, model });
        try {
          latestPromptContext = await renderAgentContext({
            blocks: [...baseContextBlocks.values()],
            selection: resolvedSelection,
            policy: resolvedContextPolicy,
            canonicalEvents: currentTurnHistoryEvents(),
            callId,
            judgment,
            turn: before.turn
          });
          return contextProjection(latestPromptContext);
        } catch (error) {
          closeActiveTurn(TurnOutcome.ERROR, true, errorView(error), {
            stage: "CONTEXT_RENDER"
          });
          throw error;
        }
      }

      const turnTraceSurface = Object.freeze({
        current: tracer.current,
        async runSpan(kind, name, operation, options = {}) {
          if (kind !== TraceSpanKind.MODEL) {
            return tracer.runSpan(kind, name, operation, options);
          }

          invariant(!modelInFlight, "concurrent model turns are not supported in one agent invocation");
          const attributes = options?.attributes ?? null;
          if (!preparedForModel) {
            beginTurn({
              reportedTurn: attributes?.turn ?? attributes?.attempt ?? null,
              model: attributes?.model ?? modelRouteView?.adapter ?? { name, version: null }
            });
          }
          invariant(turnEventStore.hasActive(callId), "model generation requires an active turn");
          preparedForModel = false;

          modelInFlight = true;
          try {
            return await tracer.runSpan(kind, name, operation, options);
          } catch (error) {
            closeActiveTurn(TurnOutcome.ERROR, true, errorView(error), { model: name });
            throw error;
          } finally {
            modelInFlight = false;
          }
        }
      });

      const result = await tracer.runSpan(
        TraceSpanKind.STRATEGY,
        strategyName,
        async () => {
          try {
            const value = await selectedStrategy.run(Object.freeze({
              input: runInput,
              context: runContext,
              callContext: runContext,
              promptContext: initialProjection.promptContext,
              events: runEvents,
              agentEvents: initialProjection.agentEvents,
              history: initialProjection.history,
              callId,
              recordAgentEvent,
              prepareTurn: turnAwareContext ? prepareTurn : null,
              capabilities: Object.freeze([...resolved.values()].map(capabilityView)),
              invoke,
              resources: visibleResourceRefs,
              describeResource,
              invokeResource,
              liveObjects: visibleLiveObjects,
              describeLiveObject,
              invokeLiveObject,
              readLiveObject,
              judgment,
              validateResult: runtimeContract.validateResult ?? null,
              model: resolvedModelRoute?.adapter ?? null,
              modelRoute: modelRouteView,
              trace: turnTraceSurface
            }));
            closeActiveTurn(TurnOutcome.RESULT, true, null, { result: true });
            return value;
          } catch (error) {
            closeActiveTurn(TurnOutcome.ERROR, true, errorView(error));
            throw error;
          }
        },
        {
          callId,
          attributes: { judgment: judgment?.name ?? null, modelRoute: modelRouteView }
        }
      );
      const modelUsage = typeof resolvedModelRoute?.usage === "function"
        ? resolvedModelRoute.usage()
        : null;

      return Object.freeze({
        result,
        callId,
        usage: Object.freeze({
          capabilityCalls,
          budgetExhausted,
          maxCapabilityCalls
        }),
        promptContext: clone(latestPromptContext),
        modelRoute: clone(modelRouteView),
        modelUsage: clone(modelUsage)
      });
    } catch (error) {
      recordRuntimeEvent(AgentEventKind.ERROR, callId, judgment, { error: errorView(error) });
      throw error;
    } finally {
      resolvedResourceRegistry.closeCall(callId);
      resolvedLiveObjectRegistry.closeCall(callId);
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
            model: judgment.model,
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
          promptContext: clone(report.promptContext),
          modelRoute: clone(report.modelRoute),
          modelUsage: clone(report.modelUsage)
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

    modelRouting() {
      return Object.freeze({
        default: clone(runtimeModel),
        registered: resolvedModelRegistry.registrations(),
        loaded: resolvedModelRegistry.loaded()
      });
    },

    resourceRefs() {
      return activeBaseResourceRefs();
    },

    resourcePolicy() {
      return clone(resolvedResourceRegistry.policy());
    },

    describeResource(ref) {
      return resolvedResourceRegistry.describe(ref);
    },

    invokeResource(ref, operationName, payload = null) {
      return resolvedResourceRegistry.invoke(ref, operationName, payload);
    },

    revokeResource(ref) {
      return resolvedResourceRegistry.revoke(ref);
    },

    liveObjects() {
      return activeBaseLiveObjects();
    },

    liveObjectPolicy() {
      return clone(resolvedLiveObjectRegistry.policy());
    },

    describeLiveObject(ref) {
      return resolvedLiveObjectRegistry.describe(ref);
    },

    invokeLiveObject(ref, methodName, args = []) {
      return resolvedLiveObjectRegistry.invoke(ref, methodName, args);
    },

    readLiveObject(ref, propertyName) {
      return resolvedLiveObjectRegistry.read(ref, propertyName);
    },

    revokeLiveObject(ref) {
      return resolvedLiveObjectRegistry.revoke(ref);
    },

    agentEvents() {
      return agentEventStore.events();
    },

    turnEvents() {
      return turnEventStore.events();
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
