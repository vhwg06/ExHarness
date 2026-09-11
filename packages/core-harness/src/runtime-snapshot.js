import { invariant, requireText } from "./contracts.js";
import { ExHarnessErrorCode, RuntimeSnapshotError } from "./errors.js";
import { ResourceRefKind } from "./resource.js";
import { digestValue } from "./trust.js";

export const CURRENT_RUNTIME_SNAPSHOT_SCHEMA_VERSION = 1;
export const RuntimeSnapshotType = "EXHARNESS_AGENT_RUNTIME_SNAPSHOT";

export const RuntimeSnapshotPayloadMode = Object.freeze({
  OMIT: "OMIT",
  SANITIZE: "SANITIZE"
});

export const RuntimeSnapshotRedactionKind = Object.freeze({
  RESOURCE_REF: "RESOURCE_REF_REDACTED",
  PAYLOAD_OMITTED: "PAYLOAD_OMITTED"
});

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function normalizeOptionalText(value, label) {
  return value == null ? null : requireText(value, label);
}

function normalizePayloadMode(value) {
  invariant(Object.values(RuntimeSnapshotPayloadMode).includes(value), "runtime snapshot payload mode is invalid");
  return value;
}

function normalizeSnapshotData(value, label, redactions, seen = new WeakSet()) {
  if (value == null) return value;
  const type = typeof value;
  if (type === "string" || type === "boolean") return value;
  if (type === "number") {
    invariant(Number.isFinite(value), `${label} numbers must be finite`);
    return value;
  }
  invariant(type === "object", `${label} must contain only JSON-compatible data`);
  invariant(!seen.has(value), `${label} cannot contain cycles`);
  seen.add(value);

  if (value.kind === ResourceRefKind) {
    redactions.resourceRefs += 1;
    seen.delete(value);
    return Object.freeze({
      kind: RuntimeSnapshotRedactionKind.RESOURCE_REF,
      name: value.name == null ? null : requireText(value.name, `${label} resource name`),
      lifetime: value.lifetime == null ? null : requireText(value.lifetime, `${label} resource lifetime`)
    });
  }

  if (Array.isArray(value)) {
    const result = value.map((item, index) => normalizeSnapshotData(item, `${label}[${index}]`, redactions, seen));
    seen.delete(value);
    return Object.freeze(result);
  }

  const prototype = Object.getPrototypeOf(value);
  invariant(prototype === Object.prototype || prototype === null, `${label} must contain only plain objects and arrays`);
  invariant(Object.getOwnPropertySymbols(value).length === 0, `${label} cannot contain symbol keys`);
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    result[key] = normalizeSnapshotData(child, `${label}.${key}`, redactions, seen);
  }
  seen.delete(value);
  return Object.freeze(result);
}

function digestText(value) {
  return value == null ? null : digestValue(value);
}

function strategyManifest(strategy) {
  if (strategy == null) return null;
  return Object.freeze({
    kind: strategy.kind ?? null,
    name: strategy.name ?? null,
    acceptsRoutedModel: strategy.acceptsRoutedModel === true,
    model: strategy.model == null ? null : clone(strategy.model)
  });
}

function contextBlockManifest(block) {
  return Object.freeze({
    name: block.name,
    trust: block.trust,
    dynamic: block.dynamic === true,
    descriptionDigest: digestText(block.description ?? null),
    valueDigest: block.dynamic === true ? null : digestValue(block.value)
  });
}

function judgmentManifest(judgment) {
  return Object.freeze({
    name: judgment.name,
    descriptionDigest: digestText(judgment.description ?? null),
    typedInput: judgment.parseInput != null,
    typedOutput: judgment.parseOutput != null,
    strategy: strategyManifest(judgment.strategy),
    model: judgment.model == null ? null : clone(judgment.model),
    context: Object.freeze({
      blocks: Object.freeze([...judgment.context.blocks]),
      history: judgment.context.history === true,
      selector: judgment.context.selectHistory != null,
      reducer: judgment.context.reduceHistory != null
    })
  });
}

function capabilityManifest(capability) {
  return Object.freeze({
    name: capability.name,
    mutatesCandidate: capability.mutatesCandidate === true,
    descriptionDigest: digestText(capability.description ?? null),
    typedInput: capability.parseInput != null,
    typedOutput: capability.parseOutput != null
  });
}

