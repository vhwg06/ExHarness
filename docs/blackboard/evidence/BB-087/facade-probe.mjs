// Deterministic probe of the delivered BB-064 createOracleContextResolver facade.
// Run from repository root: node docs/blackboard/evidence/BB-087/facade-probe.mjs
// Writes facade-probe-result.json beside this file. No network, model or credentials.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import * as O from '../../../../packages/oracle/src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SNAP = 'rev-1';
const authority = { sourceKind: 'REPOSITORY', refPrefix: '', observe: async () => ({ snapshotRef: SNAP }) };
function provider(behavior, bytes = 5) {
  const providerId = `p-${behavior}`;
  return {
    descriptor: { providerId, sourceKinds: ['REPOSITORY'], operations: ['READ_EXACT'], snapshotModes: ['EXACT', 'CURRENT'], currentnessValidators: ['REVISION'], maxConcurrentCalls: 1, costClass: 'LOW' },
    async retrieve(work) {
      if (behavior === 'fail') throw new O.ProviderFailure({ reason: 'SOURCE_FAILURE', providerId, evidenceId: work.evidenceId, detail: 'probe source failure' });
      return [{ evidenceId: work.evidenceId, source: { kind: 'REPOSITORY', ref: 'repo', snapshotRef: SNAP, itemRef: work.sourceConstraint.itemRef }, validators: [{ kind: 'REVISION', value: SNAP, strength: 'STRONG' }], provenance: [{ kind: 'SOURCE_REF', ref: `repo@${SNAP}:${work.sourceConstraint.itemRef}` }], content: 'x'.repeat(bytes), providerEvidence: { providerId, operation: 'READ_EXACT' } }];
    }
  };
}
const evidence = (id, necessity = 'REQUIRED') => ({ id, necessity, need: 'probe need', source: { kind: 'REPOSITORY', ref: 'repo', snapshot: { mode: 'CURRENT' }, itemRefs: [`${id}.js`] }, requiredProvenance: [] });
const requirement = (budget, ev = [evidence('e1')]) => ({ consumerRef: 'bb087-probe', semanticNeed: 'probe', evidence: ev, budget });
async function run(name, { behavior = 'ok', bytes = 5, budget, ev }) {
  const catalog = O.createSourceCatalog({ providers: [provider(behavior, bytes)], snapshotAuthorities: [authority] });
  const planner = O.createRetrievalPlanner({ catalog });
  const req = requirement(budget, ev);
  const plannedUnresolved = planner.plan(req).unresolved;
  const resolver = O.createOracleContextResolver({ sourceCatalog: catalog, retrievalPlanner: planner });
  try {
    const { resolution } = await resolver.resolve(req);
    return { name, outcome: 'RESOLVED', status: resolution.status, consumed: resolution.consumed, materializedBytes: resolution.materialization.bytes, unresolved: resolution.unresolved, plannedUnresolved };
  } catch (error) {
    return { name, outcome: 'THROWN', errorName: error.name, reason: error.reason ?? null, message: error.message, plannedUnresolved };
  }
}
const cases = [
  await run('small-item-under-6000-byte-budget', { budget: { maxItems: 3, maxMaterializedBytes: 6000, maxProviderCalls: 3, maxResolutionSteps: 1 } }),
  await run('small-item-under-100000-byte-budget', { budget: { maxItems: 3, maxMaterializedBytes: 100000, maxProviderCalls: 3, maxResolutionSteps: 1 } }),
  await run('provider-source-failure-required-evidence', { behavior: 'fail', budget: { maxItems: 3, maxMaterializedBytes: 100000, maxProviderCalls: 3, maxResolutionSteps: 1 } }),
  await run('planner-budget-exhausted-optional-evidence', { budget: { maxItems: 1, maxMaterializedBytes: 100000, maxProviderCalls: 1, maxResolutionSteps: 1 }, ev: [evidence('e1'), evidence('e2', 'OPTIONAL')] })
];
const result = {
  kind: 'BB087_FACADE_PROBE_RESULT', version: 1,
  subject: 'packages/oracle/src/context-resolution.js createOracleContextResolver (BB-064 delivered)',
  subjectSha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(here, '../../../../packages/oracle/src/context-resolution.js'))).digest('hex'),
  cases,
  observations: {
    constantMaterializedBytes: cases[1].consumed?.materializedBytes === 40000 && cases[1].materializedBytes < 1000,
    subFortyKilobyteBudgetUnresolvable: cases[0].outcome === 'THROWN' && /materializedBytes budget exceeded/.test(cases[0].message),
    providerFailureEscapesAsThrow: cases[2].outcome === 'THROWN' && cases[2].errorName === 'ProviderFailure',
    plannerReasonDropped: cases[3].plannedUnresolved.some(u => u.reason === 'BUDGET_EXHAUSTED') && cases[3].unresolved?.every(u => u.reason === 'MISSING')
  }
};
fs.writeFileSync(path.join(here, 'facade-probe-result.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result.observations));
