// Planning-strategy parity and ordering tests (PL2).
// RRF_FUSION_V1 and GRAPH_EXPANDED_V1 delegate every reservation to the delivered
// DETERMINISTIC_V1 planner and validate every candidate through SourceCatalog.
// These tests prove reservation/budget/currentness/provenance parity plus the exact
// fusion ordering and single-hop expansion semantics, using in-memory fake providers.
import assert from 'node:assert/strict';
import test from 'node:test';
import { defineContextRequirement } from '../src/context-contract.js';
import { ProviderOperation } from '../src/provider-contract.js';
import { createSourceCatalog } from '../src/source-catalog.js';
import { createRetrievalPlanner } from '../src/retrieval-planner.js';
import { createContextGraphProvider } from '../src/providers/context-graph.js';
import { createAuthoritativeGraphClient } from '../src/context-graph.js';
import {
  createFusionRetrievalPlanner,
  createGraphExpandedRetrievalPlanner,
  PlanningStrategyId,
  RRF_K
} from '../src/planning-strategies.js';

const BUDGET = { maxItems: 4, maxProviderCalls: 4, maxMaterializedBytes: 20000, maxResolutionSteps: 1 };
const EXACT = { mode: 'EXACT', ref: 'rev-1' };

const repoRequirement = ({ snapshot = EXACT, budget = {} } = {}) => defineContextRequirement({
  consumerRef: 'strategy-test',
  semanticNeed: 'find files about the need',
  evidence: [{ id: 'e', necessity: 'REQUIRED', need: 'find files about the need', source: { kind: 'REPOSITORY', ref: 'repo', snapshot } }],
  budget: { ...BUDGET, ...budget }
});

const fakeRepoProvider = (providerId, operations, retrieve) => ({
  descriptor: {
    providerId,
    sourceKinds: ['REPOSITORY'],
    operations,
    snapshotModes: ['EXACT', 'CURRENT'],
    currentnessValidators: ['REVISION'],
    maxConcurrentCalls: 1,
    costClass: 'LOW'
  },
  retrieve
});

// Raw candidate shaped for validateCandidate: EXACT snapshot must equal the
// requirement snapshot ref unless the test overrides it.
const rawCandidate = (work, { itemRef, snapshotRef = EXACT.ref, content = `content of ${itemRef}`, provenance = [{ kind: 'SOURCE_REF', ref: `repo/${itemRef}` }] } = {}) => ({
  evidenceId: work.evidenceId,
  source: { kind: 'REPOSITORY', ref: 'repo', snapshotRef, itemRef },
  validators: [{ kind: 'REVISION', value: snapshotRef, strength: 'STRONG' }],
  provenance,
  content,
  providerEvidence: { providerId: work.providerId, operation: work.operation }
});

const returnsItems = (...items) => async work => items.map(item => typeof item === 'string' ? rawCandidate(work, { itemRef: item }) : rawCandidate(work, item));

// Catalog with symbol + lexical fakes; structural added only by tests that need a
// third reserved work unit (via the existingEdges plan option).
function symbolLexicalCatalog({ symbolRetrieve, lexicalRetrieve, symbolId = 'a-symbol', lexicalId = 'b-lexical' } = {}) {
  const calls = { symbol: 0, lexical: 0 };
  const catalog = createSourceCatalog({
    providers: [
      fakeRepoProvider(symbolId, [ProviderOperation.LOOKUP_SYMBOL], async work => { calls.symbol++; return symbolRetrieve(work); }),
      fakeRepoProvider(lexicalId, [ProviderOperation.SEARCH_LEXICAL], async work => { calls.lexical++; return lexicalRetrieve(work); })
    ]
  });
  return { catalog, calls };
}

function planners(catalog) {
  const base = createRetrievalPlanner({ catalog });
  return {
    base,
    rrf: createFusionRetrievalPlanner({ catalog, base }),
    graph: createGraphExpandedRetrievalPlanner({ catalog, base })
  };
}

