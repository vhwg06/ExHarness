// BB-088 boundary: the authoritative graph client through the delivered CONTEXT_GRAPH provider seam,
// SourceCatalog, RetrievalPlanner and fixed facade, plus a real exact-snapshot build of this repository.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as O from '../packages/oracle/src/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const REPO = 'exharness';
const FILES = {
  'src/a.js': "import { b } from './b.js';\nexport const a = b;\n",
  'src/b.js': "export const b = 1;\n",
  'src/c.js': "import { b } from './b.js';\nexport const c = b;\n"
};
const memoryReader = snapshots => ({
  async listFiles({ revision }) { if (!snapshots[revision]) throw new Error(`unexpected revision ${revision}`); return Object.keys(snapshots[revision]); },
  async readFile({ revision, path: file }) { const files = snapshots[revision]; if (!files?.[file]) throw new Error(`missing ${file}@${revision}`); return { content: files[file], sourceRef: `${file}@${revision}` }; }
});
const graphRef = `context-graph://${REPO}/IMPORTED_BY/1/src/b.js`;
const requirement = (budget = {}) => ({
  consumerRef: 'bb088-boundary', semanticNeed: 'importers of src/b.js',
  budget: { maxItems: 4, maxMaterializedBytes: 20000, maxProviderCalls: 1, maxResolutionSteps: 1, ...budget },
  evidence: [{ id: 'importers', necessity: 'REQUIRED', need: 'files importing src/b.js', source: { kind: 'CONTEXT_GRAPH', ref: graphRef, snapshot: { mode: 'CURRENT' } }, requiredProvenance: [] }]
});
const graphAuthority = observe => ({ sourceKind: 'CONTEXT_GRAPH', refPrefix: `context-graph://${REPO}/`, observe });
function compose({ authorities, graphSnapshot = 'snap-1' }) {
  const traverseCalls = [];
  const graphClient = O.createAuthoritativeGraphClient({ snapshotReader: memoryReader({ 'snap-1': FILES, 'snap-0': FILES }), repositoryRef: REPO, roots: ['src'], currentSnapshot: async () => graphSnapshot });
  const counted = { traverse: async request => { traverseCalls.push(request.source.ref); return graphClient.traverse(request); } };
  const sourceCatalog = O.createSourceCatalog({ providers: [O.createContextGraphProvider({ graphClient: counted })], snapshotAuthorities: authorities });
  const retrievalPlanner = O.createRetrievalPlanner({ catalog: sourceCatalog });
  return { traverseCalls, retrievalPlanner, facade: O.createOracleContextResolver({ sourceCatalog, retrievalPlanner }) };
}

test('CG3 CURRENT graph evidence at the authoritative snapshot resolves COMPLETE with REVISION and CONTENT_DIGEST strong validators', async () => {
  const { facade, traverseCalls } = compose({ authorities: [graphAuthority(async () => ({ snapshotRef: 'snap-1' }))] });
  const { resolution } = await facade.resolve(requirement());
  assert.equal(resolution.status, 'COMPLETE');
  // The delivered planner reserves one item per TRAVERSE_GRAPH work, so the client returns the first
  // path in (distance, id) order and marks the omitted remainder with truncated:true.
  assert.deepEqual(resolution.items.map(item => item.source.itemRef), ['src/a.js']);
  assert.equal(JSON.parse(resolution.items[0].content).truncated, true);
  for (const item of resolution.items) {
    assert.deepEqual(item.currentness.validators.map(v => `${v.kind}:${v.strength}`), ['REVISION:STRONG', 'CONTENT_DIGEST:STRONG']);
    assert.equal(item.currentness.validators[0].value, 'snap-1');
    assert.ok(item.provenance.every(entry => entry.kind === 'AUTHORITATIVE_SOURCE' && entry.ref.endsWith('@snap-1')));
  }
  assert.doesNotThrow(() => O.assertConsumableContextResolution(resolution, requirement()));
  assert.equal(traverseCalls.length, 1);
});

test('CG3 a graph built at an older snapshot than the authority is STALE and REQUIRED evidence is UNSATISFIED', async () => {
  const { facade } = compose({ authorities: [graphAuthority(async () => ({ snapshotRef: 'snap-1' }))], graphSnapshot: 'snap-0' });
  const { resolution } = await facade.resolve(requirement());
  assert.equal(resolution.status, 'UNSATISFIED');
  assert.deepEqual(resolution.unresolved.map(u => u.reason), ['STALE']);
  assert.equal(resolution.items.length, 0);
  assert.throws(() => O.assertConsumableContextResolution(resolution, requirement()));
});

