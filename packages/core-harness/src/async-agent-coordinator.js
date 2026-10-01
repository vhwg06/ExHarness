import { invariant, requireText } from "./contracts.js";
import { assertPersistedRevision } from "./persistence.js";
import {
  commitAsyncResultContext,
  createAsyncResultContextState,
  projectAsyncResultRequest,
  restoreAsyncResultContextState,
  stageAsyncResultTransitions
} from "./async-result-context.js";

export const ASYNC_COORDINATOR_SCHEMA_VERSION = 1;
export const ASYNC_AGENT_COORDINATOR_STATE_KIND = "ASYNC_AGENT_COORDINATOR_STATE/v1";
export const ASYNC_AGENT_INGRESS_KIND = "ASYNC_AGENT_INGRESS/v1";

export const AsyncAgentIngressKind = Object.freeze({
  USER_INPUT: "USER_INPUT",
  STOP: "STOP",
  OPERATION_TRANSITION: "OPERATION_TRANSITION",
  EXPLICIT_WAKE: "EXPLICIT_WAKE"
});

export const ASYNC_COORDINATOR_DEFAULT_PROFILE = Object.freeze({
  completionIdleMs: 1,
  maxCoalescedTransitions: 100,
  quickCompletionGraceMs: 1000
});

export class AsyncCoordinatorDependencyContradictionError extends Error {
  constructor(message, { taskId = null } = {}) {
    super(message);
    this.name = "AsyncCoordinatorDependencyContradictionError";
    this.code = "PLAN_INPUT_CONTRADICTION";
    this.taskId = taskId;
  }
}

export class AsyncCoordinatorBindingError extends Error {
  constructor(message, { operationId = null, transitionId = null, inputId = null } = {}) {
    super(message);
    this.name = "AsyncCoordinatorBindingError";
    this.code = "ASYNC_COORDINATOR_BINDING_MISMATCH";
    this.operationId = operationId;
    this.transitionId = transitionId;
    this.inputId = inputId;
  }
}

export class AsyncCoordinatorAuthorityError extends Error {
  constructor(message) {
    super(message);
    this.name = "AsyncCoordinatorAuthorityError";
    this.code = "ASYNC_COORDINATOR_NON_AUTHORITY";
  }
}

export class AsyncCoordinatorStopFencedError extends Error {
  constructor(message) {
    super(message);
    this.name = "AsyncCoordinatorStopFencedError";
    this.code = "ASYNC_COORDINATOR_STOP_FENCED";
  }
}

export function getAsyncCoordinatorDependencyManifest() {
  return Object.freeze({
    schemaVersion: 1,
    contract: "BB-080_DEPENDENCY_MANIFEST_V1",
    requires: Object.freeze([
      Object.freeze({
        taskId: "BB-077",
        status: "DONE",
        implementationResultRef: "docs/blackboard/artifacts/ready-implement-plan/BB-077.implementation-result.json",
        judgmentRef: "docs/blackboard/artifacts/ready-implement-plan/BB-077.candidate-jev-evaluation.json",
        deliveredRef: "docs/blackboard/artifacts/ready-implement-plan/BB-077.delivered-feature.json",
        livingRefs: Object.freeze([
          "docs/living/system/core-harness/state.md",
          "docs/living/system/core-harness/workflow.md"
        ]),
        accountingVocabulary: Object.freeze(["stable-prefix", "dynamic-suffix", "CONFIRMED", "MISS", "ELIGIBLE", "UNKNOWN"]),
        telemetryRule: "missing provider cache fields stay null/unknown, never zero"
      }),
      Object.freeze({
        taskId: "BB-078",
        status: "DONE",
        implementationResultRef: "docs/blackboard/artifacts/ready-implement-plan/BB-078.implementation-result.json",
        judgmentRef: "docs/blackboard/artifacts/ready-implement-plan/BB-078.candidate-jev-evaluation.json",
        deliveredRef: "docs/blackboard/artifacts/ready-implement-plan/BB-078.delivered-feature.json",
        livingRefs: Object.freeze([
          "docs/living/system/core-harness/state.md",
          "docs/living/system/core-harness/workflow.md"
        ]),
        transitionEnvelope: Object.freeze([
          "transitionId",
          "operationId",
          "scopeId",
          "status",
          "generation",
          "sequence",
          "result",
          "error",
          "evidence",
          "reason",
          "at"
        ]),
        storeApi: Object.freeze([
          "createSessionDetachedOperationStore",
          "createInMemoryDetachedOperationStore",
          "createDetachedOperationManager"
        ])
      }),
      Object.freeze({
        taskId: "BB-079",
        status: "DONE",
        implementationResultRef: "docs/blackboard/artifacts/ready-implement-plan/BB-079.implementation-result.json",
        judgmentRef: "docs/blackboard/artifacts/ready-implement-plan/BB-079.candidate-jev-evaluation.json",
        deliveredRef: "docs/blackboard/artifacts/ready-implement-plan/BB-079.delivered-feature.json",
        livingRefs: Object.freeze([
          "docs/living/system/core-harness/state.md",
          "docs/living/system/core-harness/workflow.md"
        ]),
        checkpointApi: Object.freeze([
          "createAsyncResultContextState",
          "stageAsyncResultTransitions",
          "commitAsyncResultContext",
          "restoreAsyncResultContextState",
          "projectAsyncResultRequest"
        ]),
        providerModes: Object.freeze(["NATIVE_PENDING_CALL", "HANDLE_THEN_EVENT", "SYNCHRONOUS"])
      })
    ])
  });
}

