import assert from "node:assert/strict";
import test from "node:test";

import {
  ActionIntentAuthorizationDecision,
  ActionIntentStatus,
  ActionIntentTargetKind,
  createDeliberationController,
  createDeliberationStore
} from "../src/cognition.js";
import { ExHarnessErrorCode } from "../src/errors.js";
import { createDeterministicClock, createDeterministicIdFactory } from "../src/testing.js";

function fixture({ authorize = null, policy = {} } = {}) {
  const store = createDeliberationStore({
    policy,
    clock: createDeterministicClock(),
    idFactory: createDeterministicIdFactory("cognition")
  });
  const controller = createDeliberationController({
    store,
    actionIntentPolicy: authorize == null
      ? {}
      : {
          name: "test-policy",
          revision: "1",
          authorize
        }
  });
  return { store, controller };
}

function step(controller) {
  return controller.deliberate({
    callId: "call-1",
    turn: 1,
    sourceRefs: [{ kind: "OBSERVATION", id: "observation-1" }],
    contextRefs: [{ kind: "CONTEXT", id: "context-1" }],
    intent: "repair bug X",
    expectedOutcome: "bug X no longer reproduces",
    successCondition: "evaluation for bug X passes",
    constraints: [{ kind: "scope", value: "bug-x" }],
    action: {
      target: ActionIntentTargetKind.CAPABILITY,
      name: "repo.patch",
      input: { file: "x.js" }
    }
  });
}

test("deliberation creates bounded semantic step and separate action intent", () => {
  const { controller } = fixture();
  const created = step(controller);

  assert.equal(created.deliberation.intent, "repair bug X");
  assert.equal(created.deliberation.actionIntentRef.id, created.actionIntent.id);
  assert.equal(created.actionIntent.deliberationRef.id, created.deliberation.id);
  assert.equal(created.actionIntent.status, ActionIntentStatus.PROPOSED);
  assert.deepEqual(created.actionIntent.sourceRefs, [{ kind: "OBSERVATION", id: "observation-1" }]);
  assert.equal(Object.prototype.hasOwnProperty.call(created.deliberation, "chainOfThought"), false);
});

test("action intent policy rejects before execution", async () => {
  let executed = false;
  const { controller } = fixture({
    authorize: async () => ({
      decision: ActionIntentAuthorizationDecision.DENY,
      reason: "insufficient persisted evidence",
      evidenceRefs: [{ kind: "OBSERVATION", id: "observation-1" }]
    })
  });
  const created = step(controller);

  await assert.rejects(
    controller.execute(created.actionIntent.artifactRef, async () => {
      executed = true;
      return null;
    }),
    (error) => error.code === ExHarnessErrorCode.ACTION_INTENT_REJECTED
  );
  assert.equal(executed, false);
  assert.equal(controller.getActionIntent(created.actionIntent.id).status, ActionIntentStatus.REJECTED);
});

test("authorized execution records exact outcome artifact ref", async () => {
  const { controller } = fixture();
  const created = step(controller);
  const result = await controller.execute(created.actionIntent.artifactRef, async () => ({
    artifactRef: { kind: "OBSERVATION", id: "observation-2" },
    value: { fixed: true }
  }));

  assert.equal(result.result.value.fixed, true);
  assert.equal(result.actionIntent.status, ActionIntentStatus.EXECUTED);
  assert.deepEqual(result.actionIntent.outcomeRefs, [{ kind: "OBSERVATION", id: "observation-2" }]);
});

test("deliberation store enforces serialized bounds", () => {
  const { controller } = fixture({ policy: { maxSerializedChars: 256 } });
  assert.throws(
    () => controller.deliberate({
      callId: "call-1",
      intent: "x".repeat(300),
      expectedOutcome: "outcome",
      successCondition: "success",
      action: { target: ActionIntentTargetKind.CUSTOM, name: "noop" }
    }),
    /serialized bound/
  );
});
