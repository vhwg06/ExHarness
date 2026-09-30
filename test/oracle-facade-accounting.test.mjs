// BB-087 regression suite: truthful facade accounting and typed provider/planner failure.
// Reproduces every case of docs/blackboard/evidence/BB-087/facade-probe.mjs with corrected expectations.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import * as O from '../packages/oracle/src/index.js';
import { defineContextRequirementBlock, resolveContextRequirementBlocks } from '../packages/core-harness/src/index.js';

const SNAP = 'rev-1';
const facadeSource = fs.readFileSync(new URL('../packages/oracle/src/context-resolution.js', import.meta.url), 'utf8');

function authority(observe = async () => ({ snapshotRef: SNAP })) {
  return { sourceKind: 'REPOSITORY', refPrefix: '', observe };
}
function provider({ fail = () => false, bytes = () => 5, operations = ['READ_EXACT'], snapshot = () => SNAP, onRetrieve = () => {} } = {}) {
  const providerId = 'p-fixture';
  return {
    descriptor: { providerId, sourceKinds: ['REPOSITORY'], operations, snapshotModes: ['EXACT', 'CURRENT'], currentnessValidators: ['REVISION'], maxConcurrentCalls: 1, costClass: 'LOW' },
    async retrieve(work) {
      onRetrieve(work);
      if (fail(work.evidenceId)) throw new O.ProviderFailure({ reason: 'SOURCE_FAILURE', providerId, evidenceId: work.evidenceId, detail: `fixture source failure ${work.evidenceId}` });
      const snap = snapshot();
      return [{ evidenceId: work.evidenceId, source: { kind: 'REPOSITORY', ref: 'repo', snapshotRef: snap, itemRef: work.sourceConstraint.itemRef }, validators: [{ kind: 'REVISION', value: snap, strength: 'STRONG' }], provenance: [{ kind: 'SOURCE_REF', ref: `repo@${snap}:${work.sourceConstraint.itemRef}` }], content: 'x'.repeat(bytes(work.evidenceId)), providerEvidence: { providerId, operation: work.operation } }];
    }
  };
}
const evidence = (id, necessity = 'REQUIRED') => ({ id, necessity, need: 'fixture need', source: { kind: 'REPOSITORY', ref: 'repo', snapshot: { mode: 'CURRENT' }, itemRefs: [`${id}.js`] }, requiredProvenance: [] });
const budget = (over = {}) => ({ maxItems: 3, maxMaterializedBytes: 100000, maxProviderCalls: 3, maxResolutionSteps: 1, ...over });
const requirement = (b, ev = [evidence('e1')]) => ({ consumerRef: 'bb087-accounting', semanticNeed: 'accounting', evidence: ev, budget: b });
function setup({ providerOptions, observe, planner: wrapPlanner, durability = null } = {}) {
  const catalog = O.createSourceCatalog({ providers: [provider(providerOptions)], snapshotAuthorities: [authority(observe)] });
  const real = O.createRetrievalPlanner({ catalog });
  const retrievalPlanner = wrapPlanner ? wrapPlanner(real) : real;
  return { catalog, retrievalPlanner, resolver: O.createOracleContextResolver({ sourceCatalog: catalog, retrievalPlanner, durability }) };
}
function assertTruthful(resolution, req, expected) {
  assert.equal(resolution.consumed.materializedBytes, resolution.materialization.bytes);
  assert.equal(resolution.consumed.items, resolution.items.length);
  assert.equal(resolution.consumed.resolutionSteps, 1);
  if (expected) assert.equal(resolution.consumed.providerCalls, expected.providerCalls);
  for (const [key, limit] of Object.entries(req.budget)) {
    const counter = key.slice(3, 4).toLowerCase() + key.slice(4);
    assert.ok(resolution.consumed[counter] <= limit, `${counter} within budget`);
  }
}

test('FA1 small item under a 6000-byte budget resolves COMPLETE with exact counters', async () => {
  const { resolver, retrievalPlanner } = setup();
  const req = requirement(budget({ maxMaterializedBytes: 6000 }));
  const { outcome, resolution } = await resolver.resolve(req);
  assert.equal(outcome, 'FRESH');
  assert.equal(resolution.status, 'COMPLETE');
  const reserved = retrievalPlanner.plan(req).reserved.providerCalls;
  assert.equal(reserved, 1);
  assertTruthful(resolution, req, { providerCalls: reserved });
  assert.equal(resolution.consumed.items, 1);
  assert.ok(resolution.materialization.bytes < 1000);
});

