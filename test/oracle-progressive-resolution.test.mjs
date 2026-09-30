// Progressive resolution: explicit bounded resolveNext steps over exact prior
// facade results, plus pinned-step consumption through Core's injected port.
// Hermetic: no filesystem writes, no network, no credentials; the scope test
// only reads repository source.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import * as O from '../packages/oracle/src/index.js';
import { createPinnedResolver, ProgressionRefused, PROGRESSION_RETRIABLE_REASONS } from '../packages/oracle/src/context-resolution.js';
import { defineContextRequirementBlock, resolveContextRequirementBlocks } from '../packages/core-harness/src/index.js';

const RETRIABLE = new Set(['BUDGET_EXHAUSTED', 'SOURCE_FAILURE', 'DEFERRED']);

function authority(revs) {
  return { sourceKind: 'REPOSITORY', refPrefix: '', observe: async ({ ref }) => ({ snapshotRef: revs[ref] ?? 'rev-1' }) };
}
function provider({ fail = () => false, bytes = () => 5, snapshot = () => 'rev-1', seen = null } = {}) {
  const providerId = 'p-progressive';
  return {
    descriptor: { providerId, sourceKinds: ['REPOSITORY'], operations: ['READ_EXACT'], snapshotModes: ['EXACT', 'CURRENT'], currentnessValidators: ['REVISION'], maxConcurrentCalls: 1, costClass: 'LOW' },
    async retrieve(work) {
      seen?.push(work.evidenceId);
      if (fail(work.evidenceId)) throw new O.ProviderFailure({ reason: 'SOURCE_FAILURE', providerId, evidenceId: work.evidenceId, detail: `progressive source failure ${work.evidenceId}` });
      const snap = snapshot(work);
      return [{ evidenceId: work.evidenceId, source: { kind: 'REPOSITORY', ref: work.sourceConstraint.ref, snapshotRef: snap, itemRef: work.sourceConstraint.itemRef }, validators: [{ kind: 'REVISION', value: snap, strength: 'STRONG' }], provenance: [{ kind: 'SOURCE_REF', ref: `${work.sourceConstraint.ref}@${snap}:${work.sourceConstraint.itemRef}` }], content: 'x'.repeat(bytes(work.evidenceId)), providerEvidence: { providerId, operation: work.operation } }];
    },
  };
}
const evidence = (id, necessity = 'REQUIRED', ref = 'repo') => ({ id, necessity, need: 'progressive need', source: { kind: 'REPOSITORY', ref, snapshot: { mode: 'CURRENT' }, itemRefs: [`${id}.js`] }, requiredProvenance: [] });
const noItemRefEvidence = (id, necessity = 'OPTIONAL') => ({ id, necessity, need: 'progressive need', source: { kind: 'REPOSITORY', ref: 'repo', snapshot: { mode: 'CURRENT' } }, requiredProvenance: [] });
const budget = (over = {}) => ({ maxItems: 8, maxMaterializedBytes: 100000, maxProviderCalls: 8, maxResolutionSteps: 4, ...over });
const requirement = (b, ev) => ({ consumerRef: 'progressive', semanticNeed: 'next step', evidence: ev, budget: b });
function setup({ providerOptions, revs = null, planner = null } = {}) {
  const revisions = revs ?? { repo: 'rev-1' };
  const catalog = O.createSourceCatalog({ providers: [provider(providerOptions)], snapshotAuthorities: [authority(revisions)] });
  const real = O.createRetrievalPlanner({ catalog });
  const retrievalPlanner = planner ? planner(real) : real;
  return { revisions, catalog, retrievalPlanner, resolver: O.createOracleContextResolver({ sourceCatalog: catalog, retrievalPlanner }) };
}
function assertWithinBudget(resolution, req) {
  for (const [key, limit] of Object.entries(req.budget)) {
    const counter = key.slice(3, 4).toLowerCase() + key.slice(4);
    assert.ok(resolution.consumed[counter] <= limit, `${counter} within budget`);
  }
}