test('plan() of RRF and GRAPH deep-equals DETERMINISTIC_V1 plan() for the same requirement and options', () => {
  const { catalog } = symbolLexicalCatalog({ symbolRetrieve: returnsItems('x.js'), lexicalRetrieve: returnsItems('y.js') });
  const { base, rrf, graph } = planners(catalog);
  assert.equal(rrf.strategyId, PlanningStrategyId.RRF_FUSION_V1);
  assert.equal(graph.strategyId, PlanningStrategyId.GRAPH_EXPANDED_V1);
  const requirement = repoRequirement();
  for (const options of [{}, { unavailableProviders: ['a-symbol'] }, { remainingBudget: { maxItems: 1 } }, { existingEdges: [] }]) {
    assert.deepEqual(rrf.plan(requirement, options), base.plan(requirement, options));
    assert.deepEqual(graph.plan(requirement, options), base.plan(requirement, options));
  }
  // Default base construction (no explicit base) reserves identically.
  assert.deepEqual(createFusionRetrievalPlanner({ catalog }).plan(requirement), base.plan(requirement));
  assert.deepEqual(createGraphExpandedRetrievalPlanner({ catalog }).plan(requirement), base.plan(requirement));
});

test('RRF runs every reserved work unit and fuses by sum 1/(60+rank) with itemRef tie-break', async () => {
  const calls = { symbol: 0, lexical: 0, structural: 0 };
  const catalog = createSourceCatalog({
    providers: [
      fakeRepoProvider('a-symbol', [ProviderOperation.LOOKUP_SYMBOL], async work => { calls.symbol++; return [rawCandidate(work, { itemRef: 'shared.js' })]; }),
      fakeRepoProvider('b-lexical', [ProviderOperation.SEARCH_LEXICAL], async work => { calls.lexical++; return [rawCandidate(work, { itemRef: 'solo.js' })]; }),
      fakeRepoProvider('c-structural', [ProviderOperation.STRUCTURAL_MAP], async work => { calls.structural++; return [rawCandidate(work, { itemRef: 'shared.js' })]; })
    ]
  });
  const { base, rrf } = planners(catalog);
  const requirement = repoRequirement();
  const options = { existingEdges: ['edge'] };
  assert.deepEqual(base.plan(requirement, options).work.map(w => w.operation),
    [ProviderOperation.LOOKUP_SYMBOL, ProviderOperation.SEARCH_LEXICAL, ProviderOperation.STRUCTURAL_MAP]);
  const baseResult = await base.execute(requirement, options);
  const rrfResult = await rrf.execute(requirement, options);
  // Base stops at the first successful provider; RRF runs every reserved unit.
  assert.equal(baseResult.candidates.length, 1);
  assert.deepEqual(calls, { symbol: 2, lexical: 1, structural: 1 });
  // shared.js is returned by two providers: score 1/(60+1) + 1/(60+1) beats the singleton.
  assert.deepEqual(rrfResult.candidates.map(c => c.source.itemRef), ['shared.js', 'solo.js']);
  assert.equal(rrfResult.candidates.length, 1 + 1);
  assert.ok(rrfResult.candidates.length <= rrfResult.planned.reserved.items);
  // Duplicates are merged: exactly one candidate per itemRef.
  assert.equal(new Set(rrfResult.candidates.map(c => c.source.itemRef)).size, rrfResult.candidates.length);
  const [first, second] = rrfResult.fusion[0].order;
  assert.equal(first.itemRef, 'shared.js');
  assert.deepEqual(first.providers, ['a-symbol', 'c-structural']);
  assert.equal(first.score, 1 / (RRF_K + 1) + 1 / (RRF_K + 1));
  assert.equal(second.itemRef, 'solo.js');
  assert.deepEqual(second.providers, ['b-lexical']);
  assert.ok(first.score > second.score);
  assert.equal(rrfResult.strategyId, PlanningStrategyId.RRF_FUSION_V1);
});

