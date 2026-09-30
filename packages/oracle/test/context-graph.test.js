import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildContextGraph, createAuthoritativeGraphClient, parseContextGraphRef, CONTEXT_GRAPH_EDGES_V1, ProviderFailure, createContextGraphProvider } from '../src/index.js';

const SNAP = 'snap-1';
const REPO = 'fixture-repo';
const digest = value => createHash('sha256').update(value).digest('hex');
// In-memory exact-snapshot reader keyed by (revision, path); any other revision throws.
function snapshotReader(filesBySnapshot, calls = []) {
  return {
    async listFiles({ repositoryRef, revision, roots }) {
      calls.push({ op: 'listFiles', repositoryRef, revision });
      const files = filesBySnapshot[revision];
      if (!files) throw new Error(`unexpected revision ${revision}`);
      return Object.keys(files).filter(file => roots.some(root => file.startsWith(`${root}/`)));
    },
    async readFile({ repositoryRef, revision, path }) {
      calls.push({ op: 'readFile', repositoryRef, revision, path });
      const files = filesBySnapshot[revision];
      if (!files) throw new Error(`unexpected revision ${revision}`);
      if (!Object.hasOwn(files, path)) throw new Error(`missing ${path}@${revision}`);
      return { content: files[path], sourceRef: `${path}@${revision}` };
    }
  };
}
const FILES = {
  'src/a.js': "import { b } from './b.js';\nimport c from \"./lib/c.js\";\nexport * from './lib/d.js';\n",
  'src/b.js': "import { c } from './lib/c.js';\nimport path from 'node:path';\nimport { x } from '../core/x.js';\nconst lazy = () => import('./lazy.js');\nexport const b = 1;\n",
  'src/lib/c.js': "import { d } from '../lib/./d.js';\nexport function c() { return d; }\n",
  'src/lib/d.js': "export const d = 4;\n",
  'src/lazy.js': "export default 1;\n",
  'src/readme.md': "import nothing from './a.js'\n",
  'edges/declared.json': JSON.stringify({ kind: 'CONTEXT_GRAPH_EDGES_V1', version: 1, edges: [{ from: 'docs/a.md', to: 'src/a.js', relation: 'DOCUMENTS' }] })
};
const build = (extra = {}, calls) => buildContextGraph({ snapshotReader: snapshotReader({ [SNAP]: { ...FILES, ...extra } }, calls), repositoryRef: REPO, snapshotRef: SNAP, roots: ['src'], edgeFiles: ['edges/declared.json'], ...extra.__options });
const edgeKey = edge => `${edge.from} -${edge.relation}-> ${edge.to}`;

test('CG1 static relative imports and re-exports become normalized FILE edges; out-of-root targets are EXTERNAL_BOUNDARY nodes', async () => {
  const graph = await build();
  const keys = graph.edges.map(edgeKey);
  assert.ok(keys.includes('src/a.js -IMPORTS-> src/b.js'));
  assert.ok(keys.includes('src/a.js -IMPORTS-> src/lib/c.js'));
  assert.ok(keys.includes('src/a.js -REEXPORTS-> src/lib/d.js'));
  assert.ok(keys.includes('src/lib/c.js -IMPORTS-> src/lib/d.js'), '../lib/./d.js normalizes with posix joins');
  assert.ok(keys.includes('src/b.js -IMPORTS-> core/x.js'));
  const boundary = graph.nodes.find(node => node.id === 'core/x.js');
  assert.deepEqual(boundary, { id: 'core/x.js', kind: 'EXTERNAL_BOUNDARY', contentDigest: null });
  assert.equal(graph.nodes.find(node => node.id === 'src/a.js').contentDigest, digest(FILES['src/a.js']));
  assert.ok(!graph.nodes.some(node => node.id === 'src/readme.md'), 'only .js/.mjs files under roots are parsed');
});

