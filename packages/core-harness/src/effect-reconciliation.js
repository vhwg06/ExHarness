import { invariant, requireText } from "./contracts.js";

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

export const EffectReplayPolicy = Object.freeze({
  PURE: "PURE",
  IDEMPOTENT: "IDEMPOTENT",
  OBSERVABLE: "OBSERVABLE",
  NON_RECONCILABLE: "NON_RECONCILABLE"
});

export const EffectOperationStatus = Object.freeze({
  INTENDED: "INTENDED",
  DISPATCHED: "DISPATCHED",
  CONFIRMED: "CONFIRMED",
  UNKNOWN: "UNKNOWN"
});

export const EffectRecoveryAction = Object.freeze({
  CONTINUE: "CONTINUE",
  RETRY: "RETRY",
  ESCALATE: "ESCALATE"
});

export class EffectRecoveryRequiredError extends Error {
  constructor({ operationId, capability, status }) {
    super(`effect recovery required for ${capability} operation ${operationId} (${status})`);
    this.name = "EffectRecoveryRequiredError";
    this.code = "EFFECT_RECOVERY_REQUIRED";
    this.operationId = operationId;
    this.capability = capability;
    this.status = status;
  }
}

export function createInMemoryEffectJournal() {
  const records = new Map();

  async function get(operationId) {
    requireText(operationId, "effect operationId");
    return clone(records.get(operationId) ?? null);
  }

  async function put(record) {
    requireText(record?.operationId, "effect operationId");
    records.set(record.operationId, clone(record));
    return clone(record);
  }

  return Object.freeze({
    get,
    async intend(record) {
      requireText(record?.capability, "effect capability");
      invariant(Object.values(EffectReplayPolicy).includes(record.replayPolicy), "effect replayPolicy is invalid");
      const existing = await get(record.operationId);
      invariant(existing == null, `effect operation already exists: ${record.operationId}`);
      return put({
        ...clone(record),
        status: EffectOperationStatus.INTENDED,
        result: null,
        error: null,
        evidence: null
      });
    },
    async markDispatched(operationId) {
      const current = await get(operationId);
      invariant(current, `effect operation not found: ${operationId}`);
      invariant(current.status === EffectOperationStatus.INTENDED, `effect operation cannot dispatch from ${current.status}`);
      return put({ ...current, status: EffectOperationStatus.DISPATCHED });
    },
    async markConfirmed(operationId, { result = null, evidence = null } = {}) {
      const current = await get(operationId);
      invariant(current, `effect operation not found: ${operationId}`);
      invariant(
        current.status === EffectOperationStatus.DISPATCHED || current.status === EffectOperationStatus.UNKNOWN,
        `effect operation cannot confirm from ${current.status}`
      );
      return put({
        ...current,
        status: EffectOperationStatus.CONFIRMED,
        result: clone(result),
        error: null,
        evidence: clone(evidence)
      });
    },
    async markUnknown(operationId, error = null) {
      const current = await get(operationId);
      invariant(current, `effect operation not found: ${operationId}`);
      invariant(current.status === EffectOperationStatus.DISPATCHED, `effect operation cannot become unknown from ${current.status}`);
      return put({
        ...current,
        status: EffectOperationStatus.UNKNOWN,
        error: error == null ? null : errorView(error)
      });
    },
    async prepareRetry(operationId, { evidence = null } = {}) {
      const current = await get(operationId);
      invariant(current, `effect operation not found: ${operationId}`);
      invariant(
        current.status === EffectOperationStatus.UNKNOWN || current.status === EffectOperationStatus.DISPATCHED,
        `effect operation cannot retry from ${current.status}`
      );
      return put({
        ...current,
        status: EffectOperationStatus.INTENDED,
        error: null,
        evidence: clone(evidence ?? current.evidence)
      });
    },
    async list() {
      return [...records.values()].map(clone);
    }
  });
}

function normalizeEffect(effect, capabilityName) {
  invariant(effect && typeof effect === "object", `capability ${capabilityName} requires effect semantics`);
  invariant(Object.values(EffectReplayPolicy).includes(effect.replayPolicy), `capability ${capabilityName} replayPolicy is invalid`);
  invariant(typeof effect.operationKey === "function", `capability ${capabilityName} requires effect.operationKey()`);
  if (effect.observe != null) {
    invariant(typeof effect.observe === "function", `capability ${capabilityName} effect.observe must be a function`);
  }
  if (effect.replayPolicy === EffectReplayPolicy.OBSERVABLE) {
    invariant(typeof effect.observe === "function", `observable capability ${capabilityName} requires effect.observe()`);
  }
  return Object.freeze({
    replayPolicy: effect.replayPolicy,
    operationKey: effect.operationKey,
    observe: effect.observe ?? null,
    desiredEffect: effect.desiredEffect ?? null
  });
}

