import assert from "node:assert/strict";
import test from "node:test";

import {
  ActionIntentStatus,
  ActionIntentTargetKind,
  EffectOperationArtifactKind,
  createActionIntentEffectController,
  createDeliberationController,
  createDeliberationStore
} from "../src/cognition.js";
import {
  EffectOperationStatus,
  EffectRecoveryAction,
  EffectRecoveryRequiredError,
  EffectReplayPolicy,
  createInMemoryEffectJournal,
  defineEffectCapability
} from "../src/effect-reconciliation.js";
import { createDeterministicClock, createDeterministicIdFactory } from "../src/testing.js";

function cognitionFixture() {
  const store = createDeliberationStore({
    clock: createDeterministicClock(),
    idFactory: createDeterministicIdFactory("effect-intent")
  });
  const deliberation = createDeliberationController({ store });
  const journal = createInMemoryEffectJournal();
  const effects = createActionIntentEffectController({ deliberation, journal });
  return { store, deliberation, journal, effects };
}

function step(deliberation) {
  return deliberation.deliberate({
    callId: "call-1",
    turn: 1,
    sourceRefs: [{ kind: "OBSERVATION", id: "observation-1" }],
    intent: "patch x.js",
    expectedOutcome: "x.js contains the repaired behavior",
    successCondition: "verification passes",
    action: {
      target: ActionIntentTargetKind.CAPABILITY,
      name: "repo.patch",
      input: { file: "x.js", patch: "fixed" }
    }
  });
}

function capability(journal, {
  replayPolicy = EffectReplayPolicy.IDEMPOTENT,
  observe = null,
  execute
} = {}) {
  return defineEffectCapability({
    name: "repo.patch",
    effect: {
      replayPolicy,
      operationKey: ({ input }) => `patch:${input.file}`,
      ...(observe == null ? {} : { observe })
    },
    async execute(input, runtime) {
      return execute(input, runtime);
    }
  }, { journal });
}

test("confirmed effect completes action intent with exact effect operation ref", async () => {
  const { deliberation, journal, effects } = cognitionFixture();
  const created = step(deliberation);
  const patch = capability(journal, {
    execute: async (input, runtime) => {
      assert.equal(runtime.callId, created.actionIntent.callId);
      assert.equal(runtime.actionIntentRef.id, created.actionIntent.id);
      assert.equal(runtime.deliberationRef.id, created.deliberation.id);
      return { ok: true, file: input.file };
    }
  });

  const result = await effects.execute(created.actionIntent.artifactRef, patch);

  assert.deepEqual(result.result, { ok: true, file: "x.js" });
  assert.equal(result.effectOperation.status, EffectOperationStatus.CONFIRMED);
  assert.equal(result.actionIntent.status, ActionIntentStatus.EXECUTED);
  assert.deepEqual(result.actionIntent.outcomeRefs, [{
    kind: EffectOperationArtifactKind,
    id: "patch:x.js"
  }]);
});

test("ambiguous idempotent effect keeps action intent authorized until reconcile and retry confirm", async () => {
  const { deliberation, journal, effects } = cognitionFixture();
  const created = step(deliberation);
  let attempts = 0;
  const patch = capability(journal, {
    execute: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("response lost after remote commit boundary");
      return { ok: true };
    }
  });

  await assert.rejects(
    () => effects.execute(created.actionIntent.artifactRef, patch),
    (error) => error instanceof EffectRecoveryRequiredError && error.status === EffectOperationStatus.UNKNOWN
  );

  const pending = deliberation.getActionIntent(created.actionIntent.id);
  assert.equal(pending.status, ActionIntentStatus.AUTHORIZED);
  assert.deepEqual(pending.outcomeRefs, [{ kind: EffectOperationArtifactKind, id: "patch:x.js" }]);
  assert.equal((await journal.get("patch:x.js")).status, EffectOperationStatus.UNKNOWN);

  const recovery = await effects.reconcile(created.actionIntent.artifactRef, patch, "patch:x.js");
  assert.equal(recovery.action, EffectRecoveryAction.RETRY);
  assert.equal(recovery.operation.status, EffectOperationStatus.INTENDED);
  assert.equal(recovery.actionIntent.status, ActionIntentStatus.AUTHORIZED);

  const retried = await effects.execute(created.actionIntent.artifactRef, patch);
  assert.equal(attempts, 2);
  assert.equal(retried.effectOperation.status, EffectOperationStatus.CONFIRMED);
  assert.equal(retried.actionIntent.status, ActionIntentStatus.EXECUTED);
});

test("observable effect can complete action intent by reconciliation without replay", async () => {
  const { deliberation, journal, effects } = cognitionFixture();
  const created = step(deliberation);
  const external = new Map();
  let attempts = 0;
  const patch = capability(journal, {
    replayPolicy: EffectReplayPolicy.OBSERVABLE,
    observe: async ({ operation }) => {
      const actual = external.get(operation.input.file) ?? null;
      return {
        satisfied: actual === operation.input.patch,
        result: { ok: actual === operation.input.patch },
        evidence: { source: "repo-read", actual }
      };
    },
    execute: async (input) => {
      attempts += 1;
      external.set(input.file, input.patch);
      throw new Error("connection dropped after patch committed");
    }
  });

  await assert.rejects(
    () => effects.execute(created.actionIntent.artifactRef, patch),
    (error) => error instanceof EffectRecoveryRequiredError
  );

  const recovery = await effects.reconcile(created.actionIntent.artifactRef, patch, "patch:x.js");
  assert.equal(recovery.action, EffectRecoveryAction.CONTINUE);
  assert.equal(recovery.operation.status, EffectOperationStatus.CONFIRMED);
  assert.equal(recovery.actionIntent.status, ActionIntentStatus.EXECUTED);
  assert.equal(attempts, 1);
});

test("non-reconcilable ambiguity escalates without falsely failing or completing intent", async () => {
  const { deliberation, journal, effects } = cognitionFixture();
  const created = step(deliberation);
  const patch = capability(journal, {
    replayPolicy: EffectReplayPolicy.NON_RECONCILABLE,
    execute: async () => {
      throw new Error("unknown external outcome");
    }
  });

  await assert.rejects(
    () => effects.execute(created.actionIntent.artifactRef, patch),
    (error) => error instanceof EffectRecoveryRequiredError
  );

  const recovery = await effects.reconcile(created.actionIntent.artifactRef, patch, "patch:x.js");
  assert.equal(recovery.action, EffectRecoveryAction.ESCALATE);
  assert.equal(recovery.actionIntent.status, ActionIntentStatus.AUTHORIZED);
  assert.equal(deliberation.getActionIntent(created.actionIntent.id).error, null);
});
