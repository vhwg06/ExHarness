import assert from "node:assert/strict";
import test from "node:test";

import {
  EffectOperationStatus,
  EffectRecoveryAction,
  EffectRecoveryRequiredError,
  EffectReplayPolicy,
  createInMemoryEffectJournal,
  defineEffectCapability,
  reconcileEffectOperation
} from "../src/effect-reconciliation.js";

const runtime = Object.freeze({ callId: "call-1", turn: { number: 1 }, trace: null });

test("effect intent is journaled before dispatch and successful result is replayed", async () => {
  const journal = createInMemoryEffectJournal();
  let executions = 0;
  const capability = defineEffectCapability({
    name: "create-pr",
    effect: {
      replayPolicy: EffectReplayPolicy.IDEMPOTENT,
      operationKey: ({ input }) => `pr:${input.head}:${input.base}`,
      desiredEffect: ({ input }) => ({ head: input.head, base: input.base })
    },
    async execute(input, executionRuntime) {
      executions += 1;
      assert.equal(executionRuntime.effect.operationId, "pr:feature/x:main");
      const duringDispatch = await journal.get(executionRuntime.effect.operationId);
      assert.equal(duringDispatch.status, EffectOperationStatus.DISPATCHED);
      return { number: 42, ...input };
    }
  }, { journal });

  const first = await capability.execute({ head: "feature/x", base: "main" }, runtime);
  const second = await capability.execute({ head: "feature/x", base: "main" }, runtime);

  assert.deepEqual(first, { number: 42, head: "feature/x", base: "main" });
  assert.deepEqual(second, first);
  assert.equal(executions, 1);
  const operation = await journal.get("pr:feature/x:main");
  assert.equal(operation.status, EffectOperationStatus.CONFIRMED);
});

test("ambiguous dispatch fails closed until explicit idempotent reconciliation prepares retry", async () => {
  const journal = createInMemoryEffectJournal();
  let attempts = 0;
  const capability = defineEffectCapability({
    name: "idempotent-write",
    effect: {
      replayPolicy: EffectReplayPolicy.IDEMPOTENT,
      operationKey: ({ input }) => `write:${input.id}`
    },
    async execute() {
      attempts += 1;
      if (attempts === 1) throw new Error("response lost after dispatch");
      return { ok: true };
    }
  }, { journal });

  await assert.rejects(
    () => capability.execute({ id: "a" }, runtime),
    /response lost/
  );
  assert.equal((await journal.get("write:a")).status, EffectOperationStatus.UNKNOWN);

  await assert.rejects(
    () => capability.execute({ id: "a" }, runtime),
    (error) => error instanceof EffectRecoveryRequiredError && error.code === "EFFECT_RECOVERY_REQUIRED"
  );
  assert.equal(attempts, 1);

  const recovery = await reconcileEffectOperation({ capability, journal, operationId: "write:a" });
  assert.equal(recovery.action, EffectRecoveryAction.RETRY);
  assert.equal(recovery.operation.status, EffectOperationStatus.INTENDED);

  assert.deepEqual(await capability.execute({ id: "a" }, runtime), { ok: true });
  assert.equal(attempts, 2);
  assert.equal((await journal.get("write:a")).status, EffectOperationStatus.CONFIRMED);
});

test("observable effect reconciles against actual state without replaying the side effect", async () => {
  const journal = createInMemoryEffectJournal();
  const external = new Map();
  let executions = 0;

  const capability = defineEffectCapability({
    name: "create-remote-object",
    effect: {
      replayPolicy: EffectReplayPolicy.OBSERVABLE,
      operationKey: ({ input }) => `remote:${input.id}`,
      desiredEffect: ({ input }) => ({ id: input.id, value: input.value }),
      async observe({ operation }) {
        const actual = external.get(operation.input.id) ?? null;
        return {
          satisfied: actual?.value === operation.desiredEffect.value,
          result: actual,
          evidence: { source: "remote-read", actual }
        };
      }
    },
    async execute(input) {
      executions += 1;
      external.set(input.id, { id: input.id, value: input.value });
      throw new Error("connection dropped after remote commit");
    }
  }, { journal });

  await assert.rejects(() => capability.execute({ id: "x", value: 7 }, runtime));
  assert.equal(executions, 1);
  assert.equal((await journal.get("remote:x")).status, EffectOperationStatus.UNKNOWN);

  const recovery = await reconcileEffectOperation({ capability, journal, operationId: "remote:x" });
  assert.equal(recovery.action, EffectRecoveryAction.CONTINUE);
  assert.equal(recovery.operation.status, EffectOperationStatus.CONFIRMED);
  assert.deepEqual(recovery.operation.result, { id: "x", value: 7 });

  const replayed = await capability.execute({ id: "x", value: 7 }, runtime);
  assert.deepEqual(replayed, { id: "x", value: 7 });
  assert.equal(executions, 1);
});

test("non-reconcilable effect escalates instead of guessing", async () => {
  const journal = createInMemoryEffectJournal();
  const capability = defineEffectCapability({
    name: "send-unknown-side-effect",
    effect: {
      replayPolicy: EffectReplayPolicy.NON_RECONCILABLE,
      operationKey: ({ input }) => `unknown:${input.id}`
    },
    async execute() {
      throw new Error("ambiguous external outcome");
    }
  }, { journal });

  await assert.rejects(() => capability.execute({ id: "1" }, runtime));
  const recovery = await reconcileEffectOperation({
    capability,
    journal,
    operationId: "unknown:1"
  });

  assert.equal(recovery.action, EffectRecoveryAction.ESCALATE);
  assert.equal(recovery.operation.status, EffectOperationStatus.UNKNOWN);
});
