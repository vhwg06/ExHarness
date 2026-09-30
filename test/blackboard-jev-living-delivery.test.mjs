import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { canonical, hash } from '../scripts/blackboard-delivery-contract.mjs';
import {
  CURRENT_LIVING_EXCERPT_STRATEGY, LIVING_DELIVERY_LIMITS, LIVING_EXCERPT_STRATEGIES, candidateChangeExcerpt, candidateSourceChanges,
  livingDocChanges, workerBatchManifest, workerQuestionBatches, workerQuestionPayload
} from '../scripts/blackboard-jev.mjs';

// LIVING_DELIVERY_EVIDENCE_V3: the Living Docs question of a bounded worker
// batch must receive the delivery evidence the docs are checked against.
const { SCOPED, CHANGED, DELIVERY } = LIVING_EXCERPT_STRATEGIES;
const MODEL = 'jev-1.13.0';
const DOC = 'docs/living/system/state.md';
const IMPL = 'src/workspace.mjs';
const TEST = 'test/workspace.test.mjs';
const bytes = value => Buffer.byteLength(canonical(value));
const criteria = { SATISFIED: 'Supported', IMPLEMENTATION_DEFECT: 'Defect', INSUFFICIENT_EVIDENCE: 'Missing', PLAN_INPUT_CONTRADICTION: 'Contradiction' };
const question = { type: 'choice', instructions: 'Judge the evidence', criteria };

const baselineImpl = ['// Workspace adapter.', 'export const version = 1;'].join('\n');
const candidateImpl = [
  '// Workspace adapter.', 'export const version = 2;', '',
  '// Runs a command inside the local git workspace; not a sandbox.',
  'export function runCommand(command) {',
  '  if (typeof command !== "string") fail("command must be a string");',
  '  const result = spawn(command);',
  '  return result;',
  '}'
].join('\n');
const baselineTest = 'import test from "node:test";';
const candidateTest = ['import test from "node:test";', 'test("runCommand rejects non-strings", () => {});'].join('\n');
const baselineDoc = ['# Current system', 'Baseline.', '', '## Workspace', 'Version one.', '', '## Boundaries', 'None.'].join('\n');
const candidateDoc = ['# Current system', 'Baseline.', '', '## Workspace', 'Version two runs commands in a local git workspace.', '', '## Boundaries', 'None.'].join('\n');

function repo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-jev-delivery-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  // Files end with a newline; materialized bodies are trimEnd()ed like git().
  const write = (ref, body) => { fs.mkdirSync(path.join(root, path.dirname(ref)), { recursive: true }); fs.writeFileSync(path.join(root, ref), typeof body === 'string' ? `${body}\n` : body); };
  git('init', '-q', '-b', 'main'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'diff.algorithm', 'patience'); git('config', 'diff.context', '9');
  write(IMPL, baselineImpl); write(TEST, baselineTest); write(DOC, baselineDoc);
  write('src/retired.mjs', 'export const retired = true;');
  write('assets/logo.bin', Buffer.from([1, 0, 2]));
  git('add', '.'); git('commit', '-q', '-m', 'baseline');
  const baseline = git('rev-parse', 'HEAD');
  write(IMPL, candidateImpl); write(TEST, candidateTest); write(DOC, candidateDoc);
  write('assets/logo.bin', Buffer.from([1, 0, 3]));
  git('rm', '-q', 'src/retired.mjs'); git('add', '.'); git('commit', '-q', '-m', 'candidate');
  return { root, git, baseline, candidate: git('rev-parse', 'HEAD') };
}

const source = (ref, body) => ({ ref, hash: hash(body), body, deleted: false });
function sources(root, candidate) {
  const show = ref => execFileSync('git', ['show', `${candidate}:${ref}`], { cwd: root, encoding: 'utf8' }).trimEnd();
  return [source(DOC, candidateDoc), source(IMPL, candidateImpl), source(TEST, candidateTest), source('assets/logo.bin', show('assets/logo.bin')),
    { ref: 'src/retired.mjs', hash: hash(''), body: '', deleted: true }, source('src/unchanged.mjs', 'export const same = 1;')];
}

