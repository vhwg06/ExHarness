import assert from "node:assert/strict";
import test from "node:test";

import {
  ASYNC_OPERATION_UPDATE_KIND,
  ASYNC_RESULT_CONTEXT_NON_AUTHORITY,
  AsyncResultContextBindingError,
  AsyncResultContextPrefixError,
  AsyncResultDependencyContradictionError,
  assertCommittedPrefixStable,
  assertDependencyContract,
  commitAsyncResultContext,
  createAsyncResultContextState,
  getAsyncResultContextDependencyManifest,
  projectAsyncResultRequest,
  resolveEffectConfirmationFromProjection,
  resolveProductAcceptanceFromProjection,
  stageAsyncResultTransitions
} from "../src/async-result-context.js";

function runningTransition(overrides = {}) {
  return {
    operationId: "detached:op-alpha",
    callId: "call-alpha",
    effectOperationId: "effect-alpha",
    generation: 1,
    sequence: 1,
    transitionId: "detached:op-alpha:g1:s1:RUNNING",
    status: "RUNNING",
    ...overrides
  };
}

function terminalTransition(overrides = {}) {
  return {
    operationId: "detached:op-alpha",
    callId: "call-alpha",
    effectOperationId: "effect-alpha",
    generation: 1,
    sequence: 2,
    transitionId: "detached:op-alpha:g1:s2:SUCCEEDED",
    status: "SUCCEEDED",
    result: { value: 42 },
    ...overrides
  };
}

function exactDependencyDescriptors() {
  const manifest = getAsyncResultContextDependencyManifest();
  const bb077 = manifest.requires[0];
  const bb078 = manifest.requires[1];
  return {
    bb077: {
      status: bb077.status,
      implementationResultRef: bb077.implementationResultRef,
      judgmentRef: bb077.judgmentRef,
      deliveredRef: bb077.deliveredRef,
      accountingVocabulary: [...bb077.accountingVocabulary]
    },
    bb078: {
      status: bb078.status,
      implementationResultRef: bb078.implementationResultRef,
      judgmentRef: bb078.judgmentRef,
      deliveredRef: bb078.deliveredRef,
      transitionEnvelope: [...bb078.transitionEnvelope],
      storeApi: [...bb078.storeApi]
    }
  };
}

test("RUNNING then terminal stages as distinct immutable items without rewriting committed bytes", () => {
  const state = createAsyncResultContextState();
  const first = stageAsyncResultTransitions({ state, transitions: [runningTransition()] });
  assert.equal(first.stagedItemIds.length, 1);
  const committed = commitAsyncResultContext({
    state,
    stagedItemIds: first.stagedItemIds,
    submissionId: "turn-1"
  });
  assert.equal(committed.committedItemIds.length, 1);
  const turnOne = projectAsyncResultRequest({ state });
  const turnOneBytes = turnOne.committedBytes;

  const second = stageAsyncResultTransitions({ state, transitions: [terminalTransition()] });
  assert.equal(second.stagedItemIds.length, 1);
  assert.notEqual(second.stagedItemIds[0], first.stagedItemIds[0]);
  const turnTwo = projectAsyncResultRequest({ state });
  assert.ok(turnTwo.committedBytes.startsWith(turnOneBytes));
  assert.equal(
    turnTwo.committedPrefixSha256,
    committed.committedPrefixDigest
  );

  const committedAgain = commitAsyncResultContext({
    state,
    stagedItemIds: second.stagedItemIds,
    submissionId: "turn-2"
  });
  assert.deepEqual(committedAgain.itemOrder, [...first.stagedItemIds, ...second.stagedItemIds]);
  const turnThree = projectAsyncResultRequest({ state });
  assert.ok(turnThree.committedBytes.startsWith(turnOneBytes));
  assertCommittedPrefixStable({ previousCommittedBytes: turnOneBytes, state });
});

test("non-terminal items never expose result or error payloads", () => {
  const state = createAsyncResultContextState();
  const staged = stageAsyncResultTransitions({
    state,
    transitions: [runningTransition({ result: { value: 1 }, error: { message: "boom" } })]
  });
  assert.equal(state.stagedItems[0].result, null);
  assert.equal(state.stagedItems[0].error, null);
  assert.equal(state.stagedItems[0].terminal, false);
  assert.equal(staged.stagedItemIds.length, 1);
});

test("terminal items project the delivered result and error only from operation truth", () => {
  const state = createAsyncResultContextState();
  stageAsyncResultTransitions({
    state,
    transitions: [terminalTransition({ status: "FAILED", result: null, error: { message: "nope" } })]
  });
  assert.deepEqual(state.stagedItems[0].result, null);
  assert.deepEqual(state.stagedItems[0].error, { message: "nope" });
  assert.equal(state.stagedItems[0].terminal, true);
});

