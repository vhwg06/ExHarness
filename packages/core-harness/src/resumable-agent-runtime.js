import { invariant, requireText } from "./contracts.js";
import { createAgentEventStore } from "./agent-events.js";
import { createAgentRuntime, defineCapability } from "./agent-runtime.js";
import { defineContextBlock, defineContextPolicy } from "./context.js";
import { ExHarnessErrorCode, RuntimeSnapshotError } from "./errors.js";
import { defineJudgment } from "./judgment.js";
import { defineLiveObject, defineLiveObjectPolicy } from "./live-object.js";
import { createModelRegistry, defineModelSelector } from "./model-routing.js";
import { defineResource, defineResourcePolicy, ResourceLifetime } from "./resource.js";
import {
  RuntimeSnapshotPayloadMode,
  assertRuntimeSnapshotCompatible,
  createRuntimeConfigurationManifest,
  createRuntimeSnapshot,
  normalizeRuntimeSnapshot
} from "./runtime-snapshot.js";

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function strategyDescriptor(strategy) {
  if (strategy == null) return null;
  const model = strategy.model && typeof strategy.model === "object"
    ? Object.freeze({
        name: strategy.model.name ?? null,
        version: strategy.model.version ?? null
      })
    : null;
  return Object.freeze({
    kind: strategy.kind ?? null,
    name: strategy.name ?? null,
    acceptsRoutedModel: strategy.acceptsRoutedModel === true,
    model
  });
}

function snapshotJudgment(judgment) {
  return Object.freeze({
    ...judgment,
    strategy: strategyDescriptor(judgment.strategy)
  });
}

function resourceState(resources, runtime) {
  const activeNames = new Set(runtime.resourceRefs().map((ref) => ref.name));
  return resources.map((resource) => Object.freeze({
    name: resource.name,
    active: activeNames.has(resource.name)
  }));
}

function liveObjectState(liveObjects, runtime) {
  const activeNames = new Set(runtime.liveObjects().map((entry) => entry.name));
  return liveObjects.map((liveObject) => Object.freeze({
    name: liveObject.name,
    active: activeNames.has(liveObject.name)
  }));
}

function assertResourceStateNames(snapshot, resources) {
  const expected = [...resources.map((resource) => resource.name)].sort();
  const actual = [...snapshot.state.agentResources.map((item) => item.name)].sort();
  if (expected.length !== actual.length || expected.some((name, index) => name !== actual[index])) {
    throw new RuntimeSnapshotError(
      ExHarnessErrorCode.RUNTIME_SNAPSHOT_INCOMPATIBLE,
      "runtime snapshot resource state does not match configured resources",
      { expected, actual }
    );
  }
}

function assertLiveObjectStateNames(snapshot, liveObjects) {
  const expected = [...liveObjects.map((liveObject) => liveObject.name)].sort();
  const state = snapshot.state.agentLiveObjects ?? [];
  const actual = [...state.map((item) => item.name)].sort();
  if (expected.length !== actual.length || expected.some((name, index) => name !== actual[index])) {
    throw new RuntimeSnapshotError(
      ExHarnessErrorCode.RUNTIME_SNAPSHOT_INCOMPATIBLE,
      "runtime snapshot live object state does not match configured live objects",
      { expected, actual }
    );
  }
}

function applyResourceRestore(runtime, snapshot, resourceRebind) {
  const currentRefs = new Map(runtime.resourceRefs().map((ref) => [ref.name, ref]));
  for (const state of snapshot.state.agentResources) {
    const ref = currentRefs.get(state.name) ?? null;
    invariant(ref, `restored runtime resource ref is missing: ${state.name}`);
    if (!state.active) {
      runtime.revokeResource(ref);
      continue;
    }
    if (typeof resourceRebind !== "function") {
      throw new RuntimeSnapshotError(
        ExHarnessErrorCode.RUNTIME_SNAPSHOT_RESOURCE_REBIND_REQUIRED,
        `runtime snapshot requires explicit resource rebinding: ${state.name}`,
        { resource: state.name }
      );
    }
    const approved = resourceRebind(Object.freeze({
      name: state.name,
      ref: clone(ref),
      snapshotState: Object.freeze({ active: true })
    }));
    if (approved !== true) {
      throw new RuntimeSnapshotError(
        ExHarnessErrorCode.RUNTIME_SNAPSHOT_RESOURCE_REBIND_REQUIRED,
        `runtime snapshot resource rebinding was not approved: ${state.name}`,
        { resource: state.name }
      );
    }
  }
}

