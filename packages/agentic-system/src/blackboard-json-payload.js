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
    const keys = Object.keys(value);
    if (keys.length !== value.length) unsupported(path, "sparse arrays or extra array properties are not supported");
    for (let index = 0; index < value.length; index += 1) {
      if (keys[index] !== String(index)) unsupported(path, "sparse arrays or extra array properties are not supported");
      validateJsonValue(value[index], `${path}[${index}]`, seen);
    }
    return;
  }

  if (Object.getPrototypeOf(value) !== Object.prototype) {
    const constructorName = value?.constructor?.name ?? "non-plain object";
    unsupported(path, `${constructorName} is not a plain JSON object`);
  }
  if (Object.getOwnPropertySymbols(value).length > 0) unsupported(path, "symbol-keyed properties are not supported");
  for (const [key, nested] of Object.entries(value)) validateJsonValue(nested, `${path}.${key}`, seen);
}

export function validateBlackboardPersistedPayload(rawSnapshot) {
  validateJsonValue(rawSnapshot, "$", new WeakMap());
  return rawSnapshot;
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
