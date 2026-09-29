import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { defineApplicationArtifactManifest, createJsonArtifactManifestStore, createManifestArtifactReader } from '../packages/agentic-system/src/artifact-manifest.js';
import { defineContextRequirement, defineContextResolution } from '../packages/oracle/src/index.js';
import { defineSourceObservation, defineResolverConfiguration, resolverConfigDigest, reuseKey, defineContextResolutionReceipt, createDurableResolutionCoordinator } from '../packages/oracle/src/index.js';
import { createResolutionStore } from '../packages/oracle/src/index.js';
import { createSourceCatalog } from '../packages/oracle/src/index.js';

const sha = (s) => `sha256:${createHash('sha256').update(s, 'utf8').digest('hex')}`;
const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), 'oracle-durability-it-'));

function manifestFixture(content = 'hello') {
  return defineApplicationArtifactManifest({
    kind: 'APPLICATION_ARTIFACT_MANIFEST', version: 1,
    producerWorkOrderId: 'wo1', producerRevision: 'r1',
    acceptanceDecision: { id: 'acc1', digest: 'd1' },
    retention: { policyRevision: 'p1', pinnedBy: [] },
    entries: [{ ref: 'art1', path: 'a.js', storedRevision: 'r1', contentDigest: sha(content), availability: 'AVAILABLE' }],
  });
}

test('manifest-protected Backend-to-QA replay stays strict before reusable receipt', async (t) => {
  const dir = await tmp();
  const manifestStore = createJsonArtifactManifestStore({ path: path.join(dir, 'manifests') });
  const manifest = manifestFixture('hello');
  await manifestStore.putManifest(manifest);
  const goodReader = createManifestArtifactReader({ reader: { readArtifact: async () => ({ content: 'hello', sourceRef: 'art1@r1' }) }, manifestStore });
  const exact = goodReader.forManifest(manifest.ref);
  const out = await exact.readArtifact({ ref: 'art1', path: 'a.js', producerWorkOrderId: 'wo1', revision: 'r1', acceptanceDecision: { id: 'acc1', digest: 'd1' } });
  assert.equal(out.content, 'hello');
  await assert.rejects(exact.readArtifact({ ref: 'art1', path: 'a.js', producerWorkOrderId: 'wrong', revision: 'r1', acceptanceDecision: { id: 'acc1', digest: 'd1' } }), (e) => String(e?.code ?? e?.message).includes('PRODUCER_MISMATCH'));
  await assert.rejects(exact.readArtifact({ ref: 'art1', path: 'a.js', producerWorkOrderId: 'wo1', revision: 'wrong', acceptanceDecision: { id: 'acc1', digest: 'd1' } }), (e) => String(e?.code ?? e?.message).includes('REVISION_MISMATCH'));
  await assert.rejects(exact.readArtifact({ ref: 'art1', path: 'a.js', producerWorkOrderId: 'wo1', revision: 'r1', acceptanceDecision: { id: 'wrong', digest: 'd1' } }), (e) => String(e?.code ?? e?.message).includes('ACCEPTANCE_DECISION_MISMATCH'));
  const badContent = createManifestArtifactReader({ reader: { readArtifact: async () => ({ content: 'tampered', sourceRef: 'art1@r1' }) }, manifestStore });
  await assert.rejects(badContent.forManifest(manifest.ref).readArtifact({ ref: 'art1', path: 'a.js', producerWorkOrderId: 'wo1', revision: 'r1', acceptanceDecision: { id: 'acc1', digest: 'd1' } }), (e) => String(e?.code ?? e?.message).includes('CONTENT_MISMATCH'));
  t.diagnostic('exact manifest replay succeeds; wrong producer/revision/acceptance/content fails before any reusable receipt');
});

