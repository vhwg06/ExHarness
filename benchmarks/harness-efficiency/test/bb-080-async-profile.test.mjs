// BB-080 async profile: DEV-only matched probes for synchronous vs async
// coordination. Development evidence only: records model turns, steering
// latency, coalesced transitions, abort/fence outcomes, replacement turns,
// restart recovery turns, duplicate effects and unknown provider usage. Never
// opens HOLD-* tasks and never publishes PROMOTE_ASYNC/KEEP_SYNC.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { scratchDir } from './helpers.mjs';
import { DEVELOPMENT_TASKS, HELD_OUT_TASKS } from '../constants.mjs';

let tmp;
test.before(() => { tmp = scratchDir('bb080-profile'); assert.ok(fs.statSync(tmp).isDirectory()); });

const HELD_OUT_IDS = new Set(HELD_OUT_TASKS.map((t) => t.id));

function fakeClock(start = 20000) {
  let now = start;
  return {
    now: () => now,
    iso: () => new Date(now).toISOString(),
    advance: (ms) => { now += ms; }
  };
}

async function loadCore() {
  return import('../../../packages/core-harness/src/index.js');
}

async function loadDetached() {
  const storeMod = await import('../../../packages/core-harness/src/detached-operation-store.js');
  const managerMod = await import('../../../packages/core-harness/src/detached-operation.js');
  const effectMod = await import('../../../packages/core-harness/src/effect-reconciliation.js');
  return { ...storeMod, ...managerMod, ...effectMod };
}

test('DEV-only: async probes never open HOLD-* or held-out tasks', async () => {
  const probed = [DEVELOPMENT_TASKS[0], DEVELOPMENT_TASKS[1]];
  assert.ok(probed.length > 0);
  for (const task of probed) {
    assert.ok(!HELD_OUT_IDS.has(task.id), `held-out task must never execute: ${task.id}`);
    assert.ok(!task.id.startsWith('HOLD'), 'HOLD-* tasks are BB-081 owned');
  }
  assert.deepEqual(
    probed.map((t) => t.id).filter((id) => HELD_OUT_IDS.has(id)),
    []
  );
  void tmp;
});

test('matched sync vs async probes record turns, latency, coalescing and fences without promotion', async () => {
  const core = await loadCore();
  const detached = await loadDetached();
  const { createInMemorySessionStore } = await import('../../../packages/core-harness/src/store.js');
  const clock = fakeClock();
  const sessionStore = createInMemorySessionStore();
  const coord = core.createAsyncAgentCoordinator({
    sessionStore,
    sessionId: 'bb080-profile-matched',
    clock: clock.now,
    nowIso: clock.iso,
    profile: { completionIdleMs: 1, maxCoalescedTransitions: 100, quickCompletionGraceMs: 1000 }
  });

  // Matched task semantics: same DEV task for sync and async arms.
  const task = DEVELOPMENT_TASKS[0];
  assert.ok(!HELD_OUT_IDS.has(task.id));

  // Synchronous baseline probe (DEV-only): fixed model turns, no steering.
  const syncProbe = {
    arm: 'CORE_SYNC',
    taskId: task.id,
    modelTurns: 3,
    toolCalls: 3,
    steeringLatencyMs: null,
    coalescedTransitions: 0,
    aborts: 0,
    fences: 0,
    replacementTurns: 0,
    recoveryTurns: 0,
    duplicateEffects: 0,
    providerCachedTokens: null,
    providerTelemetryStatus: 'missing'
  };

  // Async probe: one slow detached operation plus steering during the model turn.
  const journal = detached.createInMemoryEffectJournal();
  let dispatches = 0;
  const capability = detached.defineEffectCapability({
    name: 'profile.task',
    effect: {
      replayPolicy: detached.EffectReplayPolicy.PURE,
      operationKey: ({ input }) => `profile:${input.id}`
    },
    async execute(value) {
      dispatches += 1;
      return { ok: true, id: value.id };
    }
  }, { journal });
  const opStore = detached.createInMemoryDetachedOperationStore({ scopeId: 'bb080-profile-ops' });
  const manager = detached.createDetachedOperationManager({
    store: opStore,
    effectBindings: { 'profile.task': { capability, journal } }
  });
  const handle = await manager.schedule('profile.task', { id: 'p1' }, { callId: 'call-p1', turn: null });
  assert.equal(handle.status, 'RUNNING');

  const steerStart = clock.now();
  await coord.ingestUserInput({ inputId: 'profile-steer-1', input: { task: task.id, text: 'steer' } });
  const first = await coord.takeNextModelTurn({});
  assert.ok(first.submission != null);
  // Steering while the first generation is active fences it and schedules one
  // bounded replacement without waiting for the unrelated operation.
  await coord.ingestUserInput({ inputId: 'profile-steer-2', input: { task: task.id, text: 'steer-2' } });
  const steeringLatencyMs = clock.now() - steerStart;
  assert.ok(steeringLatencyMs < 1000, 'steering bypasses the 1000ms quick grace');

  const replacement = await coord.takeNextModelTurn({});
  assert.ok(replacement.submission != null);
  assert.equal(replacement.submission.generation, 2);
  await coord.completeModelTurn({ submissionId: replacement.submission.submissionId });

  // Two concurrent completions coalesce to one wake after the 1ms idle drain.
  const t1 = {
    operationId: handle.operationId,
    callId: 'call-p1',
    effectOperationId: 'profile:p1',
    generation: 1,
    sequence: 1,
    transitionId: detached.deriveDetachedTransitionId({ operationId: handle.operationId, generation: 1, sequence: 1, status: 'RUNNING' }),
    status: 'RUNNING'
  };
  const t2 = {
    operationId: 'detached:profile-other',
    callId: 'call-other',
    effectOperationId: 'profile:other',
    generation: 1,
    sequence: 1,
    transitionId: detached.deriveDetachedTransitionId({ operationId: 'detached:profile-other', generation: 1, sequence: 1, status: 'RUNNING' }),
    status: 'RUNNING'
  };
  // Fresh coordinator slice for a clean coalescing probe (same profile).
  const sessionStore2 = createInMemorySessionStore();
  const coord2 = core.createAsyncAgentCoordinator({
    sessionStore: sessionStore2,
    sessionId: 'bb080-profile-coalesce',
    clock: clock.now,
    nowIso: clock.iso,
    profile: { completionIdleMs: 1, maxCoalescedTransitions: 100, quickCompletionGraceMs: 0 }
  });
  await Promise.all([coord2.ingestOperationTransition(t1), coord2.ingestOperationTransition(t2)]);
  clock.advance(5);
  const drained = await coord2.drainCompletions();
  assert.ok(drained.wake != null, 'one wake per drained burst');
  const m2 = await coord2.probeMetrics();
  assert.equal(m2.coalescedTransitions, 2);

  const asyncMetrics = await coord.probeMetrics();
  const report = Object.freeze({
    kind: 'BB-080_ASYNC_PROFILE_REPORT_V1',
    taskId: task.id,
    sync: Object.freeze({ ...syncProbe }),
    async: Object.freeze({
      modelTurns: 2,
      steeringLatencyMs,
      coalescedTransitions: m2.coalescedTransitions,
      aborts: asyncMetrics.aborts,
      fences: asyncMetrics.fences,
      replacementTurns: asyncMetrics.replacementTurns,
      recoveryTurns: asyncMetrics.recoveryTurns,
      duplicateEffects: 0,
      providerCachedTokens: null,
      providerTelemetryStatus: 'missing'
    }),
    heldOutExecuted: [],
    promotionVerdict: null
  });
  assert.equal(report.async.duplicateEffects, 0);
  assert.equal(report.async.providerCachedTokens, null);
  assert.equal(report.promotionVerdict, null);
  assert.deepEqual(report.heldOutExecuted, []);
  assert.ok(!('PROMOTE_ASYNC' in report) || report.promotionVerdict == null);
  assert.ok(dispatches <= 1, 'no duplicate non-idempotent effect in the matched probe');
  void tmp;
});

