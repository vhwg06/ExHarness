#!/usr/bin/env node
// BB-107 plan-defect probe (research only, hermetic, no product edits).
// Demonstrates on current main that the READY plan's D2 reservation rule starves the
// delivered GRAPH_EXPANDED_V1 expansion, contradicting two pinned planning-strategies
// tests, and proves a corrected remaining-budget rule with a pure simulation.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as O from '../../../../packages/oracle/src/index.js';
import { ProviderOperation } from '../../../../packages/oracle/src/provider-contract.js';
import { contextItemDigest } from '../../../../packages/oracle/src/context-contract.js';
import { createAuthoritativeGraphClient } from '../../../../packages/oracle/src/context-graph.js';
import { createContextGraphProvider } from '../../../../packages/oracle/src/providers/context-graph.js';
import { createGraphExpandedRetrievalPlanner } from '../../../../packages/oracle/src/planning-strategies.js';

const here = path.dirname(fileURLToPath(import.meta.url));

// ---- Fixtures mirroring packages/oracle/test/planning-strategies.test.js ----
const memorySnapshots = {
  'snap-1': {
    'src/a.js': "import { b } from './b.js';\nexport const a = b;\n",
    'src/b.js': 'export const b = 1;\n'
  }
};
const memoryReader = {
  async listFiles({ revision, roots }) {
    return Object.keys(memorySnapshots[revision] ?? {}).filter((f) => (roots ?? []).some((r) => f === r || f.startsWith(`${r}/`)));
  },
  async readFile({ revision, path: file }) {
    const content = (memorySnapshots[revision] ?? {})[file];
    if (content === undefined) throw new Error(`missing ${file}@${revision}`);
    return { content, sourceRef: `${file}@${revision}` };
  }
};
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
const rawCandidate = (work, { itemRef, snapshotRef = 'snap-1' }) => ({
  evidenceId: work.evidenceId,
  source: { kind: 'REPOSITORY', ref: 'exharness', snapshotRef, itemRef },
  validators: [{ kind: 'REVISION', value: snapshotRef, strength: 'STRONG' }],
  provenance: [{ kind: 'SOURCE_REF', ref: `${itemRef}@snap-1` }],
  content: `content of ${itemRef}`,
  providerEvidence: { providerId: work.providerId, operation: work.operation }
});
function graphCatalog() {
  const graphClient = createAuthoritativeGraphClient({ snapshotReader: memoryReader, repositoryRef: 'exharness', roots: ['src'] });
  return O.createSourceCatalog({
    providers: [
      fakeRepoProvider('a-symbol', [ProviderOperation.LOOKUP_SYMBOL], async () => []),
      fakeRepoProvider('b-lexical', [ProviderOperation.SEARCH_LEXICAL], async (work) => [{
        ...rawCandidate(work, { itemRef: 'src/a.js' }),
        source: { kind: 'REPOSITORY', ref: 'exharness', snapshotRef: 'snap-1', itemRef: 'src/a.js' },
        provenance: [{ kind: 'SOURCE_REF', ref: 'src/a.js@snap-1' }]
      }]),
      createContextGraphProvider({ graphClient })
    ]
  });
}
const GRAPH_BUDGET = { maxItems: 3, maxProviderCalls: 3, maxMaterializedBytes: 20000, maxResolutionSteps: 1 };
const graphRequirement = () => O.defineContextRequirement({
  consumerRef: 'graph-test',
  semanticNeed: 'files importing the anchor',
  evidence: [{ id: 'e', necessity: 'REQUIRED', need: 'files importing the anchor', source: { kind: 'REPOSITORY', ref: 'exharness', snapshot: { mode: 'EXACT', ref: 'snap-1' } } }],
  budget: { ...GRAPH_BUDGET }
});
const materializedBytesOf = (candidate) => {
  const item = {
    evidenceId: candidate.evidenceId,
    rank: 0,
    source: candidate.source,
    currentness: { validators: candidate.validators },
    provenance: candidate.provenance,
    content: candidate.content
  };
  return Buffer.byteLength(JSON.stringify({ ...item, itemDigest: contextItemDigest(item) }), 'utf8') + 2;
};

