import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonical, hash } from '../scripts/blackboard-delivery-contract.mjs';
import {
  OMITTED_SOURCE_INDEX_STRATEGY, WORKER_BATCH_LIMITS, checkPayloadBudget, WORKER_BATCH_STRATEGIES, aggregateBatchAnswers, evaluate, excerptEvidenceLog,
  validateEvaluation, workerBatchManifest, workerBatchStrategy, workerQuestionBatches, workerQuestionPayload, withOmittedSourceIndex
} from '../scripts/blackboard-jev.mjs';

const MODEL = 'jev-1.13.0';
const bytes = value => Buffer.byteLength(canonical(value));
const criteria = { SATISFIED: 'Supported', IMPLEMENTATION_DEFECT: 'Defect', INSUFFICIENT_EVIDENCE: 'Missing', PLAN_INPUT_CONTRADICTION: 'Contradiction' };
const question = { type: 'choice', instructions: 'Judge the evidence', criteria };

function tapLog(files, { failing = [] } = {}) {
  const lines = ['', '> exharness@0.0.0 verify', '> npm test && npm run verify:current-docs', ''];
  for (let index = 0; index < files; index++) {
    lines.push(`# Subtest: suite ${index}`);
    for (let testIndex = 0; testIndex < 20; testIndex++) lines.push(`ok ${testIndex + 1} - suite ${index} behaviour ${testIndex} holds`, '  ---', '  type: \'test\'', '  ...');
    lines.push('1..20', '# tests 20', '# suites 0', `# pass ${20 - (failing[index] ? 1 : 0)}`, `# fail ${failing[index] ? 1 : 0}`, '# cancelled 0', '# skipped 0', '# todo 0');
    if (failing[index]) lines.push(`not ok 21 - ${failing[index]}`);
  }
  lines.push('', 'exitCode=0', '');
  return lines.join('\n');
}
function fixture({ evidence, extraPlan = {} }) {
  const ids = Object.keys(evidence);
  const files = ids.flatMap(id => evidence[id]);
  return {
    model: MODEL,
    state: {
      objective: { successCriteria: ids },
      plan: { kind: 'BLACKBOARD_ARTIFACT', artifactType: 'READY_IMPLEMENT_PLAN', artifactId: 'BB-T', objective: {}, scope: [], outOfScope: [], constraints: [], invariants: [], architectureDecisions: [], implementationSlices: [], negativeVerificationCases: [], sourceSeams: { expectedNew: [], expectedTests: [] }, livingDocs: { questionId: 'LIVING_DOCS' },
        acceptanceCriteria: ids.map(id => ({ id, statement: `Claim ${id}`, verificationIds: evidence[id].map(file => file.run), evidenceRequired: [] })),
        verificationPlan: files.map(file => ({ id: file.run, command: `npm run ${file.run}` })), ...extraPlan },
      evidence: ids.map(id => ({ id, evidenceRefs: evidence[id].map(file => file.ref).sort() })),
      sources: [],
      verification: files.map(file => ({ id: file.run, command: `npm run ${file.run}`, exitCode: 0, logRef: file.ref })),
      evidenceFiles: files.map(file => ({ ref: file.ref, hash: hash(file.body), body: file.body })).sort((a, b) => a.ref.localeCompare(b.ref))
    },
    questions: Object.fromEntries(ids.map(id => [id, question]))
  };
}
const log = (run, body) => ({ run, ref: `docs/blackboard/evidence/BB-T/${run}.txt`, body });

test('oversized evidence log is excerpted deterministically with bound hash, size, command and summary', () => {
  const body = tapLog(120, { failing: { 7: 'suite 7 rejects stale input' } });
  const file = { ref: 'docs/blackboard/evidence/BB-T/repository.txt', hash: hash(body), body };
  const run = { id: 'repository', command: 'npm run verify', exitCode: 0, logRef: file.ref };
  const excerpt = excerptEvidenceLog(file, run);
  assert.ok(Buffer.byteLength(body) > 8 * WORKER_BATCH_LIMITS.evidenceExcerptBytes);
  assert.ok(bytes(excerpt) <= WORKER_BATCH_LIMITS.evidenceExcerptBytes);
  assert.equal(excerpt.hash, hash(body));
  assert.equal(excerpt.bytes, Buffer.byteLength(body));
  assert.equal(excerpt.excerpted, true);
  assert.equal(excerpt.excerptStrategy, 'EVIDENCE_LOG_EXCERPT_V1');
  assert.equal(excerpt.command, 'npm run verify');
  assert.equal(excerpt.exitCode, 0);
  assert.deepEqual(excerpt.summary.totals, { tests: 2400, suites: 0, pass: 2399, fail: 1, cancelled: 0, skipped: 0, todo: 0 });
  assert.deepEqual(excerpt.summary.failing, ['suite 7 rejects stale input']);
  assert.deepEqual(excerpt.summary.scripts, ['verify']);
  assert.equal(excerpt.summary.logExitCode, 0);
  assert.ok(excerpt.omittedLines > 0);
  assert.match(excerpt.body, /^\n> exharness@0\.0\.0 verify/);
  assert.match(excerpt.body, /bounded evidence excerpt; omitted lines are bound by hash/);
  assert.match(excerpt.body, /exitCode=0\n$/);
  assert.deepEqual(excerptEvidenceLog(file, run), excerpt, 'excerpt must be deterministic');
});