test('progressive chaining: resolveNext returns step index+1 bound to the previous resolutionId', async () => {
  let failE2 = true;
  const { resolver } = setup({ providerOptions: { fail: (id) => id === 'e2' && failE2 } });
  const req = requirement(budget(), [evidence('e1'), evidence('e2')]);
  const first = await resolver.resolve(req);
  assert.equal(first.resolution.status, 'UNSATISFIED');
  assert.deepEqual(first.resolution.unresolved, [{ evidenceId: 'e2', reason: 'SOURCE_FAILURE' }]);
  failE2 = false;
  const next = await resolver.resolveNext(req, first);
  assert.equal(next.outcome, 'FRESH');
  assert.equal(next.resolution.requirementId, first.resolution.requirementId);
  assert.equal(next.resolution.step.index, 1);
  assert.equal(next.resolution.step.previousResolutionId, first.resolution.resolutionId);
  assert.equal(next.resolution.status, 'COMPLETE');
  assert.deepEqual(next.resolution.unresolved, []);
  assert.deepEqual(next.resolution.items.map((i) => i.evidenceId), ['e1', 'e2']);
  assertWithinBudget(next.resolution, req);
});

test('progressive retriable selection: only BUDGET_EXHAUSTED/SOURCE_FAILURE/DEFERRED evidence is re-attempted', async () => {
  let failE2 = true;
  const planned = [];
  const recordPlanner = (real) => ({
    plan: real.plan.bind(real),
    execute: async (r, opts) => { planned.push(r.evidence.map((e) => e.id)); return real.execute(r, opts); },
  });
  const { resolver } = setup({ providerOptions: { fail: (id) => id === 'e2' && failE2 }, planner: recordPlanner });
  // e3 has no itemRefs so the READ_EXACT-only provider cannot serve it: planner UNSUPPORTED (non-retriable).
  const req = requirement(budget(), [evidence('e1'), evidence('e2'), noItemRefEvidence('e3')]);
  const first = await resolver.resolve(req);
  assert.deepEqual(first.resolution.unresolved, [{ evidenceId: 'e3', reason: 'UNSUPPORTED' }, { evidenceId: 'e2', reason: 'SOURCE_FAILURE' }]);
  failE2 = false;
  const next = await resolver.resolveNext(req, first);
  assert.deepEqual(planned[1], ['e2']);
  assert.deepEqual(next.resolution.unresolved, [{ evidenceId: 'e3', reason: 'UNSUPPORTED' }]);
  assert.ok(next.resolution.items.some((i) => i.evidenceId === 'e2'));
  assert.ok(!next.resolution.items.some((i) => i.evidenceId === 'e3'));
});

test('progressive retriable set includes DEFERRED alongside SOURCE_FAILURE', async () => {
  let failE2 = true;
  const { resolver } = setup({ providerOptions: { fail: (id) => id === 'e2' && failE2 } });
  const req = requirement(budget(), [evidence('e1'), evidence('e2')]);
  const first = await resolver.resolve(req);
  assert.deepEqual(first.resolution.unresolved, [{ evidenceId: 'e2', reason: 'SOURCE_FAILURE' }]);
  const deferred = O.defineContextResolution({
    requirementId: first.resolution.requirementId, step: first.resolution.step, status: first.resolution.status,
    items: first.resolution.items, unresolved: [{ evidenceId: 'e2', reason: 'DEFERRED' }], consumed: first.resolution.consumed,
  }, req);
  failE2 = false;
  const next = await resolver.resolveNext(req, { ...first, resolution: deferred });
  assert.ok(RETRIABLE.has('DEFERRED'));
  assert.equal(next.resolution.step.index, 1);
  assert.equal(next.resolution.status, 'COMPLETE');
  assert.deepEqual(next.resolution.items.map((i) => i.evidenceId), ['e1', 'e2']);
});

test('progressive budget: BUDGET_EXHAUSTED evidence is re-attempted under remaining budget with monotonic consumption', async () => {
  const { resolver } = setup();
  const req = requirement(budget({ maxItems: 1, maxResolutionSteps: 3 }), [evidence('e1'), evidence('e2')]);
  const first = await resolver.resolve(req);
  assert.equal(first.resolution.status, 'UNSATISFIED');
  assert.deepEqual(first.resolution.unresolved, [{ evidenceId: 'e2', reason: 'BUDGET_EXHAUSTED' }]);
  const next = await resolver.resolveNext(req, first);
  assert.equal(next.resolution.step.index, 1);
  assert.deepEqual(next.resolution.items, first.resolution.items);
  assert.deepEqual(next.resolution.unresolved, [{ evidenceId: 'e2', reason: 'BUDGET_EXHAUSTED' }]);
  for (const key of ['items', 'materializedBytes', 'providerCalls', 'resolutionSteps']) {
    assert.ok(next.resolution.consumed[key] >= first.resolution.consumed[key], `${key} monotonic`);
  }
  assert.equal(next.resolution.consumed.items, first.resolution.consumed.items);
  assert.equal(next.resolution.consumed.materializedBytes, first.resolution.consumed.materializedBytes);
  assertWithinBudget(next.resolution, req);
});