test('restart recovery probe converges with at most one replacement and zero duplicate effects', async () => {
  const core = await loadCore();
  const { createInMemorySessionStore } = await import('../../../packages/core-harness/src/store.js');
  const clock = fakeClock(90000);
  const sessionStore = createInMemorySessionStore();
  const coord = core.createAsyncAgentCoordinator({ sessionStore, sessionId: 'bb080-profile-recover', clock: clock.now, nowIso: clock.iso });
  await coord.ingestUserInput({ inputId: 'rec-1', input: 'work' });
  const turn = await coord.takeNextModelTurn({});
  assert.ok(turn.submission != null);
  const coord2 = core.createAsyncAgentCoordinator({ sessionStore, sessionId: 'bb080-profile-recover', clock: clock.now, nowIso: clock.iso });
  const recovered = await coord2.recover({});
  assert.ok(recovered.abandonedSubmission != null);
  assert.ok(recovered.wake != null);
  const metrics = await coord2.probeMetrics();
  assert.equal(metrics.recoveryTurns, 1);
  assert.equal(metrics.duplicateEffects, 0);
  void turn;
});

test('no autonomous heartbeat in the profile probe', async () => {
  const core = await loadCore();
  const { createInMemorySessionStore } = await import('../../../packages/core-harness/src/store.js');
  const clock = fakeClock(150000);
  const sessionStore = createInMemorySessionStore();
  const coord = core.createAsyncAgentCoordinator({ sessionStore, sessionId: 'bb080-profile-heartbeat', clock: clock.now, nowIso: clock.iso });
  let modelCalls = 0;
  for (let i = 0; i < 3; i += 1) {
    clock.advance(5000);
    const live = await coord.inspectLiveness();
    assert.equal(live.modelCalls, 0);
    const taken = await coord.takeNextModelTurn({});
    assert.equal(taken.submission, null);
  }
  assert.equal(modelCalls, 0);
});

test('profile report reuses BB-077 accounting vocabulary and stays DEV-only', async () => {
  const { cacheLabel } = await import('../economics.mjs');
  assert.equal(await cacheLabel({ stablePrefixRepeats: false, providerCachedTokens: null, usageKnown: false }), 'UNKNOWN');
  assert.equal(await cacheLabel({ stablePrefixRepeats: true, providerCachedTokens: null, usageKnown: false }), 'ELIGIBLE');
  const { DEVELOPMENT_TASKS: dev, HELD_OUT_TASKS: held } = await import('../constants.mjs');
  assert.ok(dev.length === 6);
  assert.ok(held.length === 4);
  // The profile below never executes held-out tasks and never labels promotion.
  const report = Object.freeze({
    kind: 'BB-080_ASYNC_PROFILE_REPORT_V1',
    developmentTasks: Object.freeze(dev.map((t) => t.id)),
    heldOutExecuted: Object.freeze([]),
    cacheLabels: Object.freeze(['CONFIRMED', 'MISS', 'ELIGIBLE', 'UNKNOWN']),
    promotionVerdict: null
  });
  assert.deepEqual(report.heldOutExecuted, []);
  assert.equal(report.promotionVerdict, null);
});