function payload(state = {}) {
  const log = ['> node --test test/workspace.test.mjs', ...Array.from({ length: 400 }, (_, i) => `ok ${i + 1} - case ${i + 1} ${'x'.repeat(40)}`), '# tests 400', '# pass 400', '# fail 0'].join('\n');
  return {
    model: MODEL,
    state: {
      objective: { successCriteria: ['A'] },
      plan: { kind: 'BLACKBOARD_ARTIFACT', artifactType: 'READY_IMPLEMENT_PLAN', artifactId: 'BB-T', objective: {}, scope: ['workspace'], outOfScope: [], constraints: ['Keep the adapter interface'], invariants: [], architectureDecisions: [], implementationSlices: [], negativeVerificationCases: [],
        sourceSeams: { requiredExisting: [IMPL], expectedNew: [], expectedTests: [TEST] },
        livingDocs: { refs: [DOC], questionId: 'LIVING_DOCS', statement: 'Docs describe the workspace adapter.' },
        acceptanceCriteria: [{ id: 'A', statement: 'runCommand exists', verificationIds: ['unit'], evidenceRequired: ['unit log'] }, { id: 'B', statement: 'suite passes', verificationIds: ['suite'], evidenceRequired: [] }],
        verificationPlan: [{ id: 'unit', command: `node --test ${TEST}` }, { id: 'suite', command: 'npm run verify' }] },
      evidence: [{ id: 'A', evidenceRefs: ['evidence/unit.txt'] }, { id: 'B', evidenceRefs: ['evidence/suite.txt'] }],
      sources: state.sources,
      verification: [
        { id: 'unit', command: `node --test ${TEST}`, exitCode: 0, status: 'PASSED', logRef: 'evidence/unit.txt' },
        { id: 'suite', command: 'npm run verify', exitCode: 0, status: 'PASSED', logRef: 'evidence/suite.txt' }
      ],
      evidenceFiles: [{ ref: 'evidence/suite.txt', hash: hash(log), body: log }, { ref: 'evidence/unit.txt', hash: hash('# pass 1'), body: '# pass 1' }]
    },
    questions: { A: question, B: question, LIVING_DOCS: question }
  };
}

function inputs(t) {
  const r = repo(t);
  const bound = sources(r.root, r.candidate);
  const changedRefs = [IMPL, TEST, 'assets/logo.bin', 'src/retired.mjs'];
  const candidateChanges = candidateSourceChanges(r.root, r.baseline, r.candidate, changedRefs, bound);
  const livingChanges = livingDocChanges(r.root, r.baseline, r.candidate, [DOC]);
  return { r, bound, candidateChanges, livingChanges, full: payload({ sources: bound }) };
}

test('DELIVERY is the current strategy for new batched worker evaluations', () => {
  assert.equal(CURRENT_LIVING_EXCERPT_STRATEGY, DELIVERY);
  assert.deepEqual(Object.values(LIVING_EXCERPT_STRATEGIES), ['LIVING_SCOPED_SECTIONS_V1', 'LIVING_CHANGED_SECTIONS_V2', 'LIVING_DELIVERY_EVIDENCE_V3']);
});

test('candidate change map binds changed bodies to the materialized source hashes', t => {
  const { r, bound, candidateChanges } = inputs(t);
  assert.deepEqual(Object.keys(candidateChanges), ['assets/logo.bin', 'src/retired.mjs', IMPL, TEST]);
  assert.deepEqual(candidateChanges[IMPL], { ranges: [[2, 9]], body: candidateImpl });
  assert.deepEqual(candidateChanges[TEST], { ranges: [[2, 2]], body: candidateTest });
  assert.equal(candidateChanges['src/retired.mjs'].deleted, true);
  assert.equal(candidateChanges['assets/logo.bin'].binary, true);
  assert.equal('body' in candidateChanges['assets/logo.bin'], false, 'binary files stay hash stubs');
  const drifted = bound.map(entry => entry.ref === IMPL ? { ...entry, hash: hash('other') } : entry);
  assert.throws(() => candidateSourceChanges(r.root, r.baseline, r.candidate, [IMPL], drifted), /candidate change body differs from bound source: src\/workspace\.mjs/);
  assert.throws(() => candidateSourceChanges(r.root, r.baseline, r.candidate, ['src/elsewhere.mjs'], bound), /candidate change outside materialized sources/);
  assert.throws(() => candidateSourceChanges(r.root, 'main', r.candidate, [IMPL], bound), /exact commits/);
});

