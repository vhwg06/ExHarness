import assert from 'node:assert/strict';
import { defineContextRequirement, defineContextResolution } from '../../packages/oracle/src/context-contract.js';
import { defineSourceObservation, defineResolverConfiguration, resolverConfigDigest, reuseKey, defineContextResolutionReceipt, evaluateReceiptCurrentness, createDurableResolutionCoordinator } from '../../packages/oracle/src/index.js';
import { createResolutionStore } from '../../packages/oracle/src/index.js';
import { createSourceCatalog } from '../../packages/oracle/src/index.js';
import { defineApplicationArtifactManifest, createJsonArtifactManifestStore, createManifestArtifactReader } from '../../packages/agentic-system/src/artifact-manifest.js';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const sha = (s) => `sha256:${createHash('sha256').update(s, 'utf8').digest('hex')}`;
const budget = { maxItems: 4, maxMaterializedBytes: 40000, maxProviderCalls: 4, maxResolutionSteps: 1 };
const config = { contractRevision: 'c1', plannerRevision: 'p1', materializationRevision: 'm1', providerBindings: {} };
const configDigest = resolverConfigDigest(config);
const attempts = [];
const record = (id, ok, detail) => { attempts.push({ id, ok, detail }); assert.ok(ok, `${id}: ${detail}`); };

const memStore = () => {
  const mem = new Map();
  return {
    async readReuseSlot(k) { return mem.get(k) ?? null; },
    async readReceipt(ref) { return mem.get(ref); },
    async readResolution(ref) { return mem.get(ref); },
    async putResolution(v) { const ref = `resolution://${v.resolutionId}`; mem.set(ref, v); return ref; },
    async putReceipt(v) { const ref = `receipt://${v.receiptId}`; mem.set(ref, { ...v, receiptRef: ref }); return ref; },
    async publishReuseSlot(k, resolutionId, receiptRef) { mem.set(k, { reuseKey: k, resolutionId, receiptRef }); },
  };
};
const complete = (requirement, snapshotRef, itemRef = 'a') => defineContextResolution({ requirementId: requirement.requirementId, step: { index: 0, previousResolutionId: null }, status: 'COMPLETE', items: requirement.evidence.map((e, i) => ({ evidenceId: e.id, rank: 0, source: { kind: e.source.kind, ref: e.source.ref, snapshotRef: e.source.kind === 'APPLICATION_ARTIFACT' ? 'r1' : snapshotRef, itemRef }, currentness: { validators: [{ kind: 'REVISION', value: e.source.kind === 'APPLICATION_ARTIFACT' ? 'r1' : snapshotRef, strength: 'STRONG' }] }, provenance: [{ kind: 'SOURCE_REF', ref: `${e.source.ref}@${snapshotRef}` }], content: `c${i}` })), unresolved: [], consumed: { items: requirement.evidence.length, materializedBytes: 8000, providerCalls: 2, resolutionSteps: 1 } }, requirement);

// 1-2: repository CURRENT A->A reusable, A->B invalidates
{
  let head = 'A';
  const catalog = createSourceCatalog({ snapshotAuthorities: [{ sourceKind: 'REPOSITORY', refPrefix: '', observe: async () => ({ snapshotRef: head }) }] });
  const coordinator = createDurableResolutionCoordinator({ catalog, store: memStore(), resolverConfiguration: config, resolveFresh: async (r) => complete(r, head) });
  const requirement = defineContextRequirement({ consumerRef: 'w', semanticNeed: 's', evidence: [{ id: 'e', necessity: 'REQUIRED', need: 'n', source: { kind: 'REPOSITORY', ref: 'repo', snapshot: { mode: 'CURRENT' } } }], budget });
  const first = await coordinator.resolve(requirement);
  const second = await coordinator.resolve(requirement);
  record('repo-A-A', second.outcome === 'REUSED' && second.resolution.resolutionId === first.resolution.resolutionId, `reuseKey ${first.reuseKey.slice(0, 12)} reused`);
  head = 'B';
  const third = await coordinator.resolve(requirement);
  record('repo-A-B', third.outcome === 'PUBLISHED' && third.reuseKey !== first.reuseKey, `A->B selects different key ${third.reuseKey.slice(0, 12)}`);
}

