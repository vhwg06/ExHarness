import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { hash, assertObjectiveSupersession, assertDeliveryArtifact } from '../scripts/blackboard-delivery-contract.mjs';
import {
  supersessionRef, CLEARED_CONTRACT_FIELDS, detectSupersessions, assertObjectivesUnchanged,
  verifySupersession, verifyRetainedSupersessions, expectedDependents
} from '../scripts/blackboard-objective-supersession.mjs';
import { verifyDeliveryContracts } from '../scripts/blackboard-delivery-verify.mjs';

const OBJ = id => `docs/blackboard/artifacts/objective/${id}.json`;
const PLAN = id => `docs/blackboard/artifacts/ready-implement-plan/${id}.json`;
const GRAPH = 'docs/blackboard/work-graph.json';
const ciScript = path.resolve('scripts/blackboard-jev-ci.mjs');

function removeFixture(root) {
  const absolute = path.resolve(root);
  if (path.dirname(absolute) !== path.resolve(os.tmpdir()) || !/^bb-sup-/.test(path.basename(absolute))) throw new Error('unsafe fixture cleanup');
  fs.rmSync(absolute, { recursive: true, force: true });
}
const readJson = (root, ref) => JSON.parse(fs.readFileSync(path.join(root, ref), 'utf8'));
const writeJson = (root, ref, value) => { fs.mkdirSync(path.dirname(path.join(root, ref)), { recursive: true }); fs.writeFileSync(path.join(root, ref), JSON.stringify(value, null, 2) + '\n'); };
const writeText = (root, ref, body) => { fs.mkdirSync(path.dirname(path.join(root, ref)), { recursive: true }); fs.writeFileSync(path.join(root, ref), body); };
const gitIn = root => (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const objective = (id, outcome) => ({ kind: 'BLACKBOARD_ARTIFACT', version: 1, artifactType: 'OBJECTIVE', artifactId: id, outcome, currentProblem: `${id} problem`, scope: ['scope'], constraints: ['constraint'], successCriteria: ['success'], currentSourceRefs: ['source.js'] });
function plan(id, objectiveHash, status, extra = {}) {
  const p = {
    kind: 'BLACKBOARD_ARTIFACT', version: 1, artifactType: 'READY_IMPLEMENT_PLAN', artifactId: id, status,
    objective: { ref: OBJ(id), hash: objectiveHash }, scope: ['scope'], outOfScope: [], constraints: ['constraint'], invariants: ['INV'],
    architectureDecisions: ['decision'], implementationSlices: ['slice'],
    sourceScope: { read: ['source.js'], write: ['source.js'], forbiddenWrite: ['docs/blackboard/**'] },
    sourceSeams: { requiredExisting: ['source.js'], expectedNew: [], expectedTests: ['test.js'] },
    acceptanceCriteria: [{ id: 'AC', statement: 'works', verificationIds: ['unit'], evidenceRequired: ['log'] }],
    verificationPlan: [{ id: 'unit', command: 'node test.js' }], invariantCoverage: [{ invariant: 'INV', criterionIds: ['AC'] }], ...extra
  };
  if (status === 'READY') p.readinessRef = `docs/blackboard/artifacts/ready-implement-plan/${id}.readiness-jev-evaluation.json`;
  return p;
}
const task = (id, fields) => ({ id, featureId: null, title: `${id} title`, kind: 'IMPLEMENTATION', complexity: 'S', status: 'PLANNED', components: ['outer/blackboard'], dependencies: [], artifacts: { inputRefs: [], outputRefs: [], consolidatedRefs: [] }, expectedOutputs: ['OUT'], claim: null, currentContextRef: null, ...fields });

// Mixed trusted Board: BB-1 target (RESEARCH_SA with stale judgment), BB-2 READY WORKER dependent,
// BB-3 active RESEARCH_SA dependent, BB-4 DONE dependent, BB-5 unrelated, BB-6 WORKER (not a valid target).
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-sup-'));
  t.after(() => removeFixture(root));
  const git = gitIn(root);
  git('init', '-b', 'main'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
  writeText(root, 'source.js', 'export const answer = 1;\n'); writeText(root, 'scripts/tool.mjs', 'export const tool = 1;\n');
  git('add', '.'); git('commit', '-m', 'baseline'); const baseline = git('rev-parse', 'HEAD');
  const status = { 'BB-1': 'DRAFT', 'BB-2': 'READY', 'BB-3': 'DRAFT', 'BB-4': 'READY', 'BB-5': 'DRAFT', 'BB-6': 'READY' };
  for (const id of Object.keys(status)) {
    writeJson(root, OBJ(id), objective(id, `${id} outcome`));
    writeJson(root, PLAN(id), plan(id, hash(objective(id, `${id} outcome`)), status[id]));
  }
  const evalRef = id => `docs/blackboard/artifacts/ready-implement-plan/${id}.readiness-jev-evaluation.json`;
  for (const id of ['BB-1', 'BB-2', 'BB-4', 'BB-6']) writeJson(root, evalRef(id), { stale: id });
  writeText(root, 'docs/blackboard/context/BB-1/current.json', '{"active":true}\n');
  writeText(root, 'docs/blackboard/context/BB-3/current.json', '{"active":true}\n');
  const contract = (id, extra = {}) => ({ objectiveRef: OBJ(id), planRef: PLAN(id), researchBaselineSha: baseline, ...extra });
  const graph = {
    kind: 'OUTER_BLACKBOARD_WORK_GRAPH', version: 1, phase: 'FIXTURE', topics: [{ id: 'T', title: 'T', featureIds: [], artifactRefs: [] }], features: [],
    allocation: { executionUnit: 'TASK', contextRoutingUnit: 'COMPONENT', workerOwnership: 'ONE_TASK_PER_CLAIM', nextWorkId: 'BB-7' },
    tasks: [
      task('BB-1', { status: 'ACTIVE', lane: 'RESEARCH_SA', phase: 'RESEARCH', claim: { workerId: 'w' }, currentContextRef: 'docs/blackboard/context/BB-1/current.json', contract: contract('BB-1', { evaluationRef: evalRef('BB-1'), lastEvaluatedInput: 'a'.repeat(64), candidateSha: baseline, evidenceRef: 'docs/blackboard/evidence/BB-1/old.txt' }) }),
      task('BB-2', { lane: 'WORKER', phase: 'EXECUTION', dependencies: [{ taskId: 'BB-1', requires: ['TASK_OUTPUT'] }], contract: contract('BB-2', { baselineSha: baseline, evaluationRef: evalRef('BB-2'), lastEvaluatedInput: 'b'.repeat(64), evidenceRef: `docs/blackboard/artifacts/ready-implement-plan/BB-2.implementation-result.json` }) }),
      task('BB-3', { status: 'ACTIVE', lane: 'RESEARCH_SA', phase: 'RESEARCH', claim: { workerId: 'r' }, currentContextRef: 'docs/blackboard/context/BB-3/current.json', dependencies: [{ taskId: 'BB-1', requires: ['TASK_OUTPUT'] }], contract: contract('BB-3') }),
      task('BB-4', { status: 'DONE', lane: 'WORKER', phase: 'DELIVERED', dependencies: [{ taskId: 'BB-1', requires: ['TASK_OUTPUT'] }], contract: contract('BB-4', { deliveryRef: 'x.json', evaluationRef: evalRef('BB-4') }) }),
      task('BB-5', { lane: 'RESEARCH_SA', phase: 'RESEARCH', contract: contract('BB-5') }),
      task('BB-6', { lane: 'WORKER', phase: 'EXECUTION', contract: contract('BB-6', { evaluationRef: evalRef('BB-6') }) })
    ]
  };
  writeJson(root, GRAPH, graph); writeText(root, 'docs/blackboard/state.md', '# state\n');
  writeText(root, 'docs/blackboard/evidence/BB-1/old.txt', 'old worker evidence\n');
  git('add', '.'); git('commit', '-m', 'trusted board'); const base = git('rev-parse', 'HEAD');
  return { root, git, base, baseline };
}
// Candidate checkout of the supersession PR; `mutate` injects negative cases before commit.
function candidate(t, f, { target = 'BB-1', mutate = () => {}, receiptBase = f.base } = {}) {
  const subject = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-sup-subject-'));
  t.after(() => removeFixture(subject));
  execFileSync('git', ['clone', '-q', f.root, subject]);
  const git = gitIn(subject); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
  git('checkout', '-q', receiptBase === f.base ? f.base : receiptBase);
  const trustedGraph = readJson(subject, GRAPH);
  const oldObjective = readJson(subject, OBJ(target));
  const replacement = { ...oldObjective, outcome: `${target} replacement outcome`, currentProblem: 'objective was materially stale' };
  writeJson(subject, OBJ(target), replacement);
  const draft = readJson(subject, PLAN(target)); draft.status = 'DRAFT'; delete draft.readinessRef; draft.objective = { ref: OBJ(target), hash: hash(replacement) };
  writeJson(subject, PLAN(target), draft);
  const graph = structuredClone(trustedGraph);
  const byId = id => graph.tasks.find(x => x.id === id);
  const reset = x => { Object.assign(x, { status: 'PLANNED', lane: 'RESEARCH_SA', phase: 'RESEARCH', claim: null, currentContextRef: null }); for (const k of CLEARED_CONTRACT_FIELDS) delete x.contract[k]; };
  reset(byId(target));
  const dependents = expectedDependents(trustedGraph, target);
  for (const d of dependents) {
    const x = byId(d.taskId);
    if (d.disposition === 'RESET_RESEARCH') {
      reset(x); const p = readJson(subject, x.contract.planRef); p.status = 'DRAFT'; delete p.readinessRef; writeJson(subject, x.contract.planRef, p);
    } else if (d.disposition === 'RETAIN_RESEARCH') Object.assign(x, { status: x.status === 'ACTIVE' ? 'PLANNED' : x.status, claim: null, currentContextRef: null });
  }
  for (const id of [target, ...dependents.map(d => d.taskId)]) fs.rmSync(path.join(subject, `docs/blackboard/context/${id}`), { recursive: true, force: true });
  fs.rmSync(path.join(subject, `docs/blackboard/artifacts/ready-implement-plan/${target}.readiness-jev-evaluation.json`), { force: true });
  writeText(subject, `docs/blackboard/evidence/${target}/supersession.txt`, 'objective is materially stale\n');
  const receipt = {
    kind: 'BLACKBOARD_ARTIFACT', version: 1, artifactType: 'OBJECTIVE_SUPERSESSION', artifactId: `${target}-supersession`, targetWorkId: target,
    trustedBaseSha: f.base, oldObjective: { ref: OBJ(target), hash: hash(oldObjective) }, replacementObjective: { ref: OBJ(target), hash: hash(replacement) },
    planRef: PLAN(target), reason: 'Objective no longer describes the current problem', evidenceRefs: [`docs/blackboard/evidence/${target}/supersession.txt`], directDependents: dependents
  };
  const ctx = { subject, graph, receipt, byId, write: (ref, v) => writeJson(subject, ref, v), text: (ref, v) => writeText(subject, ref, v), read: ref => readJson(subject, ref) };
  mutate(ctx);
  writeJson(subject, GRAPH, ctx.graph); writeJson(subject, supersessionRef(target), ctx.receipt);
  git('add', '-A'); git('commit', '-q', '-m', 'supersede objective');
  return { subject, sha: git('rev-parse', 'HEAD') };
}
const verify = (f, c, extra = {}) => verifySupersession({ trustedRoot: f.root, subjectRoot: c.subject, prBaseSha: f.base, candidateSha: c.sha, targetWorkId: 'BB-1', ...extra });
const verifyTarget = (f, c, target) => verifySupersession({ trustedRoot: f.root, subjectRoot: c.subject, prBaseSha: f.base, candidateSha: c.sha, targetWorkId: target });
function rejects(t, mutate, pattern, extra) {
  const f = fixture(t); const c = candidate(t, f, { mutate });
  assert.throws(() => verify(f, c, extra), pattern);
}
// Mutate the trusted Board for `target`, commit, and advance f.base so the
// candidate is built from the mutated base. Used for trusted-state negatives
// (ACTIVE/claimed, worker authority) which verifySupersession reads from trusted.
function rebaseTrustedTarget(f, target, mutateTask) {
  const graph = readJson(f.root, GRAPH);
  mutateTask(graph.tasks.find(x => x.id === target));
  writeJson(f.root, GRAPH, graph);
  f.git('add', '-A'); f.git('commit', '-qm', `trusted ${target} mutated`);
  f.base = f.git('rev-parse', 'HEAD');
}

test('CONTRACT/TARGET_RESET/DEPENDENT_IMPACT: valid supersession resets target and conservatively classifies every direct dependent', t => {
  const f = fixture(t); const c = candidate(t, f);
  const result = verify(f, c);
  assert.equal(result.publication, 'OBJECTIVE_SUPERSESSION');
  assert.deepEqual(result.dependents.map(d => [d.taskId, d.disposition]), [['BB-2', 'RESET_RESEARCH'], ['BB-3', 'RETAIN_RESEARCH'], ['BB-4', 'TERMINAL_UNCHANGED']]);
  const receipt = assertDeliveryArtifact(readJson(c.subject, supersessionRef('BB-1')));
  assert.equal(receipt.oldObjective.hash, hash(readJson(f.root, OBJ('BB-1'))));
  assert.equal(receipt.replacementObjective.hash, hash(readJson(c.subject, OBJ('BB-1'))));
  const target = readJson(c.subject, GRAPH).tasks.find(x => x.id === 'BB-1');
  assert.deepEqual(Object.keys(target.contract).sort(), ['objectiveRef', 'planRef', 'researchBaselineSha']);
  assert.equal(target.claim, null); assert.equal(target.currentContextRef, null);
  assert.equal(fs.existsSync(path.join(c.subject, 'docs/blackboard/context/BB-1')), false);
  const draft = readJson(c.subject, PLAN('BB-1'));
  assert.equal(draft.status, 'DRAFT'); assert.equal(draft.readinessRef, undefined); assert.equal(draft.objective.hash, receipt.replacementObjective.hash);
  // Terminal dependent is byte-identical; RESET dependent keeps plan content with DRAFT status.
  assert.deepEqual(fs.readFileSync(path.join(c.subject, PLAN('BB-4'))), fs.readFileSync(path.join(f.root, PLAN('BB-4'))));
  assert.equal(readJson(c.subject, PLAN('BB-2')).status, 'DRAFT');
  // Current-only: the stable path is reused; there are no generation siblings and Git keeps the prior body.
  assert.deepEqual(fs.readdirSync(path.join(c.subject, 'docs/blackboard/artifacts/objective')).filter(n => n.startsWith('BB-1')).sort(), ['BB-1.json', 'BB-1.supersession.json']);
  assert.equal(hash(JSON.parse(gitIn(c.subject)('show', `${f.base}:${OBJ('BB-1')}`))), receipt.oldObjective.hash);
  assert.deepEqual(verifyRetainedSupersessions(c.subject, readJson(c.subject, GRAPH)), ['BB-1']);
});

test('CONTRACT: receipt schema is closed and typed', () => {
  const good = { kind: 'BLACKBOARD_ARTIFACT', version: 1, artifactType: 'OBJECTIVE_SUPERSESSION', artifactId: 'BB-1-supersession', targetWorkId: 'BB-1', trustedBaseSha: 'a'.repeat(40), oldObjective: { ref: OBJ('BB-1'), hash: 'b'.repeat(64) }, replacementObjective: { ref: OBJ('BB-1'), hash: 'c'.repeat(64) }, planRef: PLAN('BB-1'), reason: 'r', evidenceRefs: ['e'], directDependents: [{ taskId: 'BB-2', disposition: 'RESET_RESEARCH', planRef: PLAN('BB-2') }] };
  assert.equal(assertObjectiveSupersession(good), good);
  for (const bad of [{ extra: 1 }, { artifactId: 'BB-1' }, { trustedBaseSha: 'main' }, { oldObjective: { ref: OBJ('BB-1') } }, { evidenceRefs: [] }, { reason: '' },
    { directDependents: [{ taskId: 'BB-2', disposition: 'KEEP', planRef: null }] },
    { directDependents: [{ taskId: 'BB-2', disposition: 'RESET_RESEARCH', planRef: null }, { taskId: 'BB-2', disposition: 'RESET_RESEARCH', planRef: null }] }])
    assert.throws(() => assertObjectiveSupersession({ ...good, ...bad }), /BLACKBOARD_DELIVERY_INVALID/);
});

test('FRESHNESS/INV-2: stale base, old hash, routing, plan and replacement-hash negatives fail closed', t => {
  rejects(t, c => { c.receipt.trustedBaseSha = 'f'.repeat(40); }, /trustedBaseSha differs/);
  rejects(t, c => { c.receipt.oldObjective.hash = 'e'.repeat(64); }, /old objective hash differs/);
  rejects(t, c => { c.receipt.planRef = PLAN('BB-5'); }, /plan ref differs/);
  rejects(t, c => { c.receipt.replacementObjective.hash = 'd'.repeat(64); }, /replacement objective hash mismatch/);
  rejects(t, c => { c.byId('BB-1').contract.planRef = PLAN('BB-5'); }, /contract refs changed/);
  rejects(t, c => { c.write(OBJ('BB-1'), objective('BB-1', 'BB-1 outcome')); c.receipt.replacementObjective.hash = c.receipt.oldObjective.hash; const p = c.read(PLAN('BB-1')); p.objective.hash = c.receipt.oldObjective.hash; c.write(PLAN('BB-1'), p); }, /replacement objective is unchanged/);
  rejects(t, c => { const o = c.read(OBJ('BB-1')); o.artifactId = 'BB-9'; c.write(OBJ('BB-1'), o); c.receipt.replacementObjective.hash = hash(o); }, /not the target OBJECTIVE/);
  rejects(t, c => { c.receipt.oldObjective.ref = 'docs/blackboard/artifacts/objective/BB-1.g0002.json'; }, /stable objective path/);
  // CAS race: trusted main advanced after the candidate was prepared from an older base.
  const f = fixture(t); const c = candidate(t, f);
  writeText(f.root, 'source.js', 'export const answer = 3;\n'); f.git('commit', '-qam', 'main advanced'); const advanced = f.git('rev-parse', 'HEAD');
  assert.throws(() => verify(f, c, { prBaseSha: advanced }), /PR base is not an ancestor|trustedBaseSha differs/);
  assert.throws(() => verify(f, c), /trusted checkout differs from PR base/);
});

test('TARGET_RESET/INV-3: DONE/WORKER-authority targets, retained authority and identity changes are rejected', t => {
  const f = fixture(t);
  assert.throws(() => verify(f, candidate(t, f, { target: 'BB-4' }), { targetWorkId: 'BB-4' }), /must be unfinished work: BB-4 is DONE/);
  assert.throws(() => verify(f, candidate(t, f, { target: 'BB-2' }), { targetWorkId: 'BB-2' }), /retains worker authority/);
  rejects(t, c => { c.byId('BB-1').contract.evaluationRef = 'docs/blackboard/artifacts/ready-implement-plan/BB-1.readiness-jev-evaluation.json'; }, /stale authority/);
  rejects(t, c => { c.byId('BB-1').contract.candidateSha = 'a'.repeat(40); }, /stale authority/);
  rejects(t, c => { Object.assign(c.byId('BB-1'), { status: 'ACTIVE', claim: { workerId: 'w' }, currentContextRef: 'x' }); }, /PLANNED RESEARCH_SA/);
  rejects(t, c => { c.byId('BB-1').claim = { workerId: 'w' }; }, /claim or active context/);
  rejects(t, c => { c.byId('BB-1').lane = 'WORKER'; c.byId('BB-1').phase = 'EXECUTION'; }, /PLANNED RESEARCH_SA/);
  rejects(t, c => { const p = c.read(PLAN('BB-1')); p.status = 'READY'; p.readinessRef = 'r.json'; c.write(PLAN('BB-1'), p); }, /DRAFT without readinessRef/);
  rejects(t, c => { const p = c.read(PLAN('BB-1')); p.objective.hash = c.receipt.oldObjective.hash; c.write(PLAN('BB-1'), p); }, /bind the current objective/);
  rejects(t, c => { c.byId('BB-1').title = 'renamed'; }, /changed BB-1.title/);
  rejects(t, c => { c.byId('BB-2').dependencies = []; }, /BB-2.dependencies/);
  rejects(t, c => { c.byId('BB-1').components = ['other']; }, /BB-1.components/);
});

test('WORKER_TARGET (a): PLANNED unclaimed WORKER with READY plan and evaluationRef is superseded to research', t => {
  // Old line-99 behaviour rejects this with 'unfinished RESEARCH_SA work'; the
  // fix accepts it and applies the same TARGET_RESET rules as research targets.
  const f = fixture(t); const c = candidate(t, f, { target: 'BB-6' });
  const result = verifyTarget(f, c, 'BB-6');
  assert.equal(result.publication, 'OBJECTIVE_SUPERSESSION');
  assert.equal(result.workId, 'BB-6');
  const target = readJson(c.subject, GRAPH).tasks.find(x => x.id === 'BB-6');
  assert.equal(target.lane, 'RESEARCH_SA'); assert.equal(target.phase, 'RESEARCH'); assert.equal(target.status, 'PLANNED');
  assert.equal(target.claim, null); assert.equal(target.currentContextRef, null);
  assert.deepEqual(Object.keys(target.contract).sort(), ['objectiveRef', 'planRef', 'researchBaselineSha']);
  const draft = readJson(c.subject, PLAN('BB-6'));
  const receipt = readJson(c.subject, supersessionRef('BB-6'));
  assert.equal(draft.status, 'DRAFT'); assert.equal(draft.readinessRef, undefined);
  assert.equal(draft.objective.hash, receipt.replacementObjective.hash);
  assert.equal(fs.existsSync(path.join(c.subject, 'docs/blackboard/artifacts/ready-implement-plan/BB-6.readiness-jev-evaluation.json')), false);
});

test('WORKER_TARGET (b): ACTIVE/claimed WORKER target is rejected', t => {
  // Old code rejects with 'unfinished RESEARCH_SA work'; the fix rejects with
  // the precise unclaimed-WORKER message.
  const f1 = fixture(t);
  rebaseTrustedTarget(f1, 'BB-6', x => Object.assign(x, { status: 'ACTIVE', claim: { workerId: 'w' }, currentContextRef: 'docs/blackboard/context/BB-6/current.json' }));
  writeText(f1.root, 'docs/blackboard/context/BB-6/current.json', '{"active":true}\n');
  f1.git('add', '-A'); f1.git('commit', '-qm', 'trusted BB-6 active'); f1.base = f1.git('rev-parse', 'HEAD');
  assert.throws(() => verifyTarget(f1, candidate(t, f1, { target: 'BB-6' }), 'BB-6'), /must be unclaimed PLANNED WORKER work: BB-6 has status ACTIVE/);
  const f2 = fixture(t);
  rebaseTrustedTarget(f2, 'BB-6', x => { x.claim = { workerId: 'w' }; });
  assert.throws(() => verifyTarget(f2, candidate(t, f2, { target: 'BB-6' }), 'BB-6'), /must be unclaimed PLANNED WORKER work: BB-6 is claimed/);
});

test('WORKER_TARGET (c): WORKER target with candidateSha or mergeSha is rejected', t => {
  // Old code rejects with 'unfinished RESEARCH_SA work'; the fix rejects with
  // the precise worker-authority message naming the held field.
  const f1 = fixture(t);
  rebaseTrustedTarget(f1, 'BB-6', x => { x.contract.candidateSha = 'a'.repeat(40); });
  assert.throws(() => verifyTarget(f1, candidate(t, f1, { target: 'BB-6' }), 'BB-6'), /retains worker authority: BB-6 candidateSha/);
  const f2 = fixture(t);
  rebaseTrustedTarget(f2, 'BB-6', x => { x.contract.mergeSha = 'b'.repeat(40); });
  assert.throws(() => verifyTarget(f2, candidate(t, f2, { target: 'BB-6' }), 'BB-6'), /retains worker authority: BB-6 mergeSha/);
});

test('WORKER_TARGET (d): WORKER readiness evaluation modified instead of deleted is rejected', t => {
  // Old code never reaches the retention audit for a WORKER target; the fix
  // reuses the existing deletable logic and fails on rewrite.
  const f = fixture(t);
  const c = candidate(t, f, { target: 'BB-6', mutate(c) { c.write('docs/blackboard/artifacts/ready-implement-plan/BB-6.readiness-jev-evaluation.json', { rewritten: true }); } });
  assert.throws(() => verifyTarget(f, c, 'BB-6'), /historical artifact cannot be rewritten/);
});

test('WORKER_TARGET (e): WORKER plan staying READY is rejected', t => {
  // Old code rejects the WORKER target before plan checks; the fix applies the
  // same DRAFT-without-readinessRef rule as research targets.
  const f = fixture(t);
  const c = candidate(t, f, { target: 'BB-6', mutate(c) { const p = c.read(PLAN('BB-6')); p.status = 'READY'; p.readinessRef = 'docs/blackboard/artifacts/ready-implement-plan/BB-6.readiness-jev-evaluation.json'; c.write(PLAN('BB-6'), p); } });
  assert.throws(() => verifyTarget(f, c, 'BB-6'), /DRAFT without readinessRef/);
});

test('WORKER_TARGET (f): DONE target is still rejected', t => {
  // Old code rejects DONE with 'unfinished RESEARCH_SA work'; the fix keeps
  // rejecting DONE with the precise unfinished-work message.
  const f = fixture(t);
  assert.throws(() => verifyTarget(f, candidate(t, f, { target: 'BB-4' }), 'BB-4'), /must be unfinished work: BB-4 is DONE/);
});

test('DEPENDENT_IMPACT/INV-4: omitted, duplicated, misclassified or mutated dependents are rejected', t => {
  rejects(t, c => { c.receipt.directDependents = c.receipt.directDependents.filter(d => d.taskId !== 'BB-4'); }, /differ from trusted direct dependents/);
  rejects(t, c => { c.receipt.directDependents.push({ taskId: 'BB-5', disposition: 'RETAIN_RESEARCH', planRef: PLAN('BB-5') }); }, /differ from trusted direct dependents/);
  rejects(t, c => { c.receipt.directDependents.push({ ...c.receipt.directDependents[0] }); }, /duplicate supersession dependent/);
  rejects(t, c => { c.receipt.directDependents.find(d => d.taskId === 'BB-2').disposition = 'RETAIN_RESEARCH'; }, /BB-2 disposition must be RESET_RESEARCH/);
  rejects(t, c => { Object.assign(c.byId('BB-2'), { lane: 'WORKER', phase: 'EXECUTION' }); }, /PLANNED RESEARCH_SA/);
  rejects(t, c => { c.byId('BB-2').contract.evaluationRef = 'stale.json'; }, /stale authority/);
  rejects(t, c => { const p = c.read(PLAN('BB-2')); p.scope = ['rewritten']; c.write(PLAN('BB-2'), p); }, /BB-2 plan content changed/);
  rejects(t, c => { const p = c.read(PLAN('BB-2')); p.status = 'READY'; p.readinessRef = 'r.json'; c.write(PLAN('BB-2'), p); }, /DRAFT without readinessRef/);
  rejects(t, c => { c.byId('BB-3').contract.planRef = PLAN('BB-5'); }, /BB-3 must be unchanged/);
  rejects(t, c => { Object.assign(c.byId('BB-3'), { status: 'ACTIVE', claim: { workerId: 'r' } }); }, /BB-3 must be unchanged/);
  rejects(t, c => { c.byId('BB-4').artifacts.consolidatedRefs = ['rewritten.md']; }, /BB-4 must be unchanged/);
  rejects(t, c => { const p = c.read(PLAN('BB-4')); p.scope = ['history rewrite']; c.write(PLAN('BB-4'), p); }, /BB-4 plan must be unchanged|unrelated path/);
  rejects(t, c => { c.byId('BB-5').title = 'hidden edit'; }, /unrelated work: BB-5/);
  rejects(t, c => { c.graph.features.push({ id: 'F' }); }, /Board structure/);
});

test('RETENTION/MIGRATION_BOUNDARY: changed-path audit rejects code bundling, version siblings and history rewrites', t => {
  rejects(t, c => c.text('scripts/tool.mjs', 'export const tool = 2;\n'), /cannot bundle code or workflow changes: scripts\/tool.mjs/);
  rejects(t, c => c.text('.github/workflows/test.yml', 'on: push\n'), /cannot bundle code or workflow/);
  rejects(t, c => c.text('packages/x/index.js', 'x\n'), /cannot bundle code or workflow/);
  rejects(t, c => c.write('docs/blackboard/artifacts/objective/BB-1.g0002.json', objective('BB-1', 'sibling')), /unrelated path/);
  rejects(t, c => c.write('docs/blackboard/artifacts/ready-implement-plan/BB-4.readiness-jev-evaluation.json', { rewritten: true }), /unrelated path/);
  rejects(t, c => c.write('docs/blackboard/artifacts/ready-implement-plan/BB-1.readiness-jev-evaluation.json', { rewritten: true }), /historical artifact cannot be rewritten/);
  rejects(t, c => c.text('docs/blackboard/context/BB-1/current.json', '{}\n'), /may only remove active context/);
  rejects(t, c => c.write(OBJ('BB-2'), objective('BB-2', 'dependent objective rewrite')), /unrelated path/);
});

test('MIGRATION_BOUNDARY: this repository carries the mechanism only; no BB-065 objective migration is bundled', () => {
  const graph = readJson('.', GRAPH);
  assert.deepEqual(verifyRetainedSupersessions('.', graph), []);
  assert.equal(fs.existsSync(supersessionRef('BB-065')), false);
  const bb065 = graph.tasks.find(x => x.id === 'BB-065');
  const bb065Plan = readJson('.', bb065.contract.planRef);
  assert.equal(bb065Plan.objective.hash, hash(readJson('.', bb065.contract.objectiveRef)));
  assert.equal(verifyDeliveryContracts('.'), true);
});

test('RETENTION: repository verification binds retained receipts to the current stable objective', t => {
  const f = fixture(t); const c = candidate(t, f);
  const graph = readJson(c.subject, GRAPH);
  assert.deepEqual(verifyRetainedSupersessions(c.subject, graph), ['BB-1']);
  writeJson(c.subject, OBJ('BB-1'), objective('BB-1', 'silently edited later'));
  assert.throws(() => verifyRetainedSupersessions(c.subject, graph), /current objective differs from supersession replacement/);
  writeJson(c.subject, OBJ('BB-1'), readJson(c.subject, OBJ('BB-1')));
  writeJson(c.subject, 'docs/blackboard/artifacts/objective/BB-5.v2.json', objective('BB-5', 'sibling'));
  assert.throws(() => verifyRetainedSupersessions(c.subject, graph), /version sibling|current objective differs/);
});

function runSelect(trustedRoot, subjectRoot, sha) {
  const output = path.join(subjectRoot, '.select.out');
  fs.rmSync(output, { force: true });
  const env = { ...process.env, WORK_ID: '', CANDIDATE_SHA: sha, TRUSTED_ROOT: trustedRoot, SUBJECT_ROOT: subjectRoot, GITHUB_OUTPUT: output };
  delete env.TYPESAFE_API_KEY;
  execFileSync(process.execPath, [ciScript, 'select'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  return Object.fromEntries(fs.readFileSync(output, 'utf8').trim().split('\n').map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
}

test('TRUST_BOUNDARY: selector routes supersession to the deterministic verifier before research routing', t => {
  const f = fixture(t); const c = candidate(t, f);
  assert.deepEqual(detectSupersessions({ trustedRoot: f.root, subjectRoot: c.subject, trustedGraph: readJson(f.root, GRAPH) }), ['BB-1']);
  const out = runSelect(f.root, c.subject, c.sha);
  assert.deepEqual(JSON.parse(out.supersessions), [{ id: 'BB-1', sha: c.sha }]);
  // The changed target plan and fenced dependents are not ordinary research candidates for Jev.
  assert.deepEqual(JSON.parse(out.work), []);
  assert.deepEqual(JSON.parse(out.publications), []);
  // verify-supersession runs trusted scripts over candidate data without provider credentials.
  const env = { ...process.env, WORK_ID: 'BB-1', CANDIDATE_SHA: c.sha, BASE_SHA: f.base, TRUSTED_ROOT: f.root, SUBJECT_ROOT: c.subject };
  delete env.TYPESAFE_API_KEY;
  const result = JSON.parse(execFileSync(process.execPath, [ciScript, 'verify-supersession'], { env, encoding: 'utf8' }));
  assert.equal(result.publication, 'OBJECTIVE_SUPERSESSION');
  assert.throws(() => execFileSync(process.execPath, [ciScript, 'verify-supersession'], { env: { ...env, BASE_SHA: 'f'.repeat(40) }, stdio: 'pipe' }), /trusted checkout differs from PR base/);
});

test('INV-1/TRUST_BOUNDARY: ordinary research candidates cannot redefine their own objective', t => {
  const f = fixture(t);
  const subject = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-sup-self-')); t.after(() => removeFixture(subject));
  execFileSync('git', ['clone', '-q', f.root, subject]); const git = gitIn(subject);
  git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
  writeJson(subject, OBJ('BB-5'), objective('BB-5', 'self-redefined outcome'));
  const p = readJson(subject, PLAN('BB-5')); p.objective.hash = hash(readJson(subject, OBJ('BB-5'))); writeJson(subject, PLAN('BB-5'), p);
  git('commit', '-qam', 'research redefines objective'); const sha = git('rev-parse', 'HEAD');
  assert.throws(() => runSelect(f.root, subject, sha), /objective changed without OBJECTIVE_SUPERSESSION/);
  assert.throws(() => assertObjectivesUnchanged({ trustedRoot: f.root, subjectRoot: subject, trustedGraph: readJson(f.root, GRAPH) }), /objective changed without OBJECTIVE_SUPERSESSION: BB-5/);
  // A receipt cannot be deleted, renamed to a non-canonical id or aimed at unknown work.
  const c = candidate(t, f); fs.copyFileSync(path.join(c.subject, supersessionRef('BB-1')), path.join(c.subject, 'docs/blackboard/artifacts/objective/BB-99.supersession.json'));
  assert.throws(() => detectSupersessions({ trustedRoot: f.root, subjectRoot: c.subject, trustedGraph: readJson(f.root, GRAPH) }), /unknown work: BB-99/);
  fs.rmSync(path.join(c.subject, 'docs/blackboard/artifacts/objective/BB-99.supersession.json'));
  assert.throws(() => detectSupersessions({ trustedRoot: c.subject, subjectRoot: f.root, trustedGraph: readJson(c.subject, GRAPH) }), /receipt deleted: BB-1/);
});