test('progressive budget fence: a step that would exceed the requirement budget is rejected', async () => {
  const { resolver } = setup({ planner: (real) => ({ plan: real.plan.bind(real), execute: (r) => real.execute(r) }) });
  const req = requirement(budget({ maxItems: 1, maxResolutionSteps: 3 }), [evidence('e1'), evidence('e2')]);
  const first = await resolver.resolve(req);
  assert.deepEqual(first.resolution.unresolved, [{ evidenceId: 'e2', reason: 'BUDGET_EXHAUSTED' }]);
  // The planner ignores the remaining budget and retrieves e2 anyway: the
  // facade must refuse rather than exceed maxItems.
  await assert.rejects(resolver.resolveNext(req, first), /budget exceeded/);
  const parent = first.resolution;
  assert.throws(() => O.defineContextResolution({
    requirementId: parent.requirementId,
    step: { index: parent.step.index + 1, previousResolutionId: parent.resolutionId },
    status: parent.status, items: parent.items, unresolved: parent.unresolved,
    consumed: { ...parent.consumed, resolutionSteps: parent.consumed.resolutionSteps + 1, providerCalls: parent.consumed.providerCalls - 1 },
  }, req, parent), /consumption decreased/);
});

test('progressive verbatim: prior items are retained byte-identical in order and content', async () => {
  let failE2 = true;
  const { resolver } = setup({ providerOptions: { fail: (id) => id === 'e2' && failE2 } });
  const req = requirement(budget(), [evidence('e1'), evidence('e2')]);
  const first = await resolver.resolve(req);
  failE2 = false;
  const next = await resolver.resolveNext(req, first);
  assert.equal(JSON.stringify(next.resolution.items.slice(0, first.resolution.items.length)), JSON.stringify(first.resolution.items));
  assert.deepEqual(next.resolution.items.slice(0, first.resolution.items.length), first.resolution.items);
});

test('progressive no-hidden-growth: chained steps add items only for previously unresolved evidence', async () => {
  const remaining = { e2: 1, e3: 2 };
  const { resolver } = setup({ providerOptions: { fail: (id) => (remaining[id] ?? 0) > 0 && (remaining[id]--, true) } });
  const req = requirement(budget(), [evidence('e1'), evidence('e2', 'OPTIONAL'), evidence('e3', 'OPTIONAL')]);
  const first = await resolver.resolve(req);
  assert.equal(first.resolution.status, 'PARTIAL');
  const second = await resolver.resolveNext(req, first);
  assert.equal(second.resolution.step.index, 1);
  assert.equal(second.resolution.step.previousResolutionId, first.resolution.resolutionId);
  const added1 = second.resolution.items.slice(first.resolution.items.length);
  assert.ok(added1.length > 0);
  for (const item of added1) assert.equal(item.evidenceId, 'e2');
  assert.equal(second.resolution.items.filter((i) => i.evidenceId === 'e1').length, 1);
  const third = await resolver.resolveNext(req, second);
  assert.equal(third.resolution.step.index, 2);
  assert.equal(third.resolution.step.previousResolutionId, second.resolution.resolutionId);
  const added2 = third.resolution.items.slice(second.resolution.items.length);
  assert.ok(added2.length > 0);
  for (const item of added2) assert.equal(item.evidenceId, 'e3');
  assert.deepEqual(third.resolution.items.slice(0, second.resolution.items.length), second.resolution.items);
  assert.equal(third.resolution.status, 'COMPLETE');
  for (const key of ['items', 'materializedBytes', 'providerCalls', 'resolutionSteps']) {
    assert.ok(third.resolution.consumed[key] >= second.resolution.consumed[key], `${key} monotonic`);
  }
  assertWithinBudget(third.resolution, req);
});

