import assert from "node:assert/strict";
import test from "node:test";
import { EffectRecoveryAction, EffectReplayPolicy } from "../src/effect-reconciliation.js";
import { createEffectAwareHarness } from "../src/effect-aware-harness.js";
import { createInMemorySessionStore } from "../src/store.js";

function objective() {
  return {
    async evaluate() {
      return { validity: "VALID", verdict: "PASS", evidence: ["test"] };
    }
  };
}

function strategy() {
  return {
    async run() {
      return null;
    }
  };
}

function crashableStore() {
  const base = createInMemorySessionStore();
  let failMainSave = false;
  return Object.freeze({
    supportsRevisions: true,
    load: (sessionId) => base.load(sessionId),
    async save(session, options) {
      if (session.id === "effect-session" && failMainSave) {
        failMainSave = false;
        throw new Error("simulated core persistence crash");
      }
      return base.save(session, options);
    },
    failNextMainSave() {
      failMainSave = true;
    }
  });
}

function actionResult(candidate, action) {
  return {
    mutated: true,
    candidate: { id: candidate.id, version: action.nextVersion },
    result: { applied: action.nextVersion }
  };
}

function createTestHarness({ store, environment, actionEffect = undefined }) {
  return createEffectAwareHarness({
    strategy: strategy(),
    objective: objective(),
    environment,
    sessionStore: store,
    ...(actionEffect == null ? {} : { actionEffect })
  });
}

async function start(harness) {
  await harness.start({
    sessionId: "effect-session",
    work: { kind: "TEST" },
    seedCandidate: { id: "candidate", version: "v0" }
  });
}

test("BB-006 reuses a durably confirmed AVO action result after core-state persistence crashes", async () => {
  const store = crashableStore();
  let externalCalls = 0;
  const actionKeys = [];
  const environment = {
    async observe() { return null; },
    async act({ candidate, action, actionKey }) {
      externalCalls += 1;
      actionKeys.push(actionKey);
      store.failNextMainSave();
      return actionResult(candidate, action);
    }
  };

  const sessionA = createTestHarness({ store, environment });
  await start(sessionA);

  await assert.rejects(
    () => sessionA.act("effect-session", { nextVersion: "v1" }),
    /simulated core persistence crash/
  );
  assert.equal(externalCalls, 1);

  const afterCrash = await sessionA.resume("effect-session");
  assert.equal(afterCrash.candidate.version, "v0");
  const effects = await sessionA.actionEffects("effect-session");
  assert.equal(effects.length, 1);
  assert.equal(effects[0].status, "CONFIRMED");
  assert.equal(effects[0].result.candidate.version, "v1");

  const mainState = await sessionA.workState("effect-session");
  assert.equal("effectOperations" in mainState.persistentMemory, false, "effect state must remain separate from candidate/semantic state");

  const sessionB = createTestHarness({ store, environment });
  const recovered = await sessionB.act("effect-session", { nextVersion: "v1" });
  assert.equal(recovered.candidate.version, "v1");
  assert.equal(externalCalls, 1, "confirmed external effect must not be dispatched again");
  assert.equal(actionKeys.length, 1);

  const persisted = await sessionB.resume("effect-session");
  assert.equal(persisted.candidate.version, "v1");
});

test("BB-006 fails closed on ambiguous built-in AVO effects by default", async () => {
  const store = createInMemorySessionStore();
  let externalCalls = 0;
  const environment = {
    async observe() { return null; },
    async act() {
      externalCalls += 1;
      throw new Error("transport disappeared after dispatch");
    }
  };
  const harness = createTestHarness({ store, environment });
  await start(harness);

  await assert.rejects(
    () => harness.act("effect-session", { nextVersion: "v1" }),
    /transport disappeared after dispatch/
  );
  assert.equal(externalCalls, 1);
  const [operation] = await harness.actionEffects("effect-session");
  assert.equal(operation.status, "UNKNOWN");
  assert.equal(operation.replayPolicy, EffectReplayPolicy.NON_RECONCILABLE);

  await assert.rejects(
    () => harness.act("effect-session", { nextVersion: "v1" }),
    (error) => error?.code === "EFFECT_RECOVERY_REQUIRED"
  );
  assert.equal(externalCalls, 1, "ambiguous default effect must not be blindly replayed");

  const recovery = await harness.reconcileActionEffect("effect-session", operation.operationId);
  assert.equal(recovery.action, EffectRecoveryAction.ESCALATE);
  assert.equal(recovery.operation.status, "UNKNOWN");
});

test("BB-006 retries only when the adapter explicitly declares IDEMPOTENT effect semantics", async () => {
  const store = createInMemorySessionStore();
  let externalCalls = 0;
  const actionKeys = [];
  const environment = {
    async observe() { return null; },
    async act({ candidate, action, actionKey }) {
      externalCalls += 1;
      actionKeys.push(actionKey);
      if (externalCalls === 1) throw new Error("ambiguous first dispatch");
      return actionResult(candidate, action);
    }
  };
  const harness = createTestHarness({
    store,
    environment,
    actionEffect: { replayPolicy: EffectReplayPolicy.IDEMPOTENT }
  });
  await start(harness);

  await assert.rejects(
    () => harness.act("effect-session", { nextVersion: "v1" }),
    /ambiguous first dispatch/
  );
  const [operation] = await harness.actionEffects("effect-session");
  assert.equal(operation.status, "UNKNOWN");

  const recovery = await harness.reconcileActionEffect("effect-session", operation.operationId);
  assert.equal(recovery.action, EffectRecoveryAction.RETRY);
  assert.equal(recovery.operation.status, "INTENDED");

  const retried = await harness.act("effect-session", { nextVersion: "v1" });
  assert.equal(retried.candidate.version, "v1");
  assert.equal(externalCalls, 2);
  assert.equal(actionKeys[0], actionKeys[1], "idempotent retry must reuse deterministic action identity");
});
