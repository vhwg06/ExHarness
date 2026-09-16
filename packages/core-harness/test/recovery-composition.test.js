import assert from "node:assert/strict";
import test from "node:test";
import {
  AVOCapability,
  EvaluationValidity,
  EvaluationVerdict,
  VerificationStatus,
  createHarness,
  createInMemorySessionStore,
  createResumableAgentRuntime,
  sameCandidate,
  verificationCapabilityName
} from "../src/index.js";
import {
  EffectOperationStatus,
  EffectRecoveryAction,
  EffectReplayPolicy
} from "../src/effect-reconciliation.js";

const SESSION_ID = "recovery-reference";
const COMPATIBILITY_TAG = "bb007-recovery-reference-v1";

function crashableStore() {
  const base = createInMemorySessionStore();
  let crashMainWrites = false;
  return Object.freeze({
    supportsRevisions: true,
    load: (sessionId) => base.load(sessionId),
    save(session, options) {
      if (session.id === SESSION_ID && crashMainWrites) {
        throw new Error("simulated process crash before Core session persistence");
      }
      return base.save(session, options);
    },
    crashMainWrites() {
      crashMainWrites = true;
    },
    recoverMainWrites() {
      crashMainWrites = false;
    }
  });
}

function referenceStrategy() {
  return {
    kind: "BB007_RECOVERY_REFERENCE",
    async run({ input, invoke }) {
      if (input.request?.mode === "continue") {
        return { continued: true, candidate: input.candidate.version };
      }

      await invoke(AVOCapability.OBSERVE, { phase: "before-effect" });
      await invoke(verificationCapabilityName("pre-effect"));
      await invoke(AVOCapability.ACT, { nextVersion: "v1" });
      return { reached: "after-effect" };
    }
  };
}

function objective() {
  return {
    async evaluate({ candidate }) {
      return {
        validity: EvaluationValidity.VALID,
        verdict: EvaluationVerdict.PASS,
        evidence: [`candidate:${candidate.version}`]
      };
    }
  };
}

function verifier() {
  return {
    name: "pre-effect",
    async verify({ candidate }) {
      return {
        claim: "recovery.pre-effect",
        status: VerificationStatus.PASS,
        evidence: [`verified:${candidate.version}`],
        summary: "pre-effect state captured"
      };
    }
  };
}

function makeRuntime({ snapshot = null } = {}) {
  return createResumableAgentRuntime({
    runtimeCompatibilityTag: COMPATIBILITY_TAG,
    strategy: referenceStrategy(),
    ...(snapshot == null ? {} : { snapshot })
  });
}

function makeHarness({ runtime, store, environment, actionEffect = undefined }) {
  return createHarness({
    agent: runtime,
    environment,
    objective: objective(),
    sessionStore: store,
    verifiers: [verifier()],
    recoveryPolicy: { staleAfterMs: 0 },
    ...(actionEffect == null ? {} : { actionEffect })
  });
}

function evidenceIdentity(state) {
  return Object.freeze({
    observations: state.persistentMemory.observations.map((item) => item.id),
    verifications: state.persistentMemory.verifications.map((item) => item.id)
  });
}

async function applyReconciledEffect(harness, sessionId, operation) {
  const state = await harness.workState(sessionId);
  const result = operation.result;
  if (result?.mutated !== true) {
    return Object.freeze({ applied: false, reason: "confirmed effect does not advance candidate state" });
  }

  if (sameCandidate(state.currentCandidate, result.candidate)) {
    return Object.freeze({ applied: false, reason: "confirmed effect result already persisted in Core state" });
  }
  if (!sameCandidate(state.currentCandidate, operation.candidate)) {
    return Object.freeze({ applied: false, escalated: true, reason: "Core candidate diverged from effect base" });
  }

  await harness.act(sessionId, operation.action);
  return Object.freeze({ applied: true, reason: "confirmed/retried effect result applied to Core state" });
}

