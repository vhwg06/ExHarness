# Oracle context graph

Source-synchronized projection of `packages/oracle/src/context-graph.js`. Open Oracle questions live only in `../docs/blackboard/state.md`.

## Delivered boundary

`@exharness/oracle` exports four names for an authoritative, snapshot-bound context graph: `buildContextGraph`, `parseContextGraphRef`, `createAuthoritativeGraphClient` and `CONTEXT_GRAPH_EDGES_V1`. The graph client plugs into the existing `createContextGraphProvider({ graphClient })` seam. The provider seam, the contracts, `SourceCatalog`, `RetrievalPlanner` and the fixed `createOracleContextResolver` facade are unchanged. There is no graph database, vector store, temporal store or new dependency, and no edge is inferred by a model.

```text
snapshotReader.listFiles/readFile at one exact revision
 -> buildContextGraph -> { graphId, snapshotRef, roots, edgeFiles, nodes, edges, limits }
 -> createAuthoritativeGraphClient.traverse({ source, need, maxItems })
 -> createContextGraphProvider -> SourceCatalog currentness -> RetrievalPlanner -> facade
```

## Snapshot-bound extraction

`buildContextGraph({ snapshotReader, repositoryRef, snapshotRef, roots, edgeFiles = [] })` reads only through `snapshotReader.listFiles({ repositoryRef, revision, roots })` and `snapshotReader.readFile({ repositoryRef, revision, path })`, always at `snapshotRef`. There is no working-tree or mutable read path.

- **Module edges:**
  - In `.js`/`.mjs` files under `roots`, a static `import … from './x'` becomes `IMPORTS` and a static `export … from './x'` becomes `REEXPORTS`.
  - Specifiers are resolved with POSIX path joins and normalization.
  - The clause before `from` may contain only bindings, so declarations never pair with a later `from`.
- **Nodes:**
  - Each parsed file is a `FILE` node with the SHA-256 `contentDigest` of its blob.
  - A target outside `roots` becomes an `EXTERNAL_BOUNDARY` node with `contentDigest: null`. It is never dropped.
  - An in-root target with no source blob at the snapshot is a `FILE` node with a null digest, listed in `limits` as `UNRESOLVED_TARGET`.
- **Declared edges:**
  - Each file in `edgeFiles` is read at the same snapshot. It must be exactly `{ kind: "CONTEXT_GRAPH_EDGES_V1", version: 1, edges: [{ from, to, relation }] }`.
  - `relation` must be one of `DEPENDS_ON`, `DOCUMENTS`, `IMPLEMENTS` or `TESTS`. It becomes `DECLARED:<relation>`.
  - Malformed JSON, a wrong kind or version, extra or missing fields, or an unknown relation fails the build.
- **Provenance:**
  - Every edge carries `{ kind: "AUTHORITATIVE_SOURCE", ref: "<file>@<snapshotRef>", digest }`, where the file is the source file or the edge file and the digest is that file's blob digest.
- **Identity:**
  - Nodes are sorted by id.
  - Edges are sorted by `from`, `to`, `relation` (then provenance ref) and deduplicated.
  - `graphId = sha256(canonical({ snapshotRef, roots, edgeFiles, nodes, edges }))`, where `edgeFiles` carries each edge file's ref and digest.
  - The same snapshot and inputs always produce the same `graphId`, node order and edge order. Any blob change changes the `graphId`.
- **Explicit exclusions:**
  - These produce no edge: dynamic `import()`, bare package specifiers (such as `node:path`), side-effect-only imports without `from`, symbol-level references and model-inferred relations.
  - Dynamic imports and bare specifiers are listed in `graph.limits` as `DYNAMIC_IMPORT` / `BARE_SPECIFIER` with file and specifier.

## Graph ref grammar

`parseContextGraphRef(ref)` accepts only this grammar:

```text
context-graph://<repositoryRef>/<IMPORTS|IMPORTED_BY>/<hops 1|2>/<anchorPath>
```