test('RRF breaks equal fusion scores by itemRef ascending', async () => {
  const { catalog } = symbolLexicalCatalog({ symbolRetrieve: returnsItems('b.js'), lexicalRetrieve: returnsItems('a.js') });
  const { rrf } = planners(catalog);
  const result = await rrf.execute(repoRequirement());
  // Both singletons score 1/61; ascending itemRef wins.
  assert.deepEqual(result.candidates.map(c => c.source.itemRef), ['a.js', 'b.js']);
});

test('provider returning more items than reserved fails BUDGET_EXHAUSTED in base and both strategies', async () => {
  const greedy = async work => [rawCandidate(work, { itemRef: 'one.js' }), rawCandidate(work, { itemRef: 'two.js' })];
  const { catalog } = symbolLexicalCatalog({ symbolRetrieve: greedy, lexicalRetrieve: greedy });
  const { base, rrf, graph } = planners(catalog);
  const requirement = repoRequirement();
  const baseResult = await base.execute(requirement);
  const rrfResult = await rrf.execute(requirement);
  const graphResult = await graph.execute(requirement);
  for (const result of [baseResult, rrfResult, graphResult]) {
    assert.equal(result.candidates.length, 0);
    assert.deepEqual(result.unresolved, [{ evidenceId: 'e', reason: 'BUDGET_EXHAUSTED' }]);
    assert.ok(result.failures.length > 0);
    assert.ok(result.failures.every(f => f.reason === 'BUDGET_EXHAUSTED'));
  }
  assert.deepEqual(rrfResult.unresolved, baseResult.unresolved);
  assert.deepEqual(graphResult.unresolved, baseResult.unresolved);
});

test('tiny maxMaterializedBytes gives identical unresolved reasons in all three planners', async () => {
  const big = async work => [rawCandidate(work, { itemRef: 'big.js', content: 'x'.repeat(200) })];
  const { catalog } = symbolLexicalCatalog({ symbolRetrieve: big, lexicalRetrieve: big });
  const { base, rrf, graph } = planners(catalog);
  const requirement = repoRequirement({ budget: { maxMaterializedBytes: 16 } });
  const baseResult = await base.execute(requirement);
  const rrfResult = await rrf.execute(requirement);
  const graphResult = await graph.execute(requirement);
  assert.deepEqual(baseResult.unresolved, [{ evidenceId: 'e', reason: 'BUDGET_EXHAUSTED' }]);
  assert.deepEqual(rrfResult.unresolved, baseResult.unresolved);
  assert.deepEqual(graphResult.unresolved, baseResult.unresolved);
});

test('CURRENT evidence with a stale snapshot authority is STALE in all three planners', async () => {
  const stale = async work => [rawCandidate(work, { itemRef: 'old.js', snapshotRef: 'snap-0' })];
  const { catalog } = symbolLexicalCatalog({ symbolRetrieve: stale, lexicalRetrieve: stale });
  catalog.registerSnapshotAuthority({ sourceKind: 'REPOSITORY', refPrefix: 'repo', observe: async () => ({ snapshotRef: 'snap-1' }) });
  const { base, rrf, graph } = planners(catalog);
  const requirement = repoRequirement({ snapshot: { mode: 'CURRENT' } });
  const baseResult = await base.execute(requirement);
  const rrfResult = await rrf.execute(requirement);
  const graphResult = await graph.execute(requirement);
  assert.deepEqual(baseResult.unresolved, [{ evidenceId: 'e', reason: 'STALE' }]);
  assert.deepEqual(rrfResult.unresolved, baseResult.unresolved);
  assert.deepEqual(graphResult.unresolved, baseResult.unresolved);
});

