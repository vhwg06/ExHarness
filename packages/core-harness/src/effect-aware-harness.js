import { invariant } from "./contracts.js";
import { createAvoActionEffectBoundary } from "./avo-action-effect.js";
import { createAVOHarness as createBaseAVOHarness } from "./avo-harness.js";
import { createHarness as createBaseHarness } from "./harness.js";
import { createInMemorySessionStore } from "./store.js";

function bindActionEffects(factory, rawOptions, { defaultStore }) {
  invariant(rawOptions && typeof rawOptions === "object", "harness options are required");
  invariant(rawOptions.environment, "harness requires environment");

  const sessionStore = rawOptions.sessionStore ?? (defaultStore ? createInMemorySessionStore() : null);
  invariant(sessionStore, "effect-aware AVO harness requires sessionStore");

  const boundary = createAvoActionEffectBoundary({
    environment: rawOptions.environment,
    sessionStore,
    effect: rawOptions.actionEffect ?? rawOptions.environment?.effect ?? null,
    clock: rawOptions.clock ?? null
  });

  const {
    actionEffect: _actionEffect,
    ...baseOptions
  } = rawOptions;
  const base = factory({
    ...baseOptions,
    sessionStore,
    environment: boundary.environment
  });

  return Object.freeze({
    ...base,

    actionEffects(sessionId) {
      return boundary.list(sessionId);
    },

    reconcileActionEffect(sessionId, operationId) {
      return boundary.reconcile({ sessionId, operationId });
    }
  });
}

export function createEffectAwareHarness(options) {
  return bindActionEffects(createBaseHarness, options, { defaultStore: true });
}

export function createEffectAwareAVOHarness(options) {
  return bindActionEffects(createBaseAVOHarness, options, { defaultStore: false });
}
