import test from 'node:test';
import assert from 'node:assert/strict';
import { canonical, hash } from '../scripts/blackboard-delivery-contract.mjs';
import {
  CRITERION_SOURCE_STRATEGIES, CURRENT_CRITERION_SOURCE_STRATEGY, rankedWorkerSource, workerBatchManifest, workerQuestionPayload
} from '../scripts/blackboard-jev.mjs';

// CRITERION_RANKED_SOURCE_V2: criterion questions of a bounded worker batch
// receive the source lines a criterion is about, not the file head.
// CRITERION_CHANGED_SOURCES_V3 (current) additionally makes every candidate-changed
// source eligible, including one the full state sends only as a hash stub.
const { TERM_LINES, RANKED, CHANGED } = CRITERION_SOURCE_STRATEGIES;
const MODEL = 'jev-1.13.0';
const IMPL = 'scripts/receipt.mjs';
const criteria = { SATISFIED: 'Supported', IMPLEMENTATION_DEFECT: 'Defect', INSUFFICIENT_EVIDENCE: 'Missing', PLAN_INPUT_CONTRADICTION: 'Contradiction' };
const question = { type: 'choice', instructions: 'Judge the evidence', criteria };

// 300 generic lines that contain common criterion words, then the specific
// receipt schema far below the 2,800-character head the old selection kept.
const generic = Array.from({ length: 300 }, (_, i) => `export const helper${i} = (set, base) => set.and(base).the(${i}); // one new and old base helper`);
const schema = [
  '// Typed receipt authorizing replacement of one objective.',
  'export function assertReceipt(receipt) {',
  "  if (receipt?.artifactType !== 'OBJECTIVE_SUPERSESSION') fail('receipt type');",
  "  if (!Array.isArray(receipt.directDependents)) fail('receipt directDependents');",
  '  return receipt;',
  '}'
];
const body = [...generic, ...schema].join('\n');
const statement = 'OBJECTIVE_SUPERSESSION has one canonical typed receipt binding exact base, old/new objective and the complete direct-dependent impact set.';

function payload(sourceBody = body) {
  return {
    model: MODEL,
    state: {
      objective: { successCriteria: ['C'] },
      plan: { kind: 'BLACKBOARD_ARTIFACT', artifactType: 'READY_IMPLEMENT_PLAN', artifactId: 'BB-T', objective: {}, scope: ['receipt'], outOfScope: [], constraints: [], invariants: [], architectureDecisions: [], implementationSlices: [], negativeVerificationCases: [],
        sourceSeams: { requiredExisting: [IMPL], expectedNew: [], expectedTests: [] },
        livingDocs: { refs: [], questionId: 'LIVING_DOCS', statement: 'Docs.' },
        acceptanceCriteria: [{ id: 'RECEIPT', statement, verificationIds: ['unit'], evidenceRequired: [] }],
        verificationPlan: [{ id: 'unit', command: 'npm run unit' }] },
      evidence: [{ id: 'RECEIPT', evidenceRefs: ['evidence/unit.txt'] }],
      sources: [{ ref: IMPL, hash: hash(sourceBody), body: sourceBody, deleted: false }],
      verification: [{ id: 'unit', command: 'npm run unit', exitCode: 0, logRef: 'evidence/unit.txt' }],
      evidenceFiles: [{ ref: 'evidence/unit.txt', hash: hash('passed'), body: 'passed' }]
    },
    questions: { RECEIPT: question, LIVING_DOCS: question }
  };
}
const sourceOf = (options, p = payload()) => workerQuestionPayload(p, 'RECEIPT', options).state.sources[0];

test('CHANGED is the current criterion source strategy', () => {
  assert.equal(CURRENT_CRITERION_SOURCE_STRATEGY, CHANGED);
  assert.deepEqual(Object.values(CRITERION_SOURCE_STRATEGIES), ['CRITERION_TERM_LINES_V1', 'CRITERION_RANKED_SOURCE_V2', 'CRITERION_CHANGED_SOURCES_V3']);
});

test('ranked selection reaches the specific code that generic criterion words hid', () => {
  const legacy = sourceOf({ criterionSourceStrategy: TERM_LINES, candidateChanges: {} });
  assert.doesNotMatch(legacy.body, /assertReceipt/, 'the original selection is exhausted by generic lines at the file head');
  const ranked = sourceOf({ criterionSourceStrategy: RANKED, candidateChanges: {} });
  assert.equal(ranked.excerptStrategy, RANKED);
  assert.equal(ranked.hash, hash(body));
  assert.equal(ranked.bytes, Buffer.byteLength(body));
  assert.equal(ranked.excerpted, true);
  assert.ok(ranked.body.length <= 4000);
  for (const line of [301, 302, 303, 304]) assert.match(ranked.body, new RegExp(`^${line}: `, 'm'));
  assert.match(ranked.body, /^1: export const helper0/m, 'the file header is kept');
  assert.match(ranked.body, /^…$/m, 'gaps are marked');
  assert.deepEqual(sourceOf({ criterionSourceStrategy: RANKED, candidateChanges: {} }), ranked, 'deterministic');
  const current = sourceOf({ candidateChanges: {} });
  assert.equal(current.excerptStrategy, CHANGED);
  assert.ok(current.body.length <= 3000);
  for (const line of [301, 302, 303, 304]) assert.match(current.body, new RegExp(`^${line}: `, 'm'));
});