// 3: exact accepted-artifact manifest replay
{
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bb063-probe-'));
  const manifestStore = createJsonArtifactManifestStore({ path: path.join(dir, 'm') });
  const manifest = defineApplicationArtifactManifest({ kind: 'APPLICATION_ARTIFACT_MANIFEST', version: 1, producerWorkOrderId: 'wo1', producerRevision: 'r1', acceptanceDecision: { id: 'acc1', digest: 'd1' }, retention: { policyRevision: 'p1', pinnedBy: [] }, entries: [{ ref: 'art1', path: 'a.js', storedRevision: 'r1', contentDigest: sha('hello'), availability: 'AVAILABLE' }] });
  await manifestStore.putManifest(manifest);
  const reader = createManifestArtifactReader({ reader: { readArtifact: async () => ({ content: 'hello', sourceRef: 'art1@r1' }) }, manifestStore });
  const out = await reader.forManifest(manifest.ref).readArtifact({ ref: 'art1', path: 'a.js', producerWorkOrderId: 'wo1', revision: 'r1', acceptanceDecision: { id: 'acc1', digest: 'd1' } });
  record('manifest-replay', out.content === 'hello', `manifest ${manifest.ref.slice(0, 24)} replay binds producer/revision/acceptance/content`);
}

// 4-5: semantic-index snapshot equal/mismatch
{
  const requirement = defineContextRequirement({ consumerRef: 'w', semanticNeed: 's', evidence: [{ id: 'e', necessity: 'REQUIRED', need: 'n', source: { kind: 'REPOSITORY', ref: 'repo', snapshot: { mode: 'CURRENT' } } }], budget });
  const obs = (snap) => defineSourceObservation({ evidenceId: 'e', source: { kind: 'REPOSITORY', ref: 'repo', snapshot: { mode: 'CURRENT' } }, observed: { state: 'PRESENT', snapshotRef: snap, validators: [{ kind: 'REVISION', value: snap, strength: 'STRONG' }], authorityRef: 'REPOSITORY:repo', authorityRevision: snap } });
  const receipt = defineContextResolutionReceipt({ reuseKey: reuseKey({ requirementId: requirement.requirementId, resolverConfigDigest: configDigest, sourceObservations: [obs('idx1')], derivationInputs: [] }), requirementId: requirement.requirementId, resolutionId: 'r'.repeat(64), materializationId: 'm'.repeat(64), resolutionArtifactRef: 'resolution://abc', resolverConfigDigest: configDigest, sourceObservations: [obs('idx1')], derivationInputs: [], itemLineage: [{ itemDigest: 'a'.repeat(64), sourceObservationIds: ['e'], provenanceRefs: ['x'] }] });
  record('index-equal', evaluateReceiptCurrentness(receipt, [obs('idx1')]).status === 'CURRENT', 'indexed snapshot equals authority');
  const mismatch = evaluateReceiptCurrentness(receipt, [obs('idx2')]);
  record('index-mismatch', mismatch.status === 'STALE' && mismatch.changedEvidenceIds.join() === 'e', `stale reason: ${mismatch.reasons.join(';')}`);
}

