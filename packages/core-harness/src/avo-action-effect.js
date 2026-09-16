import { invariant, requireText } from "./contracts.js";
import { environmentActionKey } from "./environment.js";
import {
  EffectOperationStatus,
  EffectReplayPolicy,
  EffectRecoveryRequiredError,
  reconcileEffectOperation
} from "./effect-reconciliation.js";
import {
  CURRENT_STATE_SCHEMA_VERSION,
  assertPersistedRevision
} from "./persistence.js";

const AVO_ACTION_CAPABILITY = "avo.act";
const JOURNAL_PREFIX = "__exharness_avo_action_effects__:";
const OPERATION_PREFIX = "avo-act:";

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function nowDefault() {
  return new Date().toISOString();
}

function errorView(error) {
  return Object.freeze({
    name: error?.name ?? "Error",
    code: error?.code ?? null,
    message: error?.message ?? String(error)
  });
}

function journalStateId(sessionId) {
  return `${JOURNAL_PREFIX}${encodeURIComponent(requireText(sessionId, "AVO action effect sessionId"))}`;
}

function operationParts(operationId) {
  const id = requireText(operationId, "AVO action effect operationId");
  invariant(id.startsWith(OPERATION_PREFIX), "AVO action effect operationId is invalid");
  const suffix = id.slice(OPERATION_PREFIX.length);
  const separator = suffix.lastIndexOf(":");
  invariant(separator > 0 && separator < suffix.length - 1, "AVO action effect operationId is invalid");
  return Object.freeze({
    operationId: id,
    sessionId: decodeURIComponent(suffix.slice(0, separator)),
    actionKey: suffix.slice(separator + 1)
  });
}

function operationIdFor(input) {
  const sessionId = requireText(input?.sessionId, "AVO action effect sessionId");
  const actionKey = environmentActionKey(input);
  return Object.freeze({
    operationId: `${OPERATION_PREFIX}${encodeURIComponent(sessionId)}:${actionKey}`,
    sessionId,
    actionKey
  });
}

function emptyJournalState(sessionId, at) {
  return {
    schemaVersion: CURRENT_STATE_SCHEMA_VERSION,
    revision: 0,
    id: journalStateId(sessionId),
    work: {
      kind: "AVO_ACTION_EFFECT_JOURNAL",
      sessionId
    },
    persistentMemory: {
      effectOperations: []
    },
    trajectory: [],
    supervision: {
      inspections: 0,
      skipped: 0,
      interventions: [],
      lastInspectedEventId: null,
      lastDecision: null
    },
    createdAt: at,
    updatedAt: at
  };
}

function effectPolicy(raw) {
  const value = raw ?? {};
  invariant(value && typeof value === "object" && !Array.isArray(value), "environment.effect must be an object when provided");
  const replayPolicy = value.replayPolicy ?? EffectReplayPolicy.NON_RECONCILABLE;
  invariant(Object.values(EffectReplayPolicy).includes(replayPolicy), "environment.effect.replayPolicy is invalid");
  if (value.observe != null) invariant(typeof value.observe === "function", "environment.effect.observe must be a function");
  if (replayPolicy === EffectReplayPolicy.OBSERVABLE) {
    invariant(typeof value.observe === "function", "OBSERVABLE environment effect requires effect.observe()");
  }
  return Object.freeze({
    replayPolicy,
    observe: value.observe ?? null
  });
}

