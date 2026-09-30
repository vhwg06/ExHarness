import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { canonical, hash } from '../scripts/blackboard-delivery-contract.mjs';
import {
  CRITERION_SOURCE_STRATEGIES, LIVING_EXCERPT_STRATEGIES, WORKER_BATCH_LIMITS, evaluate, livingDocChanges, markdownSections, validateEvaluation,
  workerBatchManifest, workerQuestionBatches, workerQuestionPayload
} from '../scripts/blackboard-jev.mjs';

const MODEL = 'jev-1.13.0';
const DOC = 'docs/living/system/agentic-application/capabilities.md';
const { SCOPED, CHANGED, DELIVERY } = LIVING_EXCERPT_STRATEGIES;
const bytes = value => Buffer.byteLength(canonical(value));
const criteria = { SATISFIED: 'Supported', IMPLEMENTATION_DEFECT: 'Defect', INSUFFICIENT_EVIDENCE: 'Missing', PLAN_INPUT_CONTRADICTION: 'Contradiction' };
const question = { type: 'choice', instructions: 'Judge the evidence', criteria };

const baselineDoc = [
  '# Capabilities', 'Projection of delivered capabilities.', '',
  '## A16 — Earlier capability', 'Older behaviour.', '',
  '## A17 — Cross-domain obligations', 'Integration C behaviour.', '',
  '### Integration C details', 'Obligation currentness.', '',
  '## Boundaries', 'No live provider exists.'
].join('\n');
const candidateDoc = [
  '# Capabilities', 'Projection of delivered capabilities.', '',
  '## A16 — Earlier capability', 'Older behaviour.', '',
  '## A17 — Cross-domain obligations', 'Integration C behaviour.', '',
  '### Integration C details', 'Obligation currentness.', '',
  '## A18 — Local git workspace and command verification adapters', 'Adapters run in a local git workspace; they are not a sandbox.', '',
  '```md', '## not a heading inside fenced code', '```', '',
  '## Boundaries', 'No live provider exists; default tests use injected fixtures.'
].join('\n');

function repo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-jev-living-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
  // Local diff configuration must not change the derived ranges.
  git('config', 'diff.algorithm', 'patience'); git('config', 'diff.context', '9');
  fs.mkdirSync(path.join(root, path.dirname(DOC)), { recursive: true });
  fs.writeFileSync(path.join(root, DOC), baselineDoc);
  git('add', '.'); git('commit', '-q', '-m', 'baseline');
  const baseline = git('rev-parse', 'HEAD');
  fs.writeFileSync(path.join(root, DOC), candidateDoc);
  git('commit', '-qam', 'candidate');
  return { root, git, baseline, candidate: git('rev-parse', 'HEAD') };
}

function payload({ doc = candidateDoc, evidenceBody = 'passed', constraints = [] } = {}) {
  return {
    model: MODEL,
    state: {
      objective: { successCriteria: ['A'] },
      plan: { kind: 'BLACKBOARD_ARTIFACT', artifactType: 'READY_IMPLEMENT_PLAN', artifactId: 'BB-T', objective: {}, scope: ['local git workspace'], outOfScope: [], constraints, invariants: [], architectureDecisions: [], implementationSlices: [], negativeVerificationCases: [], sourceSeams: { expectedNew: [], expectedTests: [] },
        livingDocs: { refs: [DOC], questionId: 'LIVING_DOCS', statement: 'Docs describe A18.' },
        acceptanceCriteria: [{ id: 'A', statement: 'Claim A', verificationIds: ['unit'], evidenceRequired: [] }],
        verificationPlan: [{ id: 'unit', command: 'npm run unit' }] },
      evidence: [{ id: 'A', evidenceRefs: ['evidence/unit.txt'] }],
      sources: [{ ref: DOC, hash: hash(doc), body: doc, deleted: false }],
      verification: [{ id: 'unit', command: 'npm run unit', exitCode: 0, logRef: 'evidence/unit.txt' }],
      evidenceFiles: [{ ref: 'evidence/unit.txt', hash: hash(evidenceBody), body: evidenceBody }]
    },
    questions: { A: question, LIVING_DOCS: question }
  };
}