test("duplicate transitionId delivery is idempotent and creates no second item", () => {
  const state = createAsyncResultContextState();
  const first = stageAsyncResultTransitions({ state, transitions: [runningTransition()] });
  const second = stageAsyncResultTransitions({ state, transitions: [runningTransition()] });
  assert.deepEqual(second.skippedDuplicateTransitionIds, [runningTransition().transitionId]);
  assert.deepEqual(second.stagedItemIds, []);
  assert.equal(state.stagedItems.length, 1);
  assert.equal(first.stagedItemIds[0], state.stagedItems[0].itemId);
});

test("reused transitionId with conflicting binding fails closed", () => {
  const state = createAsyncResultContextState();
  stageAsyncResultTransitions({ state, transitions: [runningTransition()] });
  assert.throws(
    () => stageAsyncResultTransitions({
      state,
      transitions: [runningTransition({ effectOperationId: "effect-evil" })]
    }),
    (error) => error instanceof AsyncResultContextBindingError
      && error.code === "ASYNC_RESULT_CONTEXT_BINDING_MISMATCH"
  );
  assert.throws(
    () => stageAsyncResultTransitions({
      state,
      transitions: [runningTransition({ status: "SUCCEEDED", result: { value: 1 } })]
    }),
    AsyncResultContextBindingError
  );
  assert.equal(state.stagedItems.length, 1);
});

test("missing effect identity fails closed instead of projecting ambiguous context", () => {
  const state = createAsyncResultContextState();
  const transition = runningTransition();
  delete transition.effectOperationId;
  assert.throws(
    () => stageAsyncResultTransitions({ state, transitions: [transition] }),
    (error) => error instanceof AsyncResultContextBindingError
      && /fails closed/.test(error.message)
  );
  assert.equal(state.stagedItems.length, 0);
});

test("malformed generation and sequence fail closed", () => {
  const state = createAsyncResultContextState();
  assert.throws(
    () => stageAsyncResultTransitions({ state, transitions: [runningTransition({ generation: 0 })] }),
    /positive integer/
  );
  assert.throws(
    () => stageAsyncResultTransitions({ state, transitions: [runningTransition({ sequence: "1" })] }),
    /positive integer/
  );
  assert.throws(
    () => stageAsyncResultTransitions({ state, transitions: [runningTransition({ status: "BOGUS" })] }),
    /RUNNING\|CANCEL_REQUESTED/
  );
});

test("out-of-order sequences remain append-only without corrupting the committed prefix", () => {
  const state = createAsyncResultContextState();
  const first = stageAsyncResultTransitions({ state, transitions: [terminalTransition({ sequence: 2, transitionId: "t-s2" })] });
  commitAsyncResultContext({ state, stagedItemIds: first.stagedItemIds, submissionId: "turn-1" });
  const prefix = projectAsyncResultRequest({ state }).committedBytes;
  const late = stageAsyncResultTransitions({
    state,
    transitions: [runningTransition({ sequence: 1, transitionId: "t-s1-late" })]
  });
  assert.equal(late.stagedItemIds.length, 1);
  const committed = commitAsyncResultContext({ state, stagedItemIds: late.stagedItemIds, submissionId: "turn-2" });
  assert.equal(committed.itemOrder[0], first.stagedItemIds[0]);
  assertCommittedPrefixStable({ previousCommittedBytes: prefix, state });
});

test("committing an unknown or already-committed item fails closed", () => {
  const state = createAsyncResultContextState();
  const staged = stageAsyncResultTransitions({ state, transitions: [runningTransition()] });
  assert.throws(
    () => commitAsyncResultContext({ state, stagedItemIds: ["async-result:missing"], submissionId: "turn-1" }),
    /unknown or already-committed/
  );
  commitAsyncResultContext({ state, stagedItemIds: staged.stagedItemIds, submissionId: "turn-1" });
  assert.throws(
    () => commitAsyncResultContext({ state, stagedItemIds: staged.stagedItemIds, submissionId: "turn-2" }),
    /unknown or already-committed/
  );
});

test("deliberate mutation of committed bytes is detected as prefix corruption", () => {
  const state = createAsyncResultContextState();
  const staged = stageAsyncResultTransitions({ state, transitions: [runningTransition()] });
  commitAsyncResultContext({ state, stagedItemIds: staged.stagedItemIds, submissionId: "turn-1" });
  const before = projectAsyncResultRequest({ state }).committedBytes;
  state.committedItems = [
    { ...state.committedItems[0], status: "SUCCEEDED", result: { forged: true } }
  ];
  assert.throws(
    () => assertCommittedPrefixStable({ previousCommittedBytes: before, state }),
    (error) => error instanceof AsyncResultContextPrefixError
      && error.code === "ASYNC_RESULT_CONTEXT_PREFIX_CORRUPTION"
  );
});

test("each turn reports committed-prefix and staged-suffix digests with byte lengths", () => {
  const state = createAsyncResultContextState();
  stageAsyncResultTransitions({ state, transitions: [runningTransition()] });
  const projection = projectAsyncResultRequest({ state });
  assert.match(projection.committedPrefixSha256, /^sha256:[0-9a-f]{64}$/);
  assert.match(projection.stagedSuffixSha256, /^sha256:[0-9a-f]{64}$/);
  assert.equal(typeof projection.committedPrefixBytes, "number");
  assert.equal(typeof projection.stagedSuffixBytes, "number");
  assert.ok(projection.stagedSuffixBytes > 0);
  assert.deepEqual(projection.itemIds, []);
  assert.equal(projection.stagedItemIds.length, 1);
});

