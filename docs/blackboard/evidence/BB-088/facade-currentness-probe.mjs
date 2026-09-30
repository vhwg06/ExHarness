// BB-088 research probe: CONTEXT_GRAPH currentness through the delivered provider seam,
// SourceCatalog, RetrievalPlanner and fixed facade. Fake graphClient only; no product edits.
// usage: node docs/blackboard/evidence/BB-088/facade-currentness-probe.mjs
import * as O from '../../../../packages/oracle/src/index.js';

const SNAP = 'snap-A';
const graphClient = (snapshotRef = SNAP) => ({
  async traverse({ source, maxItems }) {
    return {
      snapshotRef,
      validators: [{ kind: 'REVISION', value: snapshotRef, strength: 'STRONG' }, { kind: 'CONTENT_DIGEST', value: 'graph-digest', strength: 'STRONG' }],
      paths: [{ ref: 'a.js', content: '[{"from":"a.js","to":"b.js","relation":"IMPORTS"}]', provenance: [{ kind: 'AUTHORITATIVE_SOURCE', ref: `a.js@${snapshotRef}`, digest: 'd1' }] }].slice(0, maxItems)
    };
  }
});
const requirement = { consumerRef: 'bb088-probe', semanticNeed: 'importers', budget: { maxItems: 2, maxMaterializedBytes: 20000, maxProviderCalls: 1, maxResolutionSteps: 1 },
  evidence: [{ id: 'g1', necessity: 'REQUIRED', need: 'importers of a.js', source: { kind: 'CONTEXT_GRAPH', ref: 'context-graph://repo/IMPORTED_BY/1/a.js', snapshot: { mode: 'CURRENT' } }, requiredProvenance: [] }] };
const authority = observe => ({ sourceKind: 'CONTEXT_GRAPH', refPrefix: 'context-graph://repo/', observe });

async function run(name, { authorities, graphSnapshot = SNAP }) {
  const provider = O.createContextGraphProvider({ graphClient: graphClient(graphSnapshot) });
  let providerCalls = 0;
  const counted = { descriptor: provider.descriptor, retrieve: async w => { providerCalls++; return provider.retrieve(w); } };
  const catalog = O.createSourceCatalog({ providers: [counted], snapshotAuthorities: authorities });
  const retrievalPlanner = O.createRetrievalPlanner({ catalog });
  const facade = O.createOracleContextResolver({ sourceCatalog: catalog, retrievalPlanner });
  const out = { case: name };
  try {
    const { resolution } = await facade.resolve(requirement);
    Object.assign(out, { facade: 'RESOLVED', status: resolution.status, unresolved: resolution.unresolved.map(u => u.reason ?? u.status ?? u), validators: resolution.items.flatMap(i => (i.currentness?.validators ?? []).map(v => `${v.kind}:${v.strength}`)) });
  } catch (error) { Object.assign(out, { facade: 'THREW', errorName: error.name, message: error.message }); }
  out.facadeProviderCalls = providerCalls; providerCalls = 0;
  try {
    const executed = await retrievalPlanner.execute(O.defineContextRequirement(requirement), { remainingBudget: { ...requirement.budget }, existingEdges: [] });
    out.plannerOnly = { unresolved: executed.unresolved.map(u => u.reason), candidates: executed.candidates.length };
  } catch (error) { out.plannerOnly = { threw: error.name, message: error.message }; }
  out.plannerProviderCalls = providerCalls;
  return out;
}
const results = [
  await run('matching authoritative snapshot', { authorities: [authority(async () => ({ snapshotRef: SNAP }))] }),
  await run('authority reports a newer snapshot', { authorities: [authority(async () => ({ snapshotRef: 'snap-B' }))] }),
  await run('authority registered but reports no snapshot', { authorities: [authority(async () => null)] }),
  await run('no CONTEXT_GRAPH authority registered', { authorities: [] })
];
console.log(JSON.stringify({ probe: 'BB-088 facade currentness', results }, null, 2));