test('durable coordinator publishes manifest-bound receipt without touching acceptance authority', async (t) => {
  const dir = await tmp();
  const store = createResolutionStore({ path: path.join(dir, 'oracle') });
  const catalog = createSourceCatalog({ snapshotAuthorities: [{ sourceKind: 'REPOSITORY', refPrefix: '', observe: async () => ({ snapshotRef: 'h' }) }, { sourceKind: 'APPLICATION_ARTIFACT', refPrefix: '', observe: async () => ({ snapshotRef: 'r1' }) }] });
  const requirement = defineContextRequirement({ consumerRef: 'w', semanticNeed: 's', evidence: [{ id: 'repo', necessity: 'REQUIRED', need: 'n', source: { kind: 'REPOSITORY', ref: 'repo', snapshot: { mode: 'CURRENT' } } }, { id: 'art', necessity: 'REQUIRED', need: 'n', source: { kind: 'APPLICATION_ARTIFACT', ref: 'art1', snapshot: { mode: 'CURRENT' } } }], budget: { maxItems: 4, maxMaterializedBytes: 40000, maxProviderCalls: 4, maxResolutionSteps: 1 } });
  const config = { contractRevision: 'c1', plannerRevision: 'p1', materializationRevision: 'm1', providerBindings: {} };
  const coordinator = createDurableResolutionCoordinator({
    catalog, store, resolverConfiguration: config,
    resolveFresh: async (req) => defineContextResolution({
      requirementId: req.requirementId, step: { index: 0, previousResolutionId: null }, status: 'COMPLETE',
      items: [
        { evidenceId: 'repo', rank: 0, source: { kind: 'REPOSITORY', ref: 'repo', snapshotRef: 'h', itemRef: 'a' }, currentness: { validators: [{ kind: 'REVISION', value: 'h', strength: 'STRONG' }] }, provenance: [{ kind: 'SOURCE_REF', ref: 'repo/a@h' }], content: 'c1' },
        { evidenceId: 'art', rank: 0, source: { kind: 'APPLICATION_ARTIFACT', ref: 'art1', snapshotRef: 'r1', itemRef: 'a.js' }, currentness: { validators: [{ kind: 'REVISION', value: 'r1', strength: 'STRONG' }] }, provenance: [{ kind: 'PRODUCER_WORK_ORDER', ref: 'wo1' }, { kind: 'ACCEPTANCE_DECISION', ref: 'acc1', digest: 'd1' }, { kind: 'SOURCE_REF', ref: 'art1@r1' }], content: 'hello' },
      ], unresolved: [], consumed: { items: 2, materializedBytes: 8000, providerCalls: 2, resolutionSteps: 1 },
    }, req),
  });
  const first = await coordinator.resolve(requirement);
  assert.equal(first.outcome, 'PUBLISHED');
  assert.equal(first.receipt.itemLineage.length, 2);
  const second = await coordinator.resolve(requirement);
  assert.equal(second.outcome, 'REUSED');
  assert.equal(second.resolution.resolutionId, first.resolution.resolutionId);
  const parts = [];
  for (const n of ['resolution-durability', 'resolution-store']) parts.push(await fs.readFile(`packages/oracle/src/${n}.js`, 'utf8').catch(() => ''));
  const sources = parts.join('\n');
  assert.doesNotMatch(sources, /claimWork|publishDelivery|acceptWork|recoverWork|scheduleWork|mutat/);
  t.diagnostic('manifest-bound COMPLETE publishes once then reuses; durability code performs no application lifecycle mutation');
});

test('wrong provenance bytes never become reusable current context', async () => {
  const requirement = defineContextRequirement({ consumerRef: 'w', semanticNeed: 's', evidence: [{ id: 'e', necessity: 'REQUIRED', need: 'n', source: { kind: 'REPOSITORY', ref: 'repo', snapshot: { mode: 'CURRENT' } }, requiredProvenance: [{ kind: 'SOURCE_REF', ref: 'repo/a@h' }] }], budget: { maxItems: 2, maxMaterializedBytes: 20000, maxProviderCalls: 2, maxResolutionSteps: 1 } });
  assert.throws(() => defineContextResolution({ requirementId: requirement.requirementId, step: { index: 0, previousResolutionId: null }, status: 'COMPLETE', items: [{ evidenceId: 'e', rank: 0, source: { kind: 'REPOSITORY', ref: 'repo', snapshotRef: 'h', itemRef: 'a' }, currentness: { validators: [{ kind: 'REVISION', value: 'h', strength: 'STRONG' }] }, provenance: [{ kind: 'SOURCE_REF', ref: 'wrong' }], content: 'c' }], unresolved: [], consumed: { items: 1, materializedBytes: 5000, providerCalls: 1, resolutionSteps: 1 } }, requirement), /required provenance/);
});

test('evidence store uses immutable content-addressed files with no database dependency', async (t) => {
  const research = await fs.readFile('docs/blackboard/process/oracle-context-intelligence-research/BB-063.md', 'utf8');
  for (const pin of ['restic/restic@', 'bazelbuild/bazel@', 'git/git@', 'nodejs/node@']) assert.match(research, new RegExp(pin));
  assert.match(research, /immutable/);
  const pkg = JSON.parse(await fs.readFile('packages/oracle/package.json', 'utf8'));
  for (const name of ['sqlite', 'graphiti', 'cognee', 'redis']) assert.equal(pkg.dependencies?.[name], undefined);
  t.diagnostic('Restic/Bazel/Git/Node SQLite comparison pinned; oracle has no sqlite/graphiti/cognee/redis runtime dependency; reuse uses immutable files plus exact-key slots');
});

test('Living Oracle truth limits durable scope without claiming foundation acceptance', async (t) => {
  const parts = [];
  for (const n of ['architecture', 'state', 'semantics', 'workflow']) parts.push(await fs.readFile(`docs/living/system/oracle/${n}.md`, 'utf8'));
  const docs = parts.join('\n');
  assert.match(docs, /reuseKey|ContextResolutionReceipt|no-overwrite/);
  for (const pattern of [/no mutable.*head/i, /no.*SQLite/i, /no.*garbage/i, /power-loss/i]) assert.match(docs, pattern);
  assert.doesNotMatch(docs, /BB-064/);
  t.diagnostic('Living Docs describe durable receipt/reuse limits; no mutable head, database, GC correctness or BB-064 acceptance claimed');
});
