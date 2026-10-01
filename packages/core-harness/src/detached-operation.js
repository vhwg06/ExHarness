import { invariant, requireText } from "./contracts.js";
import {
  EffectOperationStatus,
  EffectRecoveryAction,
  EffectRecoveryRequiredError,
  EffectReplayPolicy,
  reconcileEffectOperation
} from "./effect-reconciliation.js";
import {
  DETACHED_OPERATION_PROTOCOL_VERSION,
  DetachedOperationBindingError,
  DetachedOperationStatus,
  deriveDetachedOperationId,
  digestDetachedValue,
  isDetachedTerminalStatus
} from "./detached-operation-store.js";

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

function normalizeEffectBindings(effectBindings) {
  invariant(effectBindings && typeof effectBindings === "object", "detached operation manager requires effectBindings");
  const entries = effectBindings instanceof Map ? [...effectBindings.entries()] : Object.entries(effectBindings);
  invariant(entries.length > 0, "detached operation manager requires at least one effect binding");
  const registry = new Map();
  for (const [name, entry] of entries) {
    requireText(name, "detached operation effect binding name");
    // Each entry pairs the exact journal used by defineEffectCapability with
    // its capability: either `{ capability, journal }` or a bare capability
    // that already carries `.journal`.
    const capability = entry?.capability?.execute != null ? entry.capability : entry;
    const journal = entry?.capability?.execute != null ? entry.journal ?? null : entry?.journal ?? entry?.effect?.journal ?? null;
    invariant(capability && typeof capability === "object", `detached operation effect binding ${name} must be an object`);
    invariant(typeof capability.execute === "function", `detached operation effect binding ${name} requires execute()`);
    invariant(capability.effect && typeof capability.effect === "object", `detached operation effect binding ${name} requires effect semantics`);
    invariant(typeof capability.effect.operationKey === "function", `detached operation effect binding ${name} requires effect.operationKey()`);
    invariant(
      Object.values(EffectReplayPolicy).includes(capability.effect.replayPolicy),
      `detached operation effect binding ${name} replayPolicy is invalid`
    );
    invariant(capability.name == null || capability.name === name, `detached operation effect binding name mismatch: ${name}`);
    registry.set(name, Object.freeze({
      name,
      description: capability.description ?? null,
      effect: capability.effect,
      replayPolicy: capability.effect.replayPolicy,
      journal,
      execute: capability.execute
    }));
  }
  return registry;
}

function journalFor(binding) {
  return binding?.journal ?? null;
}

