import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const readJson = async (ref) => JSON.parse(await fs.readFile(path.join(root, ref), 'utf8'));
const fail = (m) => { console.error(`PLAN_INPUT_CONTRADICTION: ${m}`); process.exit(2); };

// S1: exact DONE dependency manifest
const graph = await readJson('docs/blackboard/work-graph.json');
for (const id of ['BB-060', 'BB-061', 'BB-062', 'BB-063']) {
  const t = graph.tasks.find((x) => x.id === id);
  if (!t || t.status !== 'DONE' || !t.contract?.deliveryRef) fail(`${id} is not DONE with delivery receipt`);
}
const oracle = await import('../../packages/oracle/src/index.js');
const required = {
  'BB-060': ['readRepositorySources', 'readApplicationArtifacts', 'createExactRepositoryProvider', 'createExactArtifactProvider'],
  'BB-061': ['defineContextRequirement', 'defineContextResolution', 'contextRequirementId', 'contextResolutionId', 'assertConsumableContextResolution'],
  'BB-062': ['createSourceCatalog', 'createRetrievalPlanner', 'defineProviderDescriptor', 'defineProviderCandidate', 'createLexicalSearchProvider', 'createSemanticCodeProvider', 'createStructuralMapProvider', 'createContextGraphProvider', 'createExternalSourceProvider'],
  'BB-063': ['defineSourceObservation', 'resolverConfigDigest', 'reuseKey', 'defineContextResolutionReceipt', 'evaluateReceiptCurrentness', 'createDurableResolutionCoordinator', 'createResolutionStore'],
};
const manifest = { kind: 'FOUNDATION_DEPENDENCY_MANIFEST_V1', version: 1, workId: 'BB-064', dependencies: [] };
for (const [workId, exports] of Object.entries(required)) {
  for (const name of exports) if (typeof oracle[name] !== 'function') fail(`${workId} export missing: ${name}`);
  const plan = await readJson(`docs/blackboard/artifacts/ready-implement-plan/${workId}.json`);
  const { createHash: ch } = await import('node:crypto');
  const canonical = (v) => JSON.stringify(v);
  void canonical; void ch;
  manifest.dependencies.push({ workId, exports });
}
try {
  const core = await import('../../packages/core-harness/src/context-resolution.js');
  if (typeof core.resolveContextRequirementBlocks !== 'function') fail('Core resolver seam missing');
  manifest.dependencies.push({ workId: 'BB-061-core-seam', exports: ['resolveContextRequirementBlocks'] });
} catch (e) { fail(`Core seam unreadable: ${e.message}`); }

// S3: foundation probe via facade
const { defineContextRequirement } = oracle;
const { createSourceCatalog, createExactRepositoryProvider, createExactArtifactProvider } = oracle;
const { createRetrievalPlanner } = oracle;
const { createOracleContextResolver } = oracle;
const { createResolutionStore } = oracle;
const { defineApplicationArtifactManifest, createJsonArtifactManifestStore, createManifestArtifactReader } = await import('../../packages/agentic-system/src/artifact-manifest.js');
const sha = (s) => `sha256:${createHash('sha256').update(s, 'utf8').digest('hex')}`;

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bb064-foundation-'));
const manifestStore = createJsonArtifactManifestStore({ path: path.join(dir, 'manifests') });
const manifestDoc = defineApplicationArtifactManifest({ kind: 'APPLICATION_ARTIFACT_MANIFEST', version: 1, producerWorkOrderId: 'wo1', producerRevision: 'r1', acceptanceDecision: { id: 'acc1', digest: 'd1' }, retention: { policyRevision: 'p1', pinnedBy: [] }, entries: [{ ref: 'art1', path: 'a.js', storedRevision: 'r1', contentDigest: sha('artifact-bytes'), availability: 'AVAILABLE' }] });
await manifestStore.putManifest(manifestDoc);

const catalog = createSourceCatalog({
  providers: [
    createExactRepositoryProvider({ repositoryReader: { readFile: async ({ path: p }) => ({ content: `repo-content:${p}`, sourceRef: `repo/${p}@h1` }) }, currentSnapshot: async () => 'h1' }),
    createExactArtifactProvider({ artifactReader: createManifestArtifactReader({ reader: { readArtifact: async () => ({ content: 'artifact-bytes', sourceRef: 'art1@r1' }) }, manifestStore }).forManifest(manifestDoc.ref), producerWorkOrderId: 'wo1', acceptanceDecision: { id: 'acc1', digest: 'd1' }, currentSnapshot: async () => 'r1' }),
  ],
  snapshotAuthorities: [
    { sourceKind: 'REPOSITORY', refPrefix: '', observe: async () => ({ snapshotRef: 'h1' }) },
    { sourceKind: 'APPLICATION_ARTIFACT', refPrefix: '', observe: async () => ({ snapshotRef: 'r1' }) },
  ],
});
const planner = createRetrievalPlanner({ catalog });
const store = createResolutionStore({ path: path.join(dir, 'oracle') });
const { createDurableResolutionCoordinator } = oracle;
const coordinator = createDurableResolutionCoordinator({ catalog, store, resolverConfiguration: { contractRevision: 'c1', plannerRevision: 'p1', materializationRevision: 'm1', providerBindings: {} }, resolveFresh: async () => { throw new Error('facade materializes via planner path'); } });
const resolver = createOracleContextResolver({ sourceCatalog: catalog, retrievalPlanner: planner, durability: null });

const budget = { maxItems: 4, maxMaterializedBytes: 40000, maxProviderCalls: 4, maxResolutionSteps: 1 };
const repoReq = defineContextRequirement({ consumerRef: 'probe', semanticNeed: 'repo current', evidence: [{ id: 'repo', necessity: 'REQUIRED', need: 'n', source: { kind: 'REPOSITORY', ref: 'repo', snapshot: { mode: 'CURRENT' }, itemRefs: ['a.js'] } }], budget });
const artReq = defineContextRequirement({ consumerRef: 'probe', semanticNeed: 'artifact exact', evidence: [{ id: 'art', necessity: 'REQUIRED', need: 'n', source: { kind: 'APPLICATION_ARTIFACT', ref: 'art1', snapshot: { mode: 'CURRENT' }, itemRefs: ['a.js'] } }], budget });

const repoRes = await resolver.resolve(repoReq);
assert.equal(repoRes.resolution.status, 'COMPLETE');
const artRes = await resolver.resolve(artReq);
assert.equal(artRes.resolution.status, 'COMPLETE');

const renderedBytes = Buffer.byteLength(JSON.stringify(repoRes.resolution.items).slice(0, 1000));
const probe = {
  kind: 'ORACLE_FOUNDATION_PROBE_V1', version: 1,
  repository: { requirementId: repoRes.resolution.requirementId, resolutionId: repoRes.resolution.resolutionId, validators: repoRes.resolution.items[0].currentness.validators, provenance: repoRes.resolution.items[0].provenance, consumed: repoRes.resolution.consumed, renderedBytes },
  artifact: { requirementId: artRes.resolution.requirementId, resolutionId: artRes.resolution.resolutionId, validators: artRes.resolution.items[0].currentness.validators, provenance: artRes.resolution.items[0].provenance, manifestRef: manifestDoc.ref, consumed: artRes.resolution.consumed },
  reuse: { coordinator: typeof coordinator.resolve === 'function', store: typeof store.putResolution === 'function' },
};
console.log(JSON.stringify({ manifest, probe }));