function resourceManifest(resource) {
  return Object.freeze({
    name: resource.name,
    lifetime: resource.lifetime,
    definitionDigest: digestValue({
      description: resource.description ?? null,
      metadata: resource.metadata ?? null,
      operations: resource.operations.map((operation) => ({
        name: operation.name,
        description: operation.description ?? null,
        mutates: operation.mutates === true,
        typedInput: operation.parseInput != null,
        typedOutput: operation.parseOutput != null
      }))
    })
  });
}

function sortedByName(values) {
  return [...values].sort((left, right) => left.name.localeCompare(right.name));
}

export function createRuntimeConfigurationManifest({
  compatibilityTag = null,
  strategy = null,
  capabilities = [],
  contextPolicy = null,
  contextBlocks = [],
  judgments = [],
  modelRouting = null,
  resourcePolicy = null,
  resources = []
} = {}) {
  const body = Object.freeze({
    compatibilityTag: normalizeOptionalText(compatibilityTag, "runtime compatibility tag"),
    strategy: strategyManifest(strategy),
    capabilities: Object.freeze(sortedByName(capabilities.map(capabilityManifest))),
    contextPolicy: contextPolicy == null ? null : clone(contextPolicy),
    contextBlocks: Object.freeze(sortedByName(contextBlocks.map(contextBlockManifest))),
    judgments: Object.freeze(sortedByName(judgments.map(judgmentManifest))),
    modelRouting: modelRouting == null
      ? null
      : Object.freeze({
          default: modelRouting.default == null ? null : clone(modelRouting.default),
          registered: Object.freeze([...(modelRouting.registered ?? [])].sort())
        }),
    resourcePolicy: resourcePolicy == null ? null : clone(resourcePolicy),
    resources: Object.freeze(sortedByName(resources.map(resourceManifest)))
  });

  return Object.freeze({
    type: "RUNTIME_CONFIGURATION_MANIFEST",
    body,
    digest: digestValue(body)
  });
}

function snapshotEvent(event, { payloadMode, sanitizeEventPayload, redactions }) {
  invariant(event && typeof event === "object", "runtime snapshot agent event is required");
  let payload;
  if (payloadMode === RuntimeSnapshotPayloadMode.OMIT) {
    redactions.omittedPayloads += 1;
    payload = Object.freeze({ kind: RuntimeSnapshotRedactionKind.PAYLOAD_OMITTED });
  } else {
    invariant(typeof sanitizeEventPayload === "function", "SANITIZE snapshot payload mode requires sanitizeEventPayload()");
    const authoritySafePayload = normalizeSnapshotData(
      event.payload ?? null,
      `runtime snapshot event ${event.id} raw payload`,
      redactions
    );
    const sanitized = sanitizeEventPayload(clone(authoritySafePayload), Object.freeze({
      id: event.id,
      type: event.type,
      at: event.at,
      callId: event.callId
    }));
    payload = normalizeSnapshotData(sanitized, `runtime snapshot event ${event.id} payload`, redactions);
  }

  return Object.freeze({
    id: requireText(event.id, "runtime snapshot agent event id"),
    type: requireText(event.type, "runtime snapshot agent event type"),
    at: requireText(event.at, "runtime snapshot agent event at"),
    callId: requireText(event.callId, "runtime snapshot agent event callId"),
    judgment: event.judgment == null
      ? null
      : normalizeSnapshotData(event.judgment, `runtime snapshot event ${event.id} judgment`, redactions),
    payload
  });
}

function snapshotBody({
  createdAt,
  payloadMode,
  configuration,
  agentEvents,
  agentResources,
  redactions
}) {
  return Object.freeze({
    type: RuntimeSnapshotType,
    schemaVersion: CURRENT_RUNTIME_SNAPSHOT_SCHEMA_VERSION,
    createdAt: requireText(createdAt, "runtime snapshot createdAt"),
    payloadMode,
    configuration,
    state: Object.freeze({
      agentEvents: Object.freeze(agentEvents),
      agentResources: Object.freeze(agentResources)
    }),
    redactions: Object.freeze({
      resourceRefs: redactions.resourceRefs,
      omittedPayloads: redactions.omittedPayloads
    })
  });
}