// ---- A. Delivered baseline on current main ----
const catalog = graphCatalog();
const base = O.createRetrievalPlanner({ catalog });
const planned = base.plan(graphRequirement());
const deliveredReserved = { ...planned.reserved };
const deliveredWork = planned.work.map((w) => ({ operation: w.operation, reservedBudget: { ...w.reservedBudget } }));
const deliveredFree = {
  providerCalls: GRAPH_BUDGET.maxProviderCalls - deliveredReserved.providerCalls,
  items: GRAPH_BUDGET.maxItems - deliveredReserved.items,
  materializedBytes: GRAPH_BUDGET.maxMaterializedBytes - deliveredReserved.materializedBytes
};
const deliveredGraphBytes = Math.min(8192, deliveredFree.materializedBytes);
const baseResult = await base.execute(graphRequirement());
const baseCandidateBytes = baseResult.candidates.map(materializedBytesOf);
const graph = createGraphExpandedRetrievalPlanner({ catalog, base, repositoryRef: 'exharness' });
const graphResult = await graph.execute(graphRequirement());
const derivedBytes = graphResult.candidates.length > 1 ? materializedBytesOf(graphResult.candidates[1]) : null;

// RP1 baseline: single 9000-byte READ_EXACT under 40000 reserves 8192 on main.
const SNAP = 'rev-1';
const content9k = 'x'.repeat(9000);
const rp1Budget = { maxItems: 4, maxMaterializedBytes: 40000, maxProviderCalls: 4, maxResolutionSteps: 1 };
const rp1Requirement = {
  consumerRef: 'bb107', semanticNeed: 'file', budget: rp1Budget,
  evidence: [{ id: 'e1', necessity: 'REQUIRED', need: 'file', source: { kind: 'REPOSITORY', ref: 'repo', snapshot: { mode: 'EXACT', ref: SNAP }, itemRefs: ['big.js'] } }]
};
const rp1Catalog = O.createSourceCatalog({
  providers: [O.createExactRepositoryProvider({
    repositoryReader: { async readFile({ path: p }) { return { path: p, content: content9k, sourceRef: `repo@${SNAP}:${p}` }; } }
  })],
  snapshotAuthorities: [{ sourceKind: 'REPOSITORY', refPrefix: 'repo', observe: async () => ({ snapshotRef: SNAP }) }]
});
const rp1Planner = O.createRetrievalPlanner({ catalog: rp1Catalog });
const rp1Planned = rp1Planner.plan(rp1Requirement);
const rp1ReservedBytes = rp1Planned.work[0]?.reservedBudget.materializedBytes ?? null;
const rp1Executed = await rp1Planner.execute(rp1Requirement);
const rp1NeededBytes = rp1Executed.candidates.length
  ? materializedBytesOf({ ...rp1Executed.candidates[0], evidenceId: 'e1' })
  : null;
// Measure actual materialized size of the 9k file deterministically (same formula execute() uses).
const rp1ProbeItem = {
  evidenceId: 'e1', rank: 0,
  source: { kind: 'REPOSITORY', ref: 'repo', snapshotRef: SNAP, itemRef: 'big.js' },
  currentness: { validators: [{ kind: 'REVISION', value: SNAP, strength: 'STRONG' }] },
  provenance: [{ kind: 'SOURCE_REF', ref: `repo@${SNAP}:big.js` }],
  content: content9k
};
const rp1MaterializedNeed = Buffer.byteLength(JSON.stringify({ ...rp1ProbeItem, itemDigest: contextItemDigest(rp1ProbeItem) }), 'utf8') + 2;

