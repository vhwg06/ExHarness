import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
  restoreAsyncResultContextState,
  stageAsyncResultTransitions
} from "../src/async-result-context.js";
import { createDetachedOperationManager } from "../src/detached-operation.js";
import { deriveDetachedTransitionId, createInMemoryDetachedOperationStore } from "../src/detached-operation-store.js";
import { EffectReplayPolicy } from "../src/effect-reconciliation.js";

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
    transitions: [terminalTransition({
      status: "FAILED",
      transitionId: "detached:op-alpha:g1:s2:FAILED",
      result: null,
      error: { message: "nope" }
    })]
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
  const first = stageAsyncResultTransitions({ state, transitions: [terminalTransition()] });
  commitAsyncResultContext({ state, stagedItemIds: first.stagedItemIds, submissionId: "turn-1" });
  const prefix = projectAsyncResultRequest({ state }).committedBytes;
  const late = stageAsyncResultTransitions({
    state,
    transitions: [runningTransition({ sequence: 1, transitionId: "detached:op-alpha:g1:s1:RUNNING" })]
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

const REPO_ROOT = new URL("../../..", import.meta.url);

async function readRepoJson(path) {
  return JSON.parse(await readFile(new URL(path, REPO_ROOT), "utf8"));
}

async function loadRealDependencyEvidence() {
  const graph = await readRepoJson("docs/blackboard/work-graph.json");
  const byId = new Map(graph.tasks.map((task) => [task.id, task]));
  const task077 = byId.get("BB-077");
  const task078 = byId.get("BB-078");
  const result077 = await readRepoJson("docs/blackboard/artifacts/ready-implement-plan/BB-077.implementation-result.json");
  const result078 = await readRepoJson("docs/blackboard/artifacts/ready-implement-plan/BB-078.implementation-result.json");
  const judgment077 = await readRepoJson("docs/blackboard/artifacts/ready-implement-plan/BB-077.candidate-jev-evaluation.json");
  const judgment078 = await readRepoJson("docs/blackboard/artifacts/ready-implement-plan/BB-078.candidate-jev-evaluation.json");
  const delivered077 = await readRepoJson("docs/blackboard/artifacts/ready-implement-plan/BB-077.delivered-feature.json");
  const delivered078 = await readRepoJson("docs/blackboard/artifacts/ready-implement-plan/BB-078.delivered-feature.json");
  const livingState = await readFile(new URL("docs/living/system/core-harness/state.md", REPO_ROOT), "utf8");
  const livingWorkflow = await readFile(new URL("docs/living/system/core-harness/workflow.md", REPO_ROOT), "utf8");
  return { task077, task078, result077, result078, judgment077, judgment078, delivered077, delivered078, livingState, livingWorkflow };
}

test("dependency DEPENDENCY binds the real DONE BB-077/BB-078 graph, receipts, results, judgments and Living refs", async () => {
  const evidence = await loadRealDependencyEvidence();
  assert.equal(evidence.task077.status, "DONE");
  assert.equal(evidence.task078.status, "DONE");
  assert.equal(evidence.result077.artifactType, "IMPLEMENTATION_RESULT");
  assert.equal(evidence.result078.artifactType, "IMPLEMENTATION_RESULT");
  assert.ok(evidence.result077.claims.length > 0);
  assert.ok(evidence.result078.claims.length > 0);
  assert.equal(evidence.judgment077.artifactType, "JEV_EVALUATION");
  assert.equal(evidence.judgment078.artifactType, "JEV_EVALUATION");
  assert.equal(evidence.delivered077.artifactType, "DELIVERED_FEATURE");
  assert.equal(evidence.delivered078.artifactType, "DELIVERED_FEATURE");
  assert.ok(evidence.livingState.includes("Synchronous harness-economics"));
  assert.ok(evidence.livingState.includes("Detached operation scheduling"));
  assert.ok(evidence.livingWorkflow.includes("DETACHED OPERATION PATH"));

  const manifest = getAsyncResultContextDependencyManifest();
  const contract077 = evidence.task077.contract;
  const contract078 = evidence.task078.contract;
  const descriptors = {
    bb077: {
      status: evidence.task077.status,
      implementationResultRef: contract077.evidenceRef,
      judgmentRef: contract077.evaluationRef,
      deliveredRef: contract077.deliveryRef,
      accountingVocabulary: [...manifest.requires[0].accountingVocabulary]
    },
    bb078: {
      status: evidence.task078.status,
      implementationResultRef: contract078.evidenceRef,
      judgmentRef: contract078.evaluationRef,
      deliveredRef: contract078.deliveryRef,
      transitionEnvelope: [...manifest.requires[1].transitionEnvelope],
      storeApi: [...manifest.requires[1].storeApi]
    }
  };
  assert.equal(descriptors.bb077.implementationResultRef, manifest.requires[0].implementationResultRef);
  assert.equal(descriptors.bb077.judgmentRef, manifest.requires[0].judgmentRef);
  assert.equal(descriptors.bb078.implementationResultRef, manifest.requires[1].implementationResultRef);
  assert.equal(descriptors.bb078.judgmentRef, manifest.requires[1].judgmentRef);
  const result = assertDependencyContract(descriptors);
  assert.equal(result.satisfied, true);

  const tampered = {
    bb077: { ...descriptors.bb077 },
    bb078: { ...descriptors.bb078, status: "PLANNED" }
  };
  assert.throws(
    () => assertDependencyContract(tampered),
    (error) => error instanceof AsyncResultDependencyContradictionError
      && error.code === "PLAN_INPUT_CONTRADICTION"
  );
  assert.throws(
    () => assertDependencyContract({
      bb077: { ...descriptors.bb077, deliveredRef: "docs/blackboard/artifacts/ready-implement-plan/BB-077.json" },
      bb078: descriptors.bb078
    }),
    AsyncResultDependencyContradictionError
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

function joinWithRecord(envelope, record) {
  return {
    ...envelope,
    callId: record.callId,
    effectOperationId: record.effectOperationId
  };
}

async function produceRealOperation() {
  const store = createInMemoryDetachedOperationStore({ scopeId: "bb079-repair-probe" });
  const manager = createDetachedOperationManager({
    store,
    effectBindings: {
      "repair-cap": {
        name: "repair-cap",
        description: "repair probe capability",
        effect: {
          operationKey: async () => "effect-repair-1",
          replayPolicy: EffectReplayPolicy.PURE
        },
        // A journal port with no recorded dispatch keeps the background
        // attempt in-flight forever, so the probe record stays RUNNING and
        // the test observes only deterministically produced transitions.
        journal: { get: async () => null },
        execute: () => new Promise(() => {})
      }
    }
  });
  const handle = await manager.schedule("repair-cap", { task: "probe" }, { callId: "call-repair-1" });
  const record = await manager.read(handle.operationId);
  const running = (await manager.transitions())
    .filter((envelope) => envelope.operationId === handle.operationId && envelope.status === "RUNNING");
  assert.equal(running.length, 1);
  return { store, manager, record, running: running[0] };
}

test("real BB-078 production stages through the operation record join, including a lawful generation advance", async () => {
  const { store, record, running } = await produceRealOperation();
  assert.equal(record.callId, "call-repair-1");
  assert.equal(record.effectOperationId, "effect-repair-1");
  assert.equal(record.generation, 1);

  const state = createAsyncResultContextState();
  const staged = stageAsyncResultTransitions({ state, transitions: [joinWithRecord(running, record)] });
  assert.equal(staged.stagedItemIds.length, 1);
  assert.equal(state.stagedItems[0].operationId, record.operationId);
  assert.equal(state.stagedItems[0].callId, "call-repair-1");
  assert.equal(state.stagedItems[0].effectOperationId, "effect-repair-1");

  const fenced = await store.transition(record.operationId, {
    to: "CANCEL_REQUESTED",
    generation: 1,
    reason: "repair-probe"
  });
  const afterFence = await store.read(record.operationId);
  const joinedFence = joinWithRecord(fenced.transition, afterFence);
  const stagedFence = stageAsyncResultTransitions({ state, transitions: [joinedFence] });
  assert.equal(stagedFence.stagedItemIds.length, 1);

  const takeover = await store.takeover(record.operationId);
  assert.equal(takeover.tookOver, true);
  assert.equal(takeover.record.generation, 2);
  const advanced = await store.transition(record.operationId, {
    to: "CANCELLED",
    generation: 2,
    reason: "repair-probe-advance"
  });
  const afterAdvance = await store.read(record.operationId);
  const stagedAdvance = stageAsyncResultTransitions({
    state,
    transitions: [joinWithRecord(advanced.transition, afterAdvance)]
  });
  assert.equal(stagedAdvance.stagedItemIds.length, 1);
  const advancedItem = state.stagedItems[state.stagedItems.length - 1];
  assert.equal(advancedItem.generation, 2);
  assert.equal(advancedItem.callId, "call-repair-1");
  assert.equal(advancedItem.effectOperationId, "effect-repair-1");
  assert.equal(state.maxGenerationByOperation[record.operationId], 2);
});

test("a new transitionId for the same operation cannot change call or effect identity", async () => {
  const { record, running } = await produceRealOperation();
  const state = createAsyncResultContextState();
  stageAsyncResultTransitions({ state, transitions: [joinWithRecord(running, record)] });

  const evilCall = {
    ...running,
    sequence: running.sequence + 100,
    transitionId: deriveDetachedTransitionId({
      operationId: running.operationId,
      generation: running.generation,
      sequence: running.sequence + 100,
      status: running.status
    }),
    callId: "call-evil",
    effectOperationId: record.effectOperationId
  };
  assert.throws(
    () => stageAsyncResultTransitions({ state, transitions: [evilCall] }),
    (error) => error instanceof AsyncResultContextBindingError
      && /changed call\/effect binding/.test(error.message)
  );

  const evilEffect = {
    ...running,
    sequence: running.sequence + 101,
    transitionId: deriveDetachedTransitionId({
      operationId: running.operationId,
      generation: running.generation,
      sequence: running.sequence + 101,
      status: running.status
    }),
    callId: record.callId,
    effectOperationId: "effect-evil"
  };
  assert.throws(
    () => stageAsyncResultTransitions({ state, transitions: [evilEffect] }),
    AsyncResultContextBindingError
  );
  assert.equal(state.stagedItems.length, 1);
});

test("a forged transitionId that does not derive from its envelope fails closed", () => {
  const state = createAsyncResultContextState();
  stageAsyncResultTransitions({ state, transitions: [runningTransition()] });
  assert.throws(
    () => stageAsyncResultTransitions({
      state,
      transitions: [{
        ...terminalTransition(),
        transitionId: "detached:op-alpha:g9:s9:SUCCEEDED"
      }]
    }),
    (error) => error instanceof AsyncResultContextBindingError
      && /does not derive/.test(error.message)
  );
  assert.throws(
    () => stageAsyncResultTransitions({
      state,
      transitions: [{ ...runningTransition({ sequence: 5 }), transitionId: "bogus-id" }]
    }),
    AsyncResultContextBindingError
  );
});

test("staged payloads are deeply frozen against in-memory nested mutation", () => {
  const state = createAsyncResultContextState();
  stageAsyncResultTransitions({
    state,
    transitions: [terminalTransition({ result: { nested: { value: 1 } } })]
  });
  const item = state.stagedItems[0];
  assert.ok(Object.isFrozen(item));
  assert.ok(Object.isFrozen(item.result));
  assert.ok(Object.isFrozen(item.result.nested));
  assert.throws(() => {
    item.result.nested.value = 2;
  }, TypeError);
});

test("JSON round-trip restore keeps working checkpoints and rejects tampered ones", () => {
  const state = createAsyncResultContextState();
  const first = stageAsyncResultTransitions({ state, transitions: [runningTransition()] });
  commitAsyncResultContext({ state, stagedItemIds: first.stagedItemIds, submissionId: "turn-1" });
  const second = stageAsyncResultTransitions({ state, transitions: [terminalTransition()] });
  const prefixBefore = projectAsyncResultRequest({ state }).committedBytes;

  const restored = restoreAsyncResultContextState(JSON.parse(JSON.stringify(state)));
  assertCommittedPrefixStable({ previousCommittedBytes: prefixBefore, state: restored });
  const committed = commitAsyncResultContext({
    state: restored,
    stagedItemIds: second.stagedItemIds,
    submissionId: "turn-2"
  });
  assert.equal(committed.itemOrder.length, 2);
  assert.ok(Object.isFrozen(restored.committedItems[0]));
  assert.ok(Object.isFrozen(restored.committedItems[1].result));

  const tamperedPayload = JSON.parse(JSON.stringify(state));
  tamperedPayload.committedItems[0] = {
    ...tamperedPayload.committedItems[0],
    status: "SUCCEEDED",
    result: { forged: true }
  };
  assert.throws(
    () => restoreAsyncResultContextState(tamperedPayload),
    (error) => error instanceof AsyncResultContextPrefixError
      && error.code === "ASYNC_RESULT_CONTEXT_PREFIX_CORRUPTION"
  );

  const tamperedDigest = JSON.parse(JSON.stringify(state));
  tamperedDigest.committedPrefixDigest = "sha256:0000000000000000000000000000000000000000000000000000000000000000";
  assert.throws(() => restoreAsyncResultContextState(tamperedDigest), AsyncResultContextPrefixError);

  const tamperedAdd = JSON.parse(JSON.stringify(state));
  tamperedAdd.committedItems.push({
    ...tamperedAdd.committedItems[0],
    itemId: "async-result:forged",
    transitionId: "detached:op-alpha:g1:s9:SUCCEEDED",
    sequence: 9,
    status: "SUCCEEDED"
  });
  assert.throws(() => restoreAsyncResultContextState(tamperedAdd), AsyncResultContextPrefixError);

  const tamperedNested = JSON.parse(JSON.stringify(state));
  tamperedNested.stagedItems[0].result = { forged: true };
  assert.throws(
    () => restoreAsyncResultContextState(tamperedNested),
    (error) => error instanceof AsyncResultContextPrefixError
      && /staged integrity/.test(error.message)
  );
});

test("mutated committed state is caught on every entry point, not only the optional helper", () => {
  const state = createAsyncResultContextState();
  const staged = stageAsyncResultTransitions({ state, transitions: [runningTransition()] });
  commitAsyncResultContext({ state, stagedItemIds: staged.stagedItemIds, submissionId: "turn-1" });
  state.committedItems.push({ ...state.committedItems[0], itemId: "async-result:forged" });
  assert.throws(
    () => stageAsyncResultTransitions({ state, transitions: [terminalTransition()] }),
    AsyncResultContextPrefixError
  );
  assert.throws(
    () => projectAsyncResultRequest({ state }),
    AsyncResultContextPrefixError
  );
  assert.throws(
    () => commitAsyncResultContext({ state, stagedItemIds: ["async-result:forged"], submissionId: "turn-9" }),
    AsyncResultContextPrefixError
  );
});

test("commit rejects duplicates and enforces staged projection order", () => {
  const state = createAsyncResultContextState();
  const staged = stageAsyncResultTransitions({
    state,
    transitions: [runningTransition(), terminalTransition()]
  });
  const [firstId, secondId] = staged.stagedItemIds;
  assert.throws(
    () => commitAsyncResultContext({ state, stagedItemIds: [firstId, firstId], submissionId: "turn-1" }),
    /must be unique/
  );
  assert.throws(
    () => commitAsyncResultContext({ state, stagedItemIds: [secondId, firstId], submissionId: "turn-1" }),
    /projection order/
  );
  assert.throws(
    () => commitAsyncResultContext({ state, stagedItemIds: [secondId], submissionId: "turn-1" }),
    /projection order/
  );
  const partial = commitAsyncResultContext({ state, stagedItemIds: [firstId], submissionId: "turn-1" });
  assert.deepEqual(partial.committedItemIds, [firstId]);
  assert.deepEqual(state.stagedItems.map((item) => item.itemId), [secondId]);
  const rest = commitAsyncResultContext({ state, stagedItemIds: [secondId], submissionId: "turn-2" });
  assert.deepEqual(rest.itemOrder, [firstId, secondId]);
});