export function defineEffectCapability(definition, { journal } = {}) {
  invariant(definition && typeof definition === "object", "effect capability definition is required");
  const name = requireText(definition.name, "capability.name");
  invariant(typeof definition.execute === "function", `capability ${name} requires execute()`);
  invariant(journal && typeof journal.get === "function", `capability ${name} requires effect journal get()`);
  invariant(typeof journal.intend === "function", `capability ${name} requires effect journal intend()`);
  invariant(typeof journal.markDispatched === "function", `capability ${name} requires effect journal markDispatched()`);
  invariant(typeof journal.markConfirmed === "function", `capability ${name} requires effect journal markConfirmed()`);
  invariant(typeof journal.markUnknown === "function", `capability ${name} requires effect journal markUnknown()`);

  const effect = normalizeEffect(definition.effect, name);

  return Object.freeze({
    name,
    description: definition.description ?? null,
    mutatesCandidate: definition.mutatesCandidate === true,
    parseInput: definition.parseInput ?? null,
    parseOutput: definition.parseOutput ?? null,
    effect,
    async execute(input, runtime) {
      const operationId = requireText(
        await effect.operationKey({ input: clone(input), runtime: clone(runtime) }),
        `capability ${name} effect operationId`
      );
      let operation = await journal.get(operationId);

      if (operation?.status === EffectOperationStatus.CONFIRMED) {
        return clone(operation.result);
      }
      if (operation != null && operation.status !== EffectOperationStatus.INTENDED) {
        throw new EffectRecoveryRequiredError({
          operationId,
          capability: name,
          status: operation.status
        });
      }

      const desiredEffect = typeof effect.desiredEffect === "function"
        ? await effect.desiredEffect({ input: clone(input), runtime: clone(runtime) })
        : clone(effect.desiredEffect);

      if (operation == null) {
        operation = await journal.intend({
          operationId,
          capability: name,
          replayPolicy: effect.replayPolicy,
          desiredEffect: clone(desiredEffect),
          input: clone(input),
          callId: runtime?.callId ?? null,
          turn: clone(runtime?.turn ?? null)
        });
      }

      invariant(operation.replayPolicy === effect.replayPolicy, `effect replayPolicy changed for operation ${operationId}`);
      await journal.markDispatched(operationId);

      try {
        const result = await definition.execute(input, Object.freeze({
          ...runtime,
          effect: Object.freeze({
            operationId,
            replayPolicy: effect.replayPolicy,
            desiredEffect: clone(operation.desiredEffect)
          })
        }));
        await journal.markConfirmed(operationId, { result });
        return result;
      } catch (error) {
        await journal.markUnknown(operationId, error);
        throw error;
      }
    }
  });
}

export async function reconcileEffectOperation({ capability, journal, operationId }) {
  invariant(capability && typeof capability === "object", "effect reconciliation requires capability");
  invariant(capability.effect && typeof capability.effect === "object", "effect reconciliation requires capability.effect");
  invariant(journal && typeof journal.get === "function", "effect reconciliation requires journal.get()");
  invariant(typeof journal.prepareRetry === "function", "effect reconciliation requires journal.prepareRetry()");
  const id = requireText(operationId, "effect operationId");
  const record = await journal.get(id);
  invariant(record, `effect operation not found: ${id}`);

  if (record.status === EffectOperationStatus.CONFIRMED) {
    return Object.freeze({ action: EffectRecoveryAction.CONTINUE, operation: record });
  }

  switch (record.replayPolicy) {
    case EffectReplayPolicy.PURE:
    case EffectReplayPolicy.IDEMPOTENT: {
      const retryable = record.status === EffectOperationStatus.INTENDED
        ? record
        : await journal.prepareRetry(id);
      return Object.freeze({ action: EffectRecoveryAction.RETRY, operation: retryable });
    }

    case EffectReplayPolicy.OBSERVABLE: {
      const observation = await capability.effect.observe({ operation: clone(record) });
      invariant(observation && typeof observation === "object", "effect observer must return an object");
      invariant(typeof observation.satisfied === "boolean", "effect observer must return satisfied boolean");

      if (observation.satisfied) {
        const confirmed = await journal.markConfirmed(id, {
          result: clone(observation.result ?? record.result),
          evidence: clone(observation.evidence ?? null)
        });
        return Object.freeze({ action: EffectRecoveryAction.CONTINUE, operation: confirmed });
      }

      const retryable = record.status === EffectOperationStatus.INTENDED
        ? record
        : await journal.prepareRetry(id, { evidence: observation.evidence ?? null });
      return Object.freeze({
        action: EffectRecoveryAction.RETRY,
        operation: retryable,
        evidence: clone(observation.evidence ?? null)
      });
    }

    case EffectReplayPolicy.NON_RECONCILABLE:
      return Object.freeze({ action: EffectRecoveryAction.ESCALATE, operation: record });

    default:
      throw new Error(`unsupported effect replay policy: ${record.replayPolicy}`);
  }
}
