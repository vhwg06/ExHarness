import { createHash } from "node:crypto";

import { invariant, requireText } from "./contracts.js";
import { assertPersistedRevision } from "./persistence.js";
import { createInMemorySessionStore } from "./store.js";

export const DetachedOperationStatus = Object.freeze({
  RUNNING: "RUNNING",
  CANCEL_REQUESTED: "CANCEL_REQUESTED",
  SUCCEEDED: "SUCCEEDED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
  UNKNOWN: "UNKNOWN"
});

export const DETACHED_OPERATION_PROTOCOL_VERSION = 1;

const TERMINAL_STATES = Object.freeze([
  DetachedOperationStatus.SUCCEEDED,
  DetachedOperationStatus.FAILED,
  DetachedOperationStatus.CANCELLED,
  DetachedOperationStatus.UNKNOWN
]);

const ALLOWED_TRANSITIONS = Object.freeze({
  [DetachedOperationStatus.RUNNING]: Object.freeze([
    DetachedOperationStatus.CANCEL_REQUESTED,
    DetachedOperationStatus.SUCCEEDED,
    DetachedOperationStatus.FAILED,
    DetachedOperationStatus.CANCELLED,
    DetachedOperationStatus.UNKNOWN
  ]),
  [DetachedOperationStatus.CANCEL_REQUESTED]: Object.freeze([
    DetachedOperationStatus.SUCCEEDED,
    DetachedOperationStatus.FAILED,
    DetachedOperationStatus.CANCELLED,
    DetachedOperationStatus.UNKNOWN
  ])
});

export function isDetachedTerminalStatus(status) {
  return TERMINAL_STATES.includes(status);
}