// ---- B. Pure simulation of the plan's D2 rule (no product edit) ----
// Worker D2: READ_EXACT bytes=floor(remBytes/remRefs); TRAVERSE/FETCH all remaining;
// REPOSITORY LOOKUP/SEARCH/STRUCTURAL bytes=floor(remBytes/remOps for that evidence).
function simulateD2({ budget, ops }) {
  // ops: array of {kind:'READ_EXACT'|'REPO'|'TRAVERSE', remainingRefs?, remainingOps?}
  let reservedCalls = 0, reservedItems = 0, reservedBytes = 0;
  const works = [];
  for (const op of ops) {
    const remBytes = budget.maxMaterializedBytes - reservedBytes;
    const remItems = budget.maxItems - reservedItems;
    if (reservedCalls >= budget.maxProviderCalls || remItems < 1 || remBytes < 1) return { works, reserved: { reservedCalls, reservedItems, reservedBytes }, starved: true };
    let items, bytes;
    if (op.kind === 'READ_EXACT') {
      items = 1; bytes = Math.max(1, Math.floor(remBytes / Math.max(1, op.remainingRefs ?? 1)));
    } else if (op.kind === 'TRAVERSE') {
      items = Math.max(1, remItems); bytes = remBytes;
    } else {
      items = 1; bytes = Math.max(1, Math.floor(remBytes / Math.max(1, op.remainingOps ?? 1)));
    }
    if (items > remItems) return { works, reserved: { reservedCalls, reservedItems, reservedBytes }, starved: true };
    reservedCalls += 1; reservedItems += items; reservedBytes += bytes;
    works.push({ kind: op.kind, items, bytes });
  }
  return { works, reserved: { reservedCalls, reservedItems, reservedBytes }, starved: false };
}
// Graph scenario under D2: REPOSITORY evidence with 2 ops (LOOKUP remOps 2, SEARCH remOps 1).
const d2Graph = simulateD2({ budget: GRAPH_BUDGET, ops: [{ kind: 'REPO', remainingOps: 2 }, { kind: 'REPO', remainingOps: 1 }] });
const d2Free = {
  providerCalls: GRAPH_BUDGET.maxProviderCalls - d2Graph.reserved.reservedCalls,
  items: GRAPH_BUDGET.maxItems - d2Graph.reserved.reservedItems,
  materializedBytes: GRAPH_BUDGET.maxMaterializedBytes - d2Graph.reserved.reservedBytes
};
const d2GraphBytes = Math.min(8192, d2Free.materializedBytes);
const d2Expansion = (d2Free.providerCalls >= 1 && d2Free.items >= 1 && d2GraphBytes >= 1) ? 'EXPANDED' : 'SKIPPED(BUDGET_EXHAUSTED)';
// RP1 under D2: single READ_EXACT ref gets all remaining bytes.
const d2Rp1 = simulateD2({ budget: rp1Budget, ops: [{ kind: 'READ_EXACT', remainingRefs: 1 }] });

