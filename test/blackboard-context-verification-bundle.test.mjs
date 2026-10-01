import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { hash, read, write, planHash } from '../scripts/blackboard-delivery-contract.mjs';
import { materialize, evaluate } from '../scripts/blackboard-jev.mjs';
import { publishEvaluation } from '../scripts/blackboard-delivery.mjs';
import { bundleRefs, buildBundle, installBundle } from '../scripts/blackboard-verification-bundle.mjs';

const SYN_ID = 'BB-999';

function syntheticEightRun() {
  const dir = `docs/blackboard/evidence/${SYN_ID}`;
  const runIds = ['unit', 'integration', 'regression', 'repository-verify', 'evidence-audit', 'context-check', 'delivery-check', 'observation-check'];
  const bodies = new Map();
  const verificationRuns = runIds.map(id => {
    const logRef = `${dir}/${id}.txt`;
    const body = `synthetic log for ${id}\nexitCode=0\n`;
    bodies.set(logRef, body);
    return { id, command: `node --test ${id}`, status: 'PASSED', exitCode: 0, candidateSha: 'a'.repeat(40), logRef, logHash: hash(body) };
  });
  const claimed = verificationRuns.filter(v => v.id !== 'repository-verify').map(v => v.logRef);
  const observationRef = `${dir}/COMPLETE-observation-0.txt`;
  const observationBody = 'retained observation for COMPLETE\n';
  bodies.set(observationRef, observationBody);
  const result = {
    kind: 'BLACKBOARD_ARTIFACT',
    version: 1,
    artifactType: 'IMPLEMENTATION_RESULT',
    artifactId: `${SYN_ID}-evidence`,
    plan: { ref: 'plan.json', hash: 'b'.repeat(64) },
    candidateSha: 'a'.repeat(40),
    baselineSha: 'c'.repeat(40),
    candidateTree: 'd'.repeat(40),
    verificationRuns,
    claims: [
      { id: 'COMPLETE', evidenceRefs: [...claimed.slice(0, 7), observationRef] },
      { id: 'SEPARATION', evidenceRefs: [claimed[0]] }
    ]
  };
  return { id: SYN_ID, result, bodies, unclaimedRef: `${dir}/repository-verify.txt`, observationRef };
}

function removeBundleFixture(root) {
  const absolute = path.resolve(root);
  if (path.dirname(absolute) !== path.resolve(os.tmpdir()) || !path.basename(absolute).startsWith('bb-bundle-')) throw new Error('unsafe fixture cleanup');
  fs.rmSync(absolute, { recursive: true, force: true });
}

