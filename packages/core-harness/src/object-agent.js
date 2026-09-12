import { invariant, requireText } from "./contracts.js";
import { createAgentRuntime } from "./agent-runtime.js";
import { ContextBlockTrust } from "./context.js";
import {
  DiscoveryMode,
  defineDiscoveryPolicy,
  renderObjectAgentDoc
} from "./discovery.js";
import { ExHarnessError, ExHarnessErrorCode } from "./errors.js";

const AGENTIC_METHOD = Symbol("exharness.agentic-method");
const objectAgentRecords = new WeakMap();
const SELF_DISCOVERY_BLOCK = "__exharness_self_doc__";

export const ObjectAgentMemberKind = Object.freeze({
  DETERMINISTIC: "DETERMINISTIC",
  AGENTIC: "AGENTIC"
});

export const ObjectMethodCallKind = "OBJECT_METHOD_CALL";

export class ObjectAgent {}
export const Agent = ObjectAgent;

export function agenticMethod(definition = {}) {
  invariant(definition && typeof definition === "object" && !Array.isArray(definition), "agentic method definition must be an object");
  if (definition.packArgs != null) {
    invariant(typeof definition.packArgs === "function", "agentic method packArgs must be a function");
  }
  if (definition.hidden != null) {
    invariant(typeof definition.hidden === "boolean", "agentic method hidden must be boolean");
  }

  return Object.freeze({
    [AGENTIC_METHOD]: true,
    definition: Object.freeze({ ...definition })
  });
}

export function objectMethodCall(...args) {
  return Object.freeze({
    kind: ObjectMethodCallKind,
    args: Object.freeze([...args])
  });
}

function isAgenticMarker(value) {
  return Boolean(value && typeof value === "object" && value[AGENTIC_METHOD] === true);
}

function normalizeHidden(hidden) {
  invariant(Array.isArray(hidden), "object agent hidden must be an array");
  const names = new Set();
  for (const value of hidden) names.add(requireText(value, "object agent hidden member"));
  return names;
}

function normalizeMethodMetadata(methods) {
  invariant(methods && typeof methods === "object" && !Array.isArray(methods), "object agent methods metadata must be an object");
  const result = new Map();
  for (const [name, raw] of Object.entries(methods)) {
    requireText(name, "object agent method metadata name");
    invariant(raw && typeof raw === "object" && !Array.isArray(raw), `object agent method metadata ${name} must be an object`);
    if (raw.hidden != null) invariant(typeof raw.hidden === "boolean", `object agent method ${name} hidden must be boolean`);
    if (raw.parseArgs != null) invariant(typeof raw.parseArgs === "function", `object agent method ${name} parseArgs must be a function`);
    if (raw.parseOutput != null) invariant(typeof raw.parseOutput === "function", `object agent method ${name} parseOutput must be a function`);
    if (raw.description != null) requireText(raw.description, `object agent method ${name} description`);
    result.set(name, Object.freeze({
      description: raw.description ?? null,
      hidden: raw.hidden === true,
      mutatesCandidate: raw.mutatesCandidate === true,
      parseArgs: raw.parseArgs ?? null,
      parseOutput: raw.parseOutput ?? null
    }));
  }
  return result;
}

function collectAgenticFields(instance) {
  const result = new Map();
  for (const name of Object.getOwnPropertyNames(instance)) {
    const descriptor = Object.getOwnPropertyDescriptor(instance, name);
    if (!descriptor || !("value" in descriptor) || !isAgenticMarker(descriptor.value)) continue;
    invariant(!result.has(name), `duplicate agentic method: ${name}`);
    result.set(name, Object.freeze({
      name,
      definition: descriptor.value.definition,
      descriptor
    }));
  }
  return result;
}

function publicByConvention(name) {
  return name !== "constructor" && !name.startsWith("_");
}

function resolvePrototypeBoundary(instance, explicitBoundary) {
  if (explicitBoundary != null) {
    invariant(typeof explicitBoundary === "object", "object agent prototypeBoundary must be a prototype object");
    return explicitBoundary;
  }
  if (instance instanceof ObjectAgent) return ObjectAgent.prototype;
  const immediate = Object.getPrototypeOf(instance);
  return immediate == null ? null : Object.getPrototypeOf(immediate);
}

function memberHidden(name, hidden, metadata) {
  return !publicByConvention(name) || hidden.has(name) || metadata.get(name)?.hidden === true;
}