test('markdown sections split on ##/### headings outside fenced code', () => {
  const sections = markdownSections(candidateDoc);
  assert.deepEqual(sections.map(section => section.heading), [null, '## A16 — Earlier capability', '## A17 — Cross-domain obligations', '### Integration C details', '## A18 — Local git workspace and command verification adapters', '## Boundaries']);
  assert.equal(sections.map(section => section.text).join('\n'), candidateDoc);
  assert.match(sections[4].text, /## not a heading inside fenced code/);
});

test('change map is derived from exact commits with pinned diff options', t => {
  const r = repo(t);
  const changes = livingDocChanges(r.root, r.baseline, r.candidate, [DOC]);
  assert.deepEqual(changes, { [DOC]: [[13, 19], [21, 21]] });
  assert.deepEqual(livingDocChanges(r.root, r.baseline, r.candidate, [DOC, DOC]), changes, 'deterministic, deduplicated refs');
  assert.deepEqual(livingDocChanges(r.root, r.baseline, r.baseline, [DOC]), { [DOC]: [] });
  assert.throws(() => livingDocChanges(r.root, 'main', r.candidate, [DOC]), /exact commits/);
});

test('Living Docs question receives every whole section the candidate added or modified', t => {
  const r = repo(t);
  const livingChanges = livingDocChanges(r.root, r.baseline, r.candidate, [DOC]);
  const full = payload();
  const source = workerQuestionPayload(full, 'LIVING_DOCS', { livingExcerptStrategy: CHANGED, livingChanges }).state.sources[0];
  assert.equal(source.excerptStrategy, CHANGED);
  assert.deepEqual(source.changedSections, ['## A18 — Local git workspace and command verification adapters', '## Boundaries']);
  assert.equal(source.hash, hash(candidateDoc));
  assert.equal(source.bytes, Buffer.byteLength(candidateDoc));
  assert.equal(source.omittedSections, 3);
  assert.match(source.body, /^# Capabilities\nProjection of delivered capabilities\./, 'preamble is kept');
  assert.match(source.body, /Adapters run in a local git workspace; they are not a sandbox\./);
  assert.match(source.body, /## not a heading inside fenced code/);
  assert.match(source.body, /default tests use injected fixtures/);
  assert.match(source.body, /unchanged Living Doc sections omitted; the full document is bound by hash/);
  assert.doesNotMatch(source.body, /Older behaviour|Integration C behaviour|Obligation currentness/, 'unchanged sections, including A17/Integration C, are omitted');
  // The SCOPED selection that retained evaluations used would have hidden A18.
  const scoped = workerQuestionPayload(full, 'LIVING_DOCS', { livingExcerptStrategy: SCOPED }).state.sources[0];
  assert.doesNotMatch(scoped.body, /A18/);
  assert.deepEqual(workerQuestionPayload(full, 'LIVING_DOCS', { livingExcerptStrategy: CHANGED, livingChanges }), workerQuestionPayload(full, 'LIVING_DOCS', { livingExcerptStrategy: CHANGED, livingChanges }), 'deterministic');
});

test('criterion questions keep the SCOPED Living Doc selection byte-for-byte', () => {
  const full = payload();
  const livingChanges = { [DOC]: [[13, 20]] };
  assert.equal(canonical(workerQuestionPayload(full, 'A', { livingChanges })), canonical(workerQuestionPayload(full, 'A', { livingExcerptStrategy: SCOPED })));
});

test('a Living Doc with no changed lines falls back to the SCOPED selection', () => {
  const full = payload();
  const source = workerQuestionPayload(full, 'LIVING_DOCS', { livingExcerptStrategy: CHANGED, livingChanges: { [DOC]: [] } }).state.sources[0];
  const scoped = workerQuestionPayload(full, 'LIVING_DOCS', { livingExcerptStrategy: SCOPED }).state.sources[0];
  assert.deepEqual(source, { ...scoped, excerptStrategy: CHANGED, changedSections: [] });
});

test('blank separator lines do not mark the neighbouring section as changed', () => {
  const full = payload();
  // Candidate lines 12 (blank line closing Integration C details) and 13-14 (new A18 heading and text).
  const source = workerQuestionPayload(full, 'LIVING_DOCS', { livingExcerptStrategy: CHANGED, livingChanges: { [DOC]: [[12, 14]] } }).state.sources[0];
  assert.deepEqual(source.changedSections, ['## A18 — Local git workspace and command verification adapters']);
  const blankOnly = workerQuestionPayload(full, 'LIVING_DOCS', { livingExcerptStrategy: CHANGED, livingChanges: { [DOC]: [[12, 12]] } }).state.sources[0];
  assert.deepEqual(blankOnly.changedSections, ['### Integration C details']);
});

test('Living Docs selection fails closed without a valid change map or with an unknown strategy', () => {
  const full = payload();
  assert.throws(() => workerQuestionBatches(full, 'LIVING_DOCS'), /candidate change map missing/);
  assert.throws(() => workerQuestionBatches(full, 'LIVING_DOCS', { candidateChanges: {} }), /Living Doc change map missing/);
  assert.throws(() => workerQuestionBatches(full, 'LIVING_DOCS', { livingExcerptStrategy: CHANGED }), /Living Doc change map missing/);
  assert.throws(() => workerQuestionBatches(full, 'LIVING_DOCS', { livingExcerptStrategy: CHANGED, livingChanges: { [DOC]: [[0, 3]] } }), /Living Doc change map missing/);
  assert.throws(() => workerQuestionBatches(full, 'LIVING_DOCS', { livingChanges: {}, livingExcerptStrategy: 'NEWEST' }), /unknown Living Doc excerpt strategy/);
});

test('changed sections stay within the batch limit using bounded evidence excerpts, and oversize input fails closed', () => {
  const lines = ['', '> exharness@0.0.0 verify', ''];
  for (let index = 0; index < 3000; index++) lines.push(`ok ${index + 1} - behaviour ${index} holds`);
  lines.push('# tests 3000', '# pass 3000', '# fail 0', 'exitCode=0', '');
  const bigSection = `## A18 — Local git workspace\n${'Adapter detail line.\n'.repeat(1200)}`;
  const doc = `${candidateDoc}\n${bigSection}`;
  const full = payload({ doc, evidenceBody: lines.join('\n') });
  const lastLine = doc.split('\n').length;
  const livingChanges = { [DOC]: [[13, lastLine]] };
  const [batch, ...rest] = workerQuestionBatches(full, 'LIVING_DOCS', { livingExcerptStrategy: CHANGED, livingChanges });
  assert.equal(rest.length, 0);
  assert.ok(bytes(batch.payload) <= WORKER_BATCH_LIMITS.maxBatchBytes);
  assert.ok(batch.payload.state.sources[0].body.includes('Adapter detail line.'), 'whole changed section is sent');
  const huge = payload({ doc: `${candidateDoc}\n## A19\n${'x'.repeat(70000)}` });
  assert.throws(() => workerQuestionBatches(huge, 'LIVING_DOCS', { livingExcerptStrategy: CHANGED, livingChanges: { [DOC]: [[13, 30]] } }), /worker batch exceeds bounded input: LIVING_DOCS/);
});

test('new batched evaluations record DELIVERY; retained CHANGED and SCOPED evaluations still validate', async t => {
  const r = repo(t);
  fs.mkdirSync(path.join(r.root, 'docs/blackboard'), { recursive: true });
  fs.writeFileSync(path.join(r.root, 'docs/blackboard/jev-policy.json'), JSON.stringify({ model: MODEL, policy: 'atomic-claims-1' }));
  const livingChanges = livingDocChanges(r.root, r.baseline, r.candidate, [DOC]);
  const full = payload();
  full.state.evidenceFiles[0].body = 'p'.repeat(62000); full.state.evidenceFiles[0].hash = hash(full.state.evidenceFiles[0].body);
  const materialized = { lane: 'WORKER', subject: { workId: 'BB-T', plan: { ref: 'plan.json', hash: 'a'.repeat(64) } }, payload: full, stateHash: 'b'.repeat(64), specHash: 'c'.repeat(64), cacheKey: 'd'.repeat(64), livingChanges, candidateChanges: {} };
  assert.ok(bytes(full) > WORKER_BATCH_LIMITS.maxBatchBytes, 'fixture is batched');
  const sent = [];
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body); sent.push(body);
    const [id] = Object.keys(body.questions);
    return new Response(JSON.stringify({ model: MODEL, answers: { [id]: { type: 'choice', choice: 'SATISFIED', confidence: 0.9, probabilities: { SATISFIED: 1, IMPLEMENTATION_DEFECT: 0, INSUFFICIENT_EVIDENCE: 0, PLAN_INPUT_CONTRADICTION: 0 } } }, usage: { input_tokens: 10, output_tokens: 1 } }), { status: 200 });
  };
  const evaluation = await evaluate(materialized, { root: r.root, fetchImpl, apiKey: 'fixture-key', bypassCache: true });
  assert.equal(evaluation.metrics.batching.livingExcerptStrategy, DELIVERY);
  assert.equal(evaluation.metrics.batching.criterionSourceStrategy, CRITERION_SOURCE_STRATEGIES.RANKED);
  const living = sent.find(body => body.questions.LIVING_DOCS).state;
  assert.match(living.sources[0].body, /A18 — Local git workspace/);
  assert.deepEqual(living.verification.map(run => run.id), ['unit'], 'Living Docs question receives the plan verification runs');
  assert.equal(living.evidenceFiles[0].excerpted, true);
  assert.equal(validateEvaluation(evaluation, materialized), evaluation);
  const retainedAs = (strategy, record) => {
    const manifest = workerBatchManifest(full, { livingExcerptStrategy: strategy, criterionSourceStrategy: CRITERION_SOURCE_STRATEGIES.TERM_LINES, livingChanges, candidateChanges: {} });
    const { livingExcerptStrategy, criterionSourceStrategy, ...rest } = evaluation.metrics.batching;
    return { ...evaluation, metrics: { ...evaluation.metrics, batching: { ...rest, ...(record ? { livingExcerptStrategy: strategy } : {}), manifest } } };
  };
  const changed = retainedAs(CHANGED, true), scoped = retainedAs(SCOPED, false);
  assert.notDeepEqual(changed.metrics.batching.manifest, evaluation.metrics.batching.manifest);
  assert.notDeepEqual(scoped.metrics.batching.manifest, changed.metrics.batching.manifest);
  assert.equal(validateEvaluation(changed, materialized), changed, 'retained CHANGED evaluation (BB-096, BB-053) validates');
  assert.equal(validateEvaluation(scoped, materialized), scoped, 'retained evaluation without a strategy validates as SCOPED');
  assert.throws(() => validateEvaluation({ ...changed, metrics: { ...changed.metrics, batching: { ...changed.metrics.batching, livingExcerptStrategy: DELIVERY } } }, materialized), /worker batch manifest mismatch/);
  assert.throws(() => validateEvaluation({ ...evaluation, metrics: { ...evaluation.metrics, batching: { ...evaluation.metrics.batching, livingExcerptStrategy: 'NEWEST' } } }, materialized), /unknown Living Doc excerpt strategy/);
  assert.throws(() => validateEvaluation(evaluation, { ...materialized, candidateChanges: undefined }), /candidate change map missing/);
  assert.throws(() => validateEvaluation(evaluation, { ...materialized, livingChanges: undefined }), /Living Doc change map missing/);
});