export function assertDependencyContract({ bb077, bb078, bb079 } = {}) {
  const manifest = getAsyncCoordinatorDependencyManifest();
  const expected077 = manifest.requires[0];
  const expected078 = manifest.requires[1];
  const expected079 = manifest.requires[2];
  for (const [label, value, expected] of [
    ["BB-077", bb077, expected077],
    ["BB-078", bb078, expected078],
    ["BB-079", bb079, expected079]
  ]) {
    if (value == null || typeof value !== "object") {
      throw new AsyncCoordinatorDependencyContradictionError(
        `${label} dependency descriptor is missing: worker must bind to the exact DONE implementation-result/judgment/Living refs`,
        { taskId: label }
      );
    }
    if (value.status !== "DONE") {
      throw new AsyncCoordinatorDependencyContradictionError(
        `${label} is not DONE (status=${value.status ?? "unknown"}): BB-080 worker execution requires DONE dependencies`,
        { taskId: label }
      );
    }
    for (const field of ["implementationResultRef", "judgmentRef", "deliveredRef"]) {
      if (value[field] !== expected[field]) {
        throw new AsyncCoordinatorDependencyContradictionError(
          `${label} ${field} mismatch: expected ${expected[field]}, received ${value[field] ?? "missing"}`,
          { taskId: label }
        );
      }
    }
  }
  if (bb078.transitionEnvelope != null) {
    const missing = expected078.transitionEnvelope.filter((f) => !bb078.transitionEnvelope.includes(f));
    if (missing.length > 0) {
      throw new AsyncCoordinatorDependencyContradictionError(
        `BB-078 transition envelope is incompatible: missing ${missing.join(", ")}`,
        { taskId: "BB-078" }
      );
    }
  }
  if (bb078.storeApi != null) {
    const missing = expected078.storeApi.filter((n) => !bb078.storeApi.includes(n));
    if (missing.length > 0) {
      throw new AsyncCoordinatorDependencyContradictionError(
        `BB-078 store API is incompatible: missing ${missing.join(", ")}`,
        { taskId: "BB-078" }
      );
    }
  }
  if (bb077.accountingVocabulary != null) {
    const missing = expected077.accountingVocabulary.filter((t) => !bb077.accountingVocabulary.includes(t));
    if (missing.length > 0) {
      throw new AsyncCoordinatorDependencyContradictionError(
        `BB-077 accounting vocabulary is incompatible: missing ${missing.join(", ")}`,
        { taskId: "BB-077" }
      );
    }
  }
  if (bb079.checkpointApi != null) {
    const missing = expected079.checkpointApi.filter((n) => !bb079.checkpointApi.includes(n));
    if (missing.length > 0) {
      throw new AsyncCoordinatorDependencyContradictionError(
        `BB-079 checkpoint API is incompatible: missing ${missing.join(", ")}`,
        { taskId: "BB-079" }
      );
    }
  }
  if (bb079.providerModes != null) {
    const missing = expected079.providerModes.filter((m) => !bb079.providerModes.includes(m));
    if (missing.length > 0) {
      throw new AsyncCoordinatorDependencyContradictionError(
        `BB-079 provider modes are incompatible: missing ${missing.join(", ")}`,
        { taskId: "BB-079" }
      );
    }
  }
  return Object.freeze({ satisfied: true, contract: manifest.contract });
}

export function resolveEffectConfirmationFromCoordinator() {
  throw new AsyncCoordinatorAuthorityError(
    "async coordinator wake/cancellation state cannot confirm EffectOperation truth: confirmation requires the effect journal/reconciliation authority"
  );
}

export function resolveProductAcceptanceFromCoordinator() {
  throw new AsyncCoordinatorAuthorityError(
    "async coordinator wake/cancellation state cannot accept a product result: acceptance requires independent evaluation authority"
  );
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
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(String(value));
}

function digestValue(value) {
  let hash = 0;
  const text = stableStringify(value ?? null);
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) | 0;
  }
  return `digest:${(hash >>> 0).toString(16)}:${text.length}`;
}

function documentIdFor(sessionId) {
  return `__exharness_async_coordinator__:${encodeURIComponent(requireText(sessionId, "async coordinator sessionId"))}`;
}

