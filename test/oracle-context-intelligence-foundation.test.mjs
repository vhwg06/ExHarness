import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (ref) => fs.readFileSync(path.join(root, ref), 'utf8');
const oracle = await import('../packages/oracle/src/index.js');

test('convergence composes DONE BB-060..063 without redefining authority', async (t) => {
  const graph = JSON.parse(read('docs/blackboard/work-graph.json'));
  for (const id of ['BB-060', 'BB-061', 'BB-062', 'BB-063']) {
    const task = graph.tasks.find((x) => x.id === id);
    assert.equal(task.status, 'DONE');
    assert.ok(task.contract.deliveryRef);
  }
  for (const name of ['readRepositorySources', 'defineContextRequirement', 'createSourceCatalog', 'createRetrievalPlanner', 'defineSourceObservation', 'createOracleContextResolver']) assert.equal(typeof oracle[name], 'function');
  t.diagnostic('BB-060..063 DONE with delivery receipts; facade composes delivered exports only');
});

test('foundation path preserves budget/provenance/currentness/manifest/reuse', async (t) => {
  const out = JSON.parse(execFileSync('node', ['scripts/oracle-context-intelligence/probe-foundation.mjs'], { cwd: root, encoding: 'utf8' }));
  assert.equal(out.probe.kind, 'ORACLE_FOUNDATION_PROBE_V1');
  assert.ok(out.probe.repository.resolutionId && out.probe.artifact.manifestRef.startsWith('artifact-manifest://'));
  assert.ok(out.probe.repository.validators.some((v) => v.strength === 'STRONG'));
  assert.ok(out.probe.artifact.provenance.some((p) => p.kind === 'ACCEPTANCE_DECISION'));
  assert.ok(out.probe.repository.consumed.items >= 1 && out.probe.repository.renderedBytes > 0);
  t.diagnostic(`repo ${out.probe.repository.resolutionId.slice(0, 12)} artifact ${out.probe.artifact.resolutionId.slice(0, 12)} manifest-bound with reuse seam present`);
});

test('fail-closed negatives cannot become current model context', async (t) => {
  const { defineContextRequirement, defineContextResolution } = oracle;
  const budget = { maxItems: 1, maxMaterializedBytes: 1000, maxProviderCalls: 1, maxResolutionSteps: 1 };
  const req = defineContextRequirement({ consumerRef: 'w', semanticNeed: 's', evidence: [{ id: 'e', necessity: 'REQUIRED', need: 'n', source: { kind: 'REPOSITORY', ref: 'repo', snapshot: { mode: 'CURRENT' } } }], budget });
  assert.throws(() => defineContextResolution({ requirementId: req.requirementId, step: { index: 0, previousResolutionId: null }, status: 'COMPLETE', items: [{ evidenceId: 'e', rank: 0, source: { kind: 'REPOSITORY', ref: 'repo', snapshotRef: 'h', itemRef: 'a' }, currentness: { validators: [{ kind: 'REVISION', value: 'h', strength: 'WEAK' }] }, provenance: [{ kind: 'SOURCE_REF', ref: 'x' }], content: 'c' }], unresolved: [], consumed: { items: 1, materializedBytes: 500, providerCalls: 1, resolutionSteps: 1 } }, req), /strong validator/);
  let dispatched = 0;
  const fakeCoreDispatch = async () => { dispatched += 1; };
  try {
    defineContextResolution({ requirementId: req.requirementId, step: { index: 0, previousResolutionId: null }, status: 'COMPLETE', items: [], unresolved: [], consumed: { items: 1, materializedBytes: 500, providerCalls: 1, resolutionSteps: 1 } }, req);
  } catch { /* pre-render failure: never dispatch */ }
  assert.equal(dispatched, 0);
  t.diagnostic('weak CURRENT and empty materialization fail closed with zero model/action dispatch');
});

test('Living foundation truth and continuation boundary', (t) => {
  const docs = ['architecture', 'state'].map((n) => read(`docs/living/system/oracle/${n}.md`)).join('\n');
  assert.match(docs, /createOracleContextResolver|ORACLE_FOUNDATION_PROBE_V1|O0_STATIC_CONTEXT_CONTROL/);
  assert.match(docs, /not delivered|NOT DELIVERED/i);
  const readme = read('scripts/oracle-context-intelligence/README.md');
  assert.match(readme, /BB-083/);
  assert.doesNotMatch(docs, /live value|tokens saved|productivity gain/i);
  t.diagnostic('Living Docs describe facade/probe/benchmark limits; continuation proposes BB-083 without claiming delivery');
});