test('CG3 an authority that reports no snapshot is CURRENTNESS_UNVERIFIABLE and REQUIRED evidence is UNSATISFIED', async () => {
  const { facade } = compose({ authorities: [graphAuthority(async () => null)] });
  const { resolution } = await facade.resolve(requirement());
  assert.equal(resolution.status, 'UNSATISFIED');
  assert.deepEqual(resolution.unresolved.map(u => u.reason), ['CURRENTNESS_UNVERIFIABLE']);
  assert.throws(() => O.assertConsumableContextResolution(resolution, requirement()));
});

test('CG3 without a CONTEXT_GRAPH authority the facade rejects before any graphClient call and the planner reports CURRENTNESS_UNVERIFIABLE', async () => {
  const { facade, traverseCalls, retrievalPlanner } = compose({ authorities: [] });
  await assert.rejects(facade.resolve(requirement()), error => error instanceof TypeError && /missing\/ambiguous snapshot authority for CONTEXT_GRAPH/.test(error.message));
  assert.equal(traverseCalls.length, 0);
  const executed = await retrievalPlanner.execute(O.defineContextRequirement(requirement()), { remainingBudget: { ...requirement().budget }, existingEdges: [] });
  assert.equal(executed.candidates.length, 0);
  assert.deepEqual(executed.unresolved.map(u => u.reason), ['CURRENTNESS_UNVERIFIABLE']);
});

test('CG3 a tiny maxMaterializedBytes budget is rejected by the delivered planner as BUDGET_EXHAUSTED', async () => {
  const { facade } = compose({ authorities: [graphAuthority(async () => ({ snapshotRef: 'snap-1' }))] });
  const { resolution } = await facade.resolve(requirement({ maxMaterializedBytes: 64 }));
  assert.equal(resolution.status, 'UNSATISFIED');
  assert.deepEqual(resolution.unresolved.map(u => u.reason), ['BUDGET_EXHAUSTED']);
});

// Git-backed exact snapshot reader: blobs at one commit only, never the working tree.
const gitSnapshotReader = {
  async listFiles({ revision, roots }) { return git('ls-tree', '-r', '--name-only', revision, '--', ...roots).split('\n').filter(Boolean); },
  async readFile({ revision, path: file }) { return { content: git('show', `${revision}:${file}`), sourceRef: `${file}@${revision}` }; }
};

test('CG4 a graph built from this repository at exact HEAD is deterministic, fully provenanced and answers IMPORTED_BY literally', async () => {
  const head = git('rev-parse', 'HEAD').trim();
  const roots = ['packages/oracle/src', 'packages/agentic-system/src'];
  const options = { snapshotReader: gitSnapshotReader, repositoryRef: REPO, snapshotRef: head, roots };
  const first = await O.buildContextGraph(options), second = await O.buildContextGraph(options);
  assert.equal(first.graphId, second.graphId);
  assert.deepEqual(first.edges, second.edges);
  assert.ok(first.nodes.length > 40 && first.edges.length > 100, `real graph size ${first.nodes.length}/${first.edges.length}`);
  assert.equal(first.edges.filter(edge => edge.provenance.kind !== 'AUTHORITATIVE_SOURCE' || !edge.provenance.ref.endsWith(`@${head}`) || !/^[a-f0-9]{64}$/.test(edge.provenance.digest)).length, 0);
  assert.ok(first.nodes.some(node => node.kind === 'EXTERNAL_BOUNDARY' && node.id.startsWith('packages/core-harness/')), 'out-of-root Core imports are boundary nodes');
  const anchor = 'packages/oracle/src/context-contract.js';
  const client = O.createAuthoritativeGraphClient({ snapshotReader: gitSnapshotReader, repositoryRef: REPO, roots, currentSnapshot: async () => head });
  const out = await client.traverse({ source: { kind: 'CONTEXT_GRAPH', ref: `context-graph://${REPO}/IMPORTED_BY/1/${anchor}`, snapshot: { mode: 'EXACT', ref: head } }, maxItems: 100 });
  assert.ok(out.paths.length > 0);
  const files = git('ls-tree', '-r', '--name-only', head, '--', ...roots).split('\n').filter(file => /\.(?:js|mjs)$/.test(file));
  const literal = files.filter(file => {
    const body = git('show', `${head}:${file}`);
    return [...body.matchAll(/(?:^|[\n;])[ \t]*(?:import|export)\s+[\w$\s{},*]*?\bfrom\s*(['"])(\.{1,2}\/[^'"\n]+)\1/g)]
      .some(match => path.posix.normalize(path.posix.join(path.posix.dirname(file), match[2])) === anchor);
  }).sort();
  assert.deepEqual(out.paths.map(p => p.ref), literal);
  assert.equal(out.validators[1].value, first.graphId);
});
