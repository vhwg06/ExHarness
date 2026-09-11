import { invariant, requireText } from "./contracts.js";
import { ModelRouteError } from "./errors.js";
import { defineModelAdapter, modelAdapterView } from "./model.js";

export const ModelRouteScope = Object.freeze({
  INVOCATION: "INVOCATION",
  JUDGMENT: "JUDGMENT",
  RUNTIME: "RUNTIME",
  STRATEGY: "STRATEGY"
});

export function defineModelSelector(value, label = "model selector") {
  if (value == null) return null;
  if (typeof value === "string") {
    return Object.freeze({ name: requireText(value, label) });
  }
  invariant(value && typeof value === "object" && !Array.isArray(value), `${label} must be a model name or selector object`);
  return Object.freeze({ name: requireText(value.name, `${label}.name`) });
}

function normalizeRegistration(definition) {
  invariant(definition && typeof definition === "object", "model registration is required");
  if (typeof definition.generate === "function") {
    const adapter = defineModelAdapter(definition);
    return Object.freeze({
      name: adapter.name,
      load: async () => adapter
    });
  }
  const name = requireText(definition.name, "model registration name");
  invariant(typeof definition.load === "function", `model registration ${name} requires load()`);
  return Object.freeze({ name, load: definition.load });
}

export function createModelRegistry({ models = [] } = {}) {
  invariant(Array.isArray(models), "model registry models must be an array");
  const registrations = new Map();
  const resolved = new Map();
  const pending = new Map();

  for (const definition of models) {
    const registration = normalizeRegistration(definition);
    invariant(!registrations.has(registration.name), `duplicate model registration: ${registration.name}`);
    registrations.set(registration.name, registration);
  }

  async function resolve(selector) {
    const normalized = defineModelSelector(selector);
    invariant(normalized, "model resolution requires a selector");
    if (resolved.has(normalized.name)) return resolved.get(normalized.name);
    if (pending.has(normalized.name)) return pending.get(normalized.name);

    const registration = registrations.get(normalized.name);
    if (!registration) {
      throw new ModelRouteError(
        `model not registered: ${normalized.name}`,
        { requestedModel: normalized.name }
      );
    }

    const loading = Promise.resolve()
      .then(() => registration.load())
      .then((candidate) => {
        let adapter;
        try {
          adapter = defineModelAdapter(candidate);
        } catch (error) {
          throw new ModelRouteError(
            `model loader ${normalized.name} returned an invalid adapter`,
            { requestedModel: normalized.name },
            error
          );
        }
        if (adapter.name !== normalized.name) {
          throw new ModelRouteError(
            `model loader ${normalized.name} returned adapter ${adapter.name}`,
            { requestedModel: normalized.name, resolvedModel: adapter.name }
          );
        }
        resolved.set(normalized.name, adapter);
        return adapter;
      })
      .finally(() => {
        pending.delete(normalized.name);
      });

    pending.set(normalized.name, loading);
    return loading;
  }

  return Object.freeze({
    async resolve(selector) {
      return resolve(selector);
    },

    registrations() {
      return Object.freeze([...registrations.keys()]);
    },

    loaded() {
      return Object.freeze([...resolved.values()].map(modelAdapterView));
    }
  });
}

export function selectModelRoute({ invocation = null, judgment = null, runtime = null } = {}) {
  const selected = invocation != null
    ? { selector: defineModelSelector(invocation, "invocation model"), scope: ModelRouteScope.INVOCATION }
    : judgment != null
      ? { selector: defineModelSelector(judgment, "judgment model"), scope: ModelRouteScope.JUDGMENT }
      : runtime != null
        ? { selector: defineModelSelector(runtime, "runtime model"), scope: ModelRouteScope.RUNTIME }
        : null;
  return selected == null ? null : Object.freeze(selected);
}

export async function resolveModelRoute(registry, route) {
  if (route == null) return null;
  invariant(registry && typeof registry.resolve === "function", "model route requires registry.resolve()");
  let resolvedAdapter;
  try {
    resolvedAdapter = defineModelAdapter(await registry.resolve(route.selector));
  } catch (error) {
    if (error instanceof ModelRouteError) throw error;
    throw new ModelRouteError(
      `model route ${route.selector.name} did not resolve a valid adapter`,
      { requestedModel: route.selector.name },
      error
    );
  }
  if (resolvedAdapter.name !== route.selector.name) {
    throw new ModelRouteError(
      `model route ${route.selector.name} resolved adapter ${resolvedAdapter.name}`,
      { requestedModel: route.selector.name, resolvedModel: resolvedAdapter.name }
    );
  }

  let generateCalls = 0;
  const adapter = defineModelAdapter({
    name: resolvedAdapter.name,
    version: resolvedAdapter.version,
    async generate(request) {
      generateCalls += 1;
      return resolvedAdapter.generate(request);
    }
  });
  const provenance = Object.freeze({
    scope: route.scope,
    requested: Object.freeze({ ...route.selector }),
    adapter: modelAdapterView(adapter)
  });

  return Object.freeze({
    scope: route.scope,
    requested: Object.freeze({ ...route.selector }),
    adapter,
    provenance,
    usage() {
      return Object.freeze({
        adapter: modelAdapterView(adapter),
        calls: generateCalls
      });
    }
  });
}
