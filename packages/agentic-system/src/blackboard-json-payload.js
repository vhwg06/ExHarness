import {
  createJsonBlackboardStore as createStructuralBlackboardStore,
  defineBlackboardSnapshot as defineStructuralBlackboardSnapshot
} from "./blackboard-graph.js";

function invariant(condition, message) {
  if (!condition) throw new TypeError(message);
}

function freezeClone(value) {
  return Object.freeze(structuredClone(value));
}

function unsupported(path, detail) {
  throw new TypeError(`Blackboard persisted payload invalid at ${path}: ${detail}`);
}

function validateJsonDataProperty(descriptor, path, seen) {
  if (!descriptor.enumerable) unsupported(path, "non-enumerable properties are not preserved by JSON persistence");
  if (!("value" in descriptor)) unsupported(path, "accessor properties are not supported by the persisted JSON-value contract");
  validateJsonValue(descriptor.value, path, seen);
}

function validateJsonValue(value, path, seen) {
  if (value === null) return;
  const type = typeof value;
  if (type === "string" || type === "boolean") return;
  if (type === "number") {
    if (!Number.isFinite(value)) unsupported(path, "number must be finite");
    if (Object.is(value, -0)) unsupported(path, "negative zero is not preserved by JSON persistence");
    return;
  }
  if (type !== "object") unsupported(path, `unsupported ${type} value`);

  if (seen.has(value)) {
    unsupported(path, `object graph reuses or cycles to ${seen.get(value)}; JSON persistence cannot preserve object identity`);
  }
  seen.set(value, path);

  if (Array.isArray(value)) {
    if (Object.getOwnPropertySymbols(value).length > 0) unsupported(path, "symbol-keyed array properties are not supported");
    const names = Object.getOwnPropertyNames(value).filter((name) => name !== "length");
    if (names.length !== value.length) unsupported(path, "sparse arrays or extra array properties are not supported");
    for (let index = 0; index < value.length; index += 1) {
      const key = String(index);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor == null) unsupported(path, "sparse arrays or extra array properties are not supported");
      validateJsonDataProperty(descriptor, `${path}[${index}]`, seen);
    }
    return;
  }

  if (Object.getPrototypeOf(value) !== Object.prototype) {
    const constructorName = value?.constructor?.name ?? "non-plain object";
    unsupported(path, `${constructorName} is not a plain JSON object`);
  }
  if (Object.getOwnPropertySymbols(value).length > 0) unsupported(path, "symbol-keyed properties are not supported");
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    validateJsonDataProperty(descriptor, `${path}.${key}`, seen);
  }
}

export function validateBlackboardPersistedPayload(value, { path = "$" } = {}) {
  invariant(typeof path === "string" && path.length > 0, "persisted payload validation path must be a non-empty string");
  validateJsonValue(value, path, new WeakMap());
  return value;
}

export function defineBlackboardSnapshot(raw = { version: 1, items: [] }) {
  validateBlackboardPersistedPayload(raw);
  const snapshot = defineStructuralBlackboardSnapshot(raw);
  validateBlackboardPersistedPayload(snapshot);
  return snapshot;
}

export function createJsonBlackboardStore(options) {
  const store = createStructuralBlackboardStore(options);

  return Object.freeze({
    async load() {
      const snapshot = await store.load();
      validateBlackboardPersistedPayload(snapshot);
      return snapshot;
    },

    async transact(mutator) {
      invariant(typeof mutator === "function", "Blackboard store transact requires a mutator");
      const transaction = await store.transact(async (snapshot) => {
        validateBlackboardPersistedPayload(snapshot);
        const result = await mutator(snapshot);
        const acknowledgedResult = structuredClone(result);
        validateBlackboardPersistedPayload(snapshot);
        return acknowledgedResult;
      });
      validateBlackboardPersistedPayload(transaction.snapshot);
      return freezeClone(transaction);
    },

    async diagnoseDependencyGraph() {
      return store.diagnoseDependencyGraph();
    },

    async repairDependencyGraph(input) {
      const result = await store.repairDependencyGraph(input);
      validateBlackboardPersistedPayload(result.snapshot);
      return freezeClone(result);
    }
  });
}
