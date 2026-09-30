#!/usr/bin/env node
// Credential-free probe: facade throws TypeError for missing graph authority and 1-byte budget.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as O from '../../../../packages/oracle/src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = 'exharness';
const FILES = { 'src/a.js': "import { b } from './b.js';\nexport const a = b;\n", 'src/b.js': "export const b = 1;\n" };
const reader = { async listFiles() { return Object.keys(FILES); }, async readFile({ path: f }) { return { content: FILES[f], sourceRef: `${f}@snap-1` }; } };
const graphRef = `context-graph://${REPO}/IMPORTED_BY/1/src/b.js`;
const graphReq = {
  consumerRef: 'bb108', semanticNeed: 'importers',
  budget: { maxItems: 4, maxMaterializedBytes: 20000, maxProviderCalls: 1, maxResolutionSteps: 1 },
  evidence: [{ id: 'importers', necessity: 'REQUIRED', need: 'importers', source: { kind: 'CONTEXT_GRAPH', ref: graphRef, snapshot: { mode: 'CURRENT' } } }]
};
const graphClient = O.createAuthoritativeGraphClient({ snapshotReader: reader, repositoryRef: REPO, roots: ['src'], currentSnapshot: async () => 'snap-1' });
const catalogNoAuth = O.createSourceCatalog({ providers: [O.createContextGraphProvider({ graphClient })], snapshotAuthorities: [] });
const planner = O.createRetrievalPlanner({ catalog: catalogNoAuth });
const executed = await planner.execute(O.defineContextRequirement(graphReq));
const facade = O.createOracleContextResolver({ sourceCatalog: catalogNoAuth, retrievalPlanner: planner });
let missingAuth = null;
try { await facade.resolve(graphReq); missingAuth = { outcome: 'RESOLVED' }; }
catch (e) { missingAuth = { outcome: 'THROWN', name: e.name, message: e.message, isTypeError: e instanceof TypeError }; }
const SNAP = 'rev-1';
const tinyCatalog = O.createSourceCatalog({
  providers: [O.createExactRepositoryProvider({ repositoryReader: { async readFile({ path: p }) { return { path: p, content: 'hi', sourceRef: `repo@${SNAP}:${p}` }; } } })],
  snapshotAuthorities: [{ sourceKind: 'REPOSITORY', refPrefix: 'repo', observe: async () => ({ snapshotRef: SNAP }) }]
});
const tinyPlanner = O.createRetrievalPlanner({ catalog: tinyCatalog });
const tinyReq = {
  consumerRef: 'bb108-tiny', semanticNeed: 'file',
  budget: { maxItems: 1, maxMaterializedBytes: 1, maxProviderCalls: 1, maxResolutionSteps: 1 },
  evidence: [{ id: 'e1', necessity: 'REQUIRED', need: 'file', source: { kind: 'REPOSITORY', ref: 'repo', snapshot: { mode: 'EXACT', ref: SNAP }, itemRefs: ['a.js'] } }]
};
const tinyFacade = O.createOracleContextResolver({ sourceCatalog: tinyCatalog, retrievalPlanner: tinyPlanner });
let tiny = null;
try { const out = await tinyFacade.resolve(tinyReq); tiny = { outcome: 'RESOLVED', status: out.resolution.status, unresolved: out.resolution.unresolved }; }
catch (e) { tiny = { outcome: 'THROWN', name: e.name, message: e.message, isTypeError: e instanceof TypeError }; }
const result = {
  kind: 'BB108_FACADE_THROW_PROBE_RESULT',
  version: 1,
  missingAuthority: { facade: missingAuth, plannerUnresolved: executed.unresolved, plannerFailures: executed.failures, plannerCandidates: executed.candidates.length },
  tinyBudget: tiny,
  defectMissingAuthorityThrowsTypeError: missingAuth.outcome === 'THROWN' && missingAuth.isTypeError === true && /missing\/ambiguous snapshot authority/.test(missingAuth.message),
  defectTinyBudgetThrowsConsumedBelow: tiny.outcome === 'THROWN' && tiny.isTypeError === true && tiny.message === 'consumed below materialization/step',
  plannerReportsCurrentnessUnverifiable: executed.unresolved.some((u) => u.reason === 'CURRENTNESS_UNVERIFIABLE')
};
fs.writeFileSync(path.join(here, 'facade-throw-probe-result.json'), JSON.stringify(result) + '\n');
console.log(JSON.stringify({ missingAuth: result.defectMissingAuthorityThrowsTypeError, tinyBudget: result.defectTinyBudgetThrowsConsumedBelow, plannerReason: executed.unresolved[0]?.reason }));