function applyLiveObjectRestore(runtime, snapshot, liveObjectRebind) {
  const current = new Map(runtime.liveObjects().map((entry) => [entry.name, entry.ref]));
  for (const state of snapshot.state.agentLiveObjects ?? []) {
    const ref = current.get(state.name) ?? null;
    invariant(ref, `restored runtime live object ref is missing: ${state.name}`);
    if (!state.active) {
      runtime.revokeLiveObject(ref);
      continue;
    }
    if (typeof liveObjectRebind !== "function") {
      throw new RuntimeSnapshotError(
        ExHarnessErrorCode.RUNTIME_SNAPSHOT_LIVE_OBJECT_REBIND_REQUIRED,
        `runtime snapshot requires explicit live object rebinding: ${state.name}`,
        { liveObject: state.name }
      );
    }
    const approved = liveObjectRebind(Object.freeze({
      name: state.name,
      ref: clone(ref),
      snapshotState: Object.freeze({ active: true })
    }));
    if (approved !== true) {
      throw new RuntimeSnapshotError(
        ExHarnessErrorCode.RUNTIME_SNAPSHOT_LIVE_OBJECT_REBIND_REQUIRED,
        `runtime snapshot live object rebinding was not approved: ${state.name}`,
        { liveObject: state.name }
      );
    }
  }
}