test('progressive refusal: a previous result for a different requirementId is rejected', async () => {
  const { resolver } = setup();
  const reqA = requirement(budget(), [evidence('e1')]);
  const reqB = requirement(budget(), [evidence('e1'), evidence('e2', 'OPTIONAL')]);
  const prevA = await resolver.resolve(reqA);
  await assert.rejects(resolver.resolveNext(reqB, prevA), /different requirement/);
  const prevB = await resolver.resolve(reqB);
  await assert.rejects(resolver.resolveNext(reqA, prevB), /different requirement/);
});

test('progressive refusal: COMPLETE previous throws ALREADY_COMPLETE', async () => {
  const { resolver } = setup();
  const req = requirement(budget(), [evidence('e1')]);
  const first = await resolver.resolve(req);
  assert.equal(first.resolution.status, 'COMPLETE');
  await assert.rejects(resolver.resolveNext(req, first), (error) => error instanceof ProgressionRefused && error.name === 'ProgressionRefused' && error.reason === 'ALREADY_COMPLETE');
});

test('progressive refusal: exhausted steps throws STEPS_EXHAUSTED', async () => {
  let failE2 = true;
  const { resolver } = setup({ providerOptions: { fail: (id) => id === 'e2' && failE2 } });
  const req = requirement(budget({ maxResolutionSteps: 1 }), [evidence('e1'), evidence('e2')]);
  const first = await resolver.resolve(req);
  assert.notEqual(first.resolution.status, 'COMPLETE');
  void failE2;
  await assert.rejects(resolver.resolveNext(req, first), (error) => error.name === 'ProgressionRefused' && error.reason === 'STEPS_EXHAUSTED');
});

test('progressive refusal: only non-retriable unresolved throws NOTHING_RETRIABLE', async () => {
  const { resolver } = setup();
  const unsupported = await resolver.resolve(requirement(budget(), [noItemRefEvidence('e1')]));
  assert.deepEqual(unsupported.resolution.unresolved, [{ evidenceId: 'e1', reason: 'UNSUPPORTED' }]);
  await assert.rejects(resolver.resolveNext(requirement(budget(), [noItemRefEvidence('e1')]), unsupported), (error) => error.name === 'ProgressionRefused' && error.reason === 'NOTHING_RETRIABLE');
  const ambiguousSetup = setup({ providerOptions: { fail: () => true } });
  const ambiguousReq = requirement(budget(), [evidence('e9', 'OPTIONAL')]);
  const { resolver: ambiguousResolver } = ambiguousSetup;
  const prior = await ambiguousResolver.resolve(ambiguousReq);
  assert.deepEqual(prior.resolution.unresolved, [{ evidenceId: 'e9', reason: 'SOURCE_FAILURE' }]);
  const nonRetriable = O.defineContextResolution({
    requirementId: prior.resolution.requirementId, step: prior.resolution.step, status: prior.resolution.status,
    items: prior.resolution.items, unresolved: [{ evidenceId: 'e9', reason: 'AMBIGUOUS' }], consumed: prior.resolution.consumed,
  }, ambiguousReq);
  await assert.rejects(ambiguousResolver.resolveNext(ambiguousReq, { ...prior, resolution: nonRetriable }), (error) => error.name === 'ProgressionRefused' && error.reason === 'NOTHING_RETRIABLE');
});