test('CG1 dynamic import() and bare specifiers produce no edge and are listed in graph.limits', async () => {
  const graph = await build();
  assert.ok(!graph.edges.some(edge => edge.to.includes('lazy') || edge.to === 'node:path'));
  assert.ok(graph.limits.some(limit => limit.kind === 'DYNAMIC_IMPORT' && limit.file === 'src/b.js' && limit.specifier === './lazy.js'));
  assert.ok(graph.limits.some(limit => limit.kind === 'BARE_SPECIFIER' && limit.file === 'src/b.js' && limit.specifier === 'node:path'));
});

test('CG1 every edge carries AUTHORITATIVE_SOURCE provenance with a snapshot-qualified ref and the file digest', async () => {
  const graph = await build();
  assert.ok(graph.edges.length > 0);
  for (const edge of graph.edges) {
    assert.equal(edge.provenance.kind, 'AUTHORITATIVE_SOURCE');
    assert.match(edge.provenance.ref, new RegExp(`@${SNAP}$`));
    const file = edge.provenance.ref.slice(0, -(`@${SNAP}`.length));
    assert.equal(edge.provenance.digest, digest(FILES[file]));
  }
});

test('CG1 declared CONTEXT_GRAPH_EDGES_V1 edges are provenanced by the edge file; malformed files and unknown relations fail the build', async () => {
  assert.deepEqual(CONTEXT_GRAPH_EDGES_V1.relations, ['DEPENDS_ON', 'DOCUMENTS', 'IMPLEMENTS', 'TESTS']);
  const graph = await build();
  const declared = graph.edges.find(edge => edge.relation === 'DECLARED:DOCUMENTS');
  assert.deepEqual(declared, { from: 'docs/a.md', to: 'src/a.js', relation: 'DECLARED:DOCUMENTS', provenance: { kind: 'AUTHORITATIVE_SOURCE', ref: `edges/declared.json@${SNAP}`, digest: digest(FILES['edges/declared.json']) } });
  assert.equal(graph.nodes.find(node => node.id === 'docs/a.md').kind, 'EXTERNAL_BOUNDARY');
  await assert.rejects(build({ 'edges/declared.json': '{not json' }), /malformed CONTEXT_GRAPH_EDGES_V1 file/);
  await assert.rejects(build({ 'edges/declared.json': JSON.stringify({ kind: 'CONTEXT_GRAPH_EDGES_V1', version: 2, edges: [] }) }), /malformed CONTEXT_GRAPH_EDGES_V1 file/);
  await assert.rejects(build({ 'edges/declared.json': JSON.stringify({ kind: 'CONTEXT_GRAPH_EDGES_V1', version: 1, edges: [{ from: 'a', to: 'b' }] }) }), /malformed declared edge/);
  await assert.rejects(build({ 'edges/declared.json': JSON.stringify({ kind: 'CONTEXT_GRAPH_EDGES_V1', version: 1, edges: [{ from: 'a', to: 'b', relation: 'INFERRED_BY_MODEL' }] }) }), /unknown declared relation/);
});

test('CG1 the build reads only the requested exact snapshot, and a reader asked for another revision fails', async () => {
  const calls = [];
  await build({}, calls);
  assert.ok(calls.length > 0);
  assert.ok(calls.every(call => call.revision === SNAP && call.repositoryRef === REPO));
  const reader = snapshotReader({ [SNAP]: FILES });
  await assert.rejects(buildContextGraph({ snapshotReader: reader, repositoryRef: REPO, snapshotRef: 'other-snap', roots: ['src'] }), /unexpected revision other-snap/);
  await assert.rejects(buildContextGraph({ snapshotReader: { readFile() {} }, repositoryRef: REPO, snapshotRef: SNAP, roots: ['src'] }), /snapshotReader with listFiles\(\) and readFile\(\) required/);
});

