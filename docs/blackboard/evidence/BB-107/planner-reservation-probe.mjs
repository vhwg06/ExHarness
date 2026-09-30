#!/usr/bin/env node
// Credential-free probe: planner reserves 1 item and min(8192, remaining) bytes per work unit.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as O from '../../../../packages/oracle/src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SNAP = 'rev-1';
const content9k = 'x'.repeat(9000);
const budget = { maxItems: 4, maxMaterializedBytes: 40000, maxProviderCalls: 4, maxResolutionSteps: 1 };
const requirement = {
  consumerRef: 'bb107', semanticNeed: 'file', budget,
  evidence: [{ id: 'e1', necessity: 'REQUIRED', need: 'file', source: { kind: 'REPOSITORY', ref: 'repo', snapshot: { mode: 'EXACT', ref: SNAP }, itemRefs: ['big.js'] } }]
};
const catalog = O.createSourceCatalog({
  providers: [O.createExactRepositoryProvider({
    repositoryReader: { async readFile({ path: p }) { return { path: p, content: content9k, sourceRef: `repo@${SNAP}:${p}` }; } }
  })],
  snapshotAuthorities: [{ sourceKind: 'REPOSITORY', refPrefix: 'repo', observe: async () => ({ snapshotRef: SNAP }) }]
});
const planner = O.createRetrievalPlanner({ catalog });
const planned = planner.plan(requirement);
const executed = await planner.execute(requirement);
const resolver = O.createOracleContextResolver({ sourceCatalog: catalog, retrievalPlanner: planner });
const { resolution } = await resolver.resolve(requirement);
class Coded extends O.ProviderFailure { constructor(a) { super(a); this.code = a.code; } }
const mapCatalog = O.createSourceCatalog({
  providers: [{
    descriptor: { providerId: 'lex', sourceKinds: ['REPOSITORY'], operations: ['SEARCH_LEXICAL'], snapshotModes: ['EXACT', 'CURRENT'], currentnessValidators: ['REVISION'], maxConcurrentCalls: 1, costClass: 'LOW' },
    async retrieve(work) { throw new Coded({ reason: 'SOURCE_FAILURE', providerId: 'lex', evidenceId: work.evidenceId, detail: 'ARTIFACT_CONTENT_MISMATCH: digest', code: 'ARTIFACT_CONTENT_MISMATCH' }); }
  }],
  snapshotAuthorities: [{ sourceKind: 'REPOSITORY', refPrefix: 'repo', observe: async () => ({ snapshotRef: SNAP }) }]
});
const mapped = await O.createRetrievalPlanner({ catalog: mapCatalog }).execute({
  consumerRef: 'bb107-map', semanticNeed: 's', budget,
  evidence: [{ id: 'e1', necessity: 'REQUIRED', need: 's', source: { kind: 'REPOSITORY', ref: 'repo', snapshot: { mode: 'CURRENT' } } }]
});
const result = {
  kind: 'BB107_PLANNER_RESERVATION_PROBE_RESULT',
  version: 1,
  fileBytes: 9000,
  requirementBudget: budget,
  reservedWork: planned.work.map((w) => w.reservedBudget),
  reservedTotals: planned.reserved,
  executeUnresolved: executed.unresolved,
  executeFailures: executed.failures,
  executeCandidateCount: executed.candidates.length,
  facadeStatus: resolution.status,
  facadeUnresolved: resolution.unresolved,
  mapping: { unresolved: mapped.unresolved, failures: mapped.failures, failureKeys: Object.keys(mapped.failures[0] || {}) },
  defectNineKbFileBudgetExhaustedUnder40k: resolution.status === 'UNSATISFIED' && resolution.unresolved[0]?.reason === 'BUDGET_EXHAUSTED' && planned.work[0]?.reservedBudget.materializedBytes === 8192 && planned.work[0]?.reservedBudget.items === 1
};
fs.writeFileSync(path.join(here, 'planner-reservation-probe-result.json'), JSON.stringify(result) + '\n');
console.log(JSON.stringify({ defect: result.defectNineKbFileBudgetExhaustedUnder40k, reserved: planned.work[0]?.reservedBudget, status: resolution.status, mappingKeys: result.mapping.failureKeys }));
