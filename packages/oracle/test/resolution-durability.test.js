import assert from 'node:assert/strict';
import test from 'node:test';
import { defineContextRequirement, defineContextResolution } from '../src/context-contract.js';
import {
  defineSourceObservation, observationDigest, defineResolverConfiguration, resolverConfigDigest,
  defineDerivationInput, reuseKey, defineContextResolutionReceipt, evaluateReceiptCurrentness,
  isReusableResolution, createDurableResolutionCoordinator, DurabilityFailure,
} from '../src/resolution-durability.js';
import { createSourceCatalog } from '../src/source-catalog.js';

const budget = { maxItems: 3, maxMaterializedBytes: 20000, maxProviderCalls: 3, maxResolutionSteps: 2 };
const req = (snapshot = { mode: 'CURRENT' }) => defineContextRequirement({ consumerRef: 'worker', semanticNeed: 'Find source', evidence: [{ id: 'e', necessity: 'REQUIRED', need: 'Find', source: { kind: 'REPOSITORY', ref: 'repo', snapshot } }], budget });
const config = { contractRevision: 'bb061@1', plannerRevision: 'bb062@1', materializationRevision: 'bb063@1', providerBindings: { exact: 'rev1' } };
const obs = (evidenceId = 'e', snapshotRef = 'head') => defineSourceObservation({ evidenceId, source: { kind: 'REPOSITORY', ref: 'repo', snapshot: { mode: 'CURRENT' } }, observed: { state: 'PRESENT', snapshotRef, validators: [{ kind: 'REVISION', value: snapshotRef, strength: 'STRONG' }], authorityRef: 'REPOSITORY:repo', authorityRevision: snapshotRef } });

test('reuse identity separates config/source/derivation without touching resolutionId', (t) => {
  const r = req();
  const digest = resolverConfigDigest(config);
  const k1 = reuseKey({ requirementId: r.requirementId, resolverConfigDigest: digest, sourceObservations: [obs()], derivationInputs: [] });
  const k2 = reuseKey({ requirementId: r.requirementId, resolverConfigDigest: digest, sourceObservations: [obs()], derivationInputs: [] });
  assert.equal(k1, k2);
  const changedSource = reuseKey({ requirementId: r.requirementId, resolverConfigDigest: digest, sourceObservations: [obs('e', 'head2')], derivationInputs: [] });
  assert.notEqual(k1, changedSource);
  const changedConfig = reuseKey({ requirementId: r.requirementId, resolverConfigDigest: resolverConfigDigest({ ...config, plannerRevision: 'bb062@2' }), sourceObservations: [obs()], derivationInputs: [] });
  assert.notEqual(k1, changedConfig);
  const changedDeriv = reuseKey({ requirementId: r.requirementId, resolverConfigDigest: digest, sourceObservations: [obs()], derivationInputs: [defineDerivationInput({ evidenceId: 'e', providerId: 'lex', operation: 'SEARCH_LEXICAL', providerRevision: 'z1' })] });
  assert.notEqual(k1, changedDeriv);
  t.diagnostic(`reuseKey ${k1.slice(0, 12)} stable; source/config/derivation change selects different key`);
});

test('lineage and currentness fences fail closed on stale/unverifiable evidence', (t) => {
  const r = req();
  const o = obs();
  const resolution = defineContextResolution({ requirementId: r.requirementId, step: { index: 0, previousResolutionId: null }, status: 'COMPLETE', items: [{ evidenceId: 'e', rank: 0, source: { kind: 'REPOSITORY', ref: 'repo', snapshotRef: 'head', itemRef: 'a.js' }, currentness: { validators: [{ kind: 'REVISION', value: 'head', strength: 'STRONG' }] }, provenance: [{ kind: 'SOURCE_REF', ref: 'repo/a.js@head' }], content: 'code' }], unresolved: [], consumed: { items: 1, materializedBytes: 5000, providerCalls: 1, resolutionSteps: 1 } }, r);
  assert.equal(isReusableResolution(resolution, r, [o]), true);
  const receipt = defineContextResolutionReceipt({ reuseKey: reuseKey({ requirementId: r.requirementId, resolverConfigDigest: resolverConfigDigest(config), sourceObservations: [o], derivationInputs: [] }), requirementId: r.requirementId, resolutionId: resolution.resolutionId, materializationId: resolution.materialization.id, resolutionArtifactRef: 'resolution://abc', resolverConfigDigest: resolverConfigDigest(config), sourceObservations: [o], derivationInputs: [], itemLineage: [{ itemDigest: resolution.items[0].itemDigest, sourceObservationIds: ['e'], provenanceRefs: ['repo/a.js@head'] }] });
  assert.equal(evaluateReceiptCurrentness(receipt, [o]).status, 'CURRENT');
  const stale = evaluateReceiptCurrentness(receipt, [obs('e', 'head2')]);
  assert.equal(stale.status, 'STALE');
  assert.deepEqual(stale.changedEvidenceIds, ['e']);
  assert.throws(() => defineContextResolutionReceipt({ ...receipt, itemLineage: [{ itemDigest: receipt.itemLineage[0].itemDigest, sourceObservationIds: ['missing'], provenanceRefs: [] }] }), /unknown observation/);
  t.diagnostic('COMPLETE reusable; A->B reports changed e; lineage without authoritative observation rejected');
});