function collectDeterministicMethods(instance, {
  hidden,
  metadata,
  agenticNames,
  prototypeBoundary
}) {
  const methods = new Map();
  const seen = new Set();

  for (const name of Object.getOwnPropertyNames(instance)) {
    if (agenticNames.has(name)) {
      seen.add(name);
      continue;
    }
    const descriptor = Object.getOwnPropertyDescriptor(instance, name);
    seen.add(name);
    if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "function") continue;
    methods.set(name, Object.freeze({
      name,
      owner: instance,
      own: true,
      hidden: memberHidden(name, hidden, metadata),
      implementation: descriptor.value
    }));
  }

  const boundary = resolvePrototypeBoundary(instance, prototypeBoundary);
  let proto = Object.getPrototypeOf(instance);
  while (proto && proto !== Object.prototype && proto !== boundary) {
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (seen.has(name)) continue;
      seen.add(name);
      if (agenticNames.has(name) || name === "constructor") continue;
      const descriptor = Object.getOwnPropertyDescriptor(proto, name);
      if (!descriptor || typeof descriptor.value !== "function") continue;
      methods.set(name, Object.freeze({
        name,
        owner: proto,
        own: false,
        hidden: memberHidden(name, hidden, metadata),
        implementation: descriptor.value
      }));
    }
    proto = Object.getPrototypeOf(proto);
  }

  return methods;
}

function deterministicArgs(payload) {
  if (payload && typeof payload === "object" && payload.kind === ObjectMethodCallKind) {
    invariant(Array.isArray(payload.args), "object method call args must be an array");
    return [...payload.args];
  }
  return [payload];
}

function defaultAgenticInput(args, definition) {
  if (typeof definition.packArgs === "function") {
    return definition.packArgs(Object.freeze([...args]));
  }
  if (args.length === 0) return null;
  if (args.length === 1) return args[0];
  return [...args];
}

function withSelfDiscoveryContext(context = {}) {
  invariant(context && typeof context === "object" && !Array.isArray(context), "agentic method context must be an object");
  const blocks = [...(context.blocks ?? [])];
  invariant(Array.isArray(blocks), "agentic method context blocks must be an array");
  if (!blocks.includes(SELF_DISCOVERY_BLOCK)) blocks.push(SELF_DISCOVERY_BLOCK);
  return Object.freeze({ ...context, blocks: Object.freeze(blocks) });
}

function judgmentDefinition(record) {
  const definition = record.definition;
  return {
    name: record.name,
    description: definition.description ?? null,
    parseInput: definition.parseInput ?? null,
    parseOutput: definition.parseOutput ?? null,
    strategy: definition.strategy ?? null,
    model: definition.model ?? null,
    context: withSelfDiscoveryContext(definition.context ?? {})
  };
}

function noDefaultStrategy() {
  return Object.freeze({
    kind: "OBJECT_AGENT_NO_DEFAULT_STRATEGY",
    async run() {
      throw new ExHarnessError(
        ExHarnessErrorCode.CONTRACT_VIOLATION,
        "object agent has no default strategy; call an agentic method with a strategy or configure createObjectAgent({ strategy })"
      );
    }
  });
}

function requireObjectAgentRecord(agent) {
  invariant(agent && (typeof agent === "object" || typeof agent === "function"), "object agent instance is required");
  const record = objectAgentRecords.get(agent);
  invariant(record, "value is not an ExHarness object agent");
  return record;
}

function instanceTypeName(instance) {
  const name = instance?.constructor?.name;
  return typeof name === "string" && name.length > 0 ? name : "ObjectAgent";
}

function surfaceFromParts(instance, deterministic, agentic, hidden, metadata, { includeHidden = false } = {}) {
  const members = [];

  for (const [name, method] of deterministic) {
    if (method.hidden && !includeHidden) continue;
    const methodMetadata = metadata.get(name);
    members.push(Object.freeze({
      name,
      kind: ObjectAgentMemberKind.DETERMINISTIC,
      description: methodMetadata?.description ?? null,
      hidden: method.hidden,
      mutatesCandidate: methodMetadata?.mutatesCandidate === true,
      typedInput: methodMetadata?.parseArgs != null,
      typedOutput: methodMetadata?.parseOutput != null
    }));
  }

  for (const [name, method] of agentic) {
    const definition = method.definition;
    const isHidden = hidden.has(name) || definition.hidden === true || !publicByConvention(name);
    if (isHidden && !includeHidden) continue;
    members.push(Object.freeze({
      name,
      kind: ObjectAgentMemberKind.AGENTIC,
      description: definition.description ?? null,
      hidden: isHidden,
      mutatesCandidate: false,
      typedInput: definition.parseInput != null,
      typedOutput: definition.parseOutput != null
    }));
  }

  members.sort((left, right) => left.name.localeCompare(right.name));
  return Object.freeze({
    type: instanceTypeName(instance),
    members: Object.freeze(members)
  });
}