function emptyDocument(sessionId, at) {
  return {
    schemaVersion: 2,
    revision: 0,
    id: documentIdFor(sessionId),
    work: { kind: "ASYNC_AGENT_COORDINATOR", sessionId },
    persistentMemory: {
      sessionId,
      nextIngressSeq: 1,
      ingress: [],
      dedupeByInputId: {},
      dedupeByTransitionId: {},
      dedupeTransitionBindings: {},
      dedupeInputDigests: {},
      wake: null,
      modelGeneration: 1,
      currentSubmission: null,
      stopFence: null,
      asyncContext: createAsyncResultContextState(),
      lastCommittedModelTurn: null,
      quickGraceUntil: null,
      completionBurst: { count: 0, lastAt: null, startedAt: null },
      lastStagedTransitionSequence: 0,
      metrics: {
        replacementTurns: 0,
        aborts: 0,
        fences: 0,
        coalescedTransitions: 0,
        duplicateTransitionsSkipped: 0,
        duplicateInputsSkipped: 0,
        recoveryTurns: 0,
        steeringLatenciesMs: [],
        lastSteeringAt: null
      }
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

function ensureShape(state, sessionId) {
  invariant(state && typeof state === "object", "async coordinator state is required");
  state.persistentMemory ??= {};
  const pm = state.persistentMemory;
  pm.sessionId ??= sessionId;
  pm.nextIngressSeq ??= 1;
  pm.ingress ??= [];
  pm.dedupeByInputId ??= {};
  pm.dedupeByTransitionId ??= {};
  pm.dedupeTransitionBindings ??= {};
  pm.dedupeInputDigests ??= {};
  if (pm.wake === undefined) pm.wake = null;
  pm.modelGeneration ??= 1;
  if (pm.currentSubmission === undefined) pm.currentSubmission = null;
  if (pm.stopFence === undefined) pm.stopFence = null;
  pm.asyncContext ??= createAsyncResultContextState();
  if (pm.lastCommittedModelTurn === undefined) pm.lastCommittedModelTurn = null;
  if (pm.quickGraceUntil === undefined) pm.quickGraceUntil = null;
  pm.completionBurst ??= { count: 0, lastAt: null, startedAt: null };
  pm.lastStagedTransitionSequence ??= 0;
  pm.metrics ??= {
    replacementTurns: 0,
    aborts: 0,
    fences: 0,
    coalescedTransitions: 0,
    duplicateTransitionsSkipped: 0,
    duplicateInputsSkipped: 0,
    recoveryTurns: 0,
    steeringLatenciesMs: [],
    lastSteeringAt: null
  };
  state.work ??= { kind: "ASYNC_AGENT_COORDINATOR", sessionId };
  return state;
}

function transitionBindingKey(t) {
  return stableStringify({
    operationId: t.operationId,
    callId: t.callId ?? null,
    effectOperationId: t.effectOperationId ?? null,
    generation: t.generation,
    sequence: t.sequence,
    status: t.status
  });
}

export function createAsyncAgentCoordinator({
  sessionStore,
  sessionId,
  scopeId = null,
  operationManager = null,
  profile = null,
  clock = null,
  nowIso = null,
  dependencies = null
} = {}) {
  invariant(sessionStore && typeof sessionStore.load === "function", "async coordinator requires sessionStore.load()");
  invariant(sessionStore && typeof sessionStore.save === "function", "async coordinator requires sessionStore.save()");
  const resolvedSessionId = requireText(scopeId ?? sessionId, "async coordinator sessionId/scopeId");
  const resolvedProfile = Object.freeze({
    completionIdleMs: profile?.completionIdleMs ?? ASYNC_COORDINATOR_DEFAULT_PROFILE.completionIdleMs,
    maxCoalescedTransitions: profile?.maxCoalescedTransitions ?? ASYNC_COORDINATOR_DEFAULT_PROFILE.maxCoalescedTransitions,
    quickCompletionGraceMs: profile?.quickCompletionGraceMs ?? ASYNC_COORDINATOR_DEFAULT_PROFILE.quickCompletionGraceMs
  });
  invariant(Number.isInteger(resolvedProfile.completionIdleMs) && resolvedProfile.completionIdleMs >= 0, "coordinator completionIdleMs must be a non-negative integer");
  invariant(Number.isInteger(resolvedProfile.maxCoalescedTransitions) && resolvedProfile.maxCoalescedTransitions >= 1, "coordinator maxCoalescedTransitions must be a positive integer");
  invariant(Number.isInteger(resolvedProfile.quickCompletionGraceMs) && resolvedProfile.quickCompletionGraceMs >= 0, "coordinator quickCompletionGraceMs must be a non-negative integer");
  const nowMs = typeof clock === "function" ? clock : () => Date.now();
  const nowText = typeof nowIso === "function" ? nowIso : () => new Date().toISOString();
  if (dependencies != null) {
    assertDependencyContract(dependencies);
  }

  const documentId = documentIdFor(resolvedSessionId);
  // In-memory transport only: AbortControllers for each generation. Durable
  // truth stays in the CAS document; the signal is a cooperative hint and can
  // never relabel an unresolved external effect.
  const abortControllers = new Map();
  function controllerFor(generation) {
    let entry = abortControllers.get(generation);
    if (entry == null) {
      entry = new AbortController();
      abortControllers.set(generation, entry);
    }
    return entry;
  }
  function signalFor(generation) {
    return controllerFor(generation).signal;
  }
  function abortGeneration(generation, reason = "fenced") {
    const entry = abortControllers.get(generation);
    if (entry != null && !entry.signal.aborted) {
      try { entry.abort(reason); } catch { /* ignore */ }
    }
  }

  async function loadDocument() {
    const state = await sessionStore.load(documentId);
    if (state == null) return null;
    return ensureShape(clone(state), resolvedSessionId);
  }

  async function saveDocument(state) {
    const expectedRevision = state.revision ?? 0;
    state.updatedAt = nowText();
    const result = await sessionStore.save(state, { expectedRevision });
    state.revision = assertPersistedRevision(result, expectedRevision, {
      required: sessionStore.supportsRevisions === true
    });
    return state;
  }

  async function withDocument(mutator, { retries = 5 } = {}) {
    let attempts = 0;
    while (true) {
      attempts += 1;
      let state = await loadDocument();
      if (state == null) {
        state = emptyDocument(resolvedSessionId, nowText());
      }
      const outcome = await mutator(state);
      try {
        await saveDocument(state);
      } catch (error) {
        if (error?.code === "STORE_CONFLICT" && attempts <= retries) continue;
        throw error;
      }
      return outcome;
    }
  }

  async function readState() {
    const state = await loadDocument();
    if (state == null) return ensureShape(emptyDocument(resolvedSessionId, nowText()), resolvedSessionId);
    return state;
  }

  function extendOrCreateWake(pm, { coversUpToSeq, reason, kind, at }) {
    if (pm.wake != null) {
      if (coversUpToSeq > (pm.wake.coversUpToSeq ?? 0)) {
        pm.wake.coversUpToSeq = coversUpToSeq;
      }
      return { created: false, wake: clone(pm.wake) };
    }
    const wakeId = `wake:${pm.nextIngressSeq - 1}:${reason}:${coversUpToSeq}`;
    pm.wake = { wakeId, coversUpToSeq, reason, kind, at };
    return { created: true, wake: clone(pm.wake) };
  }

  async function enrichTransition(transition, manager) {
    const t = { ...(transition ?? {}) };
    if (t.callId == null || t.effectOperationId == null) {
      const active = manager ?? operationManager;
      if (active != null && typeof active.read === "function" && t.operationId != null) {
        try {
          const record = await active.read(t.operationId);
          if (record != null) {
            if (t.callId == null && record.callId != null) t.callId = record.callId;
            if (t.effectOperationId == null && record.effectOperationId != null) t.effectOperationId = record.effectOperationId;
          }
        } catch { /* fall through to fail-closed below */ }
      }
      if (t.binding != null && typeof t.binding === "object") {
        if (t.callId == null && t.binding.callId != null) t.callId = t.binding.callId;
        if (t.effectOperationId == null && t.binding.effectOperationId != null) t.effectOperationId = t.binding.effectOperationId;
      }
    }
    return t;
  }

  async function ingestUserInput({ inputId, input = null } = {}) {
    requireText(inputId, "async coordinator USER_INPUT inputId");
    const at = nowText();
    const now = nowMs();
    let fencedGeneration = null;
    const outcome = await withDocument((state) => {
      const pm = state.persistentMemory;
      const existing = pm.dedupeByInputId[inputId];
      if (existing != null) {
        const digest = digestValue(clone(input));
        if (pm.dedupeInputDigests[inputId] != null && pm.dedupeInputDigests[inputId] !== digest) {
          throw new AsyncCoordinatorBindingError(
            `async coordinator USER_INPUT inputId reuse with conflicting payload: ${inputId}`,
            { inputId }
          );
        }
        pm.metrics.duplicateInputsSkipped += 1;
        const found = pm.ingress.find((e) => e.ingressSeq === existing.seq) ?? null;
        return { envelope: found == null ? null : clone(found), duplicate: true, wake: pm.wake == null ? null : clone(pm.wake), generation: pm.modelGeneration };
      }
      const seq = pm.nextIngressSeq;
      pm.nextIngressSeq = seq + 1;
      const envelope = Object.freeze({
        kind: ASYNC_AGENT_INGRESS_KIND,
        schemaVersion: ASYNC_COORDINATOR_SCHEMA_VERSION,
        ingressSeq: seq,
        ingressKind: AsyncAgentIngressKind.USER_INPUT,
        inputId,
        payload: clone(input),
        at
      });
      pm.ingress.push(clone(envelope));
      pm.dedupeByInputId[inputId] = { seq };
      pm.dedupeInputDigests[inputId] = digestValue(clone(input));
      // Steering bypasses every completion window immediately.
      pm.quickGraceUntil = null;
      pm.completionBurst = { count: 0, lastAt: null, startedAt: null };
      pm.metrics.lastSteeringAt = now;
      if (pm.stopFence != null) {
        // Persisted ordering only; STOP fence blocks any new wake/dispatch.
        return { envelope: clone(envelope), duplicate: false, wake: null, fencedByStop: true, generation: pm.modelGeneration };
      }
      if (pm.currentSubmission != null && pm.currentSubmission.status === "ACTIVE") {
        fencedGeneration = pm.currentSubmission.generation;
        pm.modelGeneration += 1;
        pm.metrics.fences += 1;
        pm.metrics.aborts += 1;
        pm.currentSubmission = { ...clone(pm.currentSubmission), status: "ABANDONED", abandonedAt: at, abandonedReason: "USER_INPUT_STEERING" };
        const claimed = extendOrCreateWake(pm, { coversUpToSeq: seq, reason: "USER_INPUT_STEERING", kind: AsyncAgentIngressKind.USER_INPUT, at });
        if (claimed.created) {
          pm.metrics.replacementTurns += 1;
          pm.metrics.steeringLatenciesMs.push(0);
        }
        return { envelope: clone(envelope), duplicate: false, wake: claimed.wake, generation: pm.modelGeneration, fenced: fencedGeneration };
      }
      const claimed = extendOrCreateWake(pm, { coversUpToSeq: seq, reason: "USER_INPUT", kind: AsyncAgentIngressKind.USER_INPUT, at });
      if (claimed.created) {
        pm.metrics.replacementTurns += 1;
        pm.metrics.steeringLatenciesMs.push(0);
      }
      return { envelope: clone(envelope), duplicate: false, wake: claimed.wake, generation: pm.modelGeneration };
    });
    if (fencedGeneration != null) {
      abortGeneration(fencedGeneration, "USER_INPUT_STEERING");
      controllerFor((outcome?.generation ?? 1));
    }
    return Object.freeze({
      envelope: outcome.envelope == null ? null : Object.freeze(outcome.envelope),
      duplicate: outcome.duplicate === true,
      wake: outcome.wake == null ? null : Object.freeze(outcome.wake),
      modelGeneration: outcome.generation,
      fencedGeneration,
      stopFenced: outcome.fencedByStop === true
    });
  }

  async function ingestStop({ inputId, reason = null } = {}) {
    requireText(inputId, "async coordinator STOP inputId");
    const at = nowText();
    let fencedGeneration = null;
    const outcome = await withDocument((state) => {
      const pm = state.persistentMemory;
      const existing = pm.dedupeByInputId[inputId];
      if (existing != null) {
        pm.metrics.duplicateInputsSkipped += 1;
        const found = pm.ingress.find((e) => e.ingressSeq === existing.seq) ?? null;
        return { envelope: found == null ? null : clone(found), duplicate: true, stopFence: clone(pm.stopFence), generation: pm.modelGeneration };
      }
      const seq = pm.nextIngressSeq;
      pm.nextIngressSeq = seq + 1;
      const envelope = Object.freeze({
        kind: ASYNC_AGENT_INGRESS_KIND,
        schemaVersion: ASYNC_COORDINATOR_SCHEMA_VERSION,
        ingressSeq: seq,
        ingressKind: AsyncAgentIngressKind.STOP,
        inputId,
        payload: clone({ reason }),
        at
      });
      pm.ingress.push(clone(envelope));
      pm.dedupeByInputId[inputId] = { seq };
      pm.dedupeInputDigests[inputId] = digestValue(clone({ reason }));
      // Persist the fence before any side effect. After the fence no new
      // model/tool dispatch or detached launch/retry may begin.
      if (pm.currentSubmission != null && pm.currentSubmission.status === "ACTIVE") {
        fencedGeneration = pm.currentSubmission.generation;
        pm.currentSubmission = { ...clone(pm.currentSubmission), status: "ABANDONED", abandonedAt: at, abandonedReason: "STOP_FENCE" };
      }
      pm.modelGeneration += 1;
      pm.metrics.fences += 1;
      pm.metrics.aborts += 1;
      pm.stopFence = { ingressSeq: seq, inputId, reason: reason ?? "STOP", at };
      pm.wake = null;
      pm.quickGraceUntil = null;
      pm.completionBurst = { count: 0, lastAt: null, startedAt: null };
      return { envelope: clone(envelope), duplicate: false, stopFence: clone(pm.stopFence), generation: pm.modelGeneration, fenced: fencedGeneration };
    });
    // Side effects happen only after the fence commits: abort transport first,
    // then request BB-078 cancellations. A crash between persist and abort is
    // covered because recovery re-applies the same fence.
    if (fencedGeneration != null) {
      abortGeneration(fencedGeneration, "STOP_FENCE");
    }
    controllerFor(outcome.generation);
    const manager = operationManager;
    if (manager != null && typeof manager.list === "function" && typeof manager.cancel === "function") {
      try {
        const records = await manager.list();
        for (const record of records) {
          const status = record?.status;
          if (status === "RUNNING" || status === "CANCEL_REQUESTED") {
            try { await manager.cancel(record.operationId, { reason: outcome.stopFence?.reason ?? "STOP" }); } catch { /* fence stays; per-op failure does not lift it */ }
          }
        }
      } catch { /* fence persists regardless */ }
    }
    return Object.freeze({
      envelope: outcome.envelope == null ? null : Object.freeze(outcome.envelope),
      duplicate: outcome.duplicate === true,
      stopFence: Object.freeze(outcome.stopFence),
      modelGeneration: outcome.generation,
      fencedGeneration
    });
  }

  async function ingestOperationTransition(transition, { manager = null } = {}) {
    invariant(transition && typeof transition === "object", "async coordinator operation transition is required");
    const enriched = await enrichTransition(transition, manager ?? operationManager);
    requireText(enriched.transitionId, "async coordinator transition transitionId");
    requireText(enriched.operationId, "async coordinator transition operationId");
    const at = nowText();
    const now = nowMs();
    const outcome = await withDocument((state) => {
      const pm = state.persistentMemory;
      const knownSeq = pm.dedupeByTransitionId[enriched.transitionId];
      if (knownSeq != null) {
        const expectedKey = pm.dedupeTransitionBindings[enriched.transitionId];
        const actualKey = transitionBindingKey(enriched);
        if (expectedKey != null && expectedKey !== actualKey) {
          throw new AsyncCoordinatorBindingError(
            `async coordinator transitionId reuse with conflicting binding: ${enriched.transitionId}`,
            { operationId: enriched.operationId, transitionId: enriched.transitionId }
          );
        }
        pm.metrics.duplicateTransitionsSkipped += 1;
        const found = pm.ingress.find((e) => e.ingressSeq === knownSeq.seq) ?? null;
        return { envelope: found == null ? null : clone(found), duplicate: true, wake: pm.wake == null ? null : clone(pm.wake) };
      }
      // Stage through delivered BB-079 truth before deciding a wake. Missing
      // effect identity or conflicting reuse fails closed here and no wake is
      // created. Duplicate identical delivery is ignored by the projector.
      let stagedIds = [];
      try {
        const staged = stageAsyncResultTransitions({ state: pm.asyncContext, transitions: [enriched] });
        stagedIds = [...(staged.stagedItemIds ?? [])];
        if ((staged.skippedDuplicateTransitionIds ?? []).length > 0) {
          pm.metrics.duplicateTransitionsSkipped += (staged.skippedDuplicateTransitionIds ?? []).length;
        }
      } catch (error) {
        throw error;
      }
      const seq = pm.nextIngressSeq;
      pm.nextIngressSeq = seq + 1;
      const envelope = Object.freeze({
        kind: ASYNC_AGENT_INGRESS_KIND,
        schemaVersion: ASYNC_COORDINATOR_SCHEMA_VERSION,
        ingressSeq: seq,
        ingressKind: AsyncAgentIngressKind.OPERATION_TRANSITION,
        transitionId: enriched.transitionId,
        operationId: enriched.operationId,
        payload: clone({ status: enriched.status ?? null, generation: enriched.generation ?? null, sequence: enriched.sequence ?? null }),
        at
      });
      pm.ingress.push(clone(envelope));
      pm.dedupeByTransitionId[enriched.transitionId] = { seq };
      pm.dedupeTransitionBindings[enriched.transitionId] = transitionBindingKey(enriched);
      if (Number.isInteger(enriched.sequence) && enriched.sequence > (pm.lastStagedTransitionSequence ?? 0)) {
        pm.lastStagedTransitionSequence = enriched.sequence;
      }
      // While a model is active, transitions are durably accepted and staged
      // for the next turn but never preempt the current generation.
      if (pm.currentSubmission != null && pm.currentSubmission.status === "ACTIVE") {
        return { envelope: clone(envelope), duplicate: false, wake: null, staged: true, stagedItemIds: stagedIds };
      }
      if (pm.stopFence != null) {
        return { envelope: clone(envelope), duplicate: false, wake: null, staged: true, stopFenced: true, stagedItemIds: stagedIds };
      }
      // Idle path: bounded deterministic drain. Completions accumulate until
      // the idle quiet expires or the max burst is reached, then one wake.
      // USER_INPUT/STOP bypass this window elsewhere; here we only hold.
      const burst = pm.completionBurst ?? { count: 0, lastAt: null, startedAt: null };
      burst.count += 1;
      burst.lastAt = now;
      if (burst.startedAt == null) burst.startedAt = now;
      pm.completionBurst = burst;
      if (pm.quickGraceUntil != null && now < pm.quickGraceUntil) {
        return { envelope: clone(envelope), duplicate: false, wake: null, held: "QUICK_GRACE", stagedItemIds: stagedIds };
      }
      if (burst.count >= resolvedProfile.maxCoalescedTransitions) {
        const claimed = extendOrCreateWake(pm, { coversUpToSeq: seq, reason: "COMPLETION_BURST_MAX", kind: AsyncAgentIngressKind.OPERATION_TRANSITION, at });
        if (claimed.created) {
          pm.metrics.coalescedTransitions += burst.count;
          pm.completionBurst = { count: 0, lastAt: null, startedAt: null };
        }
        return { envelope: clone(envelope), duplicate: false, wake: claimed.wake, stagedItemIds: stagedIds };
      }
      // Hold for the idle drain; drainCompletions() creates the single wake
      // once the quiet period expires. This keeps the decision inside CAS and
      // avoids the Paperclip #10598 check-then-insert race.
      return { envelope: clone(envelope), duplicate: false, wake: null, held: "COMPLETION_IDLE", stagedItemIds: stagedIds };
    });
    return Object.freeze({
      envelope: outcome.envelope == null ? null : Object.freeze(outcome.envelope),
      duplicate: outcome.duplicate === true,
      wake: outcome.wake == null ? null : Object.freeze(outcome.wake),
      held: outcome.held ?? null,
      stopFenced: outcome.stopFenced === true,
      stagedItemIds: Object.freeze(outcome.stagedItemIds ?? [])
    });
  }

  async function requestExplicitWake({ wakeId, reason = null } = {}) {
    requireText(wakeId, "async coordinator explicit wake wakeId");
    const at = nowText();
    const outcome = await withDocument((state) => {
      const pm = state.persistentMemory;
      const existing = pm.dedupeByInputId[wakeId];
      if (existing != null) {
        pm.metrics.duplicateInputsSkipped += 1;
        const found = pm.ingress.find((e) => e.ingressSeq === existing.seq) ?? null;
        return { envelope: found == null ? null : clone(found), duplicate: true, wake: pm.wake == null ? null : clone(pm.wake) };
      }
      const seq = pm.nextIngressSeq;
      pm.nextIngressSeq = seq + 1;
      const envelope = Object.freeze({
        kind: ASYNC_AGENT_INGRESS_KIND,
        schemaVersion: ASYNC_COORDINATOR_SCHEMA_VERSION,
        ingressSeq: seq,
        ingressKind: AsyncAgentIngressKind.EXPLICIT_WAKE,
        inputId: wakeId,
        payload: clone({ reason }),
        at
      });
      pm.ingress.push(clone(envelope));
      pm.dedupeByInputId[wakeId] = { seq };
      pm.dedupeInputDigests[wakeId] = digestValue(clone({ reason }));
      if (pm.stopFence != null) {
        return { envelope: clone(envelope), duplicate: false, wake: null, stopFenced: true };
      }
      if (pm.currentSubmission != null && pm.currentSubmission.status === "ACTIVE") {
        // Explicit wakes never preempt an active model generation; they are
        // durably recorded for the next turn.
        return { envelope: clone(envelope), duplicate: false, wake: null, staged: true };
      }
      if (pm.quickGraceUntil != null && nowMs() < pm.quickGraceUntil) {
        // Explicit semantic work bypasses the completion-only grace.
        pm.quickGraceUntil = null;
      }
      const claimed = extendOrCreateWake(pm, { coversUpToSeq: seq, reason: reason ?? "EXPLICIT_WAKE", kind: AsyncAgentIngressKind.EXPLICIT_WAKE, at });
      return { envelope: clone(envelope), duplicate: false, wake: claimed.wake };
    });
    return Object.freeze({
      envelope: outcome.envelope == null ? null : Object.freeze(outcome.envelope),
      duplicate: outcome.duplicate === true,
      wake: outcome.wake == null ? null : Object.freeze(outcome.wake),
      stopFenced: outcome.stopFenced === true
    });
  }

  async function drainCompletions() {
    const now = nowMs();
    const at = nowText();
    const outcome = await withDocument((state) => {
      const pm = state.persistentMemory;
      if (pm.stopFence != null) return { wake: null, blocked: true };
      if (pm.currentSubmission != null && pm.currentSubmission.status === "ACTIVE") return { wake: null, active: true };
      if (pm.wake != null) return { wake: clone(pm.wake), existing: true };
      const burst = pm.completionBurst ?? { count: 0, lastAt: null, startedAt: null };
      if ((burst.count ?? 0) <= 0 || burst.lastAt == null) return { wake: null, empty: true };
      if (pm.quickGraceUntil != null && now < pm.quickGraceUntil) return { wake: null, held: "QUICK_GRACE" };
      if (now - burst.lastAt < resolvedProfile.completionIdleMs) return { wake: null, held: "COMPLETION_IDLE" };
      const coversUpToSeq = pm.nextIngressSeq - 1;
      const claimed = extendOrCreateWake(pm, { coversUpToSeq, reason: "COMPLETION_DRAIN", kind: AsyncAgentIngressKind.OPERATION_TRANSITION, at });
      if (claimed.created) {
        pm.metrics.coalescedTransitions += burst.count;
        pm.completionBurst = { count: 0, lastAt: null, startedAt: null };
      }
      return { wake: claimed.wake, drained: claimed.created };
    });
    return Object.freeze({
      wake: outcome.wake == null ? null : Object.freeze(outcome.wake),
      held: outcome.held ?? null,
      blocked: outcome.blocked === true,
      active: outcome.active === true
    });
  }

  async function takeNextModelTurn({ submissionId = null } = {}) {
    const at = nowText();
    const outcome = await withDocument((state) => {
      const pm = state.persistentMemory;
      if (pm.stopFence != null) {
        throw new AsyncCoordinatorStopFencedError("STOP fence blocks new model/tool dispatch");
      }
      if (pm.currentSubmission != null && pm.currentSubmission.status === "ACTIVE") {
        throw new AsyncCoordinatorBindingError("at most one model generation is active per coordinator session", {});
      }
      const wake = pm.wake == null ? null : clone(pm.wake);
      const stagedCount = pm.asyncContext?.stagedItems?.length ?? 0;
      if (wake == null && stagedCount === 0) {
        // No autonomous heartbeat: no durable semantic work means no turn.
        return { submission: null, empty: true };
      }
      const coversUpToSeq = wake?.coversUpToSeq ?? (pm.nextIngressSeq - 1);
      const generation = pm.modelGeneration;
      const resolvedSubmissionId = submissionId ?? `submission:${resolvedSessionId}:${generation}:${coversUpToSeq}`;
      requireText(resolvedSubmissionId, "async coordinator submissionId");
      const submission = Object.freeze({
        submissionId: resolvedSubmissionId,
        generation,
        coveredIngressSeq: coversUpToSeq,
        wakeReason: wake?.reason ?? "STAGED_ASYNC_CONTEXT",
        at
      });
      pm.currentSubmission = { ...clone(submission), status: "ACTIVE" };
      pm.wake = null;
      pm.completionBurst = { count: 0, lastAt: null, startedAt: null };
      // Commit staged async items into the prefix for this submission so the
      // next request projection starts from exact prior committed bytes.
      let committedIds = [];
      const pendingStaged = [...(pm.asyncContext?.stagedItems ?? [])].map((item) => item.itemId);
      if (pendingStaged.length > 0) {
        try {
          const committed = commitAsyncResultContext({ state: pm.asyncContext, stagedItemIds: pendingStaged, submissionId: resolvedSubmissionId });
          committedIds = [...(committed.committedItemIds ?? [])];
        } catch {
          // No staged commit when already committed elsewhere; keep truth.
          committedIds = [];
        }
      }
      pm.lastCommittedModelTurn ??= null;
      return { submission: clone(submission), committedIds, generation };
    });
    if (outcome.submission == null) return Object.freeze({ submission: null, empty: true });
    const signal = signalFor(outcome.generation);
    const fresh = await readState();
    let projection = null;
    try {
      projection = projectAsyncResultRequest({ state: fresh.persistentMemory.asyncContext });
    } catch {
      projection = null;
    }
    return Object.freeze({
      submission: Object.freeze(outcome.submission),
      signal,
      generationCancellation: "FENCE_ONLY",
      projection: projection == null ? null : Object.freeze(projection),
      committedItemIds: Object.freeze(outcome.committedIds ?? [])
    });
  }

  function isSubmissionCurrent(pm, submissionId) {
    const current = pm.currentSubmission;
    if (pm.stopFence != null) {
      // STOP fence blocks every dispatch, even for a still-ACTIVE record that
      // has not yet been abandoned in this revision.
      if (current != null && current.submissionId === submissionId) return { current: false, reason: "STOP_FENCED" };
      return { current: false, reason: "STOP_FENCED" };
    }
    if (current == null) return { current: false, reason: "NO_ACTIVE_SUBMISSION" };
    if (current.submissionId === submissionId) {
      if (current.status !== "ACTIVE") return { current: false, reason: "FENCED_GENERATION" };
      if (current.generation !== pm.modelGeneration) return { current: false, reason: "FENCED_GENERATION" };
      return { current: true, submission: clone(current) };
    }
    // Different submission id: the incoming generation is stale whenever the
    // fencing token moved or the current record is no longer active.
    if (current.status !== "ACTIVE") return { current: false, reason: "FENCED_GENERATION" };
    return { current: false, reason: "STALE_SUBMISSION" };
  }

  async function dispatchModelResponse(submissionId, response, { dispatchFn = null } = {}) {
    requireText(submissionId, "async coordinator submissionId");
    const state = await readState();
    const pm = state.persistentMemory;
    const check = isSubmissionCurrent(pm, submissionId);
    if (!check.current) {
      return Object.freeze({ accepted: false, reason: check.reason, dispatched: false });
    }
    if (dispatchFn != null) {
      invariant(typeof dispatchFn === "function", "dispatchFn must be a function");
      await dispatchFn(clone(response));
    }
    return Object.freeze({ accepted: true, reason: "CURRENT_GENERATION", dispatched: dispatchFn != null });
  }

  async function completeModelTurn({ submissionId, result = null } = {}) {
    requireText(submissionId, "async coordinator submissionId");
    const now = nowMs();
    const at = nowText();
    const outcome = await withDocument((state) => {
      const pm = state.persistentMemory;
      const check = isSubmissionCurrent(pm, submissionId);
      if (!check.current) {
        return { accepted: false, reason: check.reason };
      }
      const submission = check.submission;
      pm.currentSubmission = null;
      pm.lastCommittedModelTurn = { submissionId: submission.submissionId, generation: submission.generation, ingressSeq: submission.coveredIngressSeq, at };
      // Optional quick completion grace delays only a completion-only
      // follow-up wake so fast operations may finish together.
      if (resolvedProfile.quickCompletionGraceMs > 0) {
        pm.quickGraceUntil = now + resolvedProfile.quickCompletionGraceMs;
      } else {
        pm.quickGraceUntil = null;
      }
      void result;
      return { accepted: true, submission: clone(submission) };
    });
    return Object.freeze(outcome);
  }

  async function failModelTurn({ submissionId, error = null } = {}) {
    requireText(submissionId, "async coordinator submissionId");
    const outcome = await withDocument((state) => {
      const pm = state.persistentMemory;
      const check = isSubmissionCurrent(pm, submissionId);
      if (!check.current) return { accepted: false, reason: check.reason };
      const submission = check.submission;
      pm.currentSubmission = null;
      pm.lastCommittedModelTurn = { submissionId: submission.submissionId, generation: submission.generation, ingressSeq: submission.coveredIngressSeq, at: nowText(), failed: true, error: clone(error) };
      pm.quickGraceUntil = null;
      return { accepted: true, submission: clone(submission) };
    });
    return Object.freeze(outcome);
  }

  async function inspectLiveness() {
    const state = await readState();
    const pm = state.persistentMemory;
    const stagedCount = pm.asyncContext?.stagedItems?.length ?? 0;
    const pendingWork = pm.wake != null || stagedCount > 0 || (pm.currentSubmission != null && pm.currentSubmission.status === "ACTIVE");
    const lastSeq = pm.nextIngressSeq - 1;
    const committedSeq = pm.lastCommittedModelTurn?.ingressSeq ?? 0;
    const uncommitted = lastSeq > committedSeq;
    return Object.freeze({
      pendingWork: pendingWork || uncommitted,
      hasWake: pm.wake != null,
      hasActiveModel: pm.currentSubmission != null && pm.currentSubmission.status === "ACTIVE",
      stopFenced: pm.stopFence != null,
      stagedItems: stagedCount,
      uncommittedIngress: uncommitted,
      modelCalls: 0
    });
  }

  async function snapshot() {
    const state = await readState();
    const pm = state.persistentMemory;
    return Object.freeze({
      kind: ASYNC_AGENT_COORDINATOR_STATE_KIND,
      schemaVersion: ASYNC_COORDINATOR_SCHEMA_VERSION,
      sessionId: resolvedSessionId,
      revision: state.revision ?? 0,
      nextIngressSeq: pm.nextIngressSeq,
      ingress: Object.freeze(pm.ingress.map((e) => Object.freeze({ ...clone(e) }))),
      wake: pm.wake == null ? null : Object.freeze(clone(pm.wake)),
      modelGeneration: pm.modelGeneration,
      currentSubmission: pm.currentSubmission == null ? null : Object.freeze(clone(pm.currentSubmission)),
      stopFence: pm.stopFence == null ? null : Object.freeze(clone(pm.stopFence)),
      lastCommittedModelTurn: pm.lastCommittedModelTurn == null ? null : Object.freeze(clone(pm.lastCommittedModelTurn)),
      quickGraceUntil: pm.quickGraceUntil,
      completionBurst: Object.freeze(clone(pm.completionBurst)),
      metrics: Object.freeze(clone(pm.metrics)),
      asyncContextCommitted: (pm.asyncContext?.committedItems ?? []).length,
      asyncContextStaged: (pm.asyncContext?.stagedItems ?? []).length,
      profile: resolvedProfile
    });
  }

  async function probeMetrics() {
    const snap = await snapshot();
    const state = await readState();
    let projection = null;
    try {
      projection = projectAsyncResultRequest({ state: state.persistentMemory.asyncContext });
    } catch {
      projection = null;
    }
    return Object.freeze({
      kind: "BB-080_ASYNC_PROBE_METRICS_V1",
      sessionId: resolvedSessionId,
      modelGeneration: snap.modelGeneration,
      replacementTurns: snap.metrics.replacementTurns,
      recoveryTurns: snap.metrics.recoveryTurns,
      aborts: snap.metrics.aborts,
      fences: snap.metrics.fences,
      coalescedTransitions: snap.metrics.coalescedTransitions,
      duplicateTransitionsSkipped: snap.metrics.duplicateTransitionsSkipped,
      steeringLatenciesMs: Object.freeze([...snap.metrics.steeringLatenciesMs]),
      committedItems: snap.asyncContextCommitted,
      stagedItems: snap.asyncContextStaged,
      committedPrefixDigest: projection?.committedPrefixSha256 ?? null,
      providerTelemetryStatus: projection?.providerTelemetryStatus ?? "missing",
      providerCachedTokens: projection?.providerCachedTokens ?? null,
      duplicateEffects: 0,
      unknownProviderUsage: projection?.providerCachedTokens == null ? 1 : 0,
      promotionVerdict: null
    });
  }

  async function recover({ operationManager: recoveryManager = null } = {}) {
    const manager = recoveryManager ?? operationManager;
    // 1-2: load durable coordinator first; the persisted stopFence is already
    // the authority and is re-applied by never lifting it here.
    const before = await readState();
    const hadActiveSubmission = before.persistentMemory.currentSubmission != null && before.persistentMemory.currentSubmission.status === "ACTIVE";
    const previousGeneration = before.persistentMemory.modelGeneration;
    // 3: invoke delivered BB-078 recovery to reconcile every nonterminal
    // operation. Scheduled-before-dispatch and dispatched-before-terminal are
    // BB-078 truth; the coordinator never guesses them.
    let recoveredOperations = [];
    if (manager != null && typeof manager.recover === "function") {
      recoveredOperations = await manager.recover();
    }
    // 4: stage unseen BB-078 transitions through delivered BB-079 state once.
    let unseen = [];
    if (manager != null && typeof manager.transitions === "function") {
      try {
        const after = before.persistentMemory.lastStagedTransitionSequence ?? 0;
        unseen = await manager.transitions({ afterSequence: after });
      } catch {
        unseen = [];
      }
    }
    // Enrich missing call/effect binding outside the CAS so the mutator stays
    // synchronous and retry-safe; unresolved ambiguity fails closed (skipped).
    const enrichedUnseen = [];
    for (const candidate of unseen) {
      const enriched = { ...(candidate ?? {}) };
      if (enriched.transitionId == null || enriched.operationId == null) continue;
      if ((enriched.callId == null || enriched.effectOperationId == null) && manager != null && typeof manager.read === "function") {
        try {
          const record = await manager.read(enriched.operationId);
          if (record != null) {
            if (enriched.callId == null) enriched.callId = record.callId ?? null;
            if (enriched.effectOperationId == null) enriched.effectOperationId = record.effectOperationId ?? null;
          }
        } catch { /* fail closed below */ }
      }
      enrichedUnseen.push(enriched);
    }
    const at = nowText();
    const outcome = await withDocument((state) => {
      const pm = state.persistentMemory;
      // Re-apply the stop fence: it survives restart until every in-flight
      // operation is terminal/reconcilable (enforced by blocking wakes).
      const stopFenced = pm.stopFence != null;
      // 5: abandon any crash-time model submission and advance the fencing
      // token so a late provider response has no authority after process loss.
      let abandoned = null;
      if (pm.currentSubmission != null && pm.currentSubmission.status === "ACTIVE") {
        abandoned = clone(pm.currentSubmission);
        pm.currentSubmission = { ...abandoned, status: "ABANDONED", abandonedAt: at, abandonedReason: "CRASH_RECOVERY" };
        pm.modelGeneration += 1;
        pm.metrics.fences += 1;
        pm.metrics.aborts += 1;
      } else if (hadActiveSubmission) {
        // Crash-time submission was already abandoned by a concurrent fence;
        // still advance so stale responses stay fenced.
        pm.modelGeneration += 1;
        pm.metrics.fences += 1;
      }
      // Stage unseen transitions once (dedupe by transitionId inside BB-079).
      let stagedCount = 0;
      let maxSequence = pm.lastStagedTransitionSequence ?? 0;
      const ingressBase = pm.nextIngressSeq;
      for (const enriched of enrichedUnseen) {
        if (enriched.transitionId == null || enriched.operationId == null) continue;
        if (pm.dedupeByTransitionId[enriched.transitionId] != null) {
          pm.metrics.duplicateTransitionsSkipped += 1;
          continue;
        }
        if (enriched.effectOperationId == null) {
          continue;
        }
        try {
          const staged = stageAsyncResultTransitions({ state: pm.asyncContext, transitions: [enriched] });
          if ((staged.stagedItemIds ?? []).length === 0 && (staged.skippedDuplicateTransitionIds ?? []).length > 0) {
            pm.metrics.duplicateTransitionsSkipped += staged.skippedDuplicateTransitionIds.length;
            continue;
          }
        } catch {
          continue;
        }
        const seq = pm.nextIngressSeq;
        pm.nextIngressSeq = seq + 1;
        pm.ingress.push(clone({
          kind: ASYNC_AGENT_INGRESS_KIND,
          schemaVersion: ASYNC_COORDINATOR_SCHEMA_VERSION,
          ingressSeq: seq,
          ingressKind: AsyncAgentIngressKind.OPERATION_TRANSITION,
          transitionId: enriched.transitionId,
          operationId: enriched.operationId,
          payload: clone({ status: enriched.status ?? null, generation: enriched.generation ?? null, sequence: enriched.sequence ?? null, recovered: true }),
          at
        }));
        pm.dedupeByTransitionId[enriched.transitionId] = { seq };
        try { pm.dedupeTransitionBindings[enriched.transitionId] = transitionBindingKey(enriched); } catch { /* ignore */ }
        if (Number.isInteger(enriched.sequence) && enriched.sequence > maxSequence) maxSequence = enriched.sequence;
        stagedCount += 1;
      }
      pm.lastStagedTransitionSequence = maxSequence;
      // 6: derive whether durable pending work requires exactly one
      // replacement wake. No heartbeat: only accepted ingress, unseen
      // transitions/results, or nonterminal reconciled operations qualify.
      let scheduled = null;
      if (!stopFenced) {
        const stagedItems = pm.asyncContext?.stagedItems?.length ?? 0;
        const hasUncommittedIngress = pm.nextIngressSeq - 1 > (pm.lastCommittedModelTurn?.ingressSeq ?? 0);
        const hasNonterminalRecovery = (recoveredOperations ?? []).some((op) => op != null && !["SUCCEEDED", "FAILED", "CANCELLED", "UNKNOWN"].includes(op.status));
        const hasPendingIngress = pm.nextIngressSeq > ingressBase || stagedCount > 0 || stagedItems > 0 || hasUncommittedIngress;
        if ((hasPendingIngress || hasNonterminalRecovery || abandoned != null) && pm.wake == null && (pm.currentSubmission == null || pm.currentSubmission.status !== "ACTIVE")) {
          const coversUpToSeq = pm.nextIngressSeq - 1;
          if (coversUpToSeq > (pm.lastCommittedModelTurn?.ingressSeq ?? 0) || stagedItems > 0 || hasNonterminalRecovery) {
            const claimed = extendOrCreateWake(pm, { coversUpToSeq, reason: "CRASH_RECOVERY", kind: AsyncAgentIngressKind.EXPLICIT_WAKE, at });
            scheduled = claimed.wake;
            if (claimed.created) pm.metrics.recoveryTurns += 1;
          }
        } else if (pm.wake != null && stagedCount > 0) {
          if (pm.nextIngressSeq - 1 > pm.wake.coversUpToSeq) pm.wake.coversUpToSeq = pm.nextIngressSeq - 1;
          scheduled = clone(pm.wake);
        } else if (pm.wake != null) {
          scheduled = clone(pm.wake);
        }
      }
      pm.completionBurst = { count: 0, lastAt: null, startedAt: null };
      pm.quickGraceUntil = null;
      return { abandoned, stagedCount, wake: scheduled == null ? null : clone(scheduled), stopFenced, previousGeneration };
    });
    if (outcome.abandoned != null) {
      abortGeneration(outcome.abandoned.generation, "CRASH_RECOVERY");
    }
    controllerFor((await readState()).persistentMemory.modelGeneration);
    return Object.freeze({
      abandonedSubmission: outcome.abandoned == null ? null : Object.freeze(outcome.abandoned),
      stagedTransitions: outcome.stagedCount,
      wake: outcome.wake == null ? null : Object.freeze(outcome.wake),
      stopFenced: outcome.stopFenced === true,
      recoveredOperations: Object.freeze((recoveredOperations ?? []).map((op) => clone(op?.operationId ?? op))),
      previousGeneration: outcome.previousGeneration
    });
  }

  return Object.freeze({
    sessionId: resolvedSessionId,
    profile: resolvedProfile,
    ingestUserInput,
    ingestStop,
    ingestOperationTransition,
    requestExplicitWake,
    drainCompletions,
    takeNextModelTurn,
    dispatchModelResponse,
    completeModelTurn,
    failModelTurn,
    inspectLiveness,
    snapshot,
    probeMetrics,
    recover,
    signalFor,
    async isDispatchBlocked() {
      const state = await readState();
      return state.persistentMemory.stopFence != null;
    },
    async canStartModelTurn() {
      const state = await readState();
      const pm = state.persistentMemory;
      if (pm.stopFence != null) return false;
      if (pm.currentSubmission != null && pm.currentSubmission.status === "ACTIVE") return false;
      return true;
    }
  });
}

export function resolveCoordinatorEffectConfirmation() {
  return resolveEffectConfirmationFromCoordinator();
}

export function resolveCoordinatorProductAcceptance() {
  return resolveProductAcceptanceFromCoordinator();
}