// 6: graph-derived lineage with authoritative leaves
{
  const requirement = defineContextRequirement({ consumerRef: 'w', semanticNeed: 's', evidence: [{ id: 'g', necessity: 'REQUIRED', need: 'n', source: { kind: 'REPOSITORY', ref: 'repo', snapshot: { mode: 'CURRENT' } } }], budget });
  const leaf = defineSourceObservation({ evidenceId: 'g', source: { kind: 'REPOSITORY', ref: 'repo', snapshot: { mode: 'CURRENT' } }, observed: { state: 'PRESENT', snapshotRef: 'h', validators: [{ kind: 'REVISION', value: 'h', strength: 'STRONG' }], authorityRef: 'REPOSITORY:repo', authorityRevision: 'h' } });
  const receipt = defineContextResolutionReceipt({ reuseKey: reuseKey({ requirementId: requirement.requirementId, resolverConfigDigest: configDigest, sourceObservations: [leaf], derivationInputs: [{ evidenceId: 'g', providerId: 'graph', operation: 'TRAVERSE_GRAPH', providerRevision: 'g1' }] }), requirementId: requirement.requirementId, resolutionId: 'b'.repeat(64), materializationId: 'c'.repeat(64), resolutionArtifactRef: 'resolution://def', resolverConfigDigest: configDigest, sourceObservations: [leaf], derivationInputs: [{ evidenceId: 'g', providerId: 'graph', operation: 'TRAVERSE_GRAPH', providerRevision: 'g1' }], itemLineage: [{ itemDigest: 'd'.repeat(64), sourceObservationIds: ['g'], provenanceRefs: ['repo/graph@h'] }] });
  record('graph-lineage', evaluateReceiptCurrentness(receipt, [leaf]).status === 'CURRENT', 'graph item closes over authoritative leaf');
}

// 7-8: stable/unstable optional absence
{
  const requirement = defineContextRequirement({ consumerRef: 'w', semanticNeed: 's', evidence: [{ id: 'a', necessity: 'REQUIRED', need: 'n', source: { kind: 'REPOSITORY', ref: 'repo', snapshot: { mode: 'CURRENT' } } }, { id: 'b', necessity: 'OPTIONAL', need: 'n', source: { kind: 'REPOSITORY', ref: 'repo', snapshot: { mode: 'CURRENT' } } }], budget });
  const { isReusableResolution } = await import('../../packages/oracle/src/index.js');
  const present = defineSourceObservation({ evidenceId: 'a', source: { kind: 'REPOSITORY', ref: 'repo', snapshot: { mode: 'CURRENT' } }, observed: { state: 'PRESENT', snapshotRef: 'h', validators: [{ kind: 'REVISION', value: 'h', strength: 'STRONG' }], authorityRef: 'R', authorityRevision: 'h' } });
  const stableAbsent = defineSourceObservation({ evidenceId: 'b', source: { kind: 'REPOSITORY', ref: 'repo', snapshot: { mode: 'CURRENT' } }, observed: { state: 'ABSENT', validators: [{ kind: 'REVISION', value: 'h', strength: 'STRONG' }], authorityRef: 'R', authorityRevision: 'h' } });
  const unstableAbsent = defineSourceObservation({ evidenceId: 'b', source: { kind: 'REPOSITORY', ref: 'repo', snapshot: { mode: 'CURRENT' } }, observed: { state: 'ABSENT', validators: [{ kind: 'REVISION', value: 'h', strength: 'WEAK' }], authorityRef: 'R', authorityRevision: 'h' } });
  const partial = defineContextResolution({ requirementId: requirement.requirementId, step: { index: 0, previousResolutionId: null }, status: 'PARTIAL', items: [{ evidenceId: 'a', rank: 0, source: { kind: 'REPOSITORY', ref: 'repo', snapshotRef: 'h', itemRef: 'a' }, currentness: { validators: [{ kind: 'REVISION', value: 'h', strength: 'STRONG' }] }, provenance: [{ kind: 'SOURCE_REF', ref: 'x' }], content: 'c' }], unresolved: [{ evidenceId: 'b', reason: 'MISSING' }], consumed: { items: 1, materializedBytes: 5000, providerCalls: 1, resolutionSteps: 1 } }, requirement);
  record('optional-stable', isReusableResolution(partial, requirement, [present, stableAbsent]) === true, 'PARTIAL with strongly fenced optional absence is reusable');
  record('optional-unstable', isReusableResolution(partial, requirement, [present, unstableAbsent]) === false, 'weak optional absence is not reusable');
}