export function createRuntimeSnapshot({
  createdAt = new Date().toISOString(),
  payloadMode = RuntimeSnapshotPayloadMode.OMIT,
  sanitizeEventPayload = null,
  configuration,
  agentEvents = [],
  agentResources = []
} = {}) {
  const resolvedPayloadMode = normalizePayloadMode(payloadMode);
  invariant(configuration?.type === "RUNTIME_CONFIGURATION_MANIFEST", "runtime snapshot requires configuration manifest");
  invariant(configuration.digest === digestValue(configuration.body), "runtime configuration manifest digest is invalid");
  invariant(Array.isArray(agentEvents), "runtime snapshot agentEvents must be an array");
  invariant(Array.isArray(agentResources), "runtime snapshot agentResources must be an array");
  if (resolvedPayloadMode === RuntimeSnapshotPayloadMode.SANITIZE) {
    invariant(typeof sanitizeEventPayload === "function", "SANITIZE snapshot payload mode requires sanitizeEventPayload()");
  }

  const redactions = { resourceRefs: 0, omittedPayloads: 0 };
  const events = agentEvents.map((event) => snapshotEvent(event, {
    payloadMode: resolvedPayloadMode,
    sanitizeEventPayload,
    redactions
  }));
  const resources = agentResources.map((item) => Object.freeze({
    name: requireText(item.name, "runtime snapshot agent resource name"),
    active: item.active === true
  }));
  invariant(new Set(resources.map((item) => item.name)).size === resources.length, "runtime snapshot resource names must be unique");

  const body = snapshotBody({
    createdAt,
    payloadMode: resolvedPayloadMode,
    configuration: clone(configuration),
    agentEvents: events,
    agentResources: resources,
    redactions
  });
  return Object.freeze({ ...body, digest: digestValue(body) });
}

export function normalizeRuntimeSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new RuntimeSnapshotError(
      ExHarnessErrorCode.RUNTIME_SNAPSHOT_INVALID,
      "runtime snapshot must be an object"
    );
  }
  if (snapshot.type !== RuntimeSnapshotType) {
    throw new RuntimeSnapshotError(
      ExHarnessErrorCode.RUNTIME_SNAPSHOT_INVALID,
      "runtime snapshot type is invalid",
      { type: snapshot.type ?? null }
    );
  }
  if (snapshot.schemaVersion !== CURRENT_RUNTIME_SNAPSHOT_SCHEMA_VERSION) {
    throw new RuntimeSnapshotError(
      ExHarnessErrorCode.RUNTIME_SNAPSHOT_SCHEMA_UNSUPPORTED,
      `unsupported runtime snapshot schema version: ${snapshot.schemaVersion}`,
      {
        schemaVersion: snapshot.schemaVersion ?? null,
        supportedVersion: CURRENT_RUNTIME_SNAPSHOT_SCHEMA_VERSION
      }
    );
  }

  const copied = clone(snapshot);
  const { digest, ...body } = copied;
  if (typeof digest !== "string" || digest !== digestValue(body)) {
    throw new RuntimeSnapshotError(
      ExHarnessErrorCode.RUNTIME_SNAPSHOT_INVALID,
      "runtime snapshot digest is invalid"
    );
  }
  if (
    !body.configuration ||
    body.configuration.type !== "RUNTIME_CONFIGURATION_MANIFEST" ||
    body.configuration.digest !== digestValue(body.configuration.body)
  ) {
    throw new RuntimeSnapshotError(
      ExHarnessErrorCode.RUNTIME_SNAPSHOT_INVALID,
      "runtime snapshot configuration manifest is invalid"
    );
  }
  invariant(Array.isArray(body.state?.agentEvents), "runtime snapshot agentEvents must be an array");
  invariant(Array.isArray(body.state?.agentResources), "runtime snapshot agentResources must be an array");
  normalizePayloadMode(body.payloadMode);

  return Object.freeze(copied);
}

export function assertRuntimeSnapshotCompatible(snapshot, currentConfiguration) {
  const resolved = normalizeRuntimeSnapshot(snapshot);
  invariant(currentConfiguration?.type === "RUNTIME_CONFIGURATION_MANIFEST", "current runtime configuration manifest is required");
  if (resolved.configuration.digest !== currentConfiguration.digest) {
    throw new RuntimeSnapshotError(
      ExHarnessErrorCode.RUNTIME_SNAPSHOT_INCOMPATIBLE,
      "runtime snapshot configuration is incompatible with current runtime",
      {
        snapshotConfigurationDigest: resolved.configuration.digest,
        currentConfigurationDigest: currentConfiguration.digest,
        snapshotCompatibilityTag: resolved.configuration.body.compatibilityTag ?? null,
        currentCompatibilityTag: currentConfiguration.body.compatibilityTag ?? null
      }
    );
  }
  return resolved;
}