test('partial reuse needs strongly fenced optional absence; unsatisfiable never reusable', () => {
  const r2 = defineContextRequirement({ consumerRef: 'w', semanticNeed: 's', evidence: [{ id: 'a', necessity: 'REQUIRED', need: 'n', source: { kind: 'REPOSITORY', ref: 'repo', snapshot: { mode: 'CURRENT' } } }, { id: 'b', necessity: 'OPTIONAL', need: 'n', source: { kind: 'REPOSITORY', ref: 'repo', snapshot: { mode: 'CURRENT' } } }], budget });
  const present = defineSourceObservation({ evidenceId: 'a', source: { kind: 'REPOSITORY', ref: 'repo', snapshot: { mode: 'CURRENT' } }, observed: { state: 'PRESENT', snapshotRef: 'h', validators: [{ kind: 'REVISION', value: 'h', strength: 'STRONG' }], authorityRef: 'REPOSITORY:repo', authorityRevision: 'h' } });
  const absent = defineSourceObservation({ evidenceId: 'b', source: { kind: 'REPOSITORY', ref: 'repo', snapshot: { mode: 'CURRENT' } }, observed: { state: 'ABSENT', validators: [{ kind: 'REVISION', value: 'h', strength: 'STRONG' }], authorityRef: 'REPOSITORY:repo', authorityRevision: 'h' } });
  const partial = defineContextResolution({ requirementId: r2.requirementId, step: { index: 0, previousResolutionId: null }, status: 'PARTIAL', items: [{ evidenceId: 'a', rank: 0, source: { kind: 'REPOSITORY', ref: 'repo', snapshotRef: 'h', itemRef: 'a' }, currentness: { validators: [{ kind: 'REVISION', value: 'h', strength: 'STRONG' }] }, provenance: [{ kind: 'SOURCE_REF', ref: 'x' }], content: 'c' }], unresolved: [{ evidenceId: 'b', reason: 'MISSING' }], consumed: { items: 1, materializedBytes: 5000, providerCalls: 1, resolutionSteps: 1 } }, r2);
  assert.equal(isReusableResolution(partial, r2, [present, absent]), true);
  const weakAbsent = defineSourceObservation({ evidenceId: 'b', source: { kind: 'REPOSITORY', ref: 'repo', snapshot: { mode: 'CURRENT' } }, observed: { state: 'ABSENT', validators: [{ kind: 'REVISION', value: 'h', strength: 'WEAK' }], authorityRef: 'REPOSITORY:repo', authorityRevision: 'h' } });
  assert.equal(isReusableResolution(partial, r2, [present, weakAbsent]), false);
});

test('coordinator double-fences pre/post observations and never auto-retries', async (t) => {
  let head = 'h1';
  const catalog = createSourceCatalog({ snapshotAuthorities: [{ sourceKind: 'REPOSITORY', refPrefix: '', observe: async () => ({ snapshotRef: head }) }] });
  const mem = new Map();
  const store = { async readReuseSlot(k) { return mem.get(k) ?? null; }, async readReceipt(ref) { return mem.get(ref); }, async readResolution(ref) { return mem.get(ref); }, async putResolution(v) { const ref = `resolution://${v.resolutionId}`; mem.set(ref, v); return ref; }, async putReceipt(v) { const ref = `receipt://${v.receiptId}`; mem.set(ref, { ...v, receiptRef: ref }); return ref; }, async publishReuseSlot(k, resolutionId, receiptRef) { mem.set(k, { reuseKey: k, resolutionId, receiptRef }); } };
  const coordinator = createDurableResolutionCoordinator({ catalog, store, resolverConfiguration: config, resolveFresh: async (requirement) => defineContextResolution({ requirementId: requirement.requirementId, step: { index: 0, previousResolutionId: null }, status: 'COMPLETE', items: [{ evidenceId: 'e', rank: 0, source: { kind: 'REPOSITORY', ref: 'repo', snapshotRef: head, itemRef: 'a' }, currentness: { validators: [{ kind: 'REVISION', value: head, strength: 'STRONG' }] }, provenance: [{ kind: 'SOURCE_REF', ref: 'x' }], content: 'c' }], unresolved: [], consumed: { items: 1, materializedBytes: 5000, providerCalls: 1, resolutionSteps: 1 } }, requirement) });
  const r = req();
  const first = await coordinator.resolve(r);
  assert.equal(first.outcome, 'PUBLISHED');
  const second = await coordinator.resolve(r);
  assert.equal(second.outcome, 'REUSED');
  assert.equal(second.resolution.resolutionId, first.resolution.resolutionId);
  head = 'h2';
  const third = await coordinator.resolve(r);
  assert.equal(third.outcome, 'PUBLISHED');
  assert.notEqual(third.reuseKey, first.reuseKey);
  let driftHead = 'd1';
  const driftCatalog = createSourceCatalog({ snapshotAuthorities: [{ sourceKind: 'REPOSITORY', refPrefix: '', observe: async () => ({ snapshotRef: driftHead }) }] });
  const driftCoordinator = createDurableResolutionCoordinator({ catalog: driftCatalog, store, resolverConfiguration: config, resolveFresh: async (requirement) => { driftHead = 'd2'; return defineContextResolution({ requirementId: requirement.requirementId, step: { index: 0, previousResolutionId: null }, status: 'COMPLETE', items: [{ evidenceId: 'e', rank: 0, source: { kind: 'REPOSITORY', ref: 'repo', snapshotRef: 'd1', itemRef: 'a' }, currentness: { validators: [{ kind: 'REVISION', value: 'd1', strength: 'STRONG' }] }, provenance: [{ kind: 'SOURCE_REF', ref: 'x' }], content: 'c' }], unresolved: [], consumed: { items: 1, materializedBytes: 5000, providerCalls: 1, resolutionSteps: 1 } }, requirement); } });
  await assert.rejects(driftCoordinator.resolve(r), (e) => e instanceof DurabilityFailure && e.reason === 'STALE_DURING_RESOLUTION');
  t.diagnostic('pre/post fences match on reuse; A->B selects different key; mid-resolve drift fails STALE_DURING_RESOLUTION without hidden retry');
});