// 9: partial provider failure never reusable
{
  const { isReusableResolution } = await import('../../packages/oracle/src/index.js');
  const requirement = defineContextRequirement({ consumerRef: 'w', semanticNeed: 's', evidence: [{ id: 'e', necessity: 'REQUIRED', need: 'n', source: { kind: 'REPOSITORY', ref: 'repo', snapshot: { mode: 'CURRENT' } } }], budget });
  const obsFail = defineSourceObservation({ evidenceId: 'e', source: { kind: 'REPOSITORY', ref: 'repo', snapshot: { mode: 'CURRENT' } }, observed: { state: 'UNAVAILABLE', authorityRef: 'R' } });
  const unsat = defineContextResolution({ requirementId: requirement.requirementId, step: { index: 0, previousResolutionId: null }, status: 'UNSATISFIED', items: [], unresolved: [{ evidenceId: 'e', reason: 'SOURCE_FAILURE' }], consumed: { items: 0, materializedBytes: 10, providerCalls: 1, resolutionSteps: 1 } }, requirement);
  record('provider-failure', isReusableResolution(unsat, requirement, [obsFail]) === false, 'UNSATISFIED partial-provider failure publishes no slot');
}

// 10: concurrent refresh converges
{
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bb063-conc-'));
  const store = createResolutionStore({ path: dir });
  const requirement = defineContextRequirement({ consumerRef: 'w', semanticNeed: 's', evidence: [{ id: 'e', necessity: 'REQUIRED', need: 'n', source: { kind: 'REPOSITORY', ref: 'repo', snapshot: { mode: 'CURRENT' } } }], budget });
  const o = defineSourceObservation({ evidenceId: 'e', source: { kind: 'REPOSITORY', ref: 'repo', snapshot: { mode: 'CURRENT' } }, observed: { state: 'PRESENT', snapshotRef: 'h', validators: [{ kind: 'REVISION', value: 'h', strength: 'STRONG' }], authorityRef: 'R', authorityRevision: 'h' } });
  const key = reuseKey({ requirementId: requirement.requirementId, resolverConfigDigest: configDigest, sourceObservations: [o], derivationInputs: [] });
  const res = defineContextResolution({ requirementId: requirement.requirementId, step: { index: 0, previousResolutionId: null }, status: 'COMPLETE', items: [{ evidenceId: 'e', rank: 0, source: { kind: 'REPOSITORY', ref: 'repo', snapshotRef: 'h', itemRef: 'a' }, currentness: { validators: [{ kind: 'REVISION', value: 'h', strength: 'STRONG' }] }, provenance: [{ kind: 'SOURCE_REF', ref: 'x' }], content: 'c' }], unresolved: [], consumed: { items: 1, materializedBytes: 5000, providerCalls: 1, resolutionSteps: 1 } }, requirement);
  const artifactRef = await store.putResolution(res);
  const receipt = defineContextResolutionReceipt({ reuseKey: key, requirementId: requirement.requirementId, resolutionId: res.resolutionId, materializationId: res.materialization.id, resolutionArtifactRef: artifactRef, resolverConfigDigest: configDigest, sourceObservations: [o], derivationInputs: [], itemLineage: [{ itemDigest: res.items[0].itemDigest, sourceObservationIds: ['e'], provenanceRefs: ['x'] }] });
  const receiptRef = await store.putReceipt(receipt);
  const outcomes = await Promise.all(Array.from({ length: 20 }, () => store.publishReuseSlot(key, res.resolutionId, receiptRef)));
  record('concurrent-refresh', outcomes.length === 20 && (await store.readReuseSlot(key)).resolutionId === res.resolutionId, '20 publishers converge to one exact-key slot');
}

console.log(JSON.stringify({ kind: 'ORACLE_CURRENTNESS_PROBE', version: 1, attempts }, null, 2));
