// Deterministic feasibility probe for a native snapshot-bound Context Graph (BB-088 research).
// Usage from repository root: node docs/blackboard/evidence/BB-088/graph-probe.mjs <git-sha>
// Reads exact blobs with git (no working-tree reads), extracts relative ES-module import edges,
// builds the graph twice, and writes graph-probe-result.json beside this file.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const sha = process.argv[2];
if (!/^[a-f0-9]{40}$/.test(sha ?? '')) throw new Error('exact 40-hex git sha required');
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
const ROOTS = ['packages/oracle/src', 'packages/agentic-system/src'];
const IMPORT = /(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s*['"](\.{1,2}\/[^'"]+)['"]/g;

function build() {
  const files = ROOTS.flatMap((root) => git('ls-tree', '-r', '--name-only', sha, '--', root).split('\n').filter((f) => f.endsWith('.js'))).sort();
  const nodes = [], edges = [];
  let rawBytes = 0;
  for (const file of files) {
    const body = git('show', `${sha}:${file}`);
    rawBytes += Buffer.byteLength(body);
    nodes.push({ id: file, snapshotRef: sha, contentDigest: digest(body) });
    for (const match of body.matchAll(IMPORT)) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1]));
      edges.push({ from: file, to: target, kind: 'IMPORTS', provenance: { kind: 'AUTHORITATIVE_SOURCE', ref: `${file}@${sha}`, digest: digest(body) } });
    }
  }
  edges.sort((a, b) => (a.from + a.to).localeCompare(b.from + b.to));
  const graph = { snapshotRef: sha, roots: ROOTS, nodes, edges };
  return { graph, graphDigest: digest(JSON.stringify(graph)), rawBytes };
}

const first = build(), second = build();
const nodeIds = new Set(first.graph.nodes.map((n) => n.id));
const dangling = first.graph.edges.filter((e) => !nodeIds.has(e.to));
const query = 'packages/oracle/src/context-contract.js';
const importers = first.graph.edges.filter((e) => e.to === query);
const projection = JSON.stringify(importers.map(({ from, kind, provenance }) => ({ from, kind, provenance })));
const importerFiles = [...new Set(importers.map((e) => e.from))];
const importerRawBytes = importerFiles.reduce((n, f) => n + Buffer.byteLength(git('show', `${sha}:${f}`)), 0);
const result = {
  kind: 'BB088_CONTEXT_GRAPH_PROBE_RESULT', version: 1, snapshotRef: sha, roots: ROOTS,
  nodes: first.graph.nodes.length, edges: first.graph.edges.length,
  deterministic: first.graphDigest === second.graphDigest, graphDigest: first.graphDigest,
  danglingEdges: dangling.map((e) => `${e.from} -> ${e.to}`),
  everyEdgeAuthoritative: first.graph.edges.every((e) => e.provenance.kind === 'AUTHORITATIVE_SOURCE' && e.provenance.ref.endsWith(`@${sha}`)),
  query: { reverseImportsOf: query, importers: importerFiles, projectionBytes: Buffer.byteLength(projection), importerRawBytes },
  corpusRawBytes: first.rawBytes,
  limits: ['regex import extraction covers static relative ES imports/re-exports only; dynamic import() and package-name specifiers are not edges', 'no symbol-level edges', 'zero model calls']
};
fs.writeFileSync(path.join(here, 'graph-probe-result.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ nodes: result.nodes, edges: result.edges, deterministic: result.deterministic, dangling: result.danglingEdges.length, projectionBytes: result.query.projectionBytes, importerRawBytes }));