These cases throw a typed `ProviderFailure` with reason `UNSUPPORTED`: an unknown relation, hops outside `1..2`, a missing segment, a non-normalized anchor, a different scheme, or a repository the client does not serve. An anchor absent from the graph gives `MISSING` at traversal. There is no fuzzy or best-effort match. The graph query lives in the evidence source `ref`. It never uses provider, tool or operation fields in the `ContextRequirement`.

## Bounded traversal

- `IMPORTS` follows `IMPORTS`/`REEXPORTS` edges forward. `IMPORTED_BY` follows them backward.
- Declared edges are part of graph identity and provenance, but the v1 grammar does not traverse them.
- The client runs breadth-first from the anchor up to `hops` and returns one path per reachable node, ordered by (distance, node id).
- Each path is `{ ref: <node id>, content, provenance }`:
  - `content` is canonical JSON: `{ anchor, relation, distance, target, edges, truncated }`;
  - `provenance` lists the `AUTHORITATIVE_SOURCE` entry of every edge on the path.
- At most `maxItems` paths are returned. When more exist, the first `maxItems` are returned with `truncated: true`.
- The delivered planner reserves one item and up to 8,192 materialized bytes per `TRAVERSE_GRAPH` work. So through the facade a CONTEXT_GRAPH evidence currently yields its first path, with `truncated: true` when more exist. Content beyond the planner byte reservation or the requirement budget is rejected by the planner as `BUDGET_EXHAUSTED`.
- The semantic `need` text is not parsed.

## Currentness wiring

`createAuthoritativeGraphClient({ snapshotReader, repositoryRef, roots, edgeFiles, currentSnapshot })` selects the snapshot by mode:

- `EXACT` evidence uses `source.snapshot.ref`.
- `CURRENT` evidence uses `currentSnapshot()`.

The client builds the graph once per snapshot and reuses it in memory by `graphId`. It returns the validators `[REVISION = snapshotRef (STRONG), CONTENT_DIGEST = graphId (STRONG)]`. The graph never certifies itself as CURRENT. The composition registers a `CONTEXT_GRAPH` snapshot authority for the graph ref namespace, whose `observe()` reports the authoritative repository snapshot. Through the delivered catalog, planner and facade:

- If the graph snapshot equals the authoritative snapshot, the resolution is `COMPLETE` with both strong validators.
- If the graph was built at a different snapshot, the result is `STALE`, and REQUIRED evidence makes the resolution `UNSATISFIED`.
- If an authority reports no snapshot, the result is `CURRENTNESS_UNVERIFIABLE`, and REQUIRED evidence makes the resolution `UNSATISFIED`.
- If no `CONTEXT_GRAPH` authority is registered, the facade returns `UNSATISFIED` with `CURRENTNESS_UNVERIFIABLE` for the required evidence without throwing and before any graph client call, so zero provider retrieve calls happen for that evidence. The planner on its own reports `CURRENTNESS_UNVERIFIABLE`.
- A budget smaller than the empty-resolution materialization (for example a one-byte `maxMaterializedBytes`) yields `UNSATISFIED` with `BUDGET_EXHAUSTED` from the facade rather than a thrown `TypeError`. This underflow diagnostic is the single case where the returned resolution is not an ordinary contract resolution: its `consumed.materializedBytes` carries the exact empty-list materialization bytes, which exceed the tiny budget, so contract validation (`defineContextResolution` / `assertConsumableContextResolution`) rejects it and it is never consumable.

## Verification

- `node --test packages/oracle/test/context-graph.test.js` covers extraction, identity, declared edges, grammar, traversal, truncation and provenance with an in-memory exact-snapshot reader.
- `node --test test/oracle-context-graph-boundary.test.mjs` covers the composition through the delivered seam, catalog, planner and facade. It also builds a real git-backed snapshot of `packages/oracle/src` and `packages/agentic-system/src` at `HEAD`: the graph is deterministic, has no unprovenanced edge, and its `IMPORTED_BY` result for `context-contract.js` equals the set of files that literally import it.
- `npm run test:oracle` includes the unit test and the architecture guard, which pins the Oracle root export list.