export class DetachedOperationBindingError extends Error {
  constructor(message, { operationId = null } = {}) {
    super(message);
    this.name = "DetachedOperationBindingError";
    this.code = "DETACHED_OPERATION_BINDING_MISMATCH";
    this.operationId = operationId;
  }
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function stableStringify(value) {
  if (value === null || value === undefined) return "null";
  const kind = typeof value;
  if (kind === "number" || kind === "boolean" || kind === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (kind === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(String(value));
}

export function digestDetachedValue(value) {
  return createHash("sha256").update(stableStringify(value ?? null)).digest("hex");
}

export function deriveDetachedOperationId({
  scopeId,
  capability,
  effectOperationId,
  inputDigest,
  callId = null,
  turn = null,
  actionIntentRef = null,
  deliberationRef = null
}) {
  requireText(scopeId, "detached operation scopeId");
  requireText(capability, "detached operation capability");
  requireText(effectOperationId, "detached operation effectOperationId");
  requireText(inputDigest, "detached operation inputDigest");
  const callBinding = digestDetachedValue({
    callId: callId ?? null,
    turn: turn ?? null,
    actionIntentRef: actionIntentRef ?? null,
    deliberationRef: deliberationRef ?? null
  });
  const digest = digestDetachedValue({
    scopeId,
    capability,
    effectOperationId,
    inputDigest,
    callBinding
  });
  return `detached:${digest.slice(0, 32)}`;
}

export function deriveDetachedTransitionId({ operationId, generation, sequence, status }) {
  requireText(operationId, "detached operation transition operationId");
  invariant(Number.isInteger(generation) && generation >= 1, "detached operation transition generation must be a positive integer");
  invariant(Number.isInteger(sequence) && sequence >= 1, "detached operation transition sequence must be a positive integer");
  requireText(status, "detached operation transition status");
  return `${operationId}:g${generation}:s${sequence}:${status}`;
}

function documentIdFor(scopeId) {
  return `__exharness_detached_operations__:${encodeURIComponent(requireText(scopeId, "detached operation scopeId"))}`;
}

function normalizeBinding(binding, scopeId) {
  invariant(binding && typeof binding === "object", "detached operation binding is required");
  requireText(binding.operationId, "detached operation binding operationId");
  requireText(binding.capability, "detached operation binding capability");
  requireText(binding.inputDigest, "detached operation binding inputDigest");
  requireText(binding.effectOperationId, "detached operation binding effectOperationId");
  requireText(binding.replayPolicy, "detached operation binding replayPolicy");
  invariant(binding.scopeId == null || binding.scopeId === scopeId, "detached operation binding scopeId mismatch");
  return Object.freeze({
    operationId: binding.operationId,
    scopeId,
    capability: binding.capability,
    inputDigest: binding.inputDigest,
    input: clone(binding.input ?? null),
    effectOperationId: binding.effectOperationId,
    replayPolicy: binding.replayPolicy,
    callId: binding.callId ?? null,
    turn: clone(binding.turn ?? null),
    trace: clone(binding.trace ?? null),
    actionIntentRef: clone(binding.actionIntentRef ?? null),
    deliberationRef: clone(binding.deliberationRef ?? null),
    protocolVersion: binding.protocolVersion ?? DETACHED_OPERATION_PROTOCOL_VERSION
  });
}

function bindingMismatchFields(expected, actual) {
  const fields = [
    "capability",
    "inputDigest",
    "effectOperationId",
    "replayPolicy",
    "callId",
    "protocolVersion"
  ];
  const mismatched = [];
  for (const field of fields) {
    if (stableStringify(expected[field] ?? null) !== stableStringify(actual[field] ?? null)) {
      mismatched.push(field);
    }
  }
  for (const field of ["input", "turn", "trace", "actionIntentRef", "deliberationRef"]) {
    if (stableStringify(expected[field] ?? null) !== stableStringify(actual[field] ?? null)) {
      mismatched.push(field);
    }
  }
  return mismatched;
}

function assertBindingMatches(stored, binding) {
  const mismatched = bindingMismatchFields(binding, stored);
  if (mismatched.length > 0) {
    throw new DetachedOperationBindingError(
      `detached operation binding mismatch for ${stored.operationId}: ${mismatched.join(", ")}`,
      { operationId: stored.operationId }
    );
  }
}

function emptyDocument(scopeId, at) {
  return {
    schemaVersion: 2,
    revision: 0,
    id: documentIdFor(scopeId),
    work: { kind: "DETACHED_OPERATION_MANAGER", scopeId },
    persistentMemory: { operations: {}, transitions: [], nextSequence: 1 },
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

function ensureDocumentShape(state, scopeId) {
  invariant(state && typeof state === "object", "detached operation manager state is required");
  state.persistentMemory ??= {};
  state.persistentMemory.operations ??= {};
  state.persistentMemory.transitions ??= [];
  if (!Number.isInteger(state.persistentMemory.nextSequence) || state.persistentMemory.nextSequence < 1) {
    const maxSequence = state.persistentMemory.transitions.reduce(
      (max, item) => Math.max(max, Number.isInteger(item?.sequence) ? item.sequence : 0),
      0
    );
    state.persistentMemory.nextSequence = maxSequence + 1;
  }
  state.work ??= { kind: "DETACHED_OPERATION_MANAGER", scopeId };
  return state;
}

export function createSessionDetachedOperationStore({ sessionStore, scopeId, clock = null } = {}) {
  invariant(sessionStore && typeof sessionStore.load === "function", "detached operation store requires sessionStore.load()");
  invariant(sessionStore && typeof sessionStore.save === "function", "detached operation store requires sessionStore.save()");
  const resolvedScopeId = requireText(scopeId, "detached operation scopeId");
  const now = typeof clock === "function" ? clock : () => new Date().toISOString();
  const documentId = documentIdFor(resolvedScopeId);

  async function loadDocument() {
    const state = await sessionStore.load(documentId);
    if (state == null) return null;
    return ensureDocumentShape(clone(state), resolvedScopeId);
  }

  async function saveDocument(state) {
    const expectedRevision = state.revision ?? 0;
    state.updatedAt = now();
    const result = await sessionStore.save(state, { expectedRevision });
    state.revision = assertPersistedRevision(result, expectedRevision, {
      required: sessionStore.supportsRevisions === true
    });
    return state;
  }

  // Every operation of one scope shares a single manager state document, so a
  // STORE_CONFLICT may be caused by a foreign write to a different operation.
  // An onConflict handler therefore answers with either the final value or
  // `{ retry: true }` to re-run the mutation against the fresh document.
  // Retries stay bounded; an exhausted budget rethrows the conflict loudly.
  async function withDocument(mutator, { retries = 3 } = {}) {
    let attempts = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      attempts += 1;
      let state = await loadDocument();
      if (state == null) {
        const at = now();
        state = emptyDocument(resolvedScopeId, at);
      }
      const outcome = mutator(state);
      try {
        await saveDocument(state);
      } catch (error) {
        if (error?.code === "STORE_CONFLICT" && attempts <= retries) {
          if (outcome?.onConflict != null) {
            const resolution = outcome.onConflict(await loadDocument());
            if (resolution?.retry === true) continue;
            return resolution;
          }
          continue;
        }
        throw error;
      }
      return outcome.value;
    }
  }

  function appendTransition(state, record, { to, result = null, error = null, evidence = null, reason = null }) {
    const sequence = state.persistentMemory.nextSequence;
    state.persistentMemory.nextSequence = sequence + 1;
    const at = now();
    const envelope = {
      transitionId: deriveDetachedTransitionId({
        operationId: record.operationId,
        generation: record.generation,
        sequence,
        status: to
      }),
      operationId: record.operationId,
      scopeId: resolvedScopeId,
      status: to,
      generation: record.generation,
      sequence,
      result: clone(result),
      error: error == null ? null : clone(error),
      evidence: clone(evidence),
      reason,
      at
    };
    record.status = to;
    record.result = clone(result);
    record.error = error == null ? null : clone(error);
    record.evidence = clone(evidence);
    record.reason = reason;
    record.sequence = sequence;
    record.updatedAt = at;
    state.persistentMemory.transitions.push(envelope);
    return clone(envelope);
  }

  return Object.freeze({
    scopeId: resolvedScopeId,

    async create(binding) {
      const normalized = normalizeBinding(binding, resolvedScopeId);
      return withDocument((state) => {
        const existing = state.persistentMemory.operations[normalized.operationId] ?? null;
        if (existing != null) {
          assertBindingMatches(existing, normalized);
          return { value: Object.freeze({ record: clone(existing), transition: null, attached: true }) };
        }
        const at = now();
        const record = {
          ...clone(normalized),
          generation: 1,
          status: DetachedOperationStatus.RUNNING,
          result: null,
          error: null,
          evidence: null,
          reason: null,
          sequence: null,
          diagnostics: [],
          createdAt: at,
          updatedAt: at
        };
        state.persistentMemory.operations[record.operationId] = record;
        const envelope = appendTransition(state, record, { to: DetachedOperationStatus.RUNNING, reason: "scheduled" });
        return {
          value: Object.freeze({ record: clone(record), transition: envelope }),
          onConflict: (current) => {
            const winner = current?.persistentMemory?.operations?.[normalized.operationId] ?? null;
            if (winner == null) return { retry: true };
            assertBindingMatches(winner, normalized);
            return Object.freeze({ record: clone(winner), transition: null, attached: true });
          }
        };
      }).then((outcome) => Object.freeze({
        record: clone(outcome.record),
        transition: outcome.transition == null ? null : clone(outcome.transition),
        attached: outcome.attached === true
      }));
    },

    async read(operationId) {
      requireText(operationId, "detached operation operationId");
      const state = await loadDocument();
      const record = state?.persistentMemory?.operations?.[operationId] ?? null;
      return record == null ? null : clone(record);
    },

    async list() {
      const state = await loadDocument();
      const operations = state?.persistentMemory?.operations ?? {};
      return Object.values(operations).map(clone);
    },

    async transitions({ afterSequence = 0 } = {}) {
      invariant(Number.isInteger(afterSequence) && afterSequence >= 0, "detached operation transitions afterSequence must be a non-negative integer");
      const state = await loadDocument();
      const envelopes = state?.persistentMemory?.transitions ?? [];
      return envelopes
        .filter((item) => (item?.sequence ?? 0) > afterSequence)
        .sort((left, right) => left.sequence - right.sequence)
        .map(clone);
    },

    async transition(operationId, { to, generation, result = null, error = null, evidence = null, reason = null } = {}) {
      requireText(operationId, "detached operation operationId");
      requireText(to, "detached operation transition status");
      invariant(Object.values(DetachedOperationStatus).includes(to), `detached operation transition status is invalid: ${to}`);
      invariant(Number.isInteger(generation) && generation >= 1, "detached operation transition generation must be a positive integer");
      return withDocument((state) => {
        const record = state.persistentMemory.operations[operationId] ?? null;
        invariant(record, `detached operation not found: ${operationId}`);
        if (isDetachedTerminalStatus(record.status)) {
          return { value: Object.freeze({ applied: false, reason: "TERMINAL_IMMUTABLE", current: clone(record) }) };
        }
        if (generation !== record.generation) {
          return { value: Object.freeze({ applied: false, reason: "STALE_GENERATION", current: clone(record) }) };
        }
        invariant(
          (ALLOWED_TRANSITIONS[record.status] ?? []).includes(to),
          `detached operation cannot transition from ${record.status} to ${to}`
        );
        const fromStatus = record.status;
        const envelope = appendTransition(state, record, { to, result, error, evidence, reason });
        return {
          value: Object.freeze({ applied: true, record: clone(record), transition: envelope }),
          onConflict: (current) => {
            const latest = current?.persistentMemory?.operations?.[operationId] ?? null;
            if (latest == null) return { retry: true };
            if (isDetachedTerminalStatus(latest.status)) {
              return Object.freeze({ applied: false, reason: "TERMINAL_IMMUTABLE", current: clone(latest) });
            }
            if (latest.generation !== generation || latest.status !== fromStatus) {
              return Object.freeze({ applied: false, reason: "CONCURRENT_TAKEOVER", current: clone(latest) });
            }
            // The conflict came from a foreign write: this record is
            // observably unchanged, so retry the mutation against the fresh
            // document instead of reporting a spurious conflict.
            return { retry: true };
          }
        };
      });
    },

    async takeover(operationId) {
      requireText(operationId, "detached operation operationId");
      return withDocument((state) => {
        const record = state.persistentMemory.operations[operationId] ?? null;
        invariant(record, `detached operation not found: ${operationId}`);
        if (isDetachedTerminalStatus(record.status)) {
          return { value: Object.freeze({ record: clone(record), tookOver: false }) };
        }
        const fromGeneration = record.generation;
        record.generation += 1;
        record.updatedAt = now();
        return {
          value: Object.freeze({ record: clone(record), tookOver: true }),
          onConflict: (current) => {
            const latest = current?.persistentMemory?.operations?.[operationId] ?? null;
            if (latest == null) return { retry: true };
            // Report tookOver:false only when this operation observably moved
            // (generation advanced or terminal reached); a foreign write to a
            // different operation retries instead of stealing ownership.
            if (isDetachedTerminalStatus(latest.status) || latest.generation !== fromGeneration) {
              return Object.freeze({ record: clone(latest), tookOver: false });
            }
            return { retry: true };
          }
        };
      });
    },

    async noteDiagnostic(operationId, note) {
      requireText(operationId, "detached operation operationId");
      return withDocument((state) => {
        const record = state.persistentMemory.operations[operationId] ?? null;
        invariant(record, `detached operation not found: ${operationId}`);
        record.diagnostics.push({
          at: now(),
          generation: record.generation,
          note: clone(note ?? null)
        });
        record.updatedAt = now();
        return {
          value: clone(record),
          // Always retry: the note lives only in the failed save, so
          // re-running against the fresh document appends it exactly once.
          onConflict: () => ({ retry: true })
        };
      });
    }
  });
}

export function createInMemoryDetachedOperationStore({ scopeId, clock = null } = {}) {
  return createSessionDetachedOperationStore({
    sessionStore: createInMemorySessionStore(),
    scopeId,
    clock
  });
}