// Temp-git WORKER fixture: READY plan with eight verification runs,
// candidate commit, and synthetic eight-run evidence on disk.
// Seven runs are claim-linked; repository-verify is the passing run
// referenced by no claim; one retained observation is claim-linked.
async function setupWorkerFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-bundle-'));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-b', 'main');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  fs.writeFileSync(path.join(root, 'source.js'), 'export const answer = 1;\n');
  fs.writeFileSync(path.join(root, 'test.js'), '// meaningful fixture source\n');
  fs.mkdirSync(path.join(root, 'docs/living/system'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs/living/system/state.md'), '# Current system\n\nThe baseline implementation is answer one.\n');
  git('add', '.');
  git('commit', '-m', 'baseline');
  const baseline = git('rev-parse', 'HEAD');
  const runIds = ['unit', 'integration', 'regression', 'repository-verify', 'evidence-audit', 'context-check', 'delivery-check', 'observation-check'];
  const verificationPlan = runIds.map(id => ({ id, command: `node -e "process.exit(0) // ${id}"` }));
  const claimedIds = runIds.filter(id => id !== 'repository-verify');
  const objective = { kind: 'BLACKBOARD_ARTIFACT', version: 1, artifactType: 'OBJECTIVE', artifactId: 'BB-1', outcome: 'Return two', currentProblem: 'Returns one', scope: ['answer'], constraints: ['Keep interface'], successCriteria: ['answer is two', 'every log is retained'], currentSourceRefs: ['source.js'] };
  const plan = { kind: 'BLACKBOARD_ARTIFACT', version: 1, artifactType: 'READY_IMPLEMENT_PLAN', artifactId: 'BB-1', status: 'DRAFT', objective: { ref: 'objective.json', hash: hash(objective) }, scope: ['answer'], outOfScope: [], constraints: ['Keep interface'], invariants: ['union transport is complete'], architectureDecisions: ['Carry every verification log'], sourceSeams: { requiredExisting: ['source.js'], expectedNew: [], expectedTests: ['test.js'] }, sourceScope: { read: ['source.js', 'test.js', 'docs/living/**'], write: ['source.js', 'test.js', 'docs/living/**'], forbiddenWrite: [] }, implementationSlices: ['Carry union logs'], livingDocs: { refs: ['docs/living/system/state.md'], questionId: 'LIVING_DOCS', statement: 'Current Living Docs accurately describe the delivered implementation.' }, acceptanceCriteria: [{ id: 'COMPLETE', statement: 'every executed log is retained with exact bytes', verificationIds: claimedIds, evidenceRequired: ['union output'] }, { id: 'SEPARATION', statement: 'unclaimed passing run materializes with observation and grants no acceptance', verificationIds: ['unit'], evidenceRequired: ['separation output'] }], invariantCoverage: [{ invariant: 'union transport is complete', criterionIds: ['COMPLETE', 'SEPARATION'] }], verificationPlan };
  const task = { id: 'BB-1', status: 'PLANNED', lane: 'RESEARCH_SA', phase: 'RESEARCH', dependencies: [], components: ['outer/blackboard'], artifacts: { inputRefs: ['objective.json', 'plan.json'], outputRefs: [], consolidatedRefs: ['docs/living/system/state.md'] }, contract: { objectiveRef: 'objective.json', planRef: 'plan.json', researchBaselineSha: baseline } };
  write(root, 'objective.json', objective);
  write(root, 'plan.json', plan);
  write(root, 'docs/blackboard/work-graph.json', { tasks: [task], features: [] });
  write(root, 'docs/blackboard/jev-policy.json', { model: 'jev-1.13.0', policy: 'atomic-claims-1', maxPayloadBytes: 524288, pricing: null });
  const response = (payload, choice = 'SATISFIED') => ({ model: payload.model, answers: Object.fromEntries(Object.keys(payload.questions).map(id => [id, { type: 'choice', choice, confidence: 0.01, probabilities: Object.fromEntries(['SATISFIED', 'IMPLEMENTATION_DEFECT', 'INSUFFICIENT_EVIDENCE', 'PLAN_INPUT_CONTRADICTION'].map(o => [o, o === choice ? 1 : 0])) }])), usage: { input_tokens: 100, output_tokens: 20 } });
  const mock = (choice = 'SATISFIED') => async (_url, init) => new Response(JSON.stringify(response(JSON.parse(init.body), choice)), { status: 200 });
  await publishEvaluation(root, 'BB-1', await evaluate(materialize(root, 'BB-1'), { root, apiKey: 'fixture', fetchImpl: mock('SATISFIED'), bypassCache: true }));
  fs.writeFileSync(path.join(root, 'source.js'), 'export const answer = 2;\n');
  fs.writeFileSync(path.join(root, 'docs/living/system/state.md'), '# Current system\n\nThe delivered implementation returns answer two.\n');
  git('add', 'source.js', 'docs/living/system/state.md');
  git('commit', '-m', 'candidate');
  const candidateSha = git('rev-parse', 'HEAD');
  const candidateTree = git('rev-parse', 'HEAD^{tree}');
  const dir = 'docs/blackboard/evidence/BB-1';
  const bodies = new Map();
  const verificationRuns = runIds.map(id => {
    const logRef = `${dir}/${id}.txt`;
    const command = `node -e "process.exit(0) // ${id}"`;
    const body = `synthetic log for ${id}\nexitCode=0\n`;
    bodies.set(logRef, body);
    return { id, command, status: 'PASSED', exitCode: 0, candidateSha, logRef, logHash: hash(body) };
  });
  const claimedRefs = verificationRuns.filter(v => v.id !== 'repository-verify').map(v => v.logRef);
  const observationRef = `${dir}/COMPLETE-observation-0.txt`;
  const observationBody = 'retained observation for COMPLETE\n';
  bodies.set(observationRef, observationBody);
  const p = read(root, 'plan.json');
  const result = { kind: 'BLACKBOARD_ARTIFACT', version: 1, artifactType: 'IMPLEMENTATION_RESULT', artifactId: 'BB-1-evidence', plan: { ref: 'plan.json', hash: planHash(p) }, baselineSha: baseline, candidateSha, candidateTree, verificationRuns, claims: [{ id: 'COMPLETE', evidenceRefs: [...claimedRefs, observationRef] }, { id: 'SEPARATION', evidenceRefs: [claimedRefs[0]] }] };
  for (const [ref, body] of bodies) {
    const abs = path.join(root, ref);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  write(root, 'evidence.json', result);
  const graph = read(root, 'docs/blackboard/work-graph.json');
  Object.assign(graph.tasks[0].contract, { evidenceRef: 'evidence.json', candidateSha, baselineSha: baseline });
  write(root, 'docs/blackboard/work-graph.json', graph);
  return { root, id: 'BB-1', result, bodies, unclaimedRef: `${dir}/repository-verify.txt`, observationRef };
}

test('BUNDLE-UNION retains exact bytes in deterministic sorted-dedupe order', () => {
  const { id, result, bodies } = syntheticEightRun();
  void id;
  const refs = bundleRefs(result);
  const expected = [...new Set([...result.verificationRuns.map(v => v.logRef), ...result.claims.flatMap(c => c.evidenceRefs)])].sort();
  assert.deepEqual(refs, expected);
  assert.deepEqual(refs, [...refs].sort());
  assert.equal(new Set(refs).size, refs.length);
  const bundle = buildBundle(result, ref => bodies.get(ref));
  assert.deepEqual(bundle.files.map(f => f.ref), refs);
  for (const file of bundle.files) {
    assert.equal(file.body, bodies.get(file.ref));
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-bundle-'));
  try {
    installBundle(root, SYN_ID, bundle);
    for (const ref of refs) {
      assert.equal(fs.readFileSync(path.join(root, ref), 'utf8'), bodies.get(ref));
    }
  } finally {
    removeBundleFixture(root);
  }
});

test('BUNDLE-UNION dedupes duplicates and preserves digests', () => {
  const { result, bodies } = syntheticEightRun();
  const duped = structuredClone(result);
  duped.claims[0].evidenceRefs.push(duped.claims[0].evidenceRefs[0]);
  duped.claims[1].evidenceRefs.push(duped.claims[0].evidenceRefs[0]);
  const refs = bundleRefs(duped);
  assert.equal(new Set(refs).size, refs.length);
  const bundle = buildBundle(duped, ref => bodies.get(ref));
  assert.equal(bundle.files.length, refs.length);
  assert.equal(bundle.files.filter(f => f.ref === duped.claims[0].evidenceRefs[0]).length, 1);
  for (const run of duped.verificationRuns) {
    const file = bundle.files.find(f => f.ref === run.logRef);
    assert.ok(file);
    assert.equal(hash(file.body), run.logHash);
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-bundle-'));
  try {
    installBundle(root, SYN_ID, bundle);
    for (const run of duped.verificationRuns) {
      const body = fs.readFileSync(path.join(root, run.logRef), 'utf8');
      assert.equal(hash(body), run.logHash);
    }
  } finally {
    removeBundleFixture(root);
  }
});

test('BUNDLE-SEPARATION separated build install materialize carries unclaimed run without granting acceptance', async () => {
  const f = await setupWorkerFixture();
  try {
    // Collect side: in-memory synthetic eight-run bodies, no repo path dependency.
    const bundle = buildBundle(f.result, ref => f.bodies.get(ref));
    const refs = bundleRefs(f.result);
    assert.ok(refs.includes(f.unclaimedRef));
    assert.ok(refs.includes(f.observationRef));
    // Evaluate side on a fresh host: drop evidence, restore via installBundle, then materialize.
    fs.rmSync(path.join(f.root, 'docs/blackboard/evidence/BB-1'), { recursive: true, force: true });
    fs.rmSync(path.join(f.root, 'evidence.json'), { force: true });
    installBundle(f.root, f.id, bundle);
    write(f.root, 'evidence.json', bundle.result);
    const input = materialize(f.root, f.id);
    assert.equal(input.lane, 'WORKER');
    const verifRefs = new Set(input.payload.state.verification.map(v => v.logRef));
    for (const run of bundle.result.verificationRuns) {
      assert.ok(verifRefs.has(run.logRef));
    }
    const fileRefs = new Set(input.payload.state.evidenceFiles.map(entry => entry.ref));
    for (const ref of refs) {
      assert.ok(fileRefs.has(ref));
    }
    // Transport alone grants no acceptance: no evaluate call, mock fetch stays 0.
    let fetchCalls = 0;
    const fetchImpl = async () => { fetchCalls++; throw new Error('provider must not be called'); };
    assert.equal(typeof fetchImpl, 'function');
    assert.equal(bundle.result.artifactType, 'IMPLEMENTATION_RESULT');
    assert.equal('verdict' in bundle.result, false);
    assert.equal(fetchCalls, 0);
  } finally {
    removeBundleFixture(f.root);
  }
});

test('BUNDLE-FAILCLOSED missing union log fails closed without provider call', async () => {
  const f = await setupWorkerFixture();
  try {
    const full = buildBundle(f.result, ref => f.bodies.get(ref));
    const pruned = { result: f.result, files: full.files.filter(entry => entry.ref !== f.unclaimedRef) };
    fs.rmSync(path.join(f.root, 'docs/blackboard/evidence/BB-1'), { recursive: true, force: true });
    fs.rmSync(path.join(f.root, 'evidence.json'), { force: true });
    let fetchCalls = 0;
    let materialized = false;
    const fetchImpl = async () => { fetchCalls++; throw new Error('provider must not be called'); };
    assert.equal(typeof fetchImpl, 'function');
    assert.throws(() => installBundle(f.root, f.id, pruned), /missing bundle entry/);
    assert.equal(fetchCalls, 0);
    assert.equal(materialized, false);
    assert.equal(fs.existsSync(path.join(f.root, f.unclaimedRef)), false);
  } finally {
    removeBundleFixture(f.root);
  }
});

test('BUNDLE-FAILCLOSED corrupt digest fails closed without provider call', async () => {
  const f = await setupWorkerFixture();
  try {
    const full = buildBundle(f.result, ref => f.bodies.get(ref));
    const tampered = { result: f.result, files: full.files.map(entry => (entry.ref.endsWith('/unit.txt') ? { ref: entry.ref, body: `${entry.body}tampered` } : entry)) };
    fs.rmSync(path.join(f.root, 'docs/blackboard/evidence/BB-1'), { recursive: true, force: true });
    fs.rmSync(path.join(f.root, 'evidence.json'), { force: true });
    let fetchCalls = 0;
    let materialized = false;
    const fetchImpl = async () => { fetchCalls++; throw new Error('provider must not be called'); };
    assert.equal(typeof fetchImpl, 'function');
    assert.throws(() => installBundle(f.root, f.id, tampered), /digest mismatch/);
    assert.equal(fetchCalls, 0);
    assert.equal(materialized, false);
    assert.equal(fs.existsSync(path.join(f.root, 'docs/blackboard/evidence/BB-1/unit.txt')), false);
  } finally {
    removeBundleFixture(f.root);
  }
});

test('BUNDLE-FAILCLOSED unsafe ref fails closed without provider call', async () => {
  const f = await setupWorkerFixture();
  try {
    const evilRef = 'docs/blackboard/evidence/BB-998/evil.txt';
    const evilResult = structuredClone(f.result);
    evilResult.claims[0].evidenceRefs.push(evilRef);
    const evilBodies = new Map(f.bodies);
    evilBodies.set(evilRef, 'evil\n');
    const bundle = buildBundle(evilResult, ref => evilBodies.get(ref));
    fs.rmSync(path.join(f.root, 'docs/blackboard/evidence/BB-1'), { recursive: true, force: true });
    fs.rmSync(path.join(f.root, 'evidence.json'), { force: true });
    let fetchCalls = 0;
    let materialized = false;
    const fetchImpl = async () => { fetchCalls++; throw new Error('provider must not be called'); };
    assert.equal(typeof fetchImpl, 'function');
    assert.throws(() => installBundle(f.root, f.id, bundle), /noncanonical/);
    assert.equal(fetchCalls, 0);
    assert.equal(materialized, false);
    assert.equal(fs.existsSync(path.join(f.root, evilRef)), false);
  } finally {
    removeBundleFixture(f.root);
  }
});

test('BUNDLE-FAILCLOSED empty body fails closed without provider call', async () => {
  const f = await setupWorkerFixture();
  try {
    assert.ok(f.bodies.get(f.unclaimedRef).length > 0);
    let fetchCalls = 0;
    let materialized = false;
    const fetchImpl = async () => { fetchCalls++; throw new Error('provider must not be called'); };
    assert.equal(typeof fetchImpl, 'function');
    assert.throws(() => buildBundle(f.result, ref => (ref === f.unclaimedRef ? '' : f.bodies.get(ref))), /empty bundle body/);
    assert.equal(fetchCalls, 0);
    assert.equal(materialized, false);
  } finally {
    removeBundleFixture(f.root);
  }
});