export function createDetachedOperationManager({ store, effectBindings, clock = null } = {}) {
  invariant(store && typeof store.create === "function", "detached operation manager requires store.create()");
  invariant(typeof store.read === "function", "detached operation manager requires store.read()");
  invariant(typeof store.list === "function", "detached operation manager requires store.list()");
  invariant(typeof store.transitions === "function", "detached operation manager requires store.transitions()");
  invariant(typeof store.transition === "function", "detached operation manager requires store.transition()");
  invariant(typeof store.takeover === "function", "detached operation manager requires store.takeover()");
  invariant(typeof store.noteDiagnostic === "function", "detached operation manager requires store.noteDiagnostic()");
  const scopeId = requireText(store.scopeId, "detached operation manager store scopeId");
  const registry = normalizeEffectBindings(effectBindings);
  const now = typeof clock === "function" ? clock : () => new Date().toISOString();

  const controllers = new Map();
  const attempts = new Map();
  const executionCounts = new Map();
  const subscribers = new Set();
  const waiters = new Map();

  function controllerFor(operationId, generation) {
    const key = `${operationId}:g${generation}`;
    let entry = controllers.get(key);
    if (entry == null) {
      entry = { controller: new AbortController(), generation };
      controllers.set(key, entry);
    }
    return entry.controller;
  }

  function abortFor(operationId, generation) {
    const entry = controllers.get(`${operationId}:g${generation}`);
    if (entry != null && !entry.controller.signal.aborted) entry.controller.abort();
  }

  function attemptFor(operationId) {
    return attempts.get(operationId) ?? null;
  }

  function trackAttempt(operationId, generation, promise) {
    const tracked = { promise, generation, settled: false, result: null, error: null };
    attempts.set(operationId, tracked);
    void Promise.resolve(promise).then(
      (result) => { tracked.settled = true; tracked.result = result; },
      (error) => { tracked.settled = true; tracked.error = error; }
    );
    return tracked;
  }

  function notifyWaiters(operationId, record) {
    const pending = waiters.get(operationId);
    if (pending == null || pending.size === 0) return;
    waiters.delete(operationId);
    for (const waiter of pending) waiter(record);
  }

  function emitTransition(envelope) {
    if (envelope == null) return;
    for (const subscriber of [...subscribers]) {
      try {
        subscriber(clone(envelope));
      } catch {
        // Observer delivery is at-least-once and never blocks scheduling truth.
      }
    }
  }

  async function applyTransition(operationId, generation, { to, result = null, error = null, evidence = null, reason = null }) {
    const outcome = await store.transition(operationId, { to, generation, result, error, evidence, reason });
    if (outcome?.applied === true) {
      emitTransition(outcome.transition);
      if (isDetachedTerminalStatus(to)) notifyWaiters(operationId, outcome.record);
    }
    return outcome;
  }

  function handleFor(record) {
    const snapshot = clone(record);
    return Object.freeze({
      operationId: snapshot.operationId,
      status: snapshot.status,
      generation: snapshot.generation,
      effectOperationId: snapshot.effectOperationId,
      capability: snapshot.capability,
      done: waitForTerminal(snapshot.operationId)
    });
  }

  function waitForTerminal(operationId) {
    return (async () => {
      const current = await store.read(operationId);
      if (current != null && isDetachedTerminalStatus(current.status)) return current;
      return new Promise((resolve) => {
        let pending = waiters.get(operationId);
        if (pending == null) {
          pending = new Set();
          waiters.set(operationId, pending);
        }
        pending.add(resolve);
        // Re-check after subscribing so a terminal write that raced the
        // initial read still resolves instead of hanging.
        void store.read(operationId).then((latest) => {
          if (latest != null && isDetachedTerminalStatus(latest.status)) {
            const active = waiters.get(operationId);
            if (active != null && active.delete(resolve)) {
              if (active.size === 0) waiters.delete(operationId);
              resolve(latest);
            }
          }
        });
      });
    })();
  }

  async function effectOperationState(binding, effectOperationId) {
    const journal = journalFor(binding);
    if (journal == null || typeof journal.get !== "function") return null;
    try {
      return await journal.get(effectOperationId);
    } catch {
      return null;
    }
  }

  function isCancelFenced(record) {
    return record?.status === DetachedOperationStatus.CANCEL_REQUESTED;
  }

  async function commitSuccess(operationId, generation, result, { reason = "attempt-success" } = {}) {
    const record = await store.read(operationId);
    if (record == null) return null;
    if (record.generation !== generation) {
      await store.noteDiagnostic(operationId, {
        kind: "STALE_GENERATION_SUCCESS_IGNORED",
        generation,
        currentGeneration: record.generation
      });
      return record;
    }
    if (isDetachedTerminalStatus(record.status)) return record;
    if (isCancelFenced(record)) {
      return settleCancellation(operationId, generation, { reason: "cancel-fenced-success" });
    }
    // Scheduler SUCCEEDED is derived only from journal CONFIRMED truth; the
    // scheduler value can never synthesize effect confirmation by itself.
    // A successful raw return without journal confirmation fails closed as
    // UNKNOWN instead of minting a synthetic success.
    const binding = registry.get(record.capability);
    const journalRecord = binding == null ? null : await effectOperationState(binding, record.effectOperationId);
    if (journalRecord?.status === EffectOperationStatus.CONFIRMED) {
      const outcome = await applyTransition(operationId, generation, {
        to: DetachedOperationStatus.SUCCEEDED,
        result: clone(journalRecord.result),
        evidence: clone(journalRecord.evidence ?? null),
        reason: "effect-confirmed"
      });
      return outcome?.current ?? outcome?.record ?? record;
    }
    const closed = await applyTransition(operationId, generation, {
      to: DetachedOperationStatus.UNKNOWN,
      error: null,
      evidence: { escalation: "success-without-confirm", journalStatus: journalRecord?.status ?? "ABSENT", reason },
      reason: "success-without-confirm"
    });
    return closed?.current ?? closed?.record ?? record;
  }

  async function settleFromError(operationId, generation, error, { reason = "attempt-error" } = {}) {
    const record = await store.read(operationId);
    if (record == null) return null;
    if (record.generation !== generation) {
      await store.noteDiagnostic(operationId, {
        kind: "STALE_GENERATION_ERROR_IGNORED",
        generation,
        currentGeneration: record.generation,
        error: errorView(error)
      });
      return record;
    }
    if (isDetachedTerminalStatus(record.status)) return record;
    if (isCancelFenced(record)) {
      return settleCancellation(operationId, generation, { reason: "cancel-fenced-error", error });
    }
    const binding = registry.get(record.capability);
    const journalRecord = binding == null ? null : await effectOperationState(binding, record.effectOperationId);
    if (journalFor(binding) != null && (journalRecord == null || journalRecord.status === EffectOperationStatus.INTENDED)) {
      // No external dispatch is recorded and the attempt failed before it, so
      // this is a deterministic scheduler/pre-dispatch failure. FAILED is
      // reserved for exactly this case; any post-DISPATCH outcome is UNKNOWN.
      const outcome = await applyTransition(operationId, generation, {
        to: DetachedOperationStatus.FAILED,
        error: errorView(error),
        evidence: { journalStatus: journalRecord?.status ?? "ABSENT", reason },
        reason: "pre-dispatch-failure"
      });
      return outcome?.current ?? outcome?.record ?? record;
    }
    return settleFromJournal(operationId, generation, { reason: "attempt-error", error });
  }

  async function settleFromJournal(operationId, generation, { reason = null, error = null } = {}) {
    const record = await store.read(operationId);
    if (record == null) return null;
    if (record.generation !== generation) {
      await store.noteDiagnostic(operationId, {
        kind: "STALE_GENERATION_SETTLE_IGNORED",
        generation,
        currentGeneration: record.generation,
        reason
      });
      return record;
    }
    if (isDetachedTerminalStatus(record.status)) return record;
    if (isCancelFenced(record)) {
      return settleCancellation(operationId, generation, { reason: reason ?? "cancel-fenced-settle", error });
    }
    const binding = registry.get(record.capability);
    if (binding == null) {
      const outcome = await applyTransition(operationId, generation, {
        to: DetachedOperationStatus.UNKNOWN,
        error: error == null ? null : errorView(error),
        evidence: { escalation: "unknown-capability-binding", reason },
        reason: "unknown-capability-binding"
      });
      return outcome?.current ?? outcome?.record ?? record;
    }
    if (journalFor(binding) == null || typeof journalFor(binding).get !== "function") {
      // Without the exact effect journal there is no authority to confirm or
      // reconcile; fail closed instead of executing blindly.
      const outcome = await applyTransition(operationId, generation, {
        to: DetachedOperationStatus.UNKNOWN,
        error: error == null ? null : errorView(error),
        evidence: { escalation: "missing-effect-journal", reason },
        reason: "missing-effect-journal"
      });
      return outcome?.current ?? outcome?.record ?? record;
    }
    const journalRecord = await effectOperationState(binding, record.effectOperationId);
    if (journalRecord?.status === EffectOperationStatus.CONFIRMED) {
      const outcome = await applyTransition(operationId, generation, {
        to: DetachedOperationStatus.SUCCEEDED,
        result: clone(journalRecord.result),
        evidence: clone(journalRecord.evidence ?? null),
        reason: reason ?? "effect-confirmed"
      });
      return outcome?.current ?? outcome?.record ?? record;
    }
    if (journalRecord == null || journalRecord.status === EffectOperationStatus.INTENDED) {
      // No external dispatch is recorded, so the current generation may
      // execute the exact bound capability for the same effectOperationId.
      // Re-execution without a pending INTENDED record is bounded: a stagnant
      // journal means the previous attempt recorded nothing, so fail closed
      // instead of dispatching blindly again.
      const executions = executionCounts.get(`${operationId}:g${generation}`) ?? 0;
      if (journalRecord?.status !== EffectOperationStatus.INTENDED && executions >= 2) {
        const outcome = await applyTransition(operationId, generation, {
          to: DetachedOperationStatus.UNKNOWN,
          error: error == null ? null : errorView(error),
          evidence: { escalation: "no-journal-progress", reason },
          reason: "no-journal-progress"
        });
        return outcome?.current ?? outcome?.record ?? record;
      }
      return executeBoundAttempt(operationId, generation, record, binding);
    }
    let recovery;
    try {
      recovery = await reconcileEffectOperation({
        capability: binding,
        journal: journalFor(binding) ?? undefined,
        operationId: record.effectOperationId
      });
    } catch (reconcileError) {
      const outcome = await applyTransition(operationId, generation, {
        to: DetachedOperationStatus.UNKNOWN,
        error: errorView(reconcileError),
        evidence: { escalation: "reconcile-failed", reason },
        reason: "reconcile-failed"
      });
      return outcome?.current ?? outcome?.record ?? record;
    }
    if (recovery.action === EffectRecoveryAction.CONTINUE) {
      const confirmed = recovery.operation;
      if (confirmed?.status === EffectOperationStatus.CONFIRMED) {
        const outcome = await applyTransition(operationId, generation, {
          to: DetachedOperationStatus.SUCCEEDED,
          result: clone(confirmed.result),
          evidence: clone(confirmed.evidence ?? null),
          reason: reason ?? "reconcile-continue"
        });
        return outcome?.current ?? outcome?.record ?? record;
      }
      const outcome = await applyTransition(operationId, generation, {
        to: DetachedOperationStatus.UNKNOWN,
        error: error == null ? null : errorView(error),
        evidence: { escalation: "reconcile-continue-without-confirm", reason },
        reason: "reconcile-continue-without-confirm"
      });
      return outcome?.current ?? outcome?.record ?? record;
    }
    if (recovery.action === EffectRecoveryAction.RETRY) {
      const fenced = await store.read(operationId);
      if (fenced == null || fenced.generation !== generation || isCancelFenced(fenced) || isDetachedTerminalStatus(fenced.status)) {
        return settleCancellation(operationId, generation, { reason: "retry-cancel-fenced", error });
      }
      // RETRY may execute only the same effectOperationId under the stored
      // replay policy and only when cancellation is not fenced.
      return executeBoundAttempt(operationId, generation, fenced, binding);
    }
    const outcome = await applyTransition(operationId, generation, {
      to: DetachedOperationStatus.UNKNOWN,
      error: error == null ? null : errorView(error),
      evidence: { escalation: recovery.action, status: recovery.operation?.status ?? null, reason },
      reason: "reconcile-escalated"
    });
    return outcome?.current ?? outcome?.record ?? record;
  }

  async function executeBoundAttempt(operationId, generation, record, binding) {
    if (journalFor(binding) == null || typeof journalFor(binding).get !== "function") {
      // Without the exact effect journal there is no authority to confirm or
      // reconcile; fail closed without executing blindly.
      const outcome = await applyTransition(operationId, generation, {
        to: DetachedOperationStatus.UNKNOWN,
        evidence: { escalation: "missing-effect-journal", reason: "execute-refused" },
        reason: "missing-effect-journal"
      });
      return outcome?.current ?? outcome?.record ?? record;
    }
    // Safety bound only: retryable policies normally confirm on the next
    // attempt. Persistent ambiguity converges UNKNOWN instead of looping.
    const countKey = `${operationId}:g${generation}`;
    const executions = (executionCounts.get(countKey) ?? 0) + 1;
    executionCounts.set(countKey, executions);
    if (executions > 5) {
      const outcome = await applyTransition(operationId, generation, {
        to: DetachedOperationStatus.UNKNOWN,
        evidence: { escalation: "retry-budget-exhausted", executions, reason: "attempt-error" },
        reason: "retry-budget-exhausted"
      });
      return outcome?.current ?? outcome?.record ?? record;
    }
    const controller = controllerFor(operationId, generation);
    const executionRuntime = Object.freeze({
      callId: record.callId,
      turn: clone(record.turn),
      trace: clone(record.trace),
      actionIntentRef: clone(record.actionIntentRef),
      deliberationRef: clone(record.deliberationRef),
      input: clone(record.input),
      signal: controller.signal,
      detached: Object.freeze({ operationId, generation, scopeId })
    });
    // Track only the raw external attempt so cancellation can distinguish a
    // settled local attempt from one still capable of committing later.
    const raw = binding.execute(clone(record.input), executionRuntime);
    trackAttempt(operationId, generation, raw);
    try {
      const result = await raw;
      return await commitSuccess(operationId, generation, result);
    } catch (error) {
      if (error instanceof EffectRecoveryRequiredError) {
        return await settleFromJournal(operationId, generation, { reason: "recovery-required", error });
      }
      return await settleFromError(operationId, generation, error);
    }
  }

  async function runDetached(operationId, generation) {
    try {
      return await runDetachedInner(operationId, generation);
    } catch (error) {
      // Fail closed: an unexpected internal error must never leave a
      // current-generation record silently RUNNING with a hung handle.
      try {
        const record = await store.read(operationId);
        if (record == null || record.generation !== generation) {
          if (record != null) {
            await store.noteDiagnostic(operationId, {
              kind: "DETACHED_RUN_UNEXPECTED_ERROR",
              error: errorView(error)
            });
          }
          return record;
        }
        if (isDetachedTerminalStatus(record.status)) return record;
        if (isCancelFenced(record)) {
          return await settleCancellation(operationId, generation, { reason: "detached-run-failure", error });
        }
        const outcome = await applyTransition(operationId, generation, {
          to: DetachedOperationStatus.UNKNOWN,
          error: errorView(error),
          evidence: { escalation: "detached-run-failure", reason: "unexpected-error" },
          reason: "detached-run-failure"
        });
        if (outcome?.applied === true) return outcome.record;
        return outcome?.current ?? record;
      } catch {
        try {
          return await store.read(operationId);
        } catch {
          return null;
        }
      }
    }
  }

  async function runDetachedInner(operationId, generation) {
    const record = await store.read(operationId);
    if (record == null || record.generation !== generation) return record;
    if (isDetachedTerminalStatus(record.status)) return record;
    const binding = registry.get(record.capability);
    if (binding == null) {
      return settleFromJournal(operationId, generation, { reason: "initial-unknown-binding" });
    }
    if (binding.replayPolicy !== record.replayPolicy || binding.effect.replayPolicy !== record.replayPolicy) {
      const outcome = await applyTransition(operationId, generation, {
        to: DetachedOperationStatus.UNKNOWN,
        evidence: { escalation: "replay-policy-changed", reason: "initial-binding-check" },
        reason: "replay-policy-changed"
      });
      return outcome?.current ?? outcome?.record ?? record;
    }
    if (isCancelFenced(record)) {
      return settleCancellation(operationId, generation, { reason: "cancelled-before-launch" });
    }
    // Only the raw external attempt is tracked (see executeBoundAttempt), so
    // cancellation can tell a settled local attempt from one still capable
    // of committing later.
    const journalRecord = await effectOperationState(binding, record.effectOperationId);
    if (journalRecord?.status === EffectOperationStatus.CONFIRMED) {
      return commitSuccess(operationId, generation, journalRecord.result);
    }
    if (journalRecord != null && journalRecord.status !== EffectOperationStatus.INTENDED) {
      return settleFromJournal(operationId, generation, { reason: "initial-journal-state" });
    }
    const fenced = await store.read(operationId);
    if (fenced == null || fenced.generation !== generation) return fenced;
    if (isCancelFenced(fenced) || isDetachedTerminalStatus(fenced.status)) {
      return settleCancellation(operationId, generation, { reason: "fenced-before-dispatch" });
    }
    return executeBoundAttempt(operationId, generation, fenced, binding);
  }

  async function scheduleOperation(name, input, runtime = {}) {
    const binding = registry.get(name);
    invariant(binding, `detached operation capability not bound: ${name}`);
    const runtimeView = runtime ?? {};
    const effectOperationId = requireText(
      await binding.effect.operationKey({ input: clone(input), runtime: clone(runtimeView) }),
      `capability ${name} effect operationId`
    );
    const inputDigest = digestDetachedValue(clone(input));
    const operationId = deriveDetachedOperationId({
      scopeId,
      capability: name,
      effectOperationId,
      inputDigest,
      callId: runtimeView.callId ?? null,
      turn: runtimeView.turn ?? null,
      actionIntentRef: runtimeView.actionIntentRef ?? null,
      deliberationRef: runtimeView.deliberationRef ?? null
    });
    const created = await store.create({
      operationId,
      scopeId,
      capability: name,
      inputDigest,
      input: clone(input),
      effectOperationId,
      replayPolicy: binding.effect.replayPolicy,
      callId: runtimeView.callId ?? null,
      turn: clone(runtimeView.turn ?? null),
      trace: clone(runtimeView.trace ?? null),
      actionIntentRef: clone(runtimeView.actionIntentRef ?? null),
      deliberationRef: clone(runtimeView.deliberationRef ?? null),
      protocolVersion: DETACHED_OPERATION_PROTOCOL_VERSION
    });
    if (created.transition != null) emitTransition(created.transition);
    const record = created.record;
    if (!isDetachedTerminalStatus(record.status) && !created.attached) {
      // Durability first: the RUNNING record is persisted before any
      // background launch; the handle returns without awaiting the effect.
      // An attach to an existing record never launches: only the owner (or a
      // later takeover generation) may dispatch, so concurrent schedules can
      // never produce a second semantic effect.
      void runDetached(record.operationId, record.generation).catch((error) => {
        void store.noteDiagnostic(record.operationId, {
          kind: "DETACHED_RUN_UNEXPECTED_ERROR",
          at: now(),
          error: errorView(error)
        });
      });
    }
    return handleFor(record);
  }

  async function settleCancellation(operationId, generation, { reason = null, error = null } = {}) {
    const record = await store.read(operationId);
    if (record == null) return null;
    if (record.generation !== generation) {
      await store.noteDiagnostic(operationId, {
        kind: "STALE_GENERATION_CANCEL_IGNORED",
        generation,
        currentGeneration: record.generation,
        reason
      });
      return record;
    }
    if (isDetachedTerminalStatus(record.status)) return record;
    const binding = registry.get(record.capability);
    if (binding == null || journalFor(binding) == null || typeof journalFor(binding).get !== "function") {
      const missing = await applyTransition(operationId, generation, {
        to: DetachedOperationStatus.UNKNOWN,
        error: error == null ? null : errorView(error),
        evidence: { escalation: "missing-effect-journal", reason },
        reason: "missing-effect-journal"
      });
      return missing?.current ?? missing?.record ?? record;
    }
    const journalRecord = await effectOperationState(binding, record.effectOperationId);
    // A CONFIRMED effect always wins a racing cancel as SUCCEEDED.
    if (journalRecord?.status === EffectOperationStatus.CONFIRMED) {
      const outcome = await applyTransition(operationId, generation, {
        to: DetachedOperationStatus.SUCCEEDED,
        result: clone(journalRecord.result),
        evidence: clone(journalRecord.evidence ?? null),
        reason: "cancel-race-confirmed"
      });
      return outcome?.current ?? outcome?.record ?? record;
    }
    if (binding != null && (binding.replayPolicy !== record.replayPolicy || binding.effect.replayPolicy !== record.replayPolicy)) {
      const outcome = await applyTransition(operationId, generation, {
        to: DetachedOperationStatus.UNKNOWN,
        error: error == null ? null : errorView(error),
        evidence: { escalation: "replay-policy-changed", reason },
        reason: "replay-policy-changed"
      });
      return outcome?.current ?? outcome?.record ?? record;
    }
    const dispatched = journalRecord != null
      && (journalRecord.status === EffectOperationStatus.DISPATCHED || journalRecord.status === EffectOperationStatus.UNKNOWN);
    if (!dispatched) {
      // Before external DISPATCH every policy may become CANCELLED and no
      // launch/retry is permitted afterwards.
      const outcome = await applyTransition(operationId, generation, {
        to: DetachedOperationStatus.CANCELLED,
        error: null,
        evidence: { cancelReason: reason ?? null, dispatchState: journalRecord?.status ?? "ABSENT" },
        reason: reason ?? "cancel-before-dispatch"
      });
      return outcome?.current ?? outcome?.record ?? record;
    }
    const policy = record.replayPolicy;
    if (policy === EffectReplayPolicy.PURE) {
      // No external side effect exists; converge CANCELLED once the local
      // attempt is fenced/aborted. A still-capable in-flight attempt keeps
      // CANCEL_REQUESTED until it settles.
      const tracked = attemptFor(operationId);
      const settled = tracked == null || tracked.generation !== generation || tracked.settled === true;
      if (!settled) return record;
      const outcome = await applyTransition(operationId, generation, {
        to: DetachedOperationStatus.CANCELLED,
        error: null,
        evidence: { cancelReason: reason ?? null, dispatchState: journalRecord.status },
        reason: reason ?? "cancel-pure"
      });
      return outcome?.current ?? outcome?.record ?? record;
    }
    if (policy === EffectReplayPolicy.IDEMPOTENT) {
      // Idempotence permits safe replay during recovery; it never proves
      // that cancellation succeeded. While the current generation's local
      // attempt is still capable of committing, stay CANCEL_REQUESTED: a
      // CONFIRMED journal at settle time still wins as SUCCEEDED, otherwise
      // post-dispatch ambiguity converges UNKNOWN.
      const tracked = attemptFor(operationId);
      const settled = tracked == null || tracked.generation !== generation || tracked.settled === true;
      if (!settled) return record;
      const outcome = await applyTransition(operationId, generation, {
        to: DetachedOperationStatus.UNKNOWN,
        error: error == null ? null : errorView(error),
        evidence: { escalation: "cancel-after-dispatch", policy, dispatchState: journalRecord.status, cancelReason: reason ?? null },
        reason: "cancel-after-dispatch"
      });
      return outcome?.current ?? outcome?.record ?? record;
    }
    if (policy === EffectReplayPolicy.OBSERVABLE) {
      const tracked = attemptFor(operationId);
      const settled = tracked == null || tracked.generation !== generation || tracked.settled === true;
      if (!settled) return record;
      let observation = null;
      let observerError = null;
      try {
        invariant(binding != null && typeof binding.effect.observe === "function", "observable cancellation requires effect.observe()");
        observation = await binding.effect.observe({ operation: clone(journalRecord) });
      } catch (observeError) {
        observerError = observeError;
      }
      if (observerError != null || observation == null || typeof observation.satisfied !== "boolean") {
        const outcome = await applyTransition(operationId, generation, {
          to: DetachedOperationStatus.UNKNOWN,
          error: error == null ? null : errorView(error),
          evidence: { escalation: "observer-failure", dispatchState: journalRecord.status, cancelReason: reason ?? null },
          reason: "cancel-observer-failure"
        });
        return outcome?.current ?? outcome?.record ?? record;
      }
      if (observation.satisfied === true) {
        const outcome = await applyTransition(operationId, generation, {
          to: DetachedOperationStatus.SUCCEEDED,
          result: clone(observation.result ?? journalRecord.result ?? null),
          evidence: clone(observation.evidence ?? null),
          reason: "cancel-observed-satisfied"
        });
        return outcome?.current ?? outcome?.record ?? record;
      }
      const outcome = await applyTransition(operationId, generation, {
        to: DetachedOperationStatus.CANCELLED,
        error: null,
        evidence: { cancelReason: reason ?? null, dispatchState: journalRecord.status, observation: clone(observation.evidence ?? null) },
        reason: "cancel-observed-absent"
      });
      return outcome?.current ?? outcome?.record ?? record;
    }
    // NON_RECONCILABLE (and any unknown future policy): never guess
    // cancellation success after dispatch. A still-capable in-flight attempt
    // keeps CANCEL_REQUESTED; a CONFIRMED journal at settle time wins as
    // SUCCEEDED, otherwise converge UNKNOWN/ESCALATE.
    const pending = attemptFor(operationId);
    const attemptSettled = pending == null || pending.generation !== generation || pending.settled === true;
    if (!attemptSettled) return record;
    const outcome = await applyTransition(operationId, generation, {
      to: DetachedOperationStatus.UNKNOWN,
      error: error == null ? null : errorView(error),
      evidence: { escalation: "cancel-after-dispatch", policy, dispatchState: journalRecord.status, cancelReason: reason ?? null },
      reason: "cancel-after-dispatch"
    });
    return outcome?.current ?? outcome?.record ?? record;
  }

  return Object.freeze({
    scopeId,

    capability(name) {
      const binding = registry.get(name);
      invariant(binding, `detached operation capability not bound: ${name}`);
      return Object.freeze({
        name: binding.name,
        description: binding.description,
        effect: binding.effect,
        async execute(input, runtime = {}) {
          return scheduleOperation(name, input, runtime);
        }
      });
    },

    async schedule(name, input, runtime = {}) {
      return scheduleOperation(name, input, runtime);
    },

    async read(operationId) {
      requireText(operationId, "detached operation operationId");
      return store.read(operationId);
    },

    async list() {
      return store.list();
    },

    async transitions({ afterSequence = 0 } = {}) {
      return store.transitions({ afterSequence });
    },

    subscribe(listener) {
      invariant(typeof listener === "function", "detached operation subscribe requires a listener");
      subscribers.add(listener);
      return () => subscribers.delete(listener);
    },

    async cancel(operationId, { reason = null } = {}) {
      requireText(operationId, "detached operation operationId");
      const record = await store.read(operationId);
      invariant(record, `detached operation not found: ${operationId}`);
      if (isDetachedTerminalStatus(record.status)) return record;
      if (record.status !== DetachedOperationStatus.CANCEL_REQUESTED) {
        const fenced = await applyTransition(operationId, record.generation, {
          to: DetachedOperationStatus.CANCEL_REQUESTED,
          evidence: { cancelReason: reason ?? null },
          reason: reason ?? "cancel-requested"
        });
        if (fenced?.applied !== true) {
          const latest = fenced?.current ?? await store.read(operationId);
          if (latest != null && isDetachedTerminalStatus(latest.status)) return latest;
          // A concurrent takeover moved the generation; abort the latest
          // generation cooperatively and let its owner settle.
          if (latest != null) abortFor(operationId, latest.generation);
          return latest;
        }
      }
      const fencedRecord = await store.read(operationId);
      abortFor(operationId, fencedRecord.generation);
      return settleCancellation(operationId, fencedRecord.generation, { reason: reason ?? "cancel-requested" });
    },

    async recover() {
      const records = await store.list();
      const settled = [];
      for (const record of records) {
        if (isDetachedTerminalStatus(record.status)) {
          settled.push(record);
          continue;
        }
        // Generation is the fencing token: CAS-increment before any work so
        // concurrent recover calls yield one current generation.
        let takeover;
        try {
          takeover = await store.takeover(record.operationId);
        } catch {
          settled.push(await store.read(record.operationId));
          continue;
        }
        if (takeover.tookOver !== true) {
          settled.push(takeover.record);
          continue;
        }
        const owned = takeover.record;
        // Verify the exact stored binding against the live effect registry;
        // any mismatch fails closed without dispatching.
        const binding = registry.get(owned.capability);
        if (binding == null) {
          const outcome = await applyTransition(owned.operationId, owned.generation, {
            to: DetachedOperationStatus.UNKNOWN,
            evidence: { escalation: "unknown-capability-binding", reason: "recover-binding-check" },
            reason: "unknown-capability-binding"
          });
          settled.push(outcome?.record ?? outcome?.current ?? owned);
          continue;
        }
        if (binding.replayPolicy !== owned.replayPolicy || binding.effect.replayPolicy !== owned.replayPolicy) {
          const outcome = await applyTransition(owned.operationId, owned.generation, {
            to: DetachedOperationStatus.UNKNOWN,
            evidence: { escalation: "replay-policy-changed", reason: "recover-binding-check" },
            reason: "replay-policy-changed"
          });
          settled.push(outcome?.record ?? outcome?.current ?? owned);
          continue;
        }
        let recomputed = null;
        try {
          recomputed = await binding.effect.operationKey({
            input: clone(owned.input),
            runtime: {
              callId: owned.callId,
              turn: clone(owned.turn),
              trace: clone(owned.trace),
              actionIntentRef: clone(owned.actionIntentRef),
              deliberationRef: clone(owned.deliberationRef)
            }
          });
        } catch {
          recomputed = null;
        }
        if (recomputed !== owned.effectOperationId) {
          const outcome = await applyTransition(owned.operationId, owned.generation, {
            to: DetachedOperationStatus.UNKNOWN,
            evidence: { escalation: "effect-binding-changed", reason: "recover-binding-check" },
            reason: "effect-binding-changed"
          });
          settled.push(outcome?.record ?? outcome?.current ?? owned);
          continue;
        }
        // The stored operationId must re-derive from the stored binding; a
        // tampered call/turn/actionIntent/input binding fails closed here.
        const rederivedDigest = digestDetachedValue(clone(owned.input));
        const rederived = rederivedDigest === owned.inputDigest ? deriveDetachedOperationId({
          scopeId,
          capability: owned.capability,
          effectOperationId: owned.effectOperationId,
          inputDigest: owned.inputDigest,
          callId: owned.callId,
          turn: owned.turn,
          actionIntentRef: owned.actionIntentRef,
          deliberationRef: owned.deliberationRef
        }) : null;
        if (rederived !== owned.operationId) {
          const outcome = await applyTransition(owned.operationId, owned.generation, {
            to: DetachedOperationStatus.UNKNOWN,
            evidence: { escalation: "operation-binding-changed", reason: "recover-binding-check" },
            reason: "operation-binding-changed"
          });
          settled.push(outcome?.record ?? outcome?.current ?? owned);
          continue;
        }
        if (owned.status === DetachedOperationStatus.CANCEL_REQUESTED) {
          settled.push(await settleCancellation(owned.operationId, owned.generation, { reason: "recover-cancel-fenced" }));
          continue;
        }
        // Only the takeover winner settles; losers above returned early, so
        // two managers can never dispatch a second semantic effect here. A
        // locally in-flight attempt of any generation also blocks settling:
        // its journal outcome is not yet known, so recovery must not dispatch
        // alongside it. A later recover converges once it settles.
        const tracked = attemptFor(owned.operationId);
        if (tracked != null && tracked.settled !== true) {
          settled.push(owned);
          continue;
        }
        try {
          settled.push(await settleFromJournal(owned.operationId, owned.generation, { reason: "recover" }));
        } catch {
          settled.push(await store.read(owned.operationId));
        }
      }
      return settled.map(clone);
    }
  });
}

export { DetachedOperationBindingError };