test('fitting questions keep the exact atomic payload and V1 manifest identity', () => {
  const full = fixture({ evidence: { A: [log('unit', tapLog(2))] } });
  const [batch] = workerQuestionBatches(full, 'A');
  assert.equal(batch.excerpted, undefined);
  assert.equal(batch.payload.state.evidenceFiles[0].body, full.state.evidenceFiles[0].body);
  const manifest = workerBatchManifest(full);
  assert.deepEqual(Object.keys(manifest[0]).sort(), ['id', 'payloadBytes', 'payloadHash']);
  assert.equal(workerBatchStrategy(manifest), WORKER_BATCH_STRATEGIES.ATOMIC);
  assert.deepEqual(workerQuestionPayload(full, 'A'), batch.payload);
});

test('question over the batch limit fits after excerpting its oversized log', () => {
  const full = fixture({ evidence: { A: [log('unit', tapLog(2))], B: [log('unit-b', tapLog(2)), log('repository', tapLog(150))] } });
  const batches = workerQuestionBatches(full, 'B');
  assert.equal(batches.length, 1);
  assert.deepEqual(batches[0].excerpted, ['docs/blackboard/evidence/BB-T/repository.txt']);
  assert.ok(bytes(batches[0].payload) <= WORKER_BATCH_LIMITS.maxBatchBytes);
  const files = batches[0].payload.state.evidenceFiles;
  const repository = files.find(file => file.ref.endsWith('repository.txt'));
  const original = full.state.evidenceFiles.find(file => file.ref.endsWith('repository.txt'));
  assert.equal(repository.hash, original.hash);
  assert.equal(repository.bytes, Buffer.byteLength(original.body));
  assert.equal(files.find(file => file.ref.endsWith('unit-b.txt')).body, full.state.evidenceFiles.find(file => file.ref.endsWith('unit-b.txt')).body, 'small logs stay verbatim');
  const manifest = workerBatchManifest(full);
  assert.deepEqual(manifest.find(entry => entry.id === 'B').excerpted, ['docs/blackboard/evidence/BB-T/repository.txt']);
  assert.equal(workerBatchStrategy(manifest), WORKER_BATCH_STRATEGIES.BOUNDED);
  assert.deepEqual(workerBatchManifest(full), manifest, 'manifest must be deterministic');
});

test('evidence that still exceeds the limit is split into bounded parts covering every file', () => {
  // Each log is below both excerpt thresholds (8,192 and the compact 3,072 bytes), so
  // excerpting alone cannot make the question fit.
  const logs = Array.from({ length: 30 }, (_, index) => log(`check-${String(index).padStart(2, '0')}`, 'x'.repeat(2800)));
  const full = fixture({ evidence: { A: logs } });
  const batches = workerQuestionBatches(full, 'A');
  assert.ok(batches.length > 1);
  const covered = [];
  for (const [index, batch] of batches.entries()) {
    assert.ok(bytes(batch.payload) <= WORKER_BATCH_LIMITS.maxBatchBytes);
    assert.equal(batch.part, index + 1);
    assert.equal(batch.parts, batches.length);
    const descriptor = batch.payload.state.batch;
    assert.deepEqual({ questionId: descriptor.questionId, part: descriptor.part, parts: descriptor.parts }, { questionId: 'A', part: index + 1, parts: batches.length });
    for (const file of batch.payload.state.evidenceFiles) {
      const original = full.state.evidenceFiles.find(entry => entry.ref === file.ref);
      assert.equal(file.hash, original.hash, 'every part binds every evidence hash');
      if (descriptor.evidenceRefs.includes(file.ref)) { assert.equal(file.body, original.body); covered.push(file.ref); }
      else { assert.equal(file.omitted, true); assert.notEqual(file.judgedInPart, index + 1); }
    }
  }
  assert.deepEqual(covered.sort(), full.state.evidenceFiles.map(file => file.ref).sort());
  assert.throws(() => workerQuestionPayload(full, 'A'), /worker batch exceeds bounded input: A/);
  const manifest = workerBatchManifest(full);
  assert.deepEqual(manifest.map(entry => [entry.part, entry.parts]), batches.map(batch => [batch.part, batch.parts]));
  assert.equal(workerBatchStrategy(manifest), WORKER_BATCH_STRATEGIES.BOUNDED);
});