test('change excerpts are numbered, hash-bound and keep the outline and failure lines first', () => {
  const body = [
    ...Array.from({ length: 200 }, (_, i) => `  const filler${i} = compute(${i}) + ${'y'.repeat(30)};`),
    'export function guard(input) {',
    '  if (!input) fail("input required");',
    '}',
    ''
  ].join('\n');
  const bound = source('src/big.mjs', body);
  const change = { ranges: [[1, 203]], body };
  const excerpt = candidateChangeExcerpt(bound, change, 2048);
  assert.ok(bytes(excerpt) <= 2048);
  assert.equal(excerpt.hash, bound.hash);
  assert.equal(excerpt.bytes, Buffer.byteLength(body));
  assert.equal(excerpt.excerptStrategy, 'CANDIDATE_CHANGE_EXCERPT_V1');
  assert.equal(excerpt.changedLines, 203);
  assert.ok(excerpt.omittedChangedLines > 0);
  assert.match(excerpt.body, /^201: export function guard\(input\) \{$/m);
  assert.match(excerpt.body, /^202:   if \(!input\) fail\("input required"\);$/m);
  assert.match(excerpt.body, /^…$/m, 'gaps are marked');
  assert.match(excerpt.body, /further changed lines omitted; the full candidate file is bound by hash/);
  assert.deepEqual(candidateChangeExcerpt(bound, change, 2048), excerpt, 'deterministic');
  const small = candidateChangeExcerpt(source(IMPL, candidateImpl), { ranges: [[2, 2], [4, 10]], body: candidateImpl });
  assert.equal(small.omittedChangedLines, 0);
  assert.equal(small.body, ['2: export const version = 2;', '…', ...candidateImpl.split('\n').slice(3, 9).map((line, i) => `${i + 4}: ${line}`)].join('\n'));
  assert.throws(() => candidateChangeExcerpt(bound, { ranges: [[1, 2]], body: `${body}!` }), /candidate change body differs from bound source/);
  assert.throws(() => candidateChangeExcerpt(bound, { ranges: [[0, 2]], body }), /candidate change map missing/);
  assert.throws(() => candidateChangeExcerpt(bound, { ranges: [[1, 2]] }), /candidate change map missing/);
  assert.throws(() => candidateChangeExcerpt(bound, change, 200), /candidate change excerpt exceeds budget/);
});

test('Living Docs question receives every verification run, every evidence log, the plan mapping and changed-source excerpts', t => {
  const { full, candidateChanges, livingChanges } = inputs(t);
  const options = { livingChanges, candidateChanges };
  const [batch, ...rest] = workerQuestionBatches(full, 'LIVING_DOCS', options);
  assert.equal(rest.length, 0);
  const state = batch.payload.state;
  assert.ok(bytes(batch.payload) <= 60000);
  assert.deepEqual(state.verification, full.state.verification, 'all plan verification runs, not only exact expected-test matches');
  assert.deepEqual(state.evidenceFiles.map(file => file.ref), ['evidence/suite.txt', 'evidence/unit.txt']);
  const suite = state.evidenceFiles[0];
  assert.equal(suite.excerpted, true);
  assert.equal(suite.hash, full.state.evidenceFiles[0].hash);
  assert.ok(bytes(suite) <= LIVING_DELIVERY_LIMITS.evidenceLogBytes);
  assert.match(suite.body, /# pass 400/);
  assert.deepEqual(state.evidenceFiles[1], full.state.evidenceFiles[1], 'small logs are sent whole');
  assert.deepEqual(state.evidence, full.state.evidence);
  assert.deepEqual(state.plan.acceptanceCriteria, [{ id: 'A', statement: 'runCommand exists', verificationIds: ['unit'] }, { id: 'B', statement: 'suite passes', verificationIds: ['suite'] }]);
  assert.deepEqual(state.plan.verificationPlan, full.state.plan.verificationPlan);
  assert.equal('constraints' in state.plan, false, 'the Living Docs plan projection stays bounded');
  assert.equal(state.livingEvidence.strategy, DELIVERY);
  const byRef = Object.fromEntries(state.sources.map(entry => [entry.ref, entry]));
  assert.equal(byRef[DOC].excerptStrategy, CHANGED);
  assert.deepEqual(byRef[DOC].changedSections, ['## Workspace']);
  assert.match(byRef[IMPL].body, /^6:   if \(typeof command !== "string"\) fail\("command must be a string"\);$/m);
  assert.match(byRef[TEST].body, /^2: test\("runCommand rejects non-strings"/m);
  assert.equal(byRef[IMPL].hash, hash(candidateImpl));
  for (const ref of ['src/unchanged.mjs', 'assets/logo.bin']) assert.deepEqual(byRef[ref], { ref, hash: byRef[ref].hash, bytes: byRef[ref].bytes, omitted: true, deleted: false });
  assert.equal(byRef['src/retired.mjs'].deleted, true);
  assert.deepEqual(workerQuestionBatches(full, 'LIVING_DOCS', options), workerQuestionBatches(full, 'LIVING_DOCS', options), 'deterministic');
});

test('criterion questions are unchanged by the DELIVERY strategy', t => {
  const { full, candidateChanges, livingChanges } = inputs(t);
  for (const id of ['A', 'B'])
    assert.equal(canonical(workerQuestionBatches(full, id, { livingChanges, candidateChanges })), canonical(workerQuestionBatches(full, id, { livingExcerptStrategy: CHANGED, livingChanges })));
  const current = workerBatchManifest(full, { livingChanges, candidateChanges });
  const changed = workerBatchManifest(full, { livingExcerptStrategy: CHANGED, livingChanges });
  const scoped = workerBatchManifest(full, { livingExcerptStrategy: SCOPED });
  assert.deepEqual(current.filter(entry => entry.id !== 'LIVING_DOCS'), changed.filter(entry => entry.id !== 'LIVING_DOCS'));
  assert.notDeepEqual(current.find(entry => entry.id === 'LIVING_DOCS'), changed.find(entry => entry.id === 'LIVING_DOCS'));
  assert.notDeepEqual(changed.find(entry => entry.id === 'LIVING_DOCS'), scoped.find(entry => entry.id === 'LIVING_DOCS'));
});

test('changed-source excerpts put implementation before tests and stay within the total budget', t => {
  const { full, livingChanges } = inputs(t);
  const many = {}, bodies = [];
  for (let i = 0; i < 12; i++) {
    const ref = i < 6 ? `test/case${String(i).padStart(2, '0')}.test.mjs` : `src/mod${String(i).padStart(2, '0')}.mjs`;
    const body = Array.from({ length: 120 }, (_, n) => `export const value${n} = ${'z'.repeat(40)};`).join('\n');
    bodies.push(source(ref, body)); many[ref] = { ranges: [[1, 120]], body };
  }
  const wide = { ...full, state: { ...full.state, sources: [...full.state.sources, ...bodies] } };
  const state = workerQuestionPayload(wide, 'LIVING_DOCS', { livingChanges, candidateChanges: many }).state;
  const excerpts = state.sources.filter(entry => entry.excerptStrategy === 'CANDIDATE_CHANGE_EXCERPT_V1');
  assert.ok(excerpts.reduce((sum, entry) => sum + bytes(entry), 0) <= LIVING_DELIVERY_LIMITS.changeTotalBytes);
  assert.ok(excerpts.every(entry => bytes(entry) <= LIVING_DELIVERY_LIMITS.changeFileBytes));
  const excerpted = new Set(excerpts.map(entry => entry.ref));
  assert.ok([...Object.keys(many).filter(ref => ref.startsWith('src/'))].every(ref => excerpted.has(ref)), 'every implementation source is excerpted before any test');
  assert.ok(!excerpted.has('test/case05.test.mjs'), 'tests are taken in ref order until the budget is spent');
  const stubbed = state.sources.filter(entry => entry.omitted && many[entry.ref]);
  assert.ok(stubbed.length > 0, 'sources beyond the budget stay hash stubs');
  assert.ok(stubbed.every(entry => entry.hash === hash(many[entry.ref].body)));

});

test('DELIVERY fails closed on a missing or drifted change map', t => {
  const { full, candidateChanges, livingChanges } = inputs(t);
  assert.throws(() => workerQuestionBatches(full, 'LIVING_DOCS', { livingChanges }), /candidate change map missing/);
  assert.throws(() => workerQuestionBatches(full, 'LIVING_DOCS', { candidateChanges }), /Living Doc change map missing/);
  const drifted = { ...candidateChanges, [IMPL]: { ...candidateChanges[IMPL], body: `${candidateImpl}// drift\n` } };
  assert.throws(() => workerQuestionBatches(full, 'LIVING_DOCS', { livingChanges, candidateChanges: drifted }), /candidate change body differs from bound source/);
  const outside = { ...candidateChanges, 'src/ghost.mjs': { ranges: [[1, 1]], body: 'x' } };
  assert.throws(() => workerQuestionBatches(full, 'LIVING_DOCS', { livingChanges, candidateChanges: outside }), /candidate change outside materialized sources/);
});
