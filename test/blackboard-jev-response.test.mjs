import test from 'node:test';
import assert from 'node:assert/strict';
import { callJev, validateResponse, evaluate, validateEvaluation, workerBatchManifest, workerQuestionPayload } from '../scripts/blackboard-jev.mjs';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const payload = { model: 'jev-1.13.0', questions: {
  'objective-0': { type: 'choice', criteria: { SATISFIED: 'yes', INSUFFICIENT_EVIDENCE: 'no' } }
}};
function response(probabilities) {
  return { model: payload.model, answers: { 'objective-0': {
    type: 'choice', choice: 'SATISFIED', confidence: 0.5, probabilities
  }}, usage: { input_tokens: 1, output_tokens: 1 } };
}
test('probability diagnostics retain strict normalization and identify the failing question', () => {
  assert.throws(() => validateResponse(response({ SATISFIED: 0.6, INSUFFICIENT_EVIDENCE: 0.3 }), payload),
    /invalid probabilities: objective-0; validRange=true; sum=0.8999999999999999; count=2/);
  assert.throws(() => validateResponse(response({ SATISFIED: 0.99998, INSUFFICIENT_EVIDENCE: 0 }), payload), /invalid probabilities/);
  assert.doesNotThrow(() => validateResponse(response({ SATISFIED: 0.7, INSUFFICIENT_EVIDENCE: 0.3 }), payload));
});
test('malformed probability data is not echoed or retried', async () => {
  let calls = 0;
  await assert.rejects(() => callJev(payload, {
    apiKey: 'test-only-secret',
    fetchImpl: async () => {
      calls++;
      return new Response(JSON.stringify(response({ SATISFIED: 'untrusted-secret-text', INSUFFICIENT_EVIDENCE: 0 })));
    }
  }), error => {
    assert.match(error.message, /objective-0; validRange=false; sum=null; count=2/);
    assert.doesNotMatch(error.message, /untrusted-secret-text|test-only-secret/);
    return true;
  });
  assert.equal(calls, 1);
});

