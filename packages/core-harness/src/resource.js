import { randomUUID } from "node:crypto";
import { invariant, requireText } from "./contracts.js";
import { ExHarnessErrorCode, ResourceAccessError } from "./errors.js";

export const ResourceLifetime = Object.freeze({
  AGENT: "AGENT",
  CALL: "CALL"
});

export const ResourceRefKind = "RESOURCE_REF";

function clone(value) {
  return value == null ? value : structuredClone(value);
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

function normalizeDescription(value, label) {
  if (value == null) return null;
  return requireText(value, label);
}

export function defineResourceOperation(definition = {}) {
  invariant(definition && typeof definition === "object", "resource operation definition is required");
  const name = requireText(definition.name, "resource operation name");
  invariant(typeof definition.execute === "function", `resource operation ${name} requires execute()`);
  if (definition.parseInput != null) invariant(typeof definition.parseInput === "function", `resource operation ${name} parseInput must be a function`);
  if (definition.parseOutput != null) invariant(typeof definition.parseOutput === "function", `resource operation ${name} parseOutput must be a function`);

  return Object.freeze({
    name,
    description: normalizeDescription(definition.description, `resource operation ${name} description`),
    mutates: definition.mutates === true,
    parseInput: definition.parseInput ?? null,
    parseOutput: definition.parseOutput ?? null,
    execute: definition.execute
  });
}

export function defineResource(definition = {}) {
  invariant(definition && typeof definition === "object", "resource definition is required");
  const name = requireText(definition.name, "resource name");
  invariant(Object.prototype.hasOwnProperty.call(definition, "value"), `resource ${name} requires a live value`);
  const lifetime = definition.lifetime ?? ResourceLifetime.AGENT;
  invariant(Object.values(ResourceLifetime).includes(lifetime), `resource ${name} lifetime is invalid`);
  const metadata = normalizeTransportData(definition.metadata ?? null, `resource ${name} metadata`);
  const operations = new Map();
  for (const item of definition.operations ?? []) {
    const operation = defineResourceOperation(item);
    invariant(!operations.has(operation.name), `duplicate resource operation: ${name}.${operation.name}`);
    operations.set(operation.name, operation);
  }

  return Object.freeze({
    name,
    description: normalizeDescription(definition.description, `resource ${name} description`),
    lifetime,
    metadata,
    value: definition.value,
    operations: Object.freeze([...operations.values()])
  });
}

export function defineResourcePolicy({
  maxResources = 32,
  maxOperationsPerResource = 32,
  maxDescriptionChars = 1_024,
  maxMetadataChars = 4_096
} = {}) {
  invariant(Number.isInteger(maxResources) && maxResources >= 0, "resource policy maxResources must be a non-negative integer");
  invariant(Number.isInteger(maxOperationsPerResource) && maxOperationsPerResource >= 0, "resource policy maxOperationsPerResource must be a non-negative integer");
  invariant(Number.isInteger(maxDescriptionChars) && maxDescriptionChars >= 0, "resource policy maxDescriptionChars must be a non-negative integer");
  invariant(Number.isInteger(maxMetadataChars) && maxMetadataChars >= 0, "resource policy maxMetadataChars must be a non-negative integer");
  return Object.freeze({ maxResources, maxOperationsPerResource, maxDescriptionChars, maxMetadataChars });
}

function serializedChars(value) {
  return JSON.stringify(value)?.length ?? 0;
}

function enforceDefinitionPolicy(resource, policy) {
  if (resource.operations.length > policy.maxOperationsPerResource) {
    throw new ResourceAccessError(
      ExHarnessErrorCode.RESOURCE_LIMIT_EXCEEDED,
      `resource operation limit exceeded: ${resource.name}`,
      { resource: resource.name, limit: "maxOperationsPerResource", maximum: policy.maxOperationsPerResource, actual: resource.operations.length }
    );
  }
  for (const [label, description] of [
    [`resource ${resource.name}`, resource.description],
    ...resource.operations.map((operation) => [`resource operation ${resource.name}.${operation.name}`, operation.description])
  ]) {
    if (description != null && description.length > policy.maxDescriptionChars) {
      throw new ResourceAccessError(
        ExHarnessErrorCode.RESOURCE_LIMIT_EXCEEDED,
        `${label} description exceeds resource policy`,
        { resource: resource.name, limit: "maxDescriptionChars", maximum: policy.maxDescriptionChars, actual: description.length }
      );
    }
  }
  const metadataChars = serializedChars(resource.metadata);
  if (metadataChars > policy.maxMetadataChars) {
    throw new ResourceAccessError(
      ExHarnessErrorCode.RESOURCE_LIMIT_EXCEEDED,
      `resource metadata limit exceeded: ${resource.name}`,
      { resource: resource.name, limit: "maxMetadataChars", maximum: policy.maxMetadataChars, actual: metadataChars }
    );
  }
}

function refView(record, registryId) {
  return Object.freeze({
    kind: ResourceRefKind,
    registryId,
    id: record.id,
    name: record.resource.name,
    lifetime: record.resource.lifetime
  });
}

function operationView(operation) {
  return Object.freeze({
    name: operation.name,
    description: operation.description,
    mutates: operation.mutates
  });
}

function resourceDescription(record, registryId) {
  return Object.freeze({
    ref: refView(record, registryId),
    description: record.resource.description,
    metadata: clone(record.resource.metadata),
    operations: Object.freeze(record.resource.operations.map(operationView))
  });
}

function resourceNameKey(resource, callId) {
  return resource.lifetime === ResourceLifetime.AGENT
    ? `${ResourceLifetime.AGENT}:${resource.name}`
    : `${ResourceLifetime.CALL}:${callId}:${resource.name}`;
}

export function createResourceRegistry({
  idFactory = () => randomUUID(),
  registryId = randomUUID(),
  policy = defineResourcePolicy(),
  authorize = null
} = {}) {
  invariant(typeof idFactory === "function", "resource registry idFactory must be a function");
  if (authorize != null) invariant(typeof authorize === "function", "resource registry authorize must be a function");
  const resolvedRegistryId = requireText(registryId, "resource registry id");
  const resolvedPolicy = defineResourcePolicy(policy);
  const records = new Map();
  const names = new Map();

  function activeCount() {
    return [...records.values()].filter((record) => !record.revoked && !record.expired).length;
  }

  function resolveRef(ref, { callId = null } = {}) {
    if (!ref || typeof ref !== "object" || ref.kind !== ResourceRefKind || ref.registryId !== resolvedRegistryId) {
      throw new ResourceAccessError(ExHarnessErrorCode.RESOURCE_REF_INVALID, "resource ref is not valid for this registry");
    }
    const record = records.get(ref.id);
    if (!record || record.resource.name !== ref.name || record.resource.lifetime !== ref.lifetime) {
      throw new ResourceAccessError(ExHarnessErrorCode.RESOURCE_REF_INVALID, "resource ref does not resolve", { resourceRefId: ref.id ?? null });
    }
    if (record.expired || (record.resource.lifetime === ResourceLifetime.CALL && record.callId !== callId)) {
      throw new ResourceAccessError(ExHarnessErrorCode.RESOURCE_EXPIRED, `resource ref is outside its call lifetime: ${record.resource.name}`, { resource: record.resource.name, resourceRefId: record.id });
    }
    if (record.revoked) {
      throw new ResourceAccessError(ExHarnessErrorCode.RESOURCE_REVOKED, `resource ref is revoked: ${record.resource.name}`, { resource: record.resource.name, resourceRefId: record.id });
    }
    return record;
  }

  async function assertAuthorized(action, record, { callId = null, operation = null } = {}) {
    if (!authorize) return;
    const allowed = await authorize(Object.freeze({
      action,
      ref: refView(record, resolvedRegistryId),
      operation: operation == null ? null : operationView(operation),
      callId
    }));
    if (allowed !== true) {
      throw new ResourceAccessError(
        ExHarnessErrorCode.RESOURCE_ACCESS_DENIED,
        `resource access denied: ${record.resource.name}${operation ? `.${operation.name}` : ""}`,
        { resource: record.resource.name, operation: operation?.name ?? null, action }
      );
    }
  }

  return Object.freeze({
    registryId: resolvedRegistryId,

    policy() {
      return clone(resolvedPolicy);
    },

    register(definition, { callId = null } = {}) {
      const resource = defineResource(definition);
      enforceDefinitionPolicy(resource, resolvedPolicy);
      if (resource.lifetime === ResourceLifetime.CALL) requireText(callId, `resource ${resource.name} callId`);
      if (resource.lifetime === ResourceLifetime.AGENT) invariant(callId == null, `agent resource ${resource.name} cannot bind to a callId`);
      const nameKey = resourceNameKey(resource, callId);
      invariant(!names.has(nameKey), `duplicate resource: ${resource.name}`);
      if (activeCount() >= resolvedPolicy.maxResources) {
        throw new ResourceAccessError(
          ExHarnessErrorCode.RESOURCE_LIMIT_EXCEEDED,
          "resource registry limit exceeded",
          { limit: "maxResources", maximum: resolvedPolicy.maxResources, actual: activeCount() + 1 }
        );
      }
      const id = requireText(idFactory(), "resource ref id");
      invariant(!records.has(id), `duplicate resource ref id: ${id}`);
      const record = { id, resource, callId, nameKey, revoked: false, expired: false };
      records.set(id, record);
      names.set(nameKey, id);
      return refView(record, resolvedRegistryId);
    },

    refs({ lifetime = null } = {}) {
      if (lifetime != null) invariant(Object.values(ResourceLifetime).includes(lifetime), "resource lifetime filter is invalid");
      return Object.freeze([...records.values()]
        .filter((record) => !record.revoked && !record.expired && (lifetime == null || record.resource.lifetime === lifetime))
        .map((record) => refView(record, resolvedRegistryId)));
    },

    async describe(ref, { callId = null } = {}) {
      const record = resolveRef(ref, { callId });
      await assertAuthorized("DESCRIBE", record, { callId });
      return resourceDescription(record, resolvedRegistryId);
    },

    async invoke(ref, operationName, payload = null, runtime = {}) {
      const callId = runtime.callId ?? null;
      const record = resolveRef(ref, { callId });
      const name = requireText(operationName, "resource operation name");
      const operation = record.resource.operations.find((candidate) => candidate.name === name);
      if (!operation) {
        throw new ResourceAccessError(
          ExHarnessErrorCode.RESOURCE_OPERATION_NOT_ALLOWED,
          `resource operation is not allowed: ${record.resource.name}.${name}`,
          { resource: record.resource.name, operation: name }
        );
      }
      await assertAuthorized("INVOKE", record, { callId, operation });
      const transportInput = normalizeTransportData(payload, `resource operation ${record.resource.name}.${name} input`);
      const parsedInput = operation.parseInput ? operation.parseInput(clone(transportInput)) : transportInput;
      const output = await operation.execute(record.resource.value, parsedInput, Object.freeze({
        callId,
        input: clone(runtime.input ?? null),
        context: clone(runtime.context ?? null),
        ref: refView(record, resolvedRegistryId)
      }));
      const parsedOutput = operation.parseOutput ? operation.parseOutput(output) : output;
      return normalizeTransportData(parsedOutput, `resource operation ${record.resource.name}.${name} output`);
    },

    revoke(ref) {
      const record = resolveRef(ref, { callId: ref?.lifetime === ResourceLifetime.CALL ? records.get(ref?.id)?.callId ?? null : null });
      record.revoked = true;
      names.delete(record.nameKey);
      return true;
    },

    closeCall(callId) {
      requireText(callId, "resource callId");
      for (const record of records.values()) {
        if (record.resource.lifetime === ResourceLifetime.CALL && record.callId === callId && !record.revoked && !record.expired) {
          record.expired = true;
          names.delete(record.nameKey);
        }
      }
    }
  });
}
