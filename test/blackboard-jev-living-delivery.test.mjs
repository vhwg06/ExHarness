import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { canonical, hash } from '../scripts/blackboard-delivery-contract.mjs';
import {
  CURRENT_LIVING_EXCERPT_STRATEGY, LIVING_COHESIVE_LIMITS, LIVING_DELIVERY_LIMITS, LIVING_EXCERPT_STRATEGIES, WORKER_BATCH_LIMITS, candidateChangeExcerpt, candidateSourceChanges,
  evaluate, excerptCompactEvidenceLog, livingDocChanges, validateEvaluation, workerBatchManifest, workerQuestionBatches, workerQuestionPayload
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

test('COHESIVE is the current strategy for new batched worker evaluations', () => {
  assert.equal(CURRENT_LIVING_EXCERPT_STRATEGY, LIVING_EXCERPT_STRATEGIES.COHESIVE);
  assert.deepEqual(Object.values(LIVING_EXCERPT_STRATEGIES), ['LIVING_SCOPED_SECTIONS_V1', 'LIVING_CHANGED_SECTIONS_V2', 'LIVING_DELIVERY_EVIDENCE_V3', 'LIVING_DELIVERY_EVIDENCE_V4']);
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
  assert.equal(state.livingEvidence.strategy, LIVING_EXCERPT_STRATEGIES.COHESIVE);
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
    assert.equal(canonical(workerQuestionBatches(full, id, { livingChanges, candidateChanges })), canonical(workerQuestionBatches(full, id, { livingExcerptStrategy: CHANGED, livingChanges, candidateChanges })));
  const current = workerBatchManifest(full, { livingChanges, candidateChanges });
  const changed = workerBatchManifest(full, { livingExcerptStrategy: CHANGED, livingChanges, candidateChanges });
  const scoped = workerBatchManifest(full, { livingExcerptStrategy: SCOPED, candidateChanges });
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

test('DELIVERY fails closed on a missing or drifted change map', t => {
  const { full, candidateChanges, livingChanges } = inputs(t);
  assert.throws(() => workerQuestionBatches(full, 'LIVING_DOCS', { livingChanges }), /candidate change map missing/);
  assert.throws(() => workerQuestionBatches(full, 'LIVING_DOCS', { candidateChanges }), /Living Doc change map missing/);
  const drifted = { ...candidateChanges, [IMPL]: { ...candidateChanges[IMPL], body: `${candidateImpl}// drift\n` } };
  assert.throws(() => workerQuestionBatches(full, 'LIVING_DOCS', { livingChanges, candidateChanges: drifted }), /candidate change body differs from bound source/);
  const outside = { ...candidateChanges, 'src/ghost.mjs': { ranges: [[1, 1]], body: 'x' } };
  assert.throws(() => workerQuestionBatches(full, 'LIVING_DOCS', { livingChanges, candidateChanges: outside }), /candidate change outside materialized sources/);
});

// BB-055 replica: 10 evidence files with the evaluated byte sizes, four Living
// Docs with changed sections and nine changed sources sized from the
// materialized input. The V3 path splits the evidence across 4 parts (part 1
// holds only the unrelated regression log); V4 keeps every log in one part.
const BB055_LOG_SIZES = [
  ['agentic-regression', 90907],
  ['cross-domain-regression', 3121],
  ['deployment-qa-regression', 3497],
  ['product-closure-race', 659],
  ['product-closure', 688],
  ['product-completeness-chain', 335],
  ['product-history-recovery', 491],
  ['product-history', 701],
  ['product-revalidation', 736],
  ['product-state-projection', 1452]
];
function bb055TapBody(size, tag) {
  const lines = [`> npm run ${tag}`, 'TAP version 13'];
  let n = 0;
  while (Buffer.byteLength(`${lines.join('\n')}\n# tests ${n}\n# pass ${n}\n# fail 0\nexitCode=0`) < size) {
    n++;
    lines.push(`ok ${n} - ${tag} case ${n} holds`);
  }
  lines.push(`# tests ${n}`, `# pass ${n}`, '# fail 0', 'exitCode=0');
  let body = lines.join('\n');
  while (Buffer.byteLength(body) > size) body = body.replace(/^ok 1 - .*$/m, match => match.slice(0, Math.max(0, match.length - (Buffer.byteLength(body) - size))));
  if (Buffer.byteLength(body) < size) body += ' '.repeat(size - Buffer.byteLength(body));
  assert.equal(Buffer.byteLength(body), size);
  return body;
}
function bb055Fixture() {
  const docNames = ['capabilities.md', 'contracts.md', 'project-acceptance.md', 'state.md'];
  const sectionSizes = [3400, 4300, 2500, 2800];
  const docPad = 2000;
  const evidenceFiles = BB055_LOG_SIZES.map(([tag, size]) => {
    const body = bb055TapBody(size, tag);
    return { ref: `evidence/${tag}.txt`, hash: hash(body), body };
  }).sort((a, b) => a.ref.localeCompare(b.ref));
  const sources = [];
  const livingChanges = {};
  docNames.forEach((name, index) => {
    const ref = `docs/living/${name}`;
    const body = `# Title ${name}\nIntro line one.\nIntro line two.\n\n## Changed ${name}\n${'D'.repeat(sectionSizes[index] + docPad - 40)}\nline-a\nline-b\n\n## Other\nUnchanged other section text.\n`;
    sources.push({ ref, hash: hash(body), body, deleted: false });
    const lines = body.split('\n');
    const start = lines.findIndex(line => line.startsWith('## Changed')) + 1;
    livingChanges[ref] = [[start, start + 2]];
  });
  const candidateChanges = {};
  for (let i = 0; i < 9; i++) {
    const ref = `src/mod${String(i).padStart(2, '0')}.mjs`;
    const out = [`// m${i} module.`];
    for (let n = 0; n < 70; n++) out.push(`export const m${i}Value${n} = compute("${'y'.repeat(24)}", ${n});`);
    const body = out.join('\n');
    sources.push({ ref, hash: hash(body), body, deleted: false });
    candidateChanges[ref] = { ranges: [[2, 71]], body };
  }
  for (let i = 0; i < 6; i++) sources.push({ ref: `src/unchanged${i}.mjs`, hash: hash(`u${i}`), bytes: 2000 + i, omitted: true, deleted: false });
  const runs = BB055_LOG_SIZES.map(([tag], index) => ({ id: `run-${index}`, command: `node --test packages/agentic-system/test/${tag}.test.js packages/agentic-system/test/extra${index}.test.js`, exitCode: 0, logRef: `evidence/${tag}.txt` }));
  const criteria = Array.from({ length: 17 }, (_, index) => ({ id: `AC-${index + 1}`, statement: `Claim ${index + 1} holds for the delivered widget under closure currentness and projection determinism`, verificationIds: [`run-${index % 10}`], evidenceRequired: [`run-${index % 10} log shows passing tests`] }));
  const full = {
    model: MODEL,
    state: {
      objective: { successCriteria: criteria.map(criterion => `Objective success ${criterion.id}: ${criterion.statement}`) },
      plan: {
        kind: 'BLACKBOARD_ARTIFACT', artifactType: 'READY_IMPLEMENT_PLAN', artifactId: 'BB-T', objective: {},
        scope: ['widget'], outOfScope: [], constraints: [], invariants: [], architectureDecisions: [],
        implementationSlices: [], negativeVerificationCases: [],
        sourceSeams: { requiredExisting: [], expectedNew: [], expectedTests: [] },
        livingDocs: { refs: docNames.map(name => `docs/living/${name}`), questionId: 'LIVING_DOCS', statement: 'Docs describe the widget.' },
        acceptanceCriteria: criteria,
        verificationPlan: runs.map(run => ({ id: run.id, command: run.command }))
      },
      evidence: criteria.map((criterion, index) => ({ id: criterion.id, evidenceRefs: [`evidence/${BB055_LOG_SIZES[index % BB055_LOG_SIZES.length][0]}.txt`] })),
      sources,
      verification: runs,
      evidenceFiles
    },
    questions: Object.fromEntries([...criteria.map(criterion => criterion.id), 'LIVING_DOCS'].map(id => [id, question]))
  };
  return { full, livingChanges, candidateChanges };
}

test('BB-055 replica: V3 splits the evidence across 4 parts while V4 keeps every log in one part', () => {
  const { full, livingChanges, candidateChanges } = bb055Fixture();
  const options = { livingChanges, candidateChanges };
  const oldBatches = workerQuestionBatches(full, 'LIVING_DOCS', { ...options, livingExcerptStrategy: LIVING_EXCERPT_STRATEGIES.DELIVERY });
  assert.equal(oldBatches.length, 4, 'the old path reproduces the evaluated 4-part layout');
  const oldRefs = oldBatches.map(batch => batch.payload.state.batch.evidenceRefs);
  assert.deepEqual(oldRefs[0], ['evidence/agentic-regression.txt'], 'part 1 holds only the unrelated regression log');
  assert.deepEqual(oldRefs[1], ['evidence/cross-domain-regression.txt']);
  assert.deepEqual(oldRefs[2], ['evidence/deployment-qa-regression.txt', 'evidence/product-closure-race.txt', 'evidence/product-closure.txt', 'evidence/product-completeness-chain.txt', 'evidence/product-history-recovery.txt']);
  assert.deepEqual(oldRefs[3], ['evidence/product-history.txt', 'evidence/product-revalidation.txt', 'evidence/product-state-projection.txt']);
  for (const batch of oldBatches) {
    assert.ok(bytes(batch.payload) <= WORKER_BATCH_LIMITS.maxBatchBytes);
    for (const file of batch.payload.state.evidenceFiles) {
      const original = full.state.evidenceFiles.find(entry => entry.ref === file.ref);
      assert.equal(file.hash, original.hash, 'every part binds every evidence hash');
    }
  }
  const [single, ...rest] = workerQuestionBatches(full, 'LIVING_DOCS', options);
  assert.equal(rest.length, 0, 'the cohesive path keeps all evidence in one part');
  assert.ok(bytes(single.payload) <= WORKER_BATCH_LIMITS.maxBatchBytes);
  const state = single.payload.state;
  assert.equal(state.livingEvidence.strategy, LIVING_EXCERPT_STRATEGIES.COHESIVE);
  assert.ok(state.livingEvidence.changeBudget < LIVING_DELIVERY_LIMITS.changeTotalBytes, 'a later compaction stage engaged');
  assert.deepEqual(state.evidenceFiles.map(file => file.ref), full.state.evidenceFiles.map(file => file.ref), 'every evidence log is carried');
  for (const file of state.evidenceFiles) {
    const original = full.state.evidenceFiles.find(entry => entry.ref === file.ref);
    assert.equal(file.omitted, undefined, `no log is stubbed: ${file.ref}`);
    assert.equal(file.hash, original.hash);
  }
  assert.deepEqual(workerQuestionBatches(full, 'LIVING_DOCS', options), workerQuestionBatches(full, 'LIVING_DOCS', options), 'deterministic');
  const manifest = workerBatchManifest(full, options);
  assert.equal(manifest.filter(entry => entry.id === 'LIVING_DOCS').length, 1);
});

test('a fitting payload stays byte-identical: criterion and V3 Living Docs batches are hash-pinned', () => {
  const doc = 'docs/living/system/state.md';
  const impl = 'src/widget.mjs';
  const docBody = '# Widget\nIntro.\n\n## Changed\nWidget runs commands.\n\n## Other\nUnchanged.\n';
  const implBody = 'export const version = 2;\n';
  const logA = ['> node --test test/widget.test.mjs', 'ok 1 - widget runs', '# pass 1', '# fail 0', 'exitCode=0'].join('\n');
  const logB = ['> npm run verify', 'ok 1 - widget lasts', '# pass 1', '# fail 0', 'exitCode=0'].join('\n');
  const full = {
    model: MODEL,
    state: {
      objective: { successCriteria: ['Widget works'] },
      plan: {
        kind: 'BLACKBOARD_ARTIFACT', artifactType: 'READY_IMPLEMENT_PLAN', artifactId: 'BB-T', objective: {},
        scope: ['widget'], outOfScope: [], constraints: [], invariants: [], architectureDecisions: [],
        implementationSlices: [], negativeVerificationCases: [],
        sourceSeams: { requiredExisting: [impl], expectedNew: [], expectedTests: [] },
        livingDocs: { refs: [doc], questionId: 'LIVING_DOCS', statement: 'Docs describe the widget.' },
        acceptanceCriteria: [{ id: 'A', statement: 'Widget works', verificationIds: ['unit'], evidenceRequired: ['unit log'] }],
        verificationPlan: [{ id: 'unit', command: 'node --test test/widget.test.mjs' }]
      },
      evidence: [{ id: 'A', evidenceRefs: ['evidence/a.txt', 'evidence/b.txt'] }],
      sources: [
        { ref: doc, hash: hash(docBody), body: docBody, deleted: false },
        { ref: impl, hash: hash(implBody), body: implBody, deleted: false }
      ],
      verification: [{ id: 'unit', command: 'node --test test/widget.test.mjs', exitCode: 0, logRef: 'evidence/a.txt' }],
      evidenceFiles: [
        { ref: 'evidence/a.txt', hash: hash(logA), body: logA },
        { ref: 'evidence/b.txt', hash: hash(logB), body: logB }
      ]
    },
    questions: { A: question, LIVING_DOCS: question }
  };
  const options = { livingChanges: { [doc]: [[4, 4]] }, candidateChanges: { [impl]: { ranges: [[1, 1]], body: implBody } } };
  const [criterion] = workerQuestionBatches(full, 'A', options);
  assert.equal(hash(criterion.payload), '589508801f9d9b9965a812c76b32d73976f12b8890847427b76e9cbc77a48555');
  const [retained] = workerQuestionBatches(full, 'LIVING_DOCS', { ...options, livingExcerptStrategy: LIVING_EXCERPT_STRATEGIES.DELIVERY });
  assert.equal(hash(retained.payload), '9e1bdacba90b427eaad76125973db9aea5fcf02668b1337fb4181a417abb48f0');
  // The current cohesive first stage carries the same delivery evidence; only
  // the strategy record differs.
  const [current] = workerQuestionBatches(full, 'LIVING_DOCS', options);
  assert.equal(current.payload.state.livingEvidence.strategy, LIVING_EXCERPT_STRATEGIES.COHESIVE);
  assert.deepEqual(current.payload.state.sources, retained.payload.state.sources);
  assert.deepEqual(current.payload.state.evidenceFiles, retained.payload.state.evidenceFiles);
  assert.deepEqual(current.payload.state.verification, retained.payload.state.verification);
  assert.deepEqual(current.payload.state.evidence, retained.payload.state.evidence);
  assert.deepEqual(current.payload.state.plan, retained.payload.state.plan);
});

test('compact evidence excerpts keep command, exit status, totals, failing and passing test names within budget', () => {
  const lines = ['> pkg@0.0.0 verify', '> npm test', 'TAP version 13'];
  for (let i = 1; i <= 60; i++) lines.push(`ok ${i} - widget case ${i} holds steady`);
  lines.push('not ok 61 - widget rejects stale input', '# tests 61', '# pass 60', '# fail 1', 'exitCode=0');
  const body = lines.join('\n');
  const file = { ref: 'evidence/big.txt', hash: hash(body), body };
  const run = { id: 'big', command: 'npm run verify', exitCode: 0, logRef: file.ref };
  const excerpt = excerptCompactEvidenceLog(file, run);
  assert.ok(bytes(excerpt) <= LIVING_COHESIVE_LIMITS.compactLogBytes);
  assert.equal(excerpt.hash, hash(body));
  assert.equal(excerpt.bytes, Buffer.byteLength(body));
  assert.equal(excerpt.excerpted, true);
  assert.equal(excerpt.excerptStrategy, 'EVIDENCE_LOG_COMPACT_EXCERPT_V1');
  assert.equal(excerpt.command, 'npm run verify');
  assert.equal(excerpt.exitCode, 0);
  assert.deepEqual(excerpt.summary.totals, { tests: 61, pass: 60, fail: 1 });
  assert.deepEqual(excerpt.summary.failing, ['widget rejects stale input']);
  assert.ok(excerpt.summary.passing.includes('widget case 1 holds steady'), 'passing test names are the proof');
  assert.equal(excerpt.summary.passingTotal, 60);
  assert.equal(typeof excerpt.summary.passingTruncated, 'boolean');
  assert.equal(excerpt.summary.logExitCode, 0);
  assert.deepEqual(excerptCompactEvidenceLog(file, run), excerpt, 'excerpt must be deterministic');
  assert.throws(() => excerptCompactEvidenceLog({ ref: 'x' }), /requires a log body/);
});

function splitLivingFixture() {
  const doc = index => {
    const name = `split${index}`;
    return `# Title ${name}\nIntro.\n\n## Changed ${name}\n${'E'.repeat(25 * 1024)}\n tail-a\n tail-b\n\n## Other\nUnchanged.\n`;
  };
  const bodies = [doc(0), doc(1)];
  const refs = ['docs/living/split0.md', 'docs/living/split1.md'];
  const sources = bodies.map((body, index) => ({ ref: refs[index], hash: hash(body), body, deleted: false }));
  const livingChanges = {};
  refs.forEach((ref, index) => {
    const lines = bodies[index].split('\n');
    const start = lines.findIndex(line => line.startsWith('## Changed')) + 1;
    livingChanges[ref] = [[start, start + 3]];
  });
  const evidenceFiles = Array.from({ length: 12 }, (_, index) => {
    const body = [`ok 1 - part-log ${index} holds`, '# pass 1', '# fail 0', 'exitCode=0', `pad-${'p'.repeat(1700)}`].join('\n');
    return { ref: `evidence/l${index}.txt`, hash: hash(body), body };
  });
  const full = {
    model: MODEL,
    state: {
      objective: { successCriteria: ['Widget holds'] },
      plan: {
        kind: 'BLACKBOARD_ARTIFACT', artifactType: 'READY_IMPLEMENT_PLAN', artifactId: 'BB-T', objective: {},
        scope: ['widget'], outOfScope: [], constraints: [], invariants: [], architectureDecisions: [],
        implementationSlices: [], negativeVerificationCases: [],
        sourceSeams: { requiredExisting: [], expectedNew: [], expectedTests: [] },
        livingDocs: { refs, questionId: 'LIVING_DOCS', statement: 'Docs describe the widget.' },
        acceptanceCriteria: [{ id: 'L', statement: 'Widget holds', verificationIds: ['r1'], evidenceRequired: [] }],
        verificationPlan: [{ id: 'r1', command: 'node --test t.test.mjs' }]
      },
      evidence: [{ id: 'L', evidenceRefs: evidenceFiles.map(file => file.ref) }],
      sources,
      verification: [{ id: 'r1', command: 'node --test t.test.mjs', exitCode: 0, logRef: evidenceFiles[0].ref }],
      evidenceFiles
    },
    questions: { LIVING_DOCS: question }
  };
  return { full, livingChanges, candidateChanges: {} };
}

test('a real doc contradiction still fails the split Living Docs question; unrelated parts do not', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-jev-living-split-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'docs/blackboard'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs/blackboard/jev-policy.json'), JSON.stringify({ model: MODEL, policy: 'atomic-claims-1' }));
  const { full, livingChanges, candidateChanges } = splitLivingFixture();
  assert.ok(bytes(full) > WORKER_BATCH_LIMITS.maxBatchBytes, 'fixture needs bounded batches');
  const materialized = { lane: 'WORKER', subject: { workId: 'BB-T', plan: { ref: 'plan.json', hash: 'a'.repeat(64) } }, payload: full, stateHash: 'b'.repeat(64), specHash: 'c'.repeat(64), cacheKey: 'd'.repeat(64), livingChanges, candidateChanges, changeSet: { refs: [], sourceScope: { write: [], forbiddenWrite: [] } } };
  const batches = workerQuestionBatches(full, 'LIVING_DOCS', { livingChanges, candidateChanges });
  assert.ok(batches.length > 1, 'cohesion is impossible here so the question splits');
  for (const batch of batches) {
    assert.ok(bytes(batch.payload) <= WORKER_BATCH_LIMITS.maxBatchBytes);
    assert.match(batch.payload.state.batch.instructions, /proves or contradicts the doc claims/);
  }
  const run = async choiceForPart => {
    const fetchImpl = async (_url, options) => {
      const body = JSON.parse(options.body);
      const [id] = Object.keys(body.questions);
      const choice = choiceForPart(body.state.batch.part);
      return new Response(JSON.stringify({ model: MODEL, answers: { [id]: { type: 'choice', choice, confidence: 0.9 - 0.01 * body.state.batch.part, probabilities: { SATISFIED: 0, IMPLEMENTATION_DEFECT: 0, INSUFFICIENT_EVIDENCE: 0, PLAN_INPUT_CONTRADICTION: 0, [choice]: 1 } } }, usage: { input_tokens: 10, output_tokens: 1 } }), { status: 200 });
    };
    return evaluate(materialized, { root, fetchImpl, apiKey: 'fixture-key', bypassCache: true });
  };
  const contradiction = await run(part => part === 1 ? 'IMPLEMENTATION_DEFECT' : 'SATISFIED');
  assert.equal(contradiction.answers.LIVING_DOCS.choice, 'IMPLEMENTATION_DEFECT', 'the contradicting part fails the question');
  assert.equal(contradiction.verdict, 'REPAIR_REQUIRED');
  assert.deepEqual(contradiction.metrics.batching.partChoices.LIVING_DOCS, ['IMPLEMENTATION_DEFECT', ...Array(batches.length - 1).fill('SATISFIED')]);
  assert.equal(validateEvaluation(contradiction, materialized), contradiction);
  const unrelated = await run(part => part === 1 ? 'INSUFFICIENT_EVIDENCE' : 'SATISFIED');
  assert.equal(unrelated.answers.LIVING_DOCS.choice, 'SATISFIED', 'a part with unrelated evidence does not fail the question');
  assert.equal(unrelated.verdict, 'SATISFIED');
});