function createSessionEffectJournal({ sessionStore, clock }) {
  invariant(sessionStore && typeof sessionStore.load === "function", "AVO action effect journal requires sessionStore.load()");
  invariant(sessionStore && typeof sessionStore.save === "function", "AVO action effect journal requires sessionStore.save()");
  const now = clock ?? nowDefault;

  async function loadState(sessionId) {
    const state = await sessionStore.load(journalStateId(sessionId));
    if (state == null) return null;
    state.persistentMemory ??= {};
    state.persistentMemory.effectOperations ??= [];
    return state;
  }

  async function saveState(state) {
    const expectedRevision = state.revision ?? 0;
    state.updatedAt = now();
    const result = await sessionStore.save(state, { expectedRevision });
    state.revision = assertPersistedRevision(result, expectedRevision, {
      required: sessionStore.supportsRevisions === true
    });
    return state;
  }

  async function readRecord(operationId) {
    const parts = operationParts(operationId);
    const state = await loadState(parts.sessionId);
    if (state == null) return null;
    return clone(state.persistentMemory.effectOperations.find((item) => item.operationId === parts.operationId) ?? null);
  }

  async function mutate(operationId, mutator) {
    const parts = operationParts(operationId);
    let state = await loadState(parts.sessionId);
    invariant(state, `AVO action effect journal not found for session ${parts.sessionId}`);
    const index = state.persistentMemory.effectOperations.findIndex((item) => item.operationId === parts.operationId);
    invariant(index >= 0, `AVO action effect operation not found: ${parts.operationId}`);
    const current = clone(state.persistentMemory.effectOperations[index]);
    const next = mutator(current);
    state.persistentMemory.effectOperations[index] = clone(next);
    await saveState(state);
    return clone(next);
  }

  return Object.freeze({
    get: readRecord,

    async list(sessionId) {
      const state = await loadState(sessionId);
      return clone(state?.persistentMemory.effectOperations ?? []);
    },

    async intend(record) {
      const sessionId = requireText(record?.sessionId, "AVO action effect sessionId");
      requireText(record?.operationId, "AVO action effect operationId");
      const parts = operationParts(record.operationId);
      invariant(parts.sessionId === sessionId, "AVO action effect operation does not belong to session");
      invariant(Object.values(EffectReplayPolicy).includes(record.replayPolicy), "AVO action effect replayPolicy is invalid");

      const at = now();
      let state = await loadState(sessionId);
      if (state == null) state = emptyJournalState(sessionId, at);
      invariant(
        !state.persistentMemory.effectOperations.some((item) => item.operationId === record.operationId),
        `AVO action effect operation already exists: ${record.operationId}`
      );
      const intended = {
        ...clone(record),
        capability: AVO_ACTION_CAPABILITY,
        status: EffectOperationStatus.INTENDED,
        result: null,
        error: null,
        evidence: null,
        intendedAt: at,
        dispatchedAt: null,
        confirmedAt: null,
        updatedAt: at
      };
      state.persistentMemory.effectOperations.push(intended);
      await saveState(state);
      return clone(intended);
    },

    async markDispatched(operationId) {
      return mutate(operationId, (current) => {
        invariant(current.status === EffectOperationStatus.INTENDED, `AVO action effect cannot dispatch from ${current.status}`);
        const at = now();
        return {
          ...current,
          status: EffectOperationStatus.DISPATCHED,
          dispatchedAt: at,
          updatedAt: at
        };
      });
    },

    async markConfirmed(operationId, { result = null, evidence = null } = {}) {
      return mutate(operationId, (current) => {
        invariant(
          current.status === EffectOperationStatus.DISPATCHED || current.status === EffectOperationStatus.UNKNOWN,
          `AVO action effect cannot confirm from ${current.status}`
        );
        const at = now();
        return {
          ...current,
          status: EffectOperationStatus.CONFIRMED,
          result: clone(result),
          error: null,
          evidence: clone(evidence),
          confirmedAt: at,
          updatedAt: at
        };
      });
    },

    async markUnknown(operationId, error = null) {
      return mutate(operationId, (current) => {
        invariant(current.status === EffectOperationStatus.DISPATCHED, `AVO action effect cannot become UNKNOWN from ${current.status}`);
        const at = now();
        return {
          ...current,
          status: EffectOperationStatus.UNKNOWN,
          error: error == null ? null : errorView(error),
          updatedAt: at
        };
      });
    },

    async prepareRetry(operationId, { evidence = null } = {}) {
      return mutate(operationId, (current) => {
        invariant(
          current.status === EffectOperationStatus.DISPATCHED || current.status === EffectOperationStatus.UNKNOWN,
          `AVO action effect cannot retry from ${current.status}`
        );
        const at = now();
        return {
          ...current,
          status: EffectOperationStatus.INTENDED,
          error: null,
          evidence: clone(evidence ?? current.evidence),
          updatedAt: at
        };
      });
    }
  });
}

export function createAvoActionEffectBoundary({
  environment,
  sessionStore,
  effect = environment?.effect ?? null,
  clock = null
} = {}) {
  invariant(environment && typeof environment.observe === "function", "AVO action effect boundary requires environment.observe()");
  invariant(environment && typeof environment.act === "function", "AVO action effect boundary requires environment.act()");
  const policy = effectPolicy(effect);
  const journal = createSessionEffectJournal({ sessionStore, clock });

  const recoveryCapability = Object.freeze({
    name: AVO_ACTION_CAPABILITY,
    effect: Object.freeze({
      replayPolicy: policy.replayPolicy,
      observe: policy.observe == null
        ? null
        : ({ operation }) => policy.observe({ operation: clone(operation) })
    })
  });

  async function ensurePolicy(operation) {
    invariant(operation.replayPolicy === policy.replayPolicy, `AVO action effect replayPolicy changed for ${operation.operationId}`);
  }

  async function act(input) {
    const identity = operationIdFor(input);
    let operation = await journal.get(identity.operationId);

    if (operation?.status === EffectOperationStatus.CONFIRMED) {
      await ensurePolicy(operation);
      return clone(operation.result);
    }
    if (operation != null && operation.status !== EffectOperationStatus.INTENDED) {
      await ensurePolicy(operation);
      throw new EffectRecoveryRequiredError({
        operationId: identity.operationId,
        capability: AVO_ACTION_CAPABILITY,
        status: operation.status
      });
    }

    if (operation == null) {
      operation = await journal.intend({
        operationId: identity.operationId,
        sessionId: identity.sessionId,
        actionKey: identity.actionKey,
        replayPolicy: policy.replayPolicy,
        work: clone(input.work),
        candidate: clone(input.candidate),
        action: clone(input.action)
      });
    } else {
      await ensurePolicy(operation);
    }

    await journal.markDispatched(identity.operationId);

    let result;
    try {
      result = await environment.act(input);
    } catch (error) {
      await journal.markUnknown(identity.operationId, error);
      throw error;
    }

    await journal.markConfirmed(identity.operationId, { result });
    return clone(result);
  }

  return Object.freeze({
    environment: Object.freeze({
      observe(input) {
        return environment.observe(input);
      },
      act
    }),

    operationId(input) {
      return operationIdFor(input).operationId;
    },

    async list(sessionId) {
      return journal.list(requireText(sessionId, "AVO action effect sessionId"));
    },

    async reconcile({ sessionId, operationId }) {
      const id = requireText(operationId, "AVO action effect operationId");
      const parts = operationParts(id);
      invariant(parts.sessionId === requireText(sessionId, "AVO action effect sessionId"), "AVO action effect operation belongs to another session");
      const operation = await journal.get(id);
      invariant(operation, `AVO action effect operation not found: ${id}`);
      await ensurePolicy(operation);
      return reconcileEffectOperation({
        capability: recoveryCapability,
        journal,
        operationId: id
      });
    }
  });
}