test('FA1 exact bytes: consumed.materializedBytes equals contract materialization and no constant counter remains', async () => {
  const { resolver } = setup({ providerOptions: { bytes: () => 777 } });
  const req = requirement(budget());
  const { resolution } = await resolver.resolve(req);
  assert.equal(resolution.status, 'COMPLETE');
  assert.notEqual(resolution.consumed.materializedBytes, 40000);
  assertTruthful(resolution, req, { providerCalls: 1 });
  const recomputed = O.defineContextResolution({ requirementId: resolution.requirementId, step: resolution.step, status: resolution.status, items: resolution.items, unresolved: resolution.unresolved, consumed: resolution.consumed }, req);
  assert.equal(recomputed.materialization.bytes, resolution.consumed.materializedBytes);
  assert.doesNotMatch(facadeSource, /40000/);
  assert.doesNotMatch(facadeSource, /Math\.max\(/);
  assert.doesNotMatch(facadeSource, /slice\(0,\s*3\)/);
});

test('FA1 zero reservations: all-UNSUPPORTED evidence reports providerCalls 0, never a floored 1', async () => {
  const { resolver } = setup({ providerOptions: { operations: ['SEARCH_LEXICAL'] } });
  const req = requirement(budget(), [evidence('e1', 'OPTIONAL')]);
  const { resolution } = await resolver.resolve(req);
  assert.equal(resolution.status, 'PARTIAL');
  assert.deepEqual(resolution.unresolved, [{ evidenceId: 'e1', reason: 'UNSUPPORTED' }]);
  assertTruthful(resolution, req, { providerCalls: 0 });
  assert.equal(resolution.consumed.items, 0);
});

test('FA2 REQUIRED provider SOURCE_FAILURE returns UNSATISFIED with typed reason and diagnostics outside identity', async () => {
  const { resolver } = setup({ providerOptions: { fail: () => true } });
  const req = requirement(budget());
  const result = await resolver.resolve(req);
  const { resolution, failures } = result;
  assert.equal(resolution.status, 'UNSATISFIED');
  assert.deepEqual(resolution.unresolved, [{ evidenceId: 'e1', reason: 'SOURCE_FAILURE' }]);
  assertTruthful(resolution, req, { providerCalls: 1 });
  assert.deepEqual(failures, [{ evidenceId: 'e1', providerId: 'p-fixture', reason: 'SOURCE_FAILURE', detail: 'fixture source failure e1' }]);
  assert.equal(Object.hasOwn(resolution, 'failures'), false);
  assert.equal(JSON.stringify(resolution).includes('fixture source failure'), false);
  assert.equal(O.contextResolutionId(resolution), resolution.resolutionId);
  assert.throws(() => O.assertConsumableContextResolution(resolution, req), /unresolved/);
});

test('FA2 OPTIONAL provider failure returns PARTIAL while REQUIRED evidence stays resolved', async () => {
  const { resolver } = setup({ providerOptions: { fail: (id) => id === 'e2' } });
  const req = requirement(budget(), [evidence('e1'), evidence('e2', 'OPTIONAL')]);
  const { resolution, failures } = await resolver.resolve(req);
  assert.equal(resolution.status, 'PARTIAL');
  assert.deepEqual(resolution.items.map((i) => i.evidenceId), ['e1']);
  assert.deepEqual(resolution.unresolved, [{ evidenceId: 'e2', reason: 'SOURCE_FAILURE' }]);
  assert.equal(failures.length, 1);
  assertTruthful(resolution, req, { providerCalls: 2 });
});

test('FA2 facade delegates to retrievalPlanner.execute() and no longer iterates planned work', async () => {
  let executeCalls = 0;
  const { resolver } = setup({ planner: (real) => ({ plan: real.plan, async execute(...args) { executeCalls++; return real.execute(...args); } }) });
  await resolver.resolve(requirement(budget()));
  assert.equal(executeCalls, 1);
  assert.match(facadeSource, /retrievalPlanner\.execute\(/);
  assert.doesNotMatch(facadeSource, /planned\.work/);
  assert.doesNotMatch(facadeSource, /registration\.retrieve/);
});

test('FA3 planner BUDGET_EXHAUSTED for OPTIONAL evidence is preserved, never MISSING', async () => {
  const { resolver, retrievalPlanner } = setup();
  const req = requirement(budget({ maxItems: 1, maxProviderCalls: 1 }), [evidence('e1'), evidence('e2', 'OPTIONAL')]);
  assert.deepEqual(retrievalPlanner.plan(req).unresolved, [{ evidenceId: 'e2', reason: 'BUDGET_EXHAUSTED' }]);
  const { resolution } = await resolver.resolve(req);
  assert.equal(resolution.status, 'PARTIAL');
  assert.deepEqual(resolution.unresolved, [{ evidenceId: 'e2', reason: 'BUDGET_EXHAUSTED' }]);
  assertTruthful(resolution, req, { providerCalls: 1 });
});

test('FA3 REQUIRED item larger than the byte budget yields UNSATISFIED BUDGET_EXHAUSTED, not a TypeError', async () => {
  const { resolver } = setup({ providerOptions: { bytes: () => 5000 } });
  const req = requirement(budget({ maxMaterializedBytes: 1000 }));
  const { resolution } = await resolver.resolve(req);
  assert.equal(resolution.status, 'UNSATISFIED');
  assert.deepEqual(resolution.unresolved, [{ evidenceId: 'e1', reason: 'BUDGET_EXHAUSTED' }]);
  assertTruthful(resolution, req);
});

// Materialization overflow beyond per-work reservations: the injected planner executes under a larger
// budget so the facade itself must apply D5 (drop OPTIONAL first, then REQUIRED, as BUDGET_EXHAUSTED).
const overflowPlanner = (real) => ({ plan: real.plan, execute: (r) => real.execute({ consumerRef: r.consumerRef, semanticNeed: r.semanticNeed, evidence: r.evidence, budget: { ...r.budget, maxMaterializedBytes: 100000 } }) });

test('FA3 facade materialization overflow drops OPTIONAL evidence first as BUDGET_EXHAUSTED', async () => {
  const { resolver } = setup({ providerOptions: { bytes: (id) => (id === 'e2' ? 3000 : 5) }, planner: overflowPlanner });
  const req = requirement(budget({ maxMaterializedBytes: 2000 }), [evidence('e1'), evidence('e2', 'OPTIONAL')]);
  const { resolution } = await resolver.resolve(req);
  assert.equal(resolution.status, 'PARTIAL');
  assert.deepEqual(resolution.items.map((i) => i.evidenceId), ['e1']);
  assert.deepEqual(resolution.unresolved, [{ evidenceId: 'e2', reason: 'BUDGET_EXHAUSTED' }]);
  assertTruthful(resolution, req, { providerCalls: 2 });
});

test('FA3 REQUIRED materialization overflow yields UNSATISFIED and never exceeds budget', async () => {
  const { resolver } = setup({ providerOptions: { bytes: () => 3000 }, planner: overflowPlanner });
  const req = requirement(budget({ maxMaterializedBytes: 2000 }));
  const { resolution } = await resolver.resolve(req);
  assert.equal(resolution.status, 'UNSATISFIED');
  assert.deepEqual(resolution.unresolved, [{ evidenceId: 'e1', reason: 'BUDGET_EXHAUSTED' }]);
  assert.equal(resolution.items.length, 0);
  assertTruthful(resolution, req, { providerCalls: 1 });
});

test('FA4 pre/post currentness drift still throws DurabilityFailure STALE_DURING_RESOLUTION', async () => {
  // Observation order: pre-observation, candidate validation, post-observation. Only the post-observation drifts.
  let observations = 0;
  const { resolver } = setup({ observe: async () => ({ snapshotRef: ++observations > 2 ? 'rev-2' : SNAP }) });
  await assert.rejects(resolver.resolve(requirement(budget())), (error) => error.name === 'DurabilityFailure' && error.reason === 'STALE_DURING_RESOLUTION');
});

test('FA4 durability REUSED result passes through unchanged without re-planning or re-accounting', async () => {
  let executeCalls = 0;
  const probe = setup();
  const fresh = await probe.resolver.resolve(requirement(budget()));
  const reused = Object.freeze({ outcome: 'REUSED', resolution: fresh.resolution, preObservations: fresh.preObservations, postObservations: fresh.postObservations, reuseKey: 'reuse-key', receiptRef: 'receipt-ref' });
  const { resolver } = setup({ durability: { resolve: async () => reused }, planner: (real) => ({ plan: real.plan, async execute(...args) { executeCalls++; return real.execute(...args); } }) });
  const result = await resolver.resolve(requirement(budget()));
  assert.equal(executeCalls, 0);
  assert.deepEqual(result, reused);
  assert.equal(result.resolution, fresh.resolution);
});

test('FA4 Core injected port projects a COMPLETE facade resolution once', async () => {
  let calls = 0;
  const { resolver } = setup();
  const port = { async resolve(req, metadata) { calls++; return resolver.resolve(req, metadata); } };
  const block = defineContextRequirementBlock({ name: 'oracle', trust: 'UNTRUSTED', requirement: requirement(budget()), project(result) { if (result.resolution.status === 'UNSATISFIED') throw new Error('unsatisfied'); return { status: result.resolution.status, items: result.resolution.items.length, bytes: result.resolution.consumed.materializedBytes }; } });
  const fixed = await resolveContextRequirementBlocks({ blocks: [block], selectedNames: ['oracle'], resolver: port, metadata: {} });
  assert.equal(calls, 1);
  assert.equal(fixed.length, 1);
  assert.equal(fixed[0].value.status, 'COMPLETE');
  assert.equal(fixed[0].value.items, 1);
});
