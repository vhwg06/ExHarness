import { randomUUID } from "node:crypto";
import { invariant, requireText } from "./contracts.js";
import { ExHarnessErrorCode, LiveObjectAccessError } from "./errors.js";
import { ResourceLifetime } from "./resource.js";

const LIVE_OBJECT_SURFACE = Symbol("exharness.live-object-surface");

export const LiveObjectRefKind = "LIVE_OBJECT_REF";

export const LiveObjectMemberKind = Object.freeze({
  METHOD: "METHOD",
  PROPERTY: "PROPERTY"
});

function isLiveValue(value) {
  return value !== null && (typeof value === "object" || typeof value === "function");
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function normalizeDescription(value, label) {
  return value == null ? null : requireText(value, label);
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
  // Validate the original object graph before structuredClone can erase custom
  // prototypes. A live/custom object must cross through an explicit
  // resultSurface instead of being silently laundered into plain transport data.
  validateTransportData(value, label);
  let copied;
  try {
    copied = clone(value);
  } catch (error) {
    throw new TypeError(`${label} must be structured-cloneable`, { cause: error });
  }
  validateTransportData(copied, label);
  return copied;
}

function normalizeResultSurface(value, label) {
  if (value == null) return null;
  invariant(
    typeof value === "function" || (value && typeof value === "object" && value[LIVE_OBJECT_SURFACE] === true),
    `${label} must be a live object surface or resolver function`
  );
  return value;
}

export function defineLiveObjectMethod(definition = {}) {
  invariant(definition && typeof definition === "object" && !Array.isArray(definition), "live object method definition is required");
  const name = requireText(definition.name, "live object method name");
  if (definition.description != null) requireText(definition.description, `live object method ${name} description`);
  if (definition.parseArgs != null) invariant(typeof definition.parseArgs === "function", `live object method ${name} parseArgs must be a function`);
  if (definition.parseOutput != null) invariant(typeof definition.parseOutput === "function", `live object method ${name} parseOutput must be a function`);
  if (definition.execute != null) invariant(typeof definition.execute === "function", `live object method ${name} execute must be a function`);
  if (definition.execute != null && definition.method != null) {
    invariant(false, `live object method ${name} cannot declare both execute and method`);
  }
  if (definition.allowLiveArgs != null) invariant(typeof definition.allowLiveArgs === "boolean", `live object method ${name} allowLiveArgs must be boolean`);

  return Object.freeze({
    kind: LiveObjectMemberKind.METHOD,
    name,
    description: normalizeDescription(definition.description, `live object method ${name} description`),
    mutates: definition.mutates === true,
    allowLiveArgs: definition.allowLiveArgs === true,
    method: definition.execute == null ? requireText(definition.method ?? name, `live object method ${name} target method`) : null,
    execute: definition.execute ?? null,
    parseArgs: definition.parseArgs ?? null,
    parseOutput: definition.parseOutput ?? null,
    resultSurface: normalizeResultSurface(definition.resultSurface ?? null, `live object method ${name} resultSurface`)
  });
}

export function defineLiveObjectProperty(definition = {}) {
  invariant(definition && typeof definition === "object" && !Array.isArray(definition), "live object property definition is required");
  const name = requireText(definition.name, "live object property name");
  invariant(typeof definition.read === "function", `live object property ${name} requires read()`);
  if (definition.description != null) requireText(definition.description, `live object property ${name} description`);
  if (definition.parseOutput != null) invariant(typeof definition.parseOutput === "function", `live object property ${name} parseOutput must be a function`);

  return Object.freeze({
    kind: LiveObjectMemberKind.PROPERTY,
    name,
    description: normalizeDescription(definition.description, `live object property ${name} description`),
    read: definition.read,
    parseOutput: definition.parseOutput ?? null,
    resultSurface: normalizeResultSurface(definition.resultSurface ?? null, `live object property ${name} resultSurface`)
  });
}

export function defineLiveObjectSurface(definition = {}) {
  if (definition && typeof definition === "object" && definition[LIVE_OBJECT_SURFACE] === true) return definition;
  invariant(definition && typeof definition === "object" && !Array.isArray(definition), "live object surface definition is required");
  const id = requireText(definition.id, "live object surface id");
  const type = definition.type == null ? null : requireText(definition.type, `live object surface ${id} type`);
  const description = normalizeDescription(definition.description, `live object surface ${id} description`);
  invariant(Array.isArray(definition.methods ?? []), `live object surface ${id} methods must be an array`);
  invariant(Array.isArray(definition.properties ?? []), `live object surface ${id} properties must be an array`);

  const methods = new Map();
  const properties = new Map();
  const names = new Set();
  for (const raw of definition.methods ?? []) {
    const method = defineLiveObjectMethod(raw);
    invariant(!names.has(method.name), `duplicate live object member: ${id}.${method.name}`);
    names.add(method.name);
    methods.set(method.name, method);
  }
  for (const raw of definition.properties ?? []) {
    const property = defineLiveObjectProperty(raw);
    invariant(!names.has(property.name), `duplicate live object member: ${id}.${property.name}`);
    names.add(property.name);
    properties.set(property.name, property);
  }

  return Object.freeze({
    [LIVE_OBJECT_SURFACE]: true,
    id,
    type,
    description,
    methods: Object.freeze([...methods.values()]),
    properties: Object.freeze([...properties.values()])
  });
}

export function liveObjectSurfaceView(surface) {
  const resolved = defineLiveObjectSurface(surface);
  return Object.freeze({
    id: resolved.id,
    type: resolved.type,
    description: resolved.description,
    methods: Object.freeze(resolved.methods.map((method) => Object.freeze({
      name: method.name,
      description: method.description,
      mutates: method.mutates,
      allowLiveArgs: method.allowLiveArgs,
      typedArgs: method.parseArgs != null,
      typedOutput: method.parseOutput != null,
      returnsLive: method.resultSurface != null
    }))),
    properties: Object.freeze(resolved.properties.map((property) => Object.freeze({
      name: property.name,
      description: property.description,
      typedOutput: property.parseOutput != null,
      returnsLive: property.resultSurface != null
    })))
  });
}

export function defineLiveObject(definition = {}) {
  invariant(definition && typeof definition === "object" && !Array.isArray(definition), "live object definition is required");
  const name = requireText(definition.name, "live object name");
  invariant(isLiveValue(definition.value), `live object ${name} requires an object or function value`);
  const lifetime = definition.lifetime ?? ResourceLifetime.AGENT;
  invariant(Object.values(ResourceLifetime).includes(lifetime), `live object ${name} lifetime is invalid`);
  return Object.freeze({
    name,
    value: definition.value,
    surface: defineLiveObjectSurface(definition.surface),
    lifetime
  });
}

export function defineLiveObjectPolicy({
  maxHandles = 128,
  maxMethodsPerSurface = 32,
  maxPropertiesPerSurface = 32,
  maxDescriptionChars = 1_024,
  maxSurfaceIdChars = 256,
  maxTypeChars = 256
} = {}) {
  for (const [name, value] of Object.entries({
    maxHandles,
    maxMethodsPerSurface,
    maxPropertiesPerSurface,
    maxDescriptionChars,
    maxSurfaceIdChars,
    maxTypeChars
  })) {
    invariant(Number.isInteger(value) && value >= 0, `live object policy ${name} must be a non-negative integer`);
  }
  return Object.freeze({
    maxHandles,
    maxMethodsPerSurface,
    maxPropertiesPerSurface,
    maxDescriptionChars,
    maxSurfaceIdChars,
    maxTypeChars
  });
}

function refView(record, registryId) {
  return Object.freeze({
    kind: LiveObjectRefKind,
    registryId,
    id: record.id,
    surfaceId: record.surface.id,
    type: record.surface.type,
    lifetime: record.lifetime
  });
}

function memberView(member) {
  if (member.kind === LiveObjectMemberKind.METHOD) {
    return Object.freeze({
      kind: member.kind,
      name: member.name,
      mutates: member.mutates,
      allowLiveArgs: member.allowLiveArgs
    });
  }
  return Object.freeze({ kind: member.kind, name: member.name });
}

function enforceSurfacePolicy(surface, policy) {
  if (surface.id.length > policy.maxSurfaceIdChars) {
    throw new LiveObjectAccessError(
      ExHarnessErrorCode.LIVE_OBJECT_LIMIT_EXCEEDED,
      `live object surface id exceeds policy: ${surface.id}`,
      { surfaceId: surface.id, limit: "maxSurfaceIdChars", maximum: policy.maxSurfaceIdChars, actual: surface.id.length }
    );
  }
  if (surface.type != null && surface.type.length > policy.maxTypeChars) {
    throw new LiveObjectAccessError(
      ExHarnessErrorCode.LIVE_OBJECT_LIMIT_EXCEEDED,
      `live object surface type exceeds policy: ${surface.id}`,
      { surfaceId: surface.id, limit: "maxTypeChars", maximum: policy.maxTypeChars, actual: surface.type.length }
    );
  }
  if (surface.methods.length > policy.maxMethodsPerSurface) {
    throw new LiveObjectAccessError(
      ExHarnessErrorCode.LIVE_OBJECT_LIMIT_EXCEEDED,
      `live object method limit exceeded: ${surface.id}`,
      { surfaceId: surface.id, limit: "maxMethodsPerSurface", maximum: policy.maxMethodsPerSurface, actual: surface.methods.length }
    );
  }
  if (surface.properties.length > policy.maxPropertiesPerSurface) {
    throw new LiveObjectAccessError(
      ExHarnessErrorCode.LIVE_OBJECT_LIMIT_EXCEEDED,
      `live object property limit exceeded: ${surface.id}`,
      { surfaceId: surface.id, limit: "maxPropertiesPerSurface", maximum: policy.maxPropertiesPerSurface, actual: surface.properties.length }
    );
  }
  for (const [label, description] of [
    [`live object surface ${surface.id}`, surface.description],
    ...surface.methods.map((member) => [`live object method ${surface.id}.${member.name}`, member.description]),
    ...surface.properties.map((member) => [`live object property ${surface.id}.${member.name}`, member.description])
  ]) {
    if (description != null && description.length > policy.maxDescriptionChars) {
      throw new LiveObjectAccessError(
        ExHarnessErrorCode.LIVE_OBJECT_LIMIT_EXCEEDED,
        `${label} description exceeds live object policy`,
        { surfaceId: surface.id, limit: "maxDescriptionChars", maximum: policy.maxDescriptionChars, actual: description.length }
      );
    }
  }
}

function resolveDataMethod(value, methodName, surfaceId, memberName) {
  let current = value;
  while (current != null) {
    const descriptor = Object.getOwnPropertyDescriptor(current, methodName);
    if (descriptor) {
      if (!("value" in descriptor) || typeof descriptor.value !== "function") {
        throw new LiveObjectAccessError(
          ExHarnessErrorCode.LIVE_OBJECT_MEMBER_NOT_ALLOWED,
          `live object method is not a data function: ${surfaceId}.${memberName}`,
          { surfaceId, member: memberName, targetMethod: methodName }
        );
      }
      return descriptor.value;
    }
    current = Object.getPrototypeOf(current);
  }
  throw new LiveObjectAccessError(
    ExHarnessErrorCode.LIVE_OBJECT_MEMBER_NOT_ALLOWED,
    `live object target method does not exist: ${surfaceId}.${memberName}`,
    { surfaceId, member: memberName, targetMethod: methodName }
  );
}

function identityKey(surfaceId, lifetime, callId) {
  return JSON.stringify([surfaceId, lifetime, lifetime === ResourceLifetime.CALL ? callId : null]);
}

export function createLiveObjectRegistry({
  idFactory = () => randomUUID(),
  registryId = randomUUID(),
  policy = defineLiveObjectPolicy(),
  authorize = null
} = {}) {
  invariant(typeof idFactory === "function", "live object registry idFactory must be a function");
  if (authorize != null) invariant(typeof authorize === "function", "live object registry authorize must be a function");
  const resolvedRegistryId = requireText(registryId, "live object registry id");
  const resolvedPolicy = defineLiveObjectPolicy(policy);
  const records = new Map();
  const identities = new WeakMap();
  const surfaces = new Map();

  function activeCount() {
    return [...records.values()].filter((record) => !record.revoked && !record.expired).length;
  }

  function registerSurface(surface) {
    const resolved = defineLiveObjectSurface(surface);
    enforceSurfacePolicy(resolved, resolvedPolicy);
    const existing = surfaces.get(resolved.id);
    if (existing && existing !== resolved) {
      throw new LiveObjectAccessError(
        ExHarnessErrorCode.LIVE_OBJECT_SURFACE_CONFLICT,
        `live object surface id was reused with a different definition: ${resolved.id}`,
        { surfaceId: resolved.id }
      );
    }
    surfaces.set(resolved.id, resolved);
    return resolved;
  }

  function resolveRef(ref, { callId = null } = {}) {
    if (!ref || typeof ref !== "object" || ref.kind !== LiveObjectRefKind || ref.registryId !== resolvedRegistryId) {
      throw new LiveObjectAccessError(ExHarnessErrorCode.LIVE_OBJECT_REF_INVALID, "live object ref is not valid for this registry");
    }
    const record = records.get(ref.id);
    if (
      !record ||
      record.surface.id !== ref.surfaceId ||
      record.lifetime !== ref.lifetime ||
      record.surface.type !== (ref.type ?? null)
    ) {
      throw new LiveObjectAccessError(
        ExHarnessErrorCode.LIVE_OBJECT_REF_INVALID,
        "live object ref does not resolve",
        { liveObjectRefId: ref.id ?? null }
      );
    }
    if (record.expired || (record.lifetime === ResourceLifetime.CALL && record.callId !== callId)) {
      throw new LiveObjectAccessError(
        ExHarnessErrorCode.LIVE_OBJECT_EXPIRED,
        `live object ref is outside its call lifetime: ${record.surface.id}`,
        { liveObjectRefId: record.id, surfaceId: record.surface.id }
      );
    }
    if (record.revoked) {
      throw new LiveObjectAccessError(
        ExHarnessErrorCode.LIVE_OBJECT_REVOKED,
        `live object ref is revoked: ${record.surface.id}`,
        { liveObjectRefId: record.id, surfaceId: record.surface.id }
      );
    }
    return record;
  }

  async function assertAuthorized(action, record, { callId = null, member = null } = {}) {
    if (!authorize) return;
    const allowed = await authorize(Object.freeze({
      action,
      ref: refView(record, resolvedRegistryId),
      surface: liveObjectSurfaceView(record.surface),
      member: member == null ? null : memberView(member),
      callId
    }));
    if (allowed !== true) {
      throw new LiveObjectAccessError(
        ExHarnessErrorCode.LIVE_OBJECT_ACCESS_DENIED,
        `live object access denied: ${record.surface.id}${member ? `.${member.name}` : ""}`,
        { surfaceId: record.surface.id, member: member?.name ?? null, action }
      );
    }
  }

  function bindMethods(value, surface) {
    const result = new Map();
    for (const method of surface.methods) {
      if (method.execute) {
        result.set(method.name, (args, runtime) => method.execute(value, args, runtime));
      } else {
        const implementation = resolveDataMethod(value, method.method, surface.id, method.name);
        result.set(method.name, (args) => Reflect.apply(implementation, value, args));
      }
    }
    return result;
  }

  function removeIdentity(record) {
    const byAuthority = identities.get(record.value);
    if (!byAuthority) return;
    const key = identityKey(record.surface.id, record.lifetime, record.callId);
    if (byAuthority.get(key) === record.id) byAuthority.delete(key);
  }

  function expose(value, surface, { lifetime = ResourceLifetime.AGENT, callId = null } = {}) {
    invariant(isLiveValue(value), "live object exposure requires an object or function value");
    invariant(Object.values(ResourceLifetime).includes(lifetime), "live object exposure lifetime is invalid");
    if (lifetime === ResourceLifetime.CALL) requireText(callId, "call-scoped live object callId");
    if (lifetime === ResourceLifetime.AGENT) invariant(callId == null, "agent live object cannot bind to a callId");
    const resolvedSurface = registerSurface(surface);
    const key = identityKey(resolvedSurface.id, lifetime, callId);
    let byAuthority = identities.get(value);
    if (!byAuthority) {
      byAuthority = new Map();
      identities.set(value, byAuthority);
    }
    const existingId = byAuthority.get(key);
    if (existingId) {
      const existing = records.get(existingId);
      if (existing && !existing.revoked && !existing.expired) return refView(existing, resolvedRegistryId);
      byAuthority.delete(key);
    }
    if (activeCount() >= resolvedPolicy.maxHandles) {
      throw new LiveObjectAccessError(
        ExHarnessErrorCode.LIVE_OBJECT_LIMIT_EXCEEDED,
        "live object handle limit exceeded",
        { limit: "maxHandles", maximum: resolvedPolicy.maxHandles, actual: activeCount() + 1 }
      );
    }
    const id = requireText(idFactory(), "live object ref id");
    invariant(!records.has(id), `duplicate live object ref id: ${id}`);
    const record = {
      id,
      value,
      surface: resolvedSurface,
      boundMethods: bindMethods(value, resolvedSurface),
      lifetime,
      callId,
      revoked: false,
      expired: false
    };
    records.set(id, record);
    byAuthority.set(key, id);
    return refView(record, resolvedRegistryId);
  }

  function resolveCallValue(value, { allowLiveArgs, callId, label, seen = new WeakSet() }) {
    if (value == null) return value;
    const type = typeof value;
    if (type === "string" || type === "boolean") return value;
    if (type === "number") {
      invariant(Number.isFinite(value), `${label} numbers must be finite`);
      return value;
    }
    invariant(type === "object", `${label} must contain only JSON-compatible data or live object refs`);

    if (value.kind === LiveObjectRefKind) {
      if (!allowLiveArgs) {
        throw new LiveObjectAccessError(
          ExHarnessErrorCode.LIVE_OBJECT_ACCESS_DENIED,
          `${label} cannot contain live object refs for this method`,
          { action: "PASS_LIVE_ARGUMENT" }
        );
      }
      return resolveRef(value, { callId }).value;
    }

    invariant(!seen.has(value), `${label} cannot contain cycles`);
    seen.add(value);
    if (Array.isArray(value)) {
      const result = value.map((item, index) => resolveCallValue(item, {
        allowLiveArgs,
        callId,
        label: `${label}[${index}]`,
        seen
      }));
      seen.delete(value);
      return result;
    }
    const prototype = Object.getPrototypeOf(value);
    invariant(prototype === Object.prototype || prototype === null, `${label} must contain only plain objects, arrays, or live object refs`);
    invariant(Object.getOwnPropertySymbols(value).length === 0, `${label} cannot contain symbol keys`);
    const result = {};
    for (const [key, child] of Object.entries(value)) {
      result[key] = resolveCallValue(child, {
        allowLiveArgs,
        callId,
        label: `${label}.${key}`,
        seen
      });
    }
    seen.delete(value);
    return result;
  }

  function resolveResultSurface(resultSurface, output, context, label) {
    if (resultSurface == null) return null;
    const resolved = typeof resultSurface === "function" ? resultSurface(output, context) : resultSurface;
    if (resolved == null) return null;
    invariant(!(resolved && typeof resolved.then === "function"), `${label} resolver must be synchronous`);
    return registerSurface(resolved);
  }

  function encodeResult(record, member, output, callId) {
    const context = Object.freeze({
      parentRef: refView(record, resolvedRegistryId),
      member: memberView(member),
      callId
    });
    const resultSurface = resolveResultSurface(
      member.resultSurface,
      output,
      context,
      `live object ${record.surface.id}.${member.name} resultSurface`
    );
    if (resultSurface == null) {
      return normalizeTransportData(output, `live object ${record.surface.id}.${member.name} output`);
    }
    if (!isLiveValue(output)) {
      throw new LiveObjectAccessError(
        ExHarnessErrorCode.LIVE_OBJECT_REF_INVALID,
        `live object member declared a live result but returned a non-object: ${record.surface.id}.${member.name}`,
        { surfaceId: record.surface.id, member: member.name }
      );
    }
    return expose(output, resultSurface, {
      lifetime: record.lifetime,
      callId: record.lifetime === ResourceLifetime.CALL ? record.callId : null
    });
  }

  return Object.freeze({
    registryId: resolvedRegistryId,

    policy() {
      return clone(resolvedPolicy);
    },

    expose,

    refs({ lifetime = null } = {}) {
      if (lifetime != null) invariant(Object.values(ResourceLifetime).includes(lifetime), "live object lifetime filter is invalid");
      return Object.freeze([...records.values()]
        .filter((record) => !record.revoked && !record.expired && (lifetime == null || record.lifetime === lifetime))
        .map((record) => refView(record, resolvedRegistryId)));
    },

    async describe(ref, { callId = null } = {}) {
      const record = resolveRef(ref, { callId });
      await assertAuthorized("DESCRIBE_LIVE", record, { callId });
      return Object.freeze({
        ref: refView(record, resolvedRegistryId),
        surface: liveObjectSurfaceView(record.surface)
      });
    },

    async invoke(ref, methodName, args = [], runtime = {}) {
      const callId = runtime.callId ?? null;
      const record = resolveRef(ref, { callId });
      const name = requireText(methodName, "live object method name");
      invariant(Array.isArray(args), `live object method ${record.surface.id}.${name} args must be an array`);
      const method = record.surface.methods.find((candidate) => candidate.name === name);
      if (!method) {
        throw new LiveObjectAccessError(
          ExHarnessErrorCode.LIVE_OBJECT_MEMBER_NOT_ALLOWED,
          `live object method is not allowed: ${record.surface.id}.${name}`,
          { surfaceId: record.surface.id, member: name, kind: LiveObjectMemberKind.METHOD }
        );
      }
      await assertAuthorized("INVOKE_LIVE", record, { callId, member: method });
      const normalizedArgs = args.map((value, index) => resolveCallValue(value, {
        allowLiveArgs: method.allowLiveArgs,
        callId,
        label: `live object ${record.surface.id}.${name} args[${index}]`
      }));
      const parsedArgs = method.parseArgs ? method.parseArgs(Object.freeze([...normalizedArgs])) : normalizedArgs;
      invariant(Array.isArray(parsedArgs), `live object method ${record.surface.id}.${name} parseArgs must return an array`);
      const execute = record.boundMethods.get(name);
      invariant(typeof execute === "function", `live object method binding is missing: ${record.surface.id}.${name}`);
      const output = await execute(parsedArgs, Object.freeze({
        callId,
        input: clone(runtime.input ?? null),
        context: clone(runtime.context ?? null),
        ref: refView(record, resolvedRegistryId)
      }));
      const parsedOutput = method.parseOutput ? method.parseOutput(output) : output;
      return encodeResult(record, method, parsedOutput, callId);
    },

    async read(ref, propertyName, runtime = {}) {
      const callId = runtime.callId ?? null;
      const record = resolveRef(ref, { callId });
      const name = requireText(propertyName, "live object property name");
      const property = record.surface.properties.find((candidate) => candidate.name === name);
      if (!property) {
        throw new LiveObjectAccessError(
          ExHarnessErrorCode.LIVE_OBJECT_MEMBER_NOT_ALLOWED,
          `live object property is not allowed: ${record.surface.id}.${name}`,
          { surfaceId: record.surface.id, member: name, kind: LiveObjectMemberKind.PROPERTY }
        );
      }
      await assertAuthorized("READ_LIVE", record, { callId, member: property });
      const output = await property.read(record.value, Object.freeze({
        callId,
        input: clone(runtime.input ?? null),
        context: clone(runtime.context ?? null),
        ref: refView(record, resolvedRegistryId)
      }));
      const parsedOutput = property.parseOutput ? property.parseOutput(output) : output;
      return encodeResult(record, property, parsedOutput, callId);
    },

    revoke(ref, { callId = null } = {}) {
      const record = resolveRef(ref, { callId });
      record.revoked = true;
      removeIdentity(record);
      return true;
    },

    closeCall(callId) {
      requireText(callId, "live object callId");
      for (const record of records.values()) {
        if (record.lifetime === ResourceLifetime.CALL && record.callId === callId && !record.revoked && !record.expired) {
          record.expired = true;
          removeIdentity(record);
        }
      }
    }
  });
}