test('CG1 repeated builds are deterministic: same graphId, node order and edge order sorted by from,to,relation', async () => {
  const first = await build(), second = await build();
  assert.equal(first.graphId, second.graphId);
  assert.match(first.graphId, /^[a-f0-9]{64}$/);
  assert.deepEqual(first.edges, second.edges);
  assert.deepEqual(first.nodes.map(node => node.id), [...first.nodes.map(node => node.id)].sort());
  const sorted = [...first.edges].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : a.to < b.to ? -1 : a.to > b.to ? 1 : a.relation < b.relation ? -1 : a.relation > b.relation ? 1 : 0));
  assert.deepEqual(first.edges, sorted);
  const changed = await build({ 'src/lib/d.js': 'export const d = 5;\n' });
  assert.notEqual(changed.graphId, first.graphId, 'content digests are part of graph identity');
});

test('CG2 parseContextGraphRef accepts only the D6 grammar and rejects anything else with a typed ProviderFailure', () => {
  assert.deepEqual({ ...parseContextGraphRef('context-graph://repo/IMPORTED_BY/2/src/lib/c.js') }, { repositoryRef: 'repo', relation: 'IMPORTED_BY', hops: 2, anchorPath: 'src/lib/c.js' });
  for (const [ref, pattern] of [
    ['context-graph://repo/CALLS/1/src/a.js', /unknown context graph relation/],
    ['context-graph://repo/IMPORTS/0/src/a.js', /hops must be 1 or 2/],
    ['context-graph://repo/IMPORTS/3/src/a.js', /hops must be 1 or 2/],
    ['context-graph://repo/IMPORTS/1', /malformed context graph ref/],
    ['repo://IMPORTS/1/src/a.js', /unsupported context graph ref/],
    ['context-graph://repo/IMPORTS/1/src/../a.js', /normalized path/]
  ]) {
    assert.throws(() => parseContextGraphRef(ref), error => error instanceof ProviderFailure && error.reason === 'UNSUPPORTED' && pattern.test(error.message), ref);
  }
});

const client = (options = {}) => createAuthoritativeGraphClient({ snapshotReader: snapshotReader({ [SNAP]: FILES }), repositoryRef: REPO, roots: ['src'], currentSnapshot: async () => SNAP, ...options });
const source = (ref, snapshot = { mode: 'EXACT', ref: SNAP }) => ({ kind: 'CONTEXT_GRAPH', ref: `context-graph://${REPO}/${ref}`, snapshot });
const parsed = path => JSON.parse(path.content);

test('CG2 IMPORTS and IMPORTED_BY traverse breadth-first up to hops, ordered by (distance, node id), with AUTHORITATIVE_SOURCE provenance on every path', async () => {
  const graphClient = client();
  const out = await graphClient.traverse({ source: source('IMPORTS/1/src/a.js'), need: 'ignored text', maxItems: 10 });
  assert.deepEqual(out.paths.map(path => path.ref), ['src/b.js', 'src/lib/c.js', 'src/lib/d.js']);
  const two = await graphClient.traverse({ source: source('IMPORTS/2/src/a.js'), maxItems: 10 });
  assert.deepEqual(two.paths.map(path => [parsed(path).distance, path.ref]), [[1, 'src/b.js'], [1, 'src/lib/c.js'], [1, 'src/lib/d.js'], [2, 'core/x.js']]);
  assert.deepEqual(parsed(two.paths[3]).edges, [{ from: 'src/a.js', to: 'src/b.js', relation: 'IMPORTS' }, { from: 'src/b.js', to: 'core/x.js', relation: 'IMPORTS' }]);
  const importers = await graphClient.traverse({ source: source('IMPORTED_BY/1/src/lib/d.js'), maxItems: 10 });
  assert.deepEqual(importers.paths.map(path => path.ref), ['src/a.js', 'src/lib/c.js']);
  const twoUp = await graphClient.traverse({ source: source('IMPORTED_BY/2/src/lib/d.js'), maxItems: 10 });
  assert.deepEqual(twoUp.paths.map(path => [parsed(path).distance, path.ref]), [[1, 'src/a.js'], [1, 'src/lib/c.js'], [2, 'src/b.js']]);
  for (const path of [...out.paths, ...two.paths, ...importers.paths, ...twoUp.paths]) {
    assert.ok(path.provenance.length === parsed(path).edges.length && path.provenance.every(entry => entry.kind === 'AUTHORITATIVE_SOURCE' && entry.ref.endsWith(`@${SNAP}`) && /^[a-f0-9]{64}$/.test(entry.digest)));
  }
  assert.deepEqual(out.validators.map(v => [v.kind, v.strength]), [['REVISION', 'STRONG'], ['CONTENT_DIGEST', 'STRONG']]);
  assert.equal(out.snapshotRef, SNAP);
  assert.equal(graphClient.stats().builds, 1, 'the graph for one snapshot is built once and reused by graphId');
});