test('unrepresentable question input still fails closed', () => {
  const full = fixture({ evidence: { A: [log('unit', 'ok')] }, extraPlan: { constraints: ['c'.repeat(70000)] } });
  assert.throws(() => workerQuestionBatches(full, 'A'), /worker batch exceeds bounded input: A/);
});

test('part answers aggregate conservatively', () => {
  const answer = (choice, confidence) => ({ type: 'choice', choice, confidence, probabilities: { [choice]: 1 } });
  assert.deepEqual(aggregateBatchAnswers([answer('SATISFIED', 0.9), answer('SATISFIED', 0.6)]), answer('SATISFIED', 0.6));
  assert.equal(aggregateBatchAnswers([answer('SATISFIED', 0.9), answer('INSUFFICIENT_EVIDENCE', 0.7)]).choice, 'INSUFFICIENT_EVIDENCE');
  assert.equal(aggregateBatchAnswers([answer('INSUFFICIENT_EVIDENCE', 0.9), answer('IMPLEMENTATION_DEFECT', 0.5), answer('PLAN_INPUT_CONTRADICTION', 0.4)]).choice, 'PLAN_INPUT_CONTRADICTION');
  assert.throws(() => aggregateBatchAnswers([]), /requires answers/);
});

test('split evaluation calls each part once, propagates any unsatisfied part and binds the manifest', async t => {
  const root = mkdtempSync(join(tmpdir(), 'blackboard-jev-bounded-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'docs/blackboard'), { recursive: true });
  writeFileSync(join(root, 'docs/blackboard/jev-policy.json'), JSON.stringify({ model: MODEL, policy: 'atomic-claims-1' }));
  const logs = Array.from({ length: 30 }, (_, index) => log(`check-${String(index).padStart(2, '0')}`, 'x'.repeat(2800)));
  const full = fixture({ evidence: { A: logs, B: [log('repository', tapLog(150))] } });
  const materialized = { lane: 'WORKER', subject: { workId: 'BB-T', plan: { ref: 'plan.json', hash: 'a'.repeat(64) } }, payload: full, stateHash: 'b'.repeat(64), specHash: 'c'.repeat(64), cacheKey: 'd'.repeat(64), changeSet: { refs: [], sourceScope: { write: [], forbiddenWrite: [] } } };
  const parts = workerQuestionBatches(full, 'A').length;
  const run = async failingPart => {
    const sent = [];
    const fetchImpl = async (_url, options) => {
      const body = JSON.parse(options.body);
      assert.ok(Buffer.byteLength(options.body) <= WORKER_BATCH_LIMITS.maxBatchBytes);
      sent.push(body);
      const [id] = Object.keys(body.questions);
      const choice = id === 'A' && body.state.batch?.part === failingPart ? 'INSUFFICIENT_EVIDENCE' : 'SATISFIED';
      const confidence = 0.9 - 0.01 * (body.state.batch?.part ?? 0);
      const probabilities = { SATISFIED: 0, IMPLEMENTATION_DEFECT: 0, INSUFFICIENT_EVIDENCE: 0, PLAN_INPUT_CONTRADICTION: 0, [choice]: 1 };
      return new Response(JSON.stringify({ model: MODEL, answers: { [id]: { type: 'choice', choice, confidence, probabilities } }, usage: { input_tokens: 10, output_tokens: 1 } }), { status: 200 });
    };
    const evaluation = await evaluate(materialized, { root, fetchImpl, apiKey: 'fixture-key', bypassCache: true });
    return { evaluation, sent };
  };
  const pass = await run(null);
  assert.equal(pass.sent.length, parts + 1);
  assert.equal(pass.evaluation.verdict, 'SATISFIED');
  assert.equal(pass.evaluation.answers.A.confidence, 0.9 - 0.01 * parts, 'least confident satisfied part is retained');
  assert.equal(pass.evaluation.metrics.batching.strategy, WORKER_BATCH_STRATEGIES.BOUNDED);
  assert.deepEqual(pass.evaluation.metrics.batching.partChoices, { A: Array(parts).fill('SATISFIED') });
  assert.deepEqual(pass.evaluation.usage, { input_tokens: 10 * (parts + 1), output_tokens: parts + 1 });
  assert.equal(validateEvaluation(pass.evaluation, materialized), pass.evaluation);
  assert.throws(() => validateEvaluation({ ...pass.evaluation, metrics: { ...pass.evaluation.metrics, batching: { ...pass.evaluation.metrics.batching, strategy: WORKER_BATCH_STRATEGIES.ATOMIC } } }, materialized), /invalid worker batch strategy/);
  const fail = await run(2);
  assert.equal(fail.evaluation.answers.A.choice, 'INSUFFICIENT_EVIDENCE');
  assert.equal(fail.evaluation.answers.B.choice, 'SATISFIED');
  assert.equal(fail.evaluation.verdict, 'REPAIR_REQUIRED');
  assert.equal(fail.evaluation.metrics.batching.partChoices.A[1], 'INSUFFICIENT_EVIDENCE');
  assert.deepEqual(fail.sent.map(body => hash(body)), pass.sent.map(body => hash(body)), 'batch payloads are deterministic across runs');
});

function manySources(count) {
  return Array.from({ length: count }, (_, index) => {
    const ref = `benchmarks/substrate/manifests/run-${String(index % 40).padStart(2, '0')}/trial-${String(index).padStart(4, '0')}/evidence/raw/result-${index}.json`;
    return { ref, hash: hash(ref), bytes: 300 + index, omitted: true, deleted: index % 7 === 0 };
  });
}
function indexedFixture(count) {
  const full = fixture({ evidence: { A: [log('unit', tapLog(2))] } });
  const stubs = manySources(count);
  const living = { ref: 'docs/living/system/state.md', hash: hash('living'), bytes: 4000, body: 'L'.repeat(4000), excerpted: false, deleted: false };
  full.state.sources = [...stubs, living];
  full.state.plan.livingDocs = { questionId: 'LIVING_DOCS', refs: [living.ref] };
  const changeSet = { refs: [...stubs.map(source => source.ref), living.ref].sort(), sourceScope: { write: ['benchmarks/**', 'docs/living/**'], forbiddenWrite: [] } };
  return { full, stubs, living, changeSet };
}

test('a question whose source stubs alone overflow is represented by a hash-bound directory index', () => {
  const { full, stubs, living, changeSet } = indexedFixture(700);
  const options = { changeSet };
  const batches = workerQuestionBatches(full, 'A', options);
  assert.equal(batches.length, 1);
  const [batch] = batches;
  assert.equal(batch.sourceIndex, OMITTED_SOURCE_INDEX_STRATEGY);
  assert.ok(bytes(batch.payload) <= WORKER_BATCH_LIMITS.maxBatchBytes);
  const index = batch.payload.state.omittedSources;
  assert.equal(index.strategy, OMITTED_SOURCE_INDEX_STRATEGY);
  // The scoped Living Doc background of a non-Living-Doc criterion is bound by hash under the index.
  const livingStub = { ref: living.ref, hash: living.hash, bytes: living.bytes, omitted: true, deleted: false };
  assert.equal(index.count, stubs.length + 1);
  assert.equal(index.hash, hash([...stubs, livingStub]));
  assert.equal(index.bytes, [...stubs, livingStub].reduce((total, source) => total + source.bytes, 0));
  assert.ok(index.directories.length <= 32);
  assert.equal(index.directories.reduce((total, group) => total + group.files, 0), stubs.length + 1);
  assert.equal(index.directories.reduce((total, group) => total + group.deleted, 0), stubs.filter(source => source.deleted).length);
  assert.equal(index.directories.reduce((total, group) => total + group.changed, 0), changeSet.refs.length);
  assert.deepEqual(batch.payload.state.sources, []);
  const sentChangeSet = batch.payload.state.changeSet;
  assert.deepEqual(sentChangeSet.refs, []);
  assert.equal(sentChangeSet.refCount, changeSet.refs.length);
  assert.equal(sentChangeSet.refsHash, hash(changeSet.refs));
  assert.deepEqual(sentChangeSet.sourceScope, changeSet.sourceScope);
  assert.deepEqual(workerQuestionBatches(full, 'A', options), batches, 'index must be deterministic');
  const manifest = workerBatchManifest(full, options);
  assert.equal(manifest.find(entry => entry.id === 'A').sourceIndex, OMITTED_SOURCE_INDEX_STRATEGY);
  assert.equal(workerBatchStrategy(manifest), WORKER_BATCH_STRATEGIES.SOURCE_INDEX);
});

test('the source index applies only when no earlier stage fits and keeps Living Docs for the Living Docs question', () => {
  const small = indexedFixture(20);
  const [fitting] = workerQuestionBatches(small.full, 'A', { changeSet: small.changeSet });
  assert.equal(fitting.sourceIndex, undefined, 'a fitting question keeps its existing payload');
  assert.equal(fitting.payload.state.omittedSources, undefined);
  assert.equal(workerBatchStrategy(workerBatchManifest(small.full, { changeSet: small.changeSet })), WORKER_BATCH_STRATEGIES.ATOMIC);
  const { full, living } = indexedFixture(700);
  const livingBase = { model: MODEL, state: { ...full.state, evidence: [], sources: full.state.sources }, questions: { LIVING_DOCS: question } };
  const indexed = withOmittedSourceIndex(livingBase);
  assert.deepEqual(indexed.state.sources.map(source => source.ref), [living.ref]);
  assert.equal(indexed.state.sources[0].body, living.body);
  assert.equal(withOmittedSourceIndex({ ...livingBase, state: { ...livingBase.state, sources: [living] } }), null, 'nothing to index');
});

test('the source index still fails closed when the indexed input cannot fit', () => {
  const { full, changeSet } = indexedFixture(700);
  full.state.plan.constraints = ['c'.repeat(70000)];
  assert.throws(() => workerQuestionBatches(full, 'A', { changeSet }), /worker batch exceeds bounded input: A/);
});

test('payload budget bounds each provider request: a batched worker state may exceed it while every batch fits', () => {
  const full = fixture({ evidence: { A: [log('unit', tapLog(120))], B: [log('integration', tapLog(120))] } });
  const total = bytes(full);
  assert.ok(total > WORKER_BATCH_LIMITS.maxBatchBytes * 2, 'fixture is larger than two batches');
  const budget = checkPayloadBudget(full, { lane: 'WORKER', maxPayloadBytes: total - 1 });
  assert.equal(budget.mode, 'BOUNDED_BATCHES');
  assert.equal(budget.payloadBytes, total);
  assert.equal(budget.requests, workerBatchManifest(full).length);
  assert.ok(budget.maxRequestBytes <= WORKER_BATCH_LIMITS.maxBatchBytes);
  assert.deepEqual(budget.maxRequestBytes, Math.max(...workerBatchManifest(full).map(entry => entry.payloadBytes)));
});

test('payload budget fails closed for whole-sent payloads and for a batch that cannot fit', () => {
  const small = fixture({ evidence: { A: [log('unit', tapLog(2))] } });
  assert.equal(checkPayloadBudget(small, { lane: 'WORKER', maxPayloadBytes: 524288 }).mode, 'SINGLE_REQUEST');
  assert.throws(() => checkPayloadBudget(small, { lane: 'WORKER', maxPayloadBytes: bytes(small) - 1 }), /payload exceeds budget/);
  const large = fixture({ evidence: { A: [log('unit', tapLog(120))] } });
  // Research payloads are sent whole, so their total size is the request size.
  assert.throws(() => checkPayloadBudget(large, { lane: 'RESEARCH_SA', maxPayloadBytes: bytes(large) - 1 }), /payload exceeds budget/);
  // A policy request budget below the worker batch limit cannot be met by bounded batches.
  assert.throws(() => checkPayloadBudget(large, { lane: 'WORKER', maxPayloadBytes: WORKER_BATCH_LIMITS.maxBatchBytes - 1 }), /payload exceeds budget/);
  // A question whose non-evidence input alone exceeds the batch limit still fails before any provider call.
  const bloated = fixture({ evidence: { A: [log('unit', tapLog(2))] }, extraPlan: { constraints: ['x'.repeat(WORKER_BATCH_LIMITS.maxBatchBytes)] } });
  assert.throws(() => checkPayloadBudget(bloated, { lane: 'WORKER', maxPayloadBytes: 524288 }), /worker batch exceeds bounded input/);
  assert.throws(() => checkPayloadBudget(small, { lane: 'WORKER', maxPayloadBytes: 0 }), /invalid payload budget/);
});