export function createResumableAgentRuntime({
  snapshot = null,
  runtimeCompatibilityTag = null,
  resourceRebind = null,
  liveObjectRebind = null,
  snapshotClock = () => new Date().toISOString(),
  agentEventStoreOptions = {},
  strategy,
  capabilities = [],
  judgments = [],
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
  tracer
} = {}) {
  invariant(strategy && typeof strategy.run === "function", "resumable agent runtime requires strategy.run()");
  invariant(typeof snapshotClock === "function", "runtime snapshot clock must be a function");
  invariant(agentEventStoreOptions && typeof agentEventStoreOptions === "object", "agentEventStoreOptions must be an object");
  invariant(!Object.prototype.hasOwnProperty.call(agentEventStoreOptions, "events"), "agentEventStoreOptions cannot override snapshot events");
  const resolvedCompatibilityTag = requireText(runtimeCompatibilityTag, "runtime compatibility tag");

  const restoredSnapshot = snapshot == null ? null : normalizeRuntimeSnapshot(snapshot);
  const normalizedCapabilities = capabilities.map(defineCapability);
  const normalizedBlocks = contextBlocks.map(defineContextBlock);
  const normalizedContextPolicy = defineContextPolicy(contextPolicy);
  const normalizedJudgments = judgments.map(defineJudgment);
  const normalizedResources = resources.map(defineResource);
  for (const resource of normalizedResources) {
    invariant(resource.lifetime === ResourceLifetime.AGENT, `resumable runtime resource ${resource.name} must use AGENT lifetime`);
  }
  const normalizedResourcePolicy = defineResourcePolicy(resourcePolicy);
  const normalizedLiveObjects = liveObjects.map(defineLiveObject);
  for (const liveObject of normalizedLiveObjects) {
    invariant(liveObject.lifetime === ResourceLifetime.AGENT, `resumable runtime live object ${liveObject.name} must use AGENT lifetime`);
  }
  const normalizedLiveObjectPolicy = defineLiveObjectPolicy(liveObjectPolicy);
  const resolvedModelRegistry = modelRegistry ?? createModelRegistry({ models });
  invariant(resolvedModelRegistry && typeof resolvedModelRegistry.resolve === "function", "resumable runtime model registry requires resolve()");
  invariant(typeof resolvedModelRegistry.registrations === "function", "resumable runtime model registry requires registrations()");
  invariant(typeof resolvedModelRegistry.loaded === "function", "resumable runtime model registry requires loaded()");
  const runtimeModel = defineModelSelector(model, "runtime model");

  const configuration = createRuntimeConfigurationManifest({
    compatibilityTag: resolvedCompatibilityTag,
    strategy: strategyDescriptor(strategy),
    capabilities: normalizedCapabilities,
    contextPolicy: normalizedContextPolicy,
    contextBlocks: normalizedBlocks,
    judgments: normalizedJudgments.map(snapshotJudgment),
    modelRouting: {
      default: runtimeModel,
      registered: resolvedModelRegistry.registrations()
    },
    resourcePolicy: normalizedResourcePolicy,
    resources: normalizedResources,
    ...(normalizedLiveObjects.length === 0
      ? {}
      : {
          liveObjectPolicy: normalizedLiveObjectPolicy,
          liveObjects: normalizedLiveObjects
        })
  });

  if (restoredSnapshot != null) {
    assertRuntimeSnapshotCompatible(restoredSnapshot, configuration);
    assertResourceStateNames(restoredSnapshot, normalizedResources);
    assertLiveObjectStateNames(restoredSnapshot, normalizedLiveObjects);
  }

  const agentEventStore = createAgentEventStore({
    ...agentEventStoreOptions,
    events: restoredSnapshot?.state.agentEvents ?? []
  });
  const runtime = createAgentRuntime({
    strategy,
    capabilities,
    judgments,
    agentEventStore,
    contextBlocks,
    contextPolicy,
    models: [],
    model,
    modelRegistry: resolvedModelRegistry,
    resources: normalizedResources,
    resourceRegistry,
    resourcePolicy: normalizedResourcePolicy,
    resourceAuthorize,
    liveObjects: normalizedLiveObjects,
    liveObjectRegistry,
    liveObjectPolicy: normalizedLiveObjectPolicy,
    liveObjectAuthorize,
    ...(tracer == null ? {} : { tracer })
  });

  if (restoredSnapshot != null && normalizedResources.length > 0) {
    applyResourceRestore(runtime, restoredSnapshot, resourceRebind);
  }
  if (restoredSnapshot != null && normalizedLiveObjects.length > 0) {
    applyLiveObjectRestore(runtime, restoredSnapshot, liveObjectRebind);
  }

  let activeCalls = 0;

  async function track(operation) {
    activeCalls += 1;
    try {
      return await operation();
    } finally {
      activeCalls -= 1;
    }
  }

  async function runWithReport(options = {}) {
    return track(() => runtime.runWithReport(options));
  }

  async function invokeJudgmentWithReport(name, input, options = {}) {
    return track(() => runtime.invokeJudgmentWithReport(name, input, options));
  }

  const surface = {
    capabilities: () => runtime.capabilities(),
    judgments: () => runtime.judgments(),
    contextBlocks: () => runtime.contextBlocks(),
    contextPolicy: () => runtime.contextPolicy(),
    modelRouting: () => runtime.modelRouting(),
    resourceRefs: () => runtime.resourceRefs(),
    resourcePolicy: () => runtime.resourcePolicy(),
    describeResource: (ref) => track(() => runtime.describeResource(ref)),
    invokeResource: (ref, operationName, payload = null) => track(() => runtime.invokeResource(ref, operationName, payload)),
    revokeResource: (ref) => runtime.revokeResource(ref),
    liveObjects: () => runtime.liveObjects(),
    liveObjectPolicy: () => runtime.liveObjectPolicy(),
    describeLiveObject: (ref) => track(() => runtime.describeLiveObject(ref)),
    invokeLiveObject: (ref, methodName, args = []) => track(() => runtime.invokeLiveObject(ref, methodName, args)),
    readLiveObject: (ref, propertyName) => track(() => runtime.readLiveObject(ref, propertyName)),
    revokeLiveObject: (ref) => runtime.revokeLiveObject(ref),
    agentEvents: () => runtime.agentEvents(),
    traces: () => runtime.traces(),
    traceFailures: () => runtime.traceFailures(),

    async run(options = {}) {
      return (await runWithReport(options)).result;
    },

    runWithReport,

    async invokeJudgment(name, input, options = {}) {
      return (await invokeJudgmentWithReport(name, input, options)).result;
    },

    invokeJudgmentWithReport,

    runtimeSnapshotConfiguration() {
      return clone(configuration);
    },

    snapshot({
      payloadMode = RuntimeSnapshotPayloadMode.OMIT,
      sanitizeEventPayload = null,
      createdAt = null
    } = {}) {
      if (activeCalls > 0) {
        throw new RuntimeSnapshotError(
          ExHarnessErrorCode.RUNTIME_SNAPSHOT_ACTIVE_CALL,
          "runtime snapshot cannot be created while an agent invocation is active",
          { activeCalls }
        );
      }
      const resolvedCreatedAt = createdAt ?? snapshotClock();
      requireText(resolvedCreatedAt, "runtime snapshot createdAt");
      return createRuntimeSnapshot({
        createdAt: resolvedCreatedAt,
        payloadMode,
        sanitizeEventPayload,
        configuration,
        agentEvents: runtime.agentEvents(),
        agentResources: resourceState(normalizedResources, runtime),
        agentLiveObjects: normalizedLiveObjects.length === 0
          ? null
          : liveObjectState(normalizedLiveObjects, runtime)
      });
    },

    restoreInfo() {
      return Object.freeze({
        restored: restoredSnapshot != null,
        snapshotDigest: restoredSnapshot?.digest ?? null,
        schemaVersion: restoredSnapshot?.schemaVersion ?? null
      });
    }
  };

  return Object.freeze(surface);
}