// ---- C. Pure simulation of the corrected rule (no product edit) ----
// Corrected: READ_EXACT bytes=floor(remBytes/remRefs) [unchanged];
// REPOSITORY LOOKUP/SEARCH/STRUCTURAL items=1, bytes=floor(remBytes/remCalls) where
// remCalls = remaining.maxProviderCalls - reserved.providerCalls (fair share across
// remaining provider calls, leaving one call-share for GRAPH when budget has headroom);
// TRAVERSE_GRAPH/FETCH_EXTERNAL items=remItems, bytes=remBytes [unchanged].
// Every magnitude is a share of the remaining budget; no 8192 constant anywhere.
function simulateCorrected({ budget, ops }) {
  let reservedCalls = 0, reservedItems = 0, reservedBytes = 0;
  const works = [];
  for (const op of ops) {
    const remBytes = budget.maxMaterializedBytes - reservedBytes;
    const remItems = budget.maxItems - reservedItems;
    const remCalls = budget.maxProviderCalls - reservedCalls;
    if (remCalls < 1 || remItems < 1 || remBytes < 1) return { works, reserved: { reservedCalls, reservedItems, reservedBytes }, starved: true };
    let items, bytes;
    if (op.kind === 'READ_EXACT') {
      items = 1; bytes = Math.max(1, Math.floor(remBytes / Math.max(1, op.remainingRefs ?? 1)));
    } else if (op.kind === 'TRAVERSE') {
      items = Math.max(1, remItems); bytes = remBytes;
    } else {
      items = 1; bytes = Math.max(1, Math.floor(remBytes / Math.max(1, remCalls)));
    }
    if (items > remItems) return { works, reserved: { reservedCalls, reservedItems, reservedBytes }, starved: true };
    reservedCalls += 1; reservedItems += items; reservedBytes += bytes;
    works.push({ kind: op.kind, items, bytes });
  }
  return { works, reserved: { reservedCalls, reservedItems, reservedBytes }, starved: false };
}
const fixedGraph = simulateCorrected({ budget: GRAPH_BUDGET, ops: [{ kind: 'REPO' }, { kind: 'REPO' }] });
const fixedFree = {
  providerCalls: GRAPH_BUDGET.maxProviderCalls - fixedGraph.reserved.reservedCalls,
  items: GRAPH_BUDGET.maxItems - fixedGraph.reserved.reservedItems,
  materializedBytes: GRAPH_BUDGET.maxMaterializedBytes - fixedGraph.reserved.reservedBytes
};
const fixedGraphBytes = Math.min(8192, fixedFree.materializedBytes);
const fixedExpansion = (fixedFree.providerCalls >= 1 && fixedFree.items >= 1 && fixedGraphBytes >= 1) ? 'EXPANDED' : 'SKIPPED(BUDGET_EXHAUSTED)';
const fixedRp1 = simulateCorrected({ budget: rp1Budget, ops: [{ kind: 'READ_EXACT', remainingRefs: 1 }] });
const fixedOversize = simulateCorrected({
  budget: { maxItems: 4, maxMaterializedBytes: 100, maxProviderCalls: 4, maxResolutionSteps: 1 },
  ops: [{ kind: 'READ_EXACT', remainingRefs: 1 }]
});
// Guard: tight budget (maxItems 2, maxProviderCalls 2) must still SKIP expansion.
const TIGHT = { maxItems: 2, maxProviderCalls: 2, maxMaterializedBytes: 20000, maxResolutionSteps: 1 };
const fixedTight = simulateCorrected({ budget: TIGHT, ops: [{ kind: 'REPO' }, { kind: 'REPO' }] });
const fixedTightFree = {
  providerCalls: TIGHT.maxProviderCalls - fixedTight.reserved.reservedCalls,
  items: TIGHT.maxItems - fixedTight.reserved.reservedItems,
  materializedBytes: TIGHT.maxMaterializedBytes - fixedTight.reserved.reservedBytes
};
const fixedTightExpansion = (fixedTightFree.providerCalls >= 1 && fixedTightFree.items >= 1 && Math.min(8192, fixedTightFree.materializedBytes) >= 1)
  ? 'EXPANDED'
  : 'SKIPPED(BUDGET_EXHAUSTED)';
// Guard: CG3 TRAVERSE single work keeps all remaining items/bytes.
const CG3BUDGET = { maxItems: 4, maxMaterializedBytes: 20000, maxProviderCalls: 1, maxResolutionSteps: 1 };
const fixedCg3 = simulateCorrected({ budget: CG3BUDGET, ops: [{ kind: 'TRAVERSE' }] });

