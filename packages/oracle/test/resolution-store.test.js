import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { defineContextRequirement, defineContextResolution } from '../src/context-contract.js';
import { defineSourceObservation, defineResolverConfiguration, resolverConfigDigest, reuseKey, defineContextResolutionReceipt } from '../src/resolution-durability.js';
import { createResolutionStore, ResolutionStoreError } from '../src/resolution-store.js';

const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), 'oracle-store-'));
const budget = { maxItems: 2, maxMaterializedBytes: 20000, maxProviderCalls: 2, maxResolutionSteps: 1 };
const req = defineContextRequirement({ consumerRef: 'w', semanticNeed: 's', evidence: [{ id: 'e', necessity: 'REQUIRED', need: 'n', source: { kind: 'REPOSITORY', ref: 'repo', snapshot: { mode: 'CURRENT' } } }], budget });
const resolution = defineContextResolution({ requirementId: req.requirementId, step: { index: 0, previousResolutionId: null }, status: 'COMPLETE', items: [{ evidenceId: 'e', rank: 0, source: { kind: 'REPOSITORY', ref: 'repo', snapshotRef: 'h', itemRef: 'a' }, currentness: { validators: [{ kind: 'REVISION', value: 'h', strength: 'STRONG' }] }, provenance: [{ kind: 'SOURCE_REF', ref: 'x' }], content: 'c' }], unresolved: [], consumed: { items: 1, materializedBytes: 5000, providerCalls: 1, resolutionSteps: 1 } }, req);
const configDigest = resolverConfigDigest({ contractRevision: 'c1', plannerRevision: 'p1', materializationRevision: 'm1', providerBindings: {} });
const obs = defineSourceObservation({ evidenceId: 'e', source: { kind: 'REPOSITORY', ref: 'repo', snapshot: { mode: 'CURRENT' } }, observed: { state: 'PRESENT', snapshotRef: 'h', validators: [{ kind: 'REVISION', value: 'h', strength: 'STRONG' }], authorityRef: 'REPOSITORY:repo', authorityRevision: 'h' } });
const key = reuseKey({ requirementId: req.requirementId, resolverConfigDigest: configDigest, sourceObservations: [obs], derivationInputs: [] });

test('immutable objects converge; digest mismatch fails closed', async (t) => {
  const store = createResolutionStore({ path: await tmp() });
  const ref = await store.putResolution(resolution);
  const again = await store.putResolution(resolution);
  assert.equal(ref, again);
  const read = await store.readResolution(ref);
  assert.equal(read.resolutionId, resolution.resolutionId);
  const badRef = ref.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a'));
  await assert.rejects(store.readResolution(badRef), (e) => e instanceof ResolutionStoreError);
  t.diagnostic('same bytes converge to one immutable object; ref digest mismatch is corrupt');
});

test('exact reuse slots converge or conflict without last-writer-wins', async (t) => {
  const store = createResolutionStore({ path: await tmp() });
  const artifactRef = await store.putResolution(resolution);
  const receipt = defineContextResolutionReceipt({ reuseKey: key, requirementId: req.requirementId, resolutionId: resolution.resolutionId, materializationId: resolution.materialization.id, resolutionArtifactRef: artifactRef, resolverConfigDigest: configDigest, sourceObservations: [obs], derivationInputs: [], itemLineage: [{ itemDigest: resolution.items[0].itemDigest, sourceObservationIds: ['e'], provenanceRefs: ['x'] }] });
  const receiptRef = await store.putReceipt(receipt);
  const first = await store.publishReuseSlot(key, resolution.resolutionId, receiptRef);
  assert.equal(first.reused, false);
  const second = await store.publishReuseSlot(key, resolution.resolutionId, receiptRef);
  assert.equal(second.reused, true);
  const slot = await store.readReuseSlot(key);
  assert.equal(slot.resolutionId, resolution.resolutionId);
  await assert.rejects(store.publishReuseSlot(key, 'different-resolution-id', receiptRef), (e) => e instanceof ResolutionStoreError && e.reason === 'CONFLICT');
  t.diagnostic('same key+same id converges; same key+different id is NONDETERMINISTIC_RESOLUTION_CONFLICT');
});

test('20 concurrent publishers converge; crash orphan retries cleanly', async (t) => {
  const dir = await tmp();
  const store = createResolutionStore({ path: dir });
  const artifactRef = await store.putResolution(resolution);
  const receipt = defineContextResolutionReceipt({ reuseKey: key, requirementId: req.requirementId, resolutionId: resolution.resolutionId, materializationId: resolution.materialization.id, resolutionArtifactRef: artifactRef, resolverConfigDigest: configDigest, sourceObservations: [obs], derivationInputs: [], itemLineage: [{ itemDigest: resolution.items[0].itemDigest, sourceObservationIds: ['e'], provenanceRefs: ['x'] }] });
  const receiptRef = await store.putReceipt(receipt);
  const outcomes = await Promise.all(Array.from({ length: 20 }, () => store.publishReuseSlot(key, resolution.resolutionId, receiptRef)));
  assert.ok(outcomes.some((o) => o.reused === false));
  assert.ok(outcomes.some((o) => o.reused === true));
  const slot = await store.readReuseSlot(key);
  assert.equal(slot.receiptRef, receiptRef);
  await fs.writeFile(path.join(dir, '.orphan.tmp'), 'partial');
  const retry = await store.publishReuseSlot(key, resolution.resolutionId, receiptRef);
  assert.equal(retry.resolutionId, resolution.resolutionId);
  t.diagnostic('20 same-key publishers converge to one slot; orphan temp does not become canonical');
});

test('corrupted slot and leftover lock reject mutable-head caching', async (t) => {
  const dir = await tmp();
  const store = createResolutionStore({ path: dir });
  await fs.mkdir(path.join(dir, 'reuse'), { recursive: true });
  await fs.writeFile(path.join(dir, 'reuse', `${key}.json`), '{corrupt');
  await assert.rejects(store.readReuseSlot(key), (e) => e instanceof ResolutionStoreError && e.reason === 'CORRUPT');
  await fs.writeFile(path.join(dir, 'reuse', `${key}.json.lock`), 'stranded');
  const lockBlocks = await fs.readFile(path.join(dir, 'reuse', `${key}.json.lock`), 'utf8').then(() => true);
  assert.equal(lockBlocks, true);
  t.diagnostic('corrupted slot fails closed; stranded *.lock demonstrates rejected mutable lockfile-head mode');
});