test('CG2 more reachable paths than maxItems returns exactly maxItems in deterministic order with truncated:true', async () => {
  const out = await client().traverse({ source: source('IMPORTS/2/src/a.js'), maxItems: 2 });
  assert.deepEqual(out.paths.map(path => path.ref), ['src/b.js', 'src/lib/c.js']);
  assert.ok(out.paths.every(path => parsed(path).truncated === true));
  const all = await client().traverse({ source: source('IMPORTS/2/src/a.js'), maxItems: 4 });
  assert.ok(all.paths.every(path => parsed(path).truncated === false));
});

test('CG2 an absent anchor, unknown relation, invalid hops or foreign repository is a typed ProviderFailure, never a fuzzy match', async () => {
  const graphClient = client();
  const reject = (ref, reason, pattern) => assert.rejects(graphClient.traverse({ source: source(ref), maxItems: 5 }), error => error instanceof ProviderFailure && error.reason === reason && pattern.test(error.message));
  await reject('IMPORTS/1/src/a', 'MISSING', /anchor not in graph/);
  await reject('IMPORTS/1/src/nope.js', 'MISSING', /anchor not in graph/);
  await reject('DEPENDS/1/src/a.js', 'UNSUPPORTED', /unknown context graph relation/);
  await reject('IMPORTS/3/src/a.js', 'UNSUPPORTED', /hops must be 1 or 2/);
  await assert.rejects(graphClient.traverse({ source: { kind: 'CONTEXT_GRAPH', ref: 'context-graph://other-repo/IMPORTS/1/src/a.js', snapshot: { mode: 'EXACT', ref: SNAP } }, maxItems: 5 }), error => error.reason === 'UNSUPPORTED');
});

test('CG2 CURRENT traversal uses currentSnapshot() and EXACT uses the source snapshot ref', async () => {
  const seen = [];
  const reader = snapshotReader({ [SNAP]: FILES, 'snap-2': { ...FILES, 'src/lib/d.js': 'export const d = 9;\n' } });
  const graphClient = createAuthoritativeGraphClient({ snapshotReader: reader, repositoryRef: REPO, roots: ['src'], currentSnapshot: async () => { seen.push('current'); return 'snap-2'; } });
  const current = await graphClient.traverse({ source: source('IMPORTS/1/src/a.js', { mode: 'CURRENT' }), maxItems: 5 });
  const exact = await graphClient.traverse({ source: source('IMPORTS/1/src/a.js', { mode: 'EXACT', ref: SNAP }), maxItems: 5 });
  assert.equal(current.snapshotRef, 'snap-2');
  assert.equal(exact.snapshotRef, SNAP);
  assert.notEqual(current.validators[1].value, exact.validators[1].value);
  assert.deepEqual(seen, ['current']);
});

test('CG2 the delivered provider seam rejects a graph path without AUTHORITATIVE_SOURCE provenance', async () => {
  const provider = createContextGraphProvider({ graphClient: { traverse: async () => ({ snapshotRef: SNAP, paths: [{ ref: 'src/a.js', content: '[]', provenance: [{ kind: 'MODEL_INFERENCE', ref: 'x' }] }] }) } });
  await assert.rejects(provider.retrieve({ evidenceId: 'g', sourceConstraint: source('IMPORTS/1/src/a.js'), semanticNeed: 'n', reservedBudget: { items: 1 } }), error => error.reason === 'CURRENTNESS_UNVERIFIABLE');
});