test('progressive currentness: drift of previously resolved evidence throws STALE_DURING_RESOLUTION', async () => {
  let failE2 = true;
  const revs = { 'repo-stable': 'rev-1', 'repo-flaky': 'rev-1' };
  const observedRefs = [];
  const catalogAuthority = { sourceKind: 'REPOSITORY', refPrefix: '', observe: async ({ ref }) => { observedRefs.push(ref); return { snapshotRef: revs[ref] }; } };
  const providerId = 'p-progressive';
  const fixture = {
    descriptor: { providerId, sourceKinds: ['REPOSITORY'], operations: ['READ_EXACT'], snapshotModes: ['EXACT', 'CURRENT'], currentnessValidators: ['REVISION'], maxConcurrentCalls: 1, costClass: 'LOW' },
    async retrieve(work) {
      if (work.evidenceId === 'e2' && failE2) throw new O.ProviderFailure({ reason: 'SOURCE_FAILURE', providerId, evidenceId: 'e2', detail: 'flaky first attempt' });
      const snap = revs[work.sourceConstraint.ref];
      return [{ evidenceId: work.evidenceId, source: { kind: 'REPOSITORY', ref: work.sourceConstraint.ref, snapshotRef: snap, itemRef: work.sourceConstraint.itemRef }, validators: [{ kind: 'REVISION', value: snap, strength: 'STRONG' }], provenance: [{ kind: 'SOURCE_REF', ref: `${work.sourceConstraint.ref}@${snap}` }], content: 'x'.repeat(5), providerEvidence: { providerId, operation: work.operation } }];
    },
  };
  const catalog = O.createSourceCatalog({ providers: [fixture], snapshotAuthorities: [catalogAuthority] });
  const retrievalPlanner = O.createRetrievalPlanner({ catalog });
  const resolver = O.createOracleContextResolver({ sourceCatalog: catalog, retrievalPlanner });
  const req = requirement(budget(), [evidence('e1', 'REQUIRED', 'repo-stable'), evidence('e2', 'REQUIRED', 'repo-flaky')]);
  const first = await resolver.resolve(req);
  assert.deepEqual(first.resolution.unresolved, [{ evidenceId: 'e2', reason: 'SOURCE_FAILURE' }]);
  // Drift of the previously resolved evidence fails the next step closed.
  revs['repo-stable'] = 'rev-2';
  failE2 = false;
  await assert.rejects(resolver.resolveNext(req, first), (error) => error.name === 'DurabilityFailure' && error.reason === 'STALE_DURING_RESOLUTION');
  // Drift confined to still-unresolved evidence does not block progression.
  revs['repo-stable'] = 'rev-1';
  revs['repo-flaky'] = 'rev-2';
  const next = await resolver.resolveNext(req, first);
  assert.equal(next.resolution.status, 'COMPLETE');
  assert.deepEqual(next.resolution.items.map((i) => i.evidenceId), ['e1', 'e2']);
});

test('pinned resolver: Core consumes a specific step once per call', async () => {
  let failE2 = true;
  const { resolver } = setup({ providerOptions: { fail: (id) => id === 'e2' && failE2 } });
  const req = requirement(budget(), [evidence('e1'), evidence('e2')]);
  const first = await resolver.resolve(req);
  failE2 = false;
  const second = await resolver.resolveNext(req, first);
  const pinned = createPinnedResolver(second);
  const direct = await pinned.resolve(structuredClone(req));
  assert.equal(direct, second.resolution);
  await assert.rejects(pinned.resolve(requirement(budget(), [evidence('other')])));
  let calls = 0;
  const counting = { resolve: async (...args) => { calls++; return pinned.resolve(...args); } };
  const block = defineContextRequirementBlock({
    name: 'oracle', trust: 'UNTRUSTED', requirement: structuredClone(req),
    project(result) { return { status: result.status, items: result.items.length, steps: result.consumed.resolutionSteps }; },
  });
  const fixed = await resolveContextRequirementBlocks({ blocks: [block], selectedNames: ['oracle'], resolver: counting, metadata: {} });
  assert.equal(calls, 1);
  assert.equal(fixed.length, 1);
  assert.deepEqual(fixed[0].value, { status: 'COMPLETE', items: 2, steps: 2 });
});

test('progressive scope: only the facade carries the progression surface', async () => {
  const facade = fs.readFileSync(new URL('../packages/oracle/src/context-resolution.js', import.meta.url), 'utf8');
  assert.match(facade, /async function resolveNext\(/);
  assert.match(facade, /function createPinnedResolver\(/);
  for (const file of [
    '../packages/oracle/src/context-contract.js',
    '../packages/oracle/src/retrieval-planner.js',
    '../packages/oracle/src/source-catalog.js',
    '../packages/oracle/src/resolution-durability.js',
    '../packages/core-harness/src/context-resolution.js',
  ]) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /resolveNext/);
    assert.doesNotMatch(source, /createPinnedResolver/);
    assert.doesNotMatch(source, /ProgressionRefused/);
  }
  assert.deepEqual([...PROGRESSION_RETRIABLE_REASONS], ['BUDGET_EXHAUSTED', 'SOURCE_FAILURE', 'DEFERRED']);
});