test('worker batches retain every atomic answer, exact evidence and cache binding', async t => {
  const root = mkdtempSync(join(tmpdir(), 'blackboard-jev-batches-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'docs/blackboard'), { recursive: true });
  writeFileSync(join(root, 'docs/blackboard/jev-policy.json'), JSON.stringify({ model: payload.model, policy: 'atomic-claims-1' }));
  const criteria = id => ({ id, verificationIds: ['check'], statement: `Claim ${id}` });
  const question = { type: 'choice', instructions: 'Judge the evidence', criteria: { SATISFIED: 'Supported', INSUFFICIENT_EVIDENCE: 'Missing' } };
  const evidenceFiles = ['A', 'B'].map(id => ({ ref: `evidence/${id}.txt`, hash: `hash-${id}`, body: id.repeat(33000) }));
  const fullPayload = {
    model: payload.model,
    state: {
      objective: { successCriteria: ['A and B'] },
      plan: { kind: 'BLACKBOARD_ARTIFACT', artifactType: 'READY_IMPLEMENT_PLAN', artifactId: 'BB-T', objective: {}, scope: [], outOfScope: [], constraints: [], invariants: [], architectureDecisions: [], implementationSlices: [], negativeVerificationCases: [], sourceSeams: { expectedNew: [], expectedTests: [] }, livingDocs: {}, acceptanceCriteria: ['A', 'B'].map(criteria), verificationPlan: [{ id: 'check', command: 'node --test unrelated.test.js' }] },
      evidence: ['A', 'B'].map(id => ({ id, evidenceRefs: [`evidence/${id}.txt`] })),
      sources: [],
      verification: [{ id: 'check', command: 'node --test unrelated.test.js', exitCode: 0 }],
      evidenceFiles
    },
    questions: { A: question, B: question }
  };
  const subject = { workId: 'BB-T', plan: { ref: 'plan.json', hash: 'a'.repeat(64) } };
  const materialized = { lane: 'WORKER', subject, payload: fullPayload, stateHash: 'b'.repeat(64), specHash: 'c'.repeat(64), cacheKey: 'd'.repeat(64) };
  let calls = 0;
  const fetchImpl = async (_url, options) => {
    calls += 1;
    const sent = JSON.parse(options.body);
    const [id] = Object.keys(sent.questions);
    assert.deepEqual(sent.state.evidence.map(entry => entry.id), [id]);
    assert.deepEqual(sent.state.evidenceFiles.map(entry => entry.ref), [`evidence/${id}.txt`]);
    return new Response(JSON.stringify({ model: sent.model, answers: { [id]: { type: 'choice', choice: 'SATISFIED', confidence: 0.9, probabilities: { SATISFIED: 0.9, INSUFFICIENT_EVIDENCE: 0.1 } } }, usage: { input_tokens: 100, output_tokens: 10 } }), { status: 200 });
  };
  const first = await evaluate(materialized, { root, fetchImpl, apiKey: 'fixture-key' });
  assert.equal(calls, 2);
  assert.equal(first.verdict, 'SATISFIED');
  assert.deepEqual(first.metrics.batching.manifest, workerBatchManifest(fullPayload));
  assert.deepEqual(first.usage, { input_tokens: 200, output_tokens: 20 });
  assert.equal(validateEvaluation(first, materialized), first);
  const second = await evaluate(materialized, { root, fetchImpl, apiKey: 'fixture-key' });
  assert.equal(calls, 2);
  assert.equal(second.metrics.cacheHit, true);
  assert.throws(() => validateEvaluation({ ...first, metrics: { ...first.metrics, batching: { ...first.metrics.batching, manifest: [] } } }, materialized), /worker batch manifest mismatch/);
});

test('worker batch includes scoped Living Docs without an Integration C heading', () => {
  const body = '# Current state\nDelivery baseline summary.\n## Oracle\nUnrelated source.\n## Delivery baseline\nCurrent baseline boundary.';
  const state = {
    objective: {},
    plan: { kind: 'BLACKBOARD_ARTIFACT', artifactType: 'READY_IMPLEMENT_PLAN', artifactId: 'BB-065', objective: {},
      scope: ['delivery.baseline'], sourceSeams: { expectedNew: [], expectedTests: [] },
      livingDocs: { questionId: 'LIVING_DOCS' }, acceptanceCriteria: [], verificationPlan: [] },
    evidence: [], verification: [], evidenceFiles: [],
    sources: [{ ref: 'docs/living/system/state.md', hash: 'bound-hash', body }]
  };
  const result = workerQuestionPayload({ model: payload.model, state,
    questions: { LIVING_DOCS: { type: 'choice', criteria: { SATISFIED: 'yes' } } } }, 'LIVING_DOCS');
  const excerpt = result.state.sources[0];
  assert.match(excerpt.body, /Delivery baseline summary/);
  assert.match(excerpt.body, /Current baseline boundary/);
  assert.doesNotMatch(excerpt.body, /Unrelated source/);
  assert.equal(excerpt.hash, 'bound-hash');
  assert.equal(excerpt.excerpted, true);
});

test('worker batch includes bounded source for its verification and omits unrelated tests', () => {
  const longBody = ['import test from "node:test";', ...Array(500).fill('// filler'), 'test("registration rejects invalid profile", () => {});'].join('\n');
  const state = {
    objective: {},
    plan: { kind: 'BLACKBOARD_ARTIFACT', artifactType: 'READY_IMPLEMENT_PLAN', artifactId: 'BB-065', objective: {},
      scope: ['delivery.baseline'], sourceSeams: { expectedNew: [], expectedTests: [] }, livingDocs: { questionId: 'LIVING_DOCS' },
      acceptanceCriteria: [{ id: 'REGISTRATION', statement: 'Invalid profile must be rejected', verificationIds: ['contract'], evidenceRequired: [] }],
      verificationPlan: [{ id: 'contract', command: 'node --test test/delivery/baseline-contract.test.mjs' }] },
    evidence: [{ id: 'REGISTRATION', evidenceRefs: ['evidence/contract.txt'] }],
    verification: [{ id: 'contract', command: 'node --test test/delivery/baseline-contract.test.mjs', logRef: 'evidence/contract.txt' }],
    evidenceFiles: [{ ref: 'evidence/contract.txt', body: 'passed' }],
    sources: [
      { ref: 'test/delivery/baseline-contract.test.mjs', hash: 'bound-test', body: longBody },
      { ref: 'test/delivery/baseline-runner.test.mjs', hash: 'unrelated-test', body: longBody }
    ]
  };
  const result = workerQuestionPayload({ model: payload.model, state,
    questions: { REGISTRATION: { type: 'choice', criteria: { SATISFIED: 'yes' } } } }, 'REGISTRATION');
  const selected = result.state.sources[0];
  assert.equal(selected.hash, 'bound-test');
  assert.equal(selected.excerpted, true);
  assert.match(selected.body, /registration rejects invalid profile/);
  assert.ok(selected.body.length < longBody.length);
  assert.equal(result.state.sources[1].omitted, true);
});