async function recoverReferenceSession({ harness, runtime, sessionId }) {
  assert.equal(runtime.restoreInfo().restored, true, "runtime authority must be restored before Core recovery composition");

  const before = await harness.workState(sessionId);
  const evidenceBefore = evidenceIdentity(before);
  const effects = await harness.actionEffects(sessionId);
  const reconciliations = [];

  for (const initial of effects) {
    let operation = initial;
    let recovery = null;

    if (operation.status !== EffectOperationStatus.CONFIRMED) {
      recovery = await harness.reconcileActionEffect(sessionId, operation.operationId);
      reconciliations.push(recovery);
      if (recovery.action === EffectRecoveryAction.ESCALATE) {
        return Object.freeze({
          resumed: false,
          blockedBy: operation.operationId,
          recovery,
          evidenceBefore,
          variationRecovery: null
        });
      }
      operation = recovery.operation;
    }

    if (recovery?.action === EffectRecoveryAction.RETRY) {
      const state = await harness.workState(sessionId);
      if (!sameCandidate(state.currentCandidate, operation.candidate)) {
        return Object.freeze({
          resumed: false,
          blockedBy: operation.operationId,
          recovery: Object.freeze({
            action: EffectRecoveryAction.ESCALATE,
            operation,
            reason: "Core candidate diverged before effect retry"
          }),
          evidenceBefore,
          variationRecovery: null
        });
      }
      await harness.act(sessionId, operation.action);
      operation = (await harness.actionEffects(sessionId))
        .find((item) => item.operationId === operation.operationId);
      assert.equal(operation.status, EffectOperationStatus.CONFIRMED);
    }

    const applied = await applyReconciledEffect(harness, sessionId, operation);
    if (applied.escalated) {
      return Object.freeze({
        resumed: false,
        blockedBy: operation.operationId,
        recovery: Object.freeze({ action: EffectRecoveryAction.ESCALATE, operation, reason: applied.reason }),
        evidenceBefore,
        variationRecovery: null
      });
    }
  }

  const variationRecovery = await harness.recover(sessionId, { force: true });
  const afterRecovery = await harness.workState(sessionId);
  const evidenceAfter = evidenceIdentity(afterRecovery);
  assert.deepEqual(evidenceAfter, evidenceBefore, "persisted observation/verification evidence must survive recovery unchanged");

  const snapshot = await harness.resume(sessionId);
  return Object.freeze({
    resumed: true,
    blockedBy: null,
    reconciliations,
    variationRecovery,
    evidenceBefore,
    evidenceAfter,
    snapshot
  });
}

test("BB-007 restores runtime authority, applies confirmed effect truth, restores evidence, closes interruption, then explicitly resumes", async () => {
  const store = crashableStore();
  let externalCalls = 0;
  const environment = {
    async observe({ candidate, request }) {
      return { candidate, request };
    },
    async act({ candidate, action }) {
      externalCalls += 1;
      store.crashMainWrites();
      return {
        mutated: true,
        candidate: { id: candidate.id, version: action.nextVersion },
        result: { externalMutation: action.nextVersion }
      };
    }
  };

  const runtimeA = makeRuntime();
  const harnessA = makeHarness({ runtime: runtimeA, store, environment });
  await harnessA.start({
    sessionId: SESSION_ID,
    work: { kind: "RECOVERY_REFERENCE" },
    seedCandidate: { id: "candidate", version: "v0" }
  });
  const runtimeSnapshot = runtimeA.snapshot({ createdAt: "2026-09-16T00:00:00.000Z" });

  await assert.rejects(
    () => harnessA.vary(SESSION_ID, { input: { mode: "crash" } }),
    /simulated process crash before Core session persistence/
  );
  assert.equal(externalCalls, 1);

  const crashed = await harnessA.workState(SESSION_ID);
  assert.equal(crashed.currentCandidate.version, "v0");
  assert.equal(crashed.persistentMemory.variations.at(-1).status, "RUNNING");
  assert.equal(crashed.persistentMemory.observations.length, 1);
  assert.equal(crashed.persistentMemory.verifications.length, 1);
  const [effect] = await harnessA.actionEffects(SESSION_ID);
  assert.equal(effect.status, EffectOperationStatus.CONFIRMED);
  assert.equal(effect.result.candidate.version, "v1");

  store.recoverMainWrites();
  const runtimeB = makeRuntime({ snapshot: runtimeSnapshot });
  const harnessB = makeHarness({ runtime: runtimeB, store, environment });
  const recovered = await recoverReferenceSession({ harness: harnessB, runtime: runtimeB, sessionId: SESSION_ID });

  assert.equal(recovered.resumed, true);
  assert.equal(recovered.variationRecovery.recovered, true);
  assert.equal(recovered.snapshot.candidate.version, "v1");
  assert.equal(externalCalls, 1, "recovery must consume confirmed effect result without external redispatch");
  assert.equal((await harnessB.actionEffects(SESSION_ID))[0].status, EffectOperationStatus.CONFIRMED);

  const continuation = await harnessB.vary(SESSION_ID, { input: { mode: "continue" } });
  assert.equal(continuation.failure, null);
  assert.deepEqual(continuation.result, { continued: true, candidate: "v1" });
});