export function createObjectAgent(instance, {
  strategy = null,
  hidden = [],
  methods = {},
  prototypeBoundary = null,
  capabilities = [],
  judgments = [],
  contextBlocks = [],
  discoveryPolicy = {},
  ...runtimeOptions
} = {}) {
  invariant(instance && typeof instance === "object", "createObjectAgent requires an object instance");
  invariant(!objectAgentRecords.has(instance), "object instance is already attached to an ExHarness runtime");
  if (strategy != null) invariant(strategy && typeof strategy.run === "function", "object agent strategy requires run()");
  invariant(Array.isArray(capabilities), "object agent extra capabilities must be an array");
  invariant(Array.isArray(judgments), "object agent extra judgments must be an array");
  invariant(Array.isArray(contextBlocks), "object agent contextBlocks must be an array");

  const hiddenNames = normalizeHidden(hidden);
  const methodMetadata = normalizeMethodMetadata(methods);
  const agentic = collectAgenticFields(instance);
  const agenticNames = new Set(agentic.keys());

  for (const [name, record] of agentic) {
    invariant(record.descriptor.configurable !== false, `agentic method field must be configurable: ${name}`);
    if (record.definition.strategy == null && strategy == null) {
      invariant(false, `agentic method ${name} requires its own strategy or createObjectAgent({ strategy })`);
    }
  }

  const deterministic = collectDeterministicMethods(instance, {
    hidden: hiddenNames,
    metadata: methodMetadata,
    agenticNames,
    prototypeBoundary
  });

  for (const name of methodMetadata.keys()) {
    invariant(
      deterministic.has(name) || agentic.has(name),
      `object agent method metadata references unknown member: ${name}`
    );
  }

  invariant(
    !deterministic.has("then") || deterministic.get("then").hidden,
    "object agent public method 'then' must be hidden"
  );

  const resolvedDiscoveryPolicy = defineDiscoveryPolicy(discoveryPolicy);
  const selfSurface = surfaceFromParts(instance, deterministic, agentic, hiddenNames, methodMetadata);
  const selfDoc = renderObjectAgentDoc(selfSurface, {
    mode: DiscoveryMode.CONCISE,
    policy: resolvedDiscoveryPolicy
  }).document;
  invariant(
    !contextBlocks.some((block) => block?.name === SELF_DISCOVERY_BLOCK),
    `object agent context block name is reserved: ${SELF_DISCOVERY_BLOCK}`
  );
  const selfDiscoveryBlock = Object.freeze({
    name: SELF_DISCOVERY_BLOCK,
    description: "Concise progressive discovery document for the current object agent surface.",
    trust: ContextBlockTrust.TRUSTED,
    value: selfDoc
  });

  const autoCapabilities = [...deterministic.values()]
    .filter((method) => !method.hidden)
    .map((method) => {
      const metadata = methodMetadata.get(method.name) ?? Object.freeze({
        description: null,
        hidden: false,
        mutatesCandidate: false,
        parseArgs: null,
        parseOutput: null
      });
      return Object.freeze({
        name: method.name,
        description: metadata.description,
        mutatesCandidate: metadata.mutatesCandidate,
        parseInput(payload) {
          const args = deterministicArgs(payload);
          const parsed = metadata.parseArgs == null ? args : metadata.parseArgs(Object.freeze([...args]));
          invariant(Array.isArray(parsed), `object agent method ${method.name} parseArgs must return an array`);
          return [...parsed];
        },
        parseOutput: metadata.parseOutput,
        async execute(args) {
          return Reflect.apply(method.implementation, instance, args);
        }
      });
    });

  const autoJudgments = [...agentic.values()].map(judgmentDefinition);
  const runtime = createAgentRuntime({
    ...runtimeOptions,
    strategy: strategy ?? noDefaultStrategy(),
    capabilities: [...autoCapabilities, ...capabilities],
    judgments: [...autoJudgments, ...judgments],
    contextBlocks: [selfDiscoveryBlock, ...contextBlocks]
  });

  for (const [name, method] of agentic) {
    const invoke = async (...args) => runtime.invokeJudgment(
      name,
      defaultAgenticInput(args, method.definition)
    );
    Object.defineProperty(invoke, "report", {
      value: async (...args) => runtime.invokeJudgmentWithReport(
        name,
        defaultAgenticInput(args, method.definition)
      ),
      enumerable: false,
      configurable: false,
      writable: false
    });
    Object.defineProperty(invoke, "withOptions", {
      value: async (options, ...args) => runtime.invokeJudgment(
        name,
        defaultAgenticInput(args, method.definition),
        options ?? {}
      ),
      enumerable: false,
      configurable: false,
      writable: false
    });
    Object.defineProperty(instance, name, {
      value: invoke,
      enumerable: false,
      configurable: false,
      writable: false
    });
  }

  const record = Object.freeze({
    instance,
    runtime,
    deterministic,
    agentic,
    hidden: hiddenNames,
    metadata: methodMetadata,
    discoveryPolicy: resolvedDiscoveryPolicy
  });
  objectAgentRecords.set(instance, record);

  return instance;
}

export function getObjectAgentRuntime(agent) {
  return requireObjectAgentRecord(agent).runtime;
}

export function objectAgentSurface(agent, { includeHidden = false } = {}) {
  invariant(typeof includeHidden === "boolean", "object agent includeHidden must be boolean");
  const record = requireObjectAgentRecord(agent);
  return surfaceFromParts(
    record.instance,
    record.deterministic,
    record.agentic,
    record.hidden,
    record.metadata,
    { includeHidden }
  );
}

export function docObjectAgent(agent, {
  mode = DiscoveryMode.CONCISE,
  policy = null
} = {}) {
  const record = requireObjectAgentRecord(agent);
  return renderObjectAgentDoc(
    objectAgentSurface(agent),
    { mode, policy: policy == null ? record.discoveryPolicy : policy }
  );
}