test("missing provider cache telemetry stays null and is never inferred from a stable digest", () => {
  const state = createAsyncResultContextState();
  const staged = stageAsyncResultTransitions({ state, transitions: [runningTransition()] });
  commitAsyncResultContext({ state, stagedItemIds: staged.stagedItemIds, submissionId: "turn-1" });
  const again = stageAsyncResultTransitions({ state, transitions: [terminalTransition()] });
  commitAsyncResultContext({ state, stagedItemIds: again.stagedItemIds, submissionId: "turn-2" });
  const projection = projectAsyncResultRequest({ state });
  assert.equal(projection.providerCachedTokens, null);
  assert.equal(projection.providerCacheWriteTokens, null);
  assert.equal(projection.providerTelemetryStatus, "missing");
});

test("reported provider cache telemetry is recorded separately from structural digests", () => {
  const state = createAsyncResultContextState();
  const projection = projectAsyncResultRequest({
    state,
    providerTelemetry: { cachedTokens: 128, cacheWriteTokens: 64 }
  });
  assert.equal(projection.providerCachedTokens, 128);
  assert.equal(projection.providerCacheWriteTokens, 64);
  assert.equal(projection.providerTelemetryStatus, "reported");
});

test("dependency manifest binds the exact DONE BB-077/BB-078 refs", () => {
  const { bb077, bb078 } = exactDependencyDescriptors();
  const result = assertDependencyContract({ bb077, bb078 });
  assert.equal(result.satisfied, true);
  assert.equal(result.contract, "BB-079_DEPENDENCY_MANIFEST_V1");
});

test("dependency PLAN_INPUT_CONTRADICTION negatives fail closed", () => {
  const { bb077, bb078 } = exactDependencyDescriptors();
  assert.throws(
    () => assertDependencyContract({ bb077: { ...bb077, status: "ACTIVE" }, bb078 }),
    (error) => error instanceof AsyncResultDependencyContradictionError
      && error.code === "PLAN_INPUT_CONTRADICTION"
  );
  assert.throws(
    () => assertDependencyContract({ bb077, bb078: null }),
    AsyncResultDependencyContradictionError
  );
  assert.throws(
    () => assertDependencyContract({
      bb077,
      bb078: { ...bb078, transitionEnvelope: ["transitionId", "operationId"] }
    }),
    /transition envelope is incompatible/
  );
  assert.throws(
    () => assertDependencyContract({
      bb077: { ...bb077, accountingVocabulary: ["stable-prefix"] },
      bb078
    }),
    /accounting vocabulary is incompatible/
  );
  assert.throws(
    () => assertDependencyContract({
      bb077: { ...bb077, implementationResultRef: "docs/blackboard/artifacts/ready-implement-plan/BB-077.json" },
      bb078
    }),
    /mismatch/
  );
});

test("projection truth cannot synthesize effect confirmation or product acceptance", () => {
  assert.equal(ASYNC_RESULT_CONTEXT_NON_AUTHORITY.kind, "ASYNC_RESULT_CONTEXT_NON_AUTHORITY/v1");
  assert.throws(resolveEffectConfirmationFromProjection, /cannot confirm EffectOperation truth/);
  assert.throws(
    () => resolveEffectConfirmationFromProjection({ status: "SUCCEEDED" }),
    /cannot confirm EffectOperation truth/
  );
  assert.throws(resolveProductAcceptanceFromProjection, /cannot accept a product result/);
});

test("binding-corruption and unresolved ambiguity leave state unchanged", () => {
  const state = createAsyncResultContextState();
  stageAsyncResultTransitions({ state, transitions: [runningTransition()] });
  const stagedCount = state.stagedItems.length;
  const seenCount = Object.keys(state.seenTransitionBindings).length;
  assert.throws(
    () => stageAsyncResultTransitions({
      state,
      transitions: [runningTransition({ callId: "call-evil" })]
    }),
    AsyncResultContextBindingError
  );
  assert.equal(state.stagedItems.length, stagedCount);
  assert.equal(Object.keys(state.seenTransitionBindings).length, seenCount);
});

test("projected items carry the exact plan identity fields", () => {
  const state = createAsyncResultContextState();
  stageAsyncResultTransitions({ state, transitions: [terminalTransition()] });
  const item = state.stagedItems[0];
  assert.equal(item.kind, ASYNC_OPERATION_UPDATE_KIND);
  assert.equal(item.operationId, "detached:op-alpha");
  assert.equal(item.callId, "call-alpha");
  assert.equal(item.effectOperationId, "effect-alpha");
  assert.equal(item.generation, 1);
  assert.equal(item.sequence, 2);
  assert.equal(item.transitionId, "detached:op-alpha:g1:s2:SUCCEEDED");
  assert.ok(Object.isFrozen(item));
});