const PINNED = [
  'candidates keep provider provenance and graph-derived items carry AUTHORITATIVE_SOURCE',
  'GRAPH adds exactly one IMPORTS hop anchored at the top base candidate when budget remains'
];
const result = {
  kind: 'BB107_PLAN_DEFECT_PROBE_RESULT',
  version: 1,
  pinnedTestFile: 'packages/oracle/test/planning-strategies.test.js',
  pinnedFailingTitles: PINNED,
  deliveredBaseline: {
    baseReserved: deliveredReserved,
    baseWork: deliveredWork,
    unreservedFree: deliveredFree,
    graphExpansionReservationBytes: deliveredGraphBytes,
    baseCandidateCount: baseResult.candidates.length,
    baseCandidateBytes,
    graphCandidateCount: graphResult.candidates.length,
    graphExpansionStatus: graphResult.expansions[0]?.status ?? null,
    derivedCandidateBytes: derivedBytes
  },
  rp1Baseline: {
    budget: rp1Budget,
    reservedBytes: rp1ReservedBytes,
    materializedNeedBytes: rp1MaterializedNeed,
    reservedCoversNeed: rp1ReservedBytes !== null && rp1ReservedBytes >= rp1MaterializedNeed,
    executeUnresolved: rp1Executed.unresolved,
    defectPresent: rp1ReservedBytes === 8192 && rp1Executed.unresolved[0]?.reason === 'BUDGET_EXHAUSTED'
  },
  d2Simulation: {
    rule: 'READ_EXACT floor(remBytes/remRefs); REPO floor(remBytes/remOps-per-evidence) items=1; TRAVERSE all-remaining',
    graphWorks: d2Graph.works,
    graphReserved: d2Graph.reserved,
    unreservedFree: d2Free,
    graphExpansionReservationBytes: d2GraphBytes,
    predictedExpansion: d2Expansion,
    predictedGraphCandidates: d2Expansion.startsWith('EXPANDED') ? 2 : 1,
    contradicts: [
      { title: PINNED[0], expected: 'result.candidates.length === 2', underD2: 'result.candidates.length === 1' },
      { title: PINNED[1], expected: "expansion.status === 'EXPANDED'", underD2: "expansion.status === 'SKIPPED' (BUDGET_EXHAUSTED)" }
    ],
    starvesGraph: d2Free.materializedBytes === 0,
    rp1Works: d2Rp1.works
  },
  correctedRule: {
    rule: 'READ_EXACT items=1 bytes=floor(remBytes/remRefs); REPO items=1 bytes=floor(remBytes/remCalls) with remCalls=remaining.maxProviderCalls-reserved.providerCalls; TRAVERSE items=remItems bytes=remBytes; no 8192 constant',
    graphWorks: fixedGraph.works,
    graphReserved: fixedGraph.reserved,
    unreservedFree: fixedFree,
    graphExpansionReservationBytes: fixedGraphBytes,
    predictedExpansion: fixedExpansion,
    baseCandidateFits: baseCandidateBytes.every((b) => b <= Math.min(...fixedGraph.works.map((w) => w.bytes))),
    derivedCandidateFits: derivedBytes !== null && derivedBytes <= fixedGraphBytes,
    rp1Works: fixedRp1.works,
    rp1CoversNeed: fixedRp1.works[0]?.bytes >= rp1MaterializedNeed,
    oversizeWorks: fixedOversize.works,
    oversizeStaysExhausted: fixedOversize.works[0]?.bytes < rp1MaterializedNeed,
    tightBudgetPredictedExpansion: fixedTightExpansion,
    tightBudgetStillSkips: fixedTightExpansion.startsWith('SKIPPED'),
    cg3TraverseWorks: fixedCg3.works,
    cg3KeepsBothPaths: fixedCg3.works[0]?.items === 4 && fixedCg3.works[0]?.bytes === 20000
  },
  verdict: {
    defectReproduced: d2Free.materializedBytes === 0 && !d2Expansion.startsWith('EXPANDED'),
    correctedKeepsGraph: fixedExpansion === 'EXPANDED' && derivedBytes !== null && derivedBytes <= fixedGraphBytes,
    correctedKeepsRp1: fixedRp1.works[0]?.bytes >= rp1MaterializedNeed,
    correctedKeepsOversizeFailClosed: fixedOversize.works[0]?.bytes < rp1MaterializedNeed,
    correctedKeepsTightSkip: fixedTightExpansion.startsWith('SKIPPED'),
    correctedKeepsCg3: fixedCg3.works[0]?.items === 4
  }
};
fs.writeFileSync(path.join(here, 'plan-defect-probe-result.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({
  deliveredFree,
  deliveredExpansion: graphResult.expansions[0]?.status,
  d2Free,
  d2Expansion,
  fixedFree,
  fixedExpansion,
  rp1ReservedBytes,
  rp1MaterializedNeed,
  verdict: result.verdict
}));