test('CURRENT evidence with no authority is CURRENTNESS_UNVERIFIABLE in all three planners', async () => {
  const fresh = async work => [rawCandidate(work, { itemRef: 'new.js', snapshotRef: 'snap-9' })];
  const { catalog } = symbolLexicalCatalog({ symbolRetrieve: fresh, lexicalRetrieve: fresh });
  const { base, rrf, graph } = planners(catalog);
  const requirement = repoRequirement({ snapshot: { mode: 'CURRENT' } });
  const baseResult = await base.execute(requirement);
  assert.deepEqual(baseResult.unresolved, [{ evidenceId: 'e', reason: 'CURRENTNESS_UNVERIFIABLE' }]);
  assert.deepEqual((await rrf.execute(requirement)).unresolved, baseResult.unresolved);
  assert.deepEqual((await graph.execute(requirement)).unresolved, baseResult.unresolved);
});

test('EXACT snapshot mismatch candidate is rejected identically in all three planners', async () => {
  const wrong = async work => [rawCandidate(work, { itemRef: 'other.js', snapshotRef: 'rev-2' })];
  const { catalog } = symbolLexicalCatalog({ symbolRetrieve: wrong, lexicalRetrieve: wrong });
  const { base, rrf, graph } = planners(catalog);
  const requirement = repoRequirement();
  const baseResult = await base.execute(requirement);
  assert.deepEqual(baseResult.unresolved, [{ evidenceId: 'e', reason: 'SOURCE_FAILURE' }]);
  assert.deepEqual((await rrf.execute(requirement)).unresolved, baseResult.unresolved);
  assert.deepEqual((await graph.execute(requirement)).unresolved, baseResult.unresolved);
});

// In-memory snapshot reader with two tiny files where a.js imports ./b.js.
const memorySnapshots = {
  'snap-1': {
    'src/a.js': "import { b } from './b.js';\nexport const a = b;\n",
    'src/b.js': 'export const b = 1;\n'
  }
};
const memoryReader = {
  async listFiles({ revision, roots }) {
    return Object.keys(memorySnapshots[revision] ?? {}).filter(file => (roots ?? []).some(root => file === root || file.startsWith(`${root}/`)));
  },
  async readFile({ revision, path: file }) {
    const content = (memorySnapshots[revision] ?? {})[file];
    if (content === undefined) throw new Error(`missing ${file}@${revision}`);
    return { content, sourceRef: `${file}@${revision}` };
  }
};

function graphCatalog() {
  const graphClient = createAuthoritativeGraphClient({ snapshotReader: memoryReader, repositoryRef: 'exharness', roots: ['src'] });
  const catalog = createSourceCatalog({
    providers: [
      fakeRepoProvider('a-symbol', [ProviderOperation.LOOKUP_SYMBOL], async () => []),
      fakeRepoProvider('b-lexical', [ProviderOperation.SEARCH_LEXICAL], async work =>
        [{ ...rawCandidate(work, { itemRef: 'src/a.js', snapshotRef: 'snap-1' }), source: { kind: 'REPOSITORY', ref: 'exharness', snapshotRef: 'snap-1', itemRef: 'src/a.js' }, provenance: [{ kind: 'SOURCE_REF', ref: 'src/a.js@snap-1' }] }]),
      createContextGraphProvider({ graphClient })
    ]
  });
  return catalog;
}

const graphRequirement = () => defineContextRequirement({
  consumerRef: 'graph-test',
  semanticNeed: 'files importing the anchor',
  evidence: [{ id: 'e', necessity: 'REQUIRED', need: 'files importing the anchor', source: { kind: 'REPOSITORY', ref: 'exharness', snapshot: { mode: 'EXACT', ref: 'snap-1' } } }],
  budget: { maxItems: 3, maxProviderCalls: 3, maxMaterializedBytes: 20000, maxResolutionSteps: 1 }
});

test('candidates keep provider provenance and graph-derived items carry AUTHORITATIVE_SOURCE', async () => {
  const catalog = graphCatalog();
  const base = createRetrievalPlanner({ catalog });
  const graph = createGraphExpandedRetrievalPlanner({ catalog, base, repositoryRef: 'exharness' });
  const baseResult = await base.execute(graphRequirement());
  assert.equal(baseResult.candidates.length, 1);
  assert.deepEqual(baseResult.candidates[0].provenance, [{ kind: 'SOURCE_REF', ref: 'src/a.js@snap-1' }]);
  const result = await graph.execute(graphRequirement());
  assert.equal(result.candidates.length, 2);
  const [kept, derived] = result.candidates;
  assert.deepEqual(kept, baseResult.candidates[0]);
  assert.equal(derived.source.kind, 'CONTEXT_GRAPH');
  assert.equal(derived.source.itemRef, 'src/b.js');
  assert.ok(derived.provenance.length > 0);
  assert.ok(derived.provenance.every(entry => entry.kind === 'AUTHORITATIVE_SOURCE'));
});