test('candidate-changed lines outrank equally relevant unchanged lines', () => {
  // Every tenth line mentions dispositions; all such lines score the same.
  const lines = Array.from({ length: 400 }, (_, i) => i % 10 === 0 ? `const dispositions${i} = classify(${i}); ${'x'.repeat(60)}` : `const value${i} = compute(${i}); ${'y'.repeat(60)}`);
  const text = lines.join('\n');
  const bound = { ref: IMPL, hash: hash(text), body: text, deleted: false };
  const unchanged = rankedWorkerSource(bound, ['dispositions'], []);
  const changed = rankedWorkerSource(bound, ['dispositions'], [[351, 351]]);
  assert.match(unchanged.body, /^11: const dispositions10/m, 'ties are broken by line order');
  assert.doesNotMatch(unchanged.body, /^351: /m);
  assert.match(changed.body, /^351: const dispositions350/m, 'changed lines are selected first');
  assert.ok(changed.body.length <= 4000);
});

test('small sources are sent whole and the criterion questions of other strategies are unchanged', () => {
  const small = payload('export const receipt = 1;');
  assert.deepEqual(sourceOf({ candidateChanges: {} }, small), small.state.sources[0]);
  const p = payload();
  const living = workerQuestionPayload(p, 'LIVING_DOCS', { candidateChanges: {}, livingChanges: {} });
  const legacyLiving = workerQuestionPayload(p, 'LIVING_DOCS', { criterionSourceStrategy: TERM_LINES, candidateChanges: {}, livingChanges: {} });
  assert.equal(canonical(living), canonical(legacyLiving), 'the Living Docs question does not use criterion source selection');
  assert.notDeepEqual(workerBatchManifest(p, { candidateChanges: {}, livingChanges: {} }), workerBatchManifest(p, { criterionSourceStrategy: TERM_LINES, candidateChanges: {}, livingChanges: {} }));
});

test('ranked selection fails closed without a valid change map or with an unknown strategy', () => {
  assert.throws(() => sourceOf({}), /candidate change map missing/);
  assert.throws(() => sourceOf({ candidateChanges: { [IMPL]: { ranges: [[0, 2]] } } }), /candidate change map missing/);
  assert.throws(() => sourceOf({ criterionSourceStrategy: 'NEWEST', candidateChanges: {} }), /unknown criterion source excerpt strategy/);
  assert.ok(sourceOf({ criterionSourceStrategy: TERM_LINES }), 'the retained selection needs no change map');
});

// A plan whose implementation file is neither expectedNew nor expectedTests: the full
// state carries it only as a hash stub, and its filename shares no criterion term.
function stubPayload(changedBody) {
  const p = payload();
  const helper = 'export const unrelatedHelper = 1;';
  p.state.sources = [
    { ref: 'scripts/adapter.mjs', hash: hash(changedBody), bytes: Buffer.byteLength(changedBody), omitted: true, deleted: false },
    { ref: 'scripts/unrelated.mjs', hash: hash(helper), bytes: Buffer.byteLength(helper), omitted: true, deleted: false },
    { ref: IMPL, hash: hash('export const receipt = 1;'), body: 'export const receipt = 1;', deleted: false }
  ];
  return p;
}
const changedCode = ['// adapter', ...schema].join('\n');
const refsOf = question => Object.fromEntries(question.state.sources.map(source => [source.ref, source]));

test('changed selection sends a candidate-changed source that the full state omits', () => {
  const p = stubPayload(changedCode);
  const candidateChanges = { 'scripts/adapter.mjs': { ranges: [[1, 7]], body: changedCode } };
  const ranked = refsOf(workerQuestionPayload(p, 'RECEIPT', { criterionSourceStrategy: RANKED, candidateChanges }));
  assert.equal(ranked['scripts/adapter.mjs'].body, undefined, 'the retained selection never sees stubbed sources');
  const current = refsOf(workerQuestionPayload(p, 'RECEIPT', { candidateChanges }));
  const adapter = current['scripts/adapter.mjs'];
  assert.equal(adapter.body, changedCode);
  assert.equal(adapter.hash, hash(changedCode));
  assert.equal(adapter.omitted, undefined);
  assert.equal(current['scripts/unrelated.mjs'].body, undefined, 'unchanged stubbed sources stay stubs');
  assert.equal(current[IMPL].body, 'export const receipt = 1;');
  assert.equal(canonical(workerQuestionPayload(p, 'RECEIPT', { candidateChanges })), canonical(workerQuestionPayload(p, 'RECEIPT', { candidateChanges })), 'deterministic');
});

test('changed selection fails closed on a candidate body that differs from the bound source', () => {
  const p = stubPayload(changedCode);
  assert.throws(() => workerQuestionPayload(p, 'RECEIPT', { candidateChanges: { 'scripts/adapter.mjs': { ranges: [[1, 2]], body: `${changedCode}\n// tampered` } } }), /candidate change body differs from bound source: scripts\/adapter.mjs/);
  const missing = refsOf(workerQuestionPayload(p, 'RECEIPT', { candidateChanges: { 'scripts/adapter.mjs': { ranges: [[1, 2]] } } }));
  assert.equal(missing['scripts/adapter.mjs'].body, undefined, 'a change without a body cannot be sent');
});

test('changed selection bounds each source and the number of sources', () => {
  const p = payload();
  const candidateChanges = {};
  p.state.sources = Array.from({ length: 9 }, (_, i) => {
    const text = `${body}\n// receipt module ${i}`;
    candidateChanges[`scripts/m${i}.mjs`] = { ranges: [[301, 304]], body: text };
    return { ref: `scripts/m${i}.mjs`, hash: hash(text), bytes: Buffer.byteLength(text), omitted: true, deleted: false };
  });
  const sent = workerQuestionPayload(p, 'RECEIPT', { candidateChanges }).state.sources.filter(source => typeof source.body === 'string');
  assert.equal(sent.length, 6);
  for (const source of sent) {
    assert.equal(source.excerptStrategy, CHANGED);
    assert.ok(source.body.length <= 3000);
    assert.match(source.body, /^302: export function assertReceipt/m, 'changed lines are kept');
  }
});
