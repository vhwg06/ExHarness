// Authoritative, snapshot-bound Context Graph for the delivered CONTEXT_GRAPH provider seam.
// Edges come only from exact repository blobs at one snapshot (static relative ES-module
// imports/re-exports) and from committed CONTEXT_GRAPH_EDGES_V1 files at the same snapshot.
// No graph database, no model-inferred edges, Node built-ins only.
import { createHash } from 'node:crypto';
import path from 'node:path';
import { ProviderFailure, ProviderFailureReason } from './provider-contract.js';

const fail = message => { throw new TypeError(message); };
const text = (value, label) => { if (typeof value !== 'string' || !value.trim()) fail(`${label} must be nonempty text`); return value; };
const sha256 = value => createHash('sha256').update(value).digest('hex');
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}
function deepFreeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value); } return value; }

/** Declared-edge file contract (D4): relation is one of the closed set below. */
export const CONTEXT_GRAPH_EDGES_V1 = deepFreeze({
  kind: 'CONTEXT_GRAPH_EDGES_V1',
  version: 1,
  relations: ['DEPENDS_ON', 'DOCUMENTS', 'IMPLEMENTS', 'TESTS']
});
const GRAPH_RELATIONS = Object.freeze(['IMPORTS', 'IMPORTED_BY']);
const SOURCE_FILE = /\.(?:js|mjs)$/;
// Static module specifiers: `import ... from '<spec>'` and `export ... from '<spec>'` (D3).
// The clause between the keyword and `from` may only hold bindings (identifiers, braces, commas, `*`, `as`),
// so declarations such as `export function f() {}` never pair with a later `from`.
const STATIC_FROM = /(?:^|[\n;])[ \t]*(import|export)\s+[\w$\s{},*]*?\bfrom\s*(['"])([^'"\n]+)\2/g;
const DYNAMIC_IMPORT = /\bimport\s*\(\s*(['"`])([^'"`\n]*)\1/g;

function normalizeRoots(roots) {
  if (!Array.isArray(roots) || !roots.length) fail('roots must be a nonempty array');
  const out = roots.map((root, index) => {
    const value = text(root, `roots[${index}]`).replace(/\/+$/, '');
    const normalized = path.posix.normalize(value);
    if (normalized !== value || normalized.startsWith('..') || path.posix.isAbsolute(normalized) || normalized === '.') fail(`roots[${index}] must be a normalized repository-relative path`);
    return normalized;
  });
  if (new Set(out).size !== out.length) fail('roots must be unique');
  return out;
}
const insideRoots = (file, roots) => roots.some(root => file === root || file.startsWith(`${root}/`));
function readerOf(snapshotReader) {
  if (!snapshotReader || typeof snapshotReader.listFiles !== 'function' || typeof snapshotReader.readFile !== 'function') fail('snapshotReader with listFiles() and readFile() required');
  return snapshotReader;
}
async function readExact(reader, repositoryRef, snapshotRef, file) {
  const result = await reader.readFile({ repositoryRef, revision: snapshotRef, path: file });
  if (!result || typeof result.content !== 'string') fail(`snapshotReader returned no content for ${file}@${snapshotRef}`);
  return result.content;
}
function parseEdgeFile(file, content) {
  let parsed;
  try { parsed = JSON.parse(content); } catch (error) { fail(`malformed ${CONTEXT_GRAPH_EDGES_V1.kind} file ${file}: ${error.message}`); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail(`malformed ${CONTEXT_GRAPH_EDGES_V1.kind} file ${file}: object required`);
  const keys = Object.keys(parsed).sort().join(',');
  if (keys !== 'edges,kind,version' || parsed.kind !== CONTEXT_GRAPH_EDGES_V1.kind || parsed.version !== CONTEXT_GRAPH_EDGES_V1.version || !Array.isArray(parsed.edges)) fail(`malformed ${CONTEXT_GRAPH_EDGES_V1.kind} file ${file}: {kind, version, edges[]} required`);
  return parsed.edges.map((edge, index) => {
    if (!edge || typeof edge !== 'object' || Array.isArray(edge) || Object.keys(edge).sort().join(',') !== 'from,relation,to') fail(`malformed declared edge ${file}#${index}: {from, to, relation} required`);
    text(edge.from, `${file}#${index}.from`); text(edge.to, `${file}#${index}.to`);
    if (!CONTEXT_GRAPH_EDGES_V1.relations.includes(edge.relation)) fail(`unknown declared relation ${file}#${index}: ${edge.relation}`);
    return { from: edge.from, to: edge.to, relation: `DECLARED:${edge.relation}` };
  });
}

/**
 * Builds a deterministic graph from one exact snapshot (D2-D5). Only snapshotReader is read,
 * always at `snapshotRef`; there is no working-tree or mutable read path.
 */
export async function buildContextGraph({ snapshotReader, repositoryRef, snapshotRef, roots, edgeFiles = [] } = {}) {
  const reader = readerOf(snapshotReader);
  text(repositoryRef, 'repositoryRef'); text(snapshotRef, 'snapshotRef');
  const normalizedRoots = normalizeRoots(roots);
  if (!Array.isArray(edgeFiles)) fail('edgeFiles must be an array');
  const declaredFiles = [...new Set(edgeFiles.map((file, index) => text(file, `edgeFiles[${index}]`)))].sort(compare);
  const listed = await reader.listFiles({ repositoryRef, revision: snapshotRef, roots: normalizedRoots });
  if (!Array.isArray(listed)) fail('snapshotReader.listFiles must return an array');
  const files = [...new Set(listed.map((file, index) => text(file, `listFiles[${index}]`)))]
    .filter(file => SOURCE_FILE.test(file) && insideRoots(file, normalizedRoots)).sort(compare);
  const nodes = new Map(), edges = new Map(), limits = [];
  for (const file of files) {
    const content = await readExact(reader, repositoryRef, snapshotRef, file);
    const digest = sha256(content);
    nodes.set(file, { id: file, kind: 'FILE', contentDigest: digest });
    const provenance = { kind: 'AUTHORITATIVE_SOURCE', ref: `${file}@${snapshotRef}`, digest };
    for (const match of content.matchAll(STATIC_FROM)) {
      const [, keyword, , specifier] = match;
      if (!specifier.startsWith('./') && !specifier.startsWith('../')) { limits.push({ kind: 'BARE_SPECIFIER', file, specifier }); continue; }
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
      const relation = keyword === 'export' ? 'REEXPORTS' : 'IMPORTS';
      edges.set(`${file}\u0000${target}\u0000${relation}\u0000${provenance.ref}`, { from: file, to: target, relation, provenance });
    }
    for (const match of content.matchAll(DYNAMIC_IMPORT)) limits.push({ kind: 'DYNAMIC_IMPORT', file, specifier: match[2] });
  }
  const edgeFileDigests = [];
  for (const file of declaredFiles) {
    const content = await readExact(reader, repositoryRef, snapshotRef, file);
    const digest = sha256(content);
    edgeFileDigests.push({ ref: file, digest });
    const provenance = { kind: 'AUTHORITATIVE_SOURCE', ref: `${file}@${snapshotRef}`, digest };
    for (const edge of parseEdgeFile(file, content)) edges.set(`${edge.from}\u0000${edge.to}\u0000${edge.relation}\u0000${provenance.ref}`, { ...edge, provenance });
  }
  // Every endpoint becomes a node: an in-root target is a FILE (its digest is null when the
  // snapshot has no such source file), an out-of-root target is an EXTERNAL_BOUNDARY node.
  for (const edge of edges.values()) for (const id of [edge.from, edge.to]) {
    if (nodes.has(id)) continue;
    const inside = insideRoots(id, normalizedRoots);
    nodes.set(id, { id, kind: inside ? 'FILE' : 'EXTERNAL_BOUNDARY', contentDigest: null });
    if (inside) limits.push({ kind: 'UNRESOLVED_TARGET', file: id, specifier: id });
  }
  const sortedNodes = [...nodes.values()].sort((a, b) => compare(a.id, b.id));
  const sortedEdges = [...edges.values()].sort((a, b) => compare(a.from, b.from) || compare(a.to, b.to) || compare(a.relation, b.relation) || compare(a.provenance.ref, b.provenance.ref));
  const sortedLimits = limits.sort((a, b) => compare(a.kind, b.kind) || compare(a.file, b.file) || compare(a.specifier, b.specifier));
  const graphId = sha256(canonical({ snapshotRef, roots: normalizedRoots, edgeFiles: edgeFileDigests, nodes: sortedNodes, edges: sortedEdges }));
  return deepFreeze({
    kind: 'CONTEXT_GRAPH_V1', graphId, repositoryRef, snapshotRef, roots: normalizedRoots, edgeFiles: edgeFileDigests,
    nodes: sortedNodes, edges: sortedEdges, limits: sortedLimits,
    exclusions: ['dynamic import() is not an edge', 'bare package specifiers are not edges', 'side-effect-only imports without from are not edges', 'no symbol-level edges', 'no model-inferred edges']
  });
}

/**
 * Parses `context-graph://<repositoryRef>/<IMPORTS|IMPORTED_BY>/<hops 1|2>/<anchorPath>` (D6).
 * Anything else is a typed ProviderFailure; there is no best-effort match.
 */
export function parseContextGraphRef(ref, { providerId = 'context-graph', evidenceId = null } = {}) {
  const failure = (reason, detail) => new ProviderFailure({ reason, providerId, evidenceId: evidenceId ?? (typeof ref === 'string' && ref.trim() ? ref : 'context-graph-ref'), detail });
  if (typeof ref !== 'string' || !ref.startsWith('context-graph://')) throw failure(ProviderFailureReason.UNSUPPORTED, `unsupported context graph ref: ${String(ref)}`);
  const parts = ref.slice('context-graph://'.length).split('/');
  if (parts.length < 4 || parts.some(part => part === '')) throw failure(ProviderFailureReason.UNSUPPORTED, `malformed context graph ref: ${ref}`);
  const [repositoryRef, relation, hopsText, ...anchorParts] = parts;
  if (!GRAPH_RELATIONS.includes(relation)) throw failure(ProviderFailureReason.UNSUPPORTED, `unknown context graph relation: ${relation}`);
  if (!/^[12]$/.test(hopsText)) throw failure(ProviderFailureReason.UNSUPPORTED, `context graph hops must be 1 or 2: ${hopsText}`);
  const anchorPath = anchorParts.join('/');
  if (path.posix.normalize(anchorPath) !== anchorPath || anchorPath.startsWith('..')) throw failure(ProviderFailureReason.UNSUPPORTED, `context graph anchor must be a normalized path: ${anchorPath}`);
  return Object.freeze({ repositoryRef, relation, hops: Number(hopsText), anchorPath });
}

/**
 * Breadth-first traversal (D8): one path per reachable node, ordered by (distance, node id).
 * IMPORTS follows IMPORTS/REEXPORTS edges forward; IMPORTED_BY follows them backward.
 */
function traverseContextGraph(graph, { relation, hops, anchorPath, maxItems }, { providerId = 'context-graph', evidenceId = 'context-graph-ref' } = {}) {
  if (!graph || graph.kind !== 'CONTEXT_GRAPH_V1') fail('context graph required');
  if (!Number.isSafeInteger(maxItems) || maxItems < 1) fail('maxItems must be a positive integer');
  if (!graph.nodes.some(node => node.id === anchorPath)) throw new ProviderFailure({ reason: ProviderFailureReason.MISSING, providerId, evidenceId, detail: `context graph anchor not in graph: ${anchorPath}` });
  const moduleEdges = graph.edges.filter(edge => edge.relation === 'IMPORTS' || edge.relation === 'REEXPORTS');
  const step = relation === 'IMPORTS' ? edge => [edge.from, edge.to] : edge => [edge.to, edge.from];
  const next = new Map();
  for (const edge of moduleEdges) { const [from] = step(edge); if (!next.has(from)) next.set(from, []); next.get(from).push(edge); }
  const found = [];
  const via = new Map([[anchorPath, []]]);
  let frontier = [anchorPath];
  for (let distance = 1; distance <= hops && frontier.length; distance++) {
    const reached = new Map();
    for (const node of frontier) for (const edge of next.get(node) ?? []) {
      const target = step(edge)[1];
      if (via.has(target) || reached.has(target)) continue;
      reached.set(target, [...via.get(node), edge]);
    }
    const ordered = [...reached.keys()].sort(compare);
    for (const target of ordered) { via.set(target, reached.get(target)); found.push({ distance, target, edges: reached.get(target) }); }
    frontier = ordered;
  }
  const truncated = found.length > maxItems;
  return found.slice(0, maxItems).map(({ distance, target, edges }) => Object.freeze({
    ref: target,
    content: canonical({ anchor: anchorPath, relation, distance, target, edges: edges.map(({ from, to, relation: kind }) => ({ from, to, relation: kind })), truncated }),
    provenance: edges.map(edge => ({ ...edge.provenance }))
  }));
}

/**
 * graphClient for the delivered createContextGraphProvider (D7). EXACT reads source.snapshot.ref,
 * CURRENT reads currentSnapshot(); graphs are reused in memory by graphId. The semantic need is not parsed.
 */
export function createAuthoritativeGraphClient({ snapshotReader, repositoryRef, roots, edgeFiles = [], currentSnapshot = null, providerId = 'context-graph' } = {}) {
  readerOf(snapshotReader); text(repositoryRef, 'repositoryRef');
  const normalizedRoots = normalizeRoots(roots);
  if (currentSnapshot !== null && typeof currentSnapshot !== 'function') fail('currentSnapshot must be a function or null');
  const graphIdBySnapshot = new Map(), graphs = new Map();
  let builds = 0;
  async function graphAt(snapshotRef) {
    const known = graphIdBySnapshot.get(snapshotRef);
    if (known) return graphs.get(known);
    const graph = await buildContextGraph({ snapshotReader, repositoryRef, snapshotRef, roots: normalizedRoots, edgeFiles });
    builds++;
    graphIdBySnapshot.set(snapshotRef, graph.graphId);
    if (!graphs.has(graph.graphId)) graphs.set(graph.graphId, graph);
    return graphs.get(graph.graphId);
  }
  async function traverse({ source, need, maxItems } = {}) {
    void need;
    if (!source || source.kind !== 'CONTEXT_GRAPH') fail('CONTEXT_GRAPH source required');
    const evidenceId = source.ref;
    const parsed = parseContextGraphRef(source.ref, { providerId, evidenceId });
    if (parsed.repositoryRef !== repositoryRef) throw new ProviderFailure({ reason: ProviderFailureReason.UNSUPPORTED, providerId, evidenceId, detail: `context graph ref names repository ${parsed.repositoryRef}, client serves ${repositoryRef}` });
    let snapshotRef;
    if (source.snapshot?.mode === 'EXACT') snapshotRef = source.snapshot.ref;
    else if (source.snapshot?.mode === 'CURRENT') {
      if (!currentSnapshot) throw new ProviderFailure({ reason: ProviderFailureReason.UNSUPPORTED, providerId, evidenceId, detail: 'CURRENT context graph needs currentSnapshot()' });
      const observed = await currentSnapshot({ repositoryRef });
      snapshotRef = typeof observed === 'string' ? observed : observed?.snapshotRef;
    } else fail('source.snapshot.mode must be EXACT or CURRENT');
    if (typeof snapshotRef !== 'string' || !snapshotRef.trim()) throw new ProviderFailure({ reason: ProviderFailureReason.SOURCE_FAILURE, providerId, evidenceId, detail: 'context graph snapshot unavailable' });
    const graph = await graphAt(snapshotRef);
    const paths = traverseContextGraph(graph, { ...parsed, maxItems }, { providerId, evidenceId });
    return {
      snapshotRef: graph.snapshotRef,
      validators: [{ kind: 'REVISION', value: graph.snapshotRef, strength: 'STRONG' }, { kind: 'CONTENT_DIGEST', value: graph.graphId, strength: 'STRONG' }],
      paths
    };
  }
  return Object.freeze({ traverse, stats: () => Object.freeze({ builds, cachedGraphs: graphs.size }) });
}