test("BB-007 leaves the interrupted variation unresolved when effect ambiguity is NON_RECONCILABLE", async () => {
  const store = crashableStore();
  let externalCalls = 0;
  const environment = {
    async observe({ candidate, request }) {
      return { candidate, request };
    },
    async act() {
      externalCalls += 1;
      store.crashMainWrites();
      throw new Error("ambiguous external dispatch");
    }
  };

  const runtimeA = makeRuntime();
  const harnessA = makeHarness({ runtime: runtimeA, store, environment });
  await harnessA.start({
    sessionId: SESSION_ID,
    work: { kind: "RECOVERY_REFERENCE" },
    seedCandidate: { id: "candidate", version: "v0" }
  });
  const runtimeSnapshot = runtimeA.snapshot({ createdAt: "2026-09-16T00:00:00.000Z" });

  await assert.rejects(
    () => harnessA.vary(SESSION_ID, { input: { mode: "crash" } }),
    /simulated process crash before Core session persistence/
  );
  assert.equal(externalCalls, 1);

  store.recoverMainWrites();
  const runtimeB = makeRuntime({ snapshot: runtimeSnapshot });
  const harnessB = makeHarness({ runtime: runtimeB, store, environment });
  const recovered = await recoverReferenceSession({ harness: harnessB, runtime: runtimeB, sessionId: SESSION_ID });

  assert.equal(recovered.resumed, false);
  assert.equal(recovered.recovery.action, EffectRecoveryAction.ESCALATE);
  assert.equal(recovered.variationRecovery, null);
  assert.equal((await harnessB.workState(SESSION_ID)).persistentMemory.variations.at(-1).status, "RUNNING");
  assert.equal(externalCalls, 1, "NON_RECONCILABLE ambiguity must not redispatch or close the interrupted work");
});

test("BB-007 machine-first IDEMPOTENT reconciliation retries before interrupted-variation closure", async () => {
  const store = crashableStore();
  let externalCalls = 0;
  const actionKeys = [];
  const environment = {
    async observe({ candidate, request }) {
      return { candidate, request };
    },
    async act({ candidate, action, actionKey }) {
      externalCalls += 1;
      actionKeys.push(actionKey);
      if (externalCalls === 1) {
        store.crashMainWrites();
        throw new Error("ambiguous first dispatch");
      }
      return {
        mutated: true,
        candidate: { id: candidate.id, version: action.nextVersion },
        result: { externalMutation: action.nextVersion }
      };
    }
  };

  const runtimeA = makeRuntime();
  const harnessA = makeHarness({
    runtime: runtimeA,
    store,
    environment,
    actionEffect: { replayPolicy: EffectReplayPolicy.IDEMPOTENT }
  });
  await harnessA.start({
    sessionId: SESSION_ID,
    work: { kind: "RECOVERY_REFERENCE" },
    seedCandidate: { id: "candidate", version: "v0" }
  });
  const runtimeSnapshot = runtimeA.snapshot({ createdAt: "2026-09-16T00:00:00.000Z" });

  await assert.rejects(
    () => harnessA.vary(SESSION_ID, { input: { mode: "crash" } }),
    /simulated process crash before Core session persistence/
  );
  assert.equal(externalCalls, 1);

  store.recoverMainWrites();
  const runtimeB = makeRuntime({ snapshot: runtimeSnapshot });
  const harnessB = makeHarness({
    runtime: runtimeB,
    store,
    environment,
    actionEffect: { replayPolicy: EffectReplayPolicy.IDEMPOTENT }
  });
  const recovered = await recoverReferenceSession({ harness: harnessB, runtime: runtimeB, sessionId: SESSION_ID });

  assert.equal(recovered.resumed, true);
  assert.equal(recovered.reconciliations[0].action, EffectRecoveryAction.RETRY);
  assert.equal(externalCalls, 2);
  assert.equal(actionKeys[0], actionKeys[1]);
  assert.equal(recovered.snapshot.candidate.version, "v1");
  assert.equal(recovered.variationRecovery.recovered, true);
});