test('GRAPH adds exactly one IMPORTS hop anchored at the top base candidate when budget remains', async () => {
  const catalog = graphCatalog();
  const base = createRetrievalPlanner({ catalog });
  const graph = createGraphExpandedRetrievalPlanner({ catalog, base, repositoryRef: 'exharness' });
  const requirement = graphRequirement();
  const baseResult = await base.execute(requirement);
  const result = await graph.execute(requirement);
  assert.equal(result.strategyId, PlanningStrategyId.GRAPH_EXPANDED_V1);
  assert.equal(result.expansions.length, 1);
  const [expansion] = result.expansions;
  assert.equal(expansion.status, 'EXPANDED');
  assert.equal(expansion.anchor, baseResult.candidates[0].source.itemRef);
  assert.match(expansion.work.sourceConstraint.ref, /\/IMPORTS\/1\//);
  assert.deepEqual(expansion.added, ['src/b.js']);
  // Base candidates are unchanged and come first.
  assert.deepEqual(result.candidates.slice(0, baseResult.candidates.length), baseResult.candidates);
});

test('GRAPH skips with BUDGET_EXHAUSTED when no unreserved budget remains', async () => {
  const catalog = graphCatalog();
  const base = createRetrievalPlanner({ catalog });
  const graph = createGraphExpandedRetrievalPlanner({ catalog, base, repositoryRef: 'exharness' });
  const requirement = defineContextRequirement({
    consumerRef: 'graph-test',
    semanticNeed: 'files importing the anchor',
    evidence: [{ id: 'e', necessity: 'REQUIRED', need: 'files importing the anchor', source: { kind: 'REPOSITORY', ref: 'exharness', snapshot: { mode: 'EXACT', ref: 'snap-1' } } }],
    budget: { maxItems: 2, maxProviderCalls: 2, maxMaterializedBytes: 20000, maxResolutionSteps: 1 }
  });
  const baseResult = await base.execute(requirement);
  assert.equal(baseResult.candidates.length, 1);
  const result = await graph.execute(requirement);
  assert.deepEqual(result.expansions, [{ evidenceId: 'e', status: 'SKIPPED', reason: 'BUDGET_EXHAUSTED' }]);
  assert.deepEqual(result.candidates, baseResult.candidates);
});

test('GRAPH skips with NO_GRAPH_PROVIDER when no graph provider is registered', async () => {
  const { catalog } = symbolLexicalCatalog({ symbolRetrieve: async () => [], lexicalRetrieve: returnsItems('only.js') });
  const base = createRetrievalPlanner({ catalog });
  const graph = createGraphExpandedRetrievalPlanner({ catalog, base });
  const baseResult = await base.execute(repoRequirement());
  const result = await graph.execute(repoRequirement());
  assert.deepEqual(result.expansions, [{ status: 'SKIPPED', reason: 'NO_GRAPH_PROVIDER' }]);
  assert.deepEqual(result.candidates, baseResult.candidates);
});

test('default createRetrievalPlanner still stops at the first successful provider', async () => {
  const { catalog, calls } = symbolLexicalCatalog({ symbolRetrieve: returnsItems('first.js'), lexicalRetrieve: returnsItems('second.js') });
  const base = createRetrievalPlanner({ catalog });
  const result = await base.execute(repoRequirement());
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].source.itemRef, 'first.js');
  assert.deepEqual(calls, { symbol: 1, lexical: 0 });
  assert.deepEqual(result.unresolved, []);
});
