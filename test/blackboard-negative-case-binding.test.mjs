import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { hash, read, write, planHash, assertPlan, verdict } from '../scripts/blackboard-delivery-contract.mjs';
import { materialize, evaluate } from '../scripts/blackboard-jev.mjs';
import { publishEvaluation, collectEvidence } from '../scripts/blackboard-delivery.mjs';
import { assertNegativeCaseBindings, negativeCaseBindingsRequired, assertNegativeCaseEnforcement, testPassedInLog, extractTestBody, checkBinding } from '../scripts/blackboard-negative-case-binding.mjs';

const BB064_SHA = 'e6be04593fa00c55b59d55dc4dc3c8d2821f5930';
const BB064_TEST = 'test/oracle-context-intelligence-foundation.test.mjs';
const BB064_TITLE = 'fail-closed negatives cannot become current model context';

function removeFixture(root) {
  const absolute = path.resolve(root);
  if (path.dirname(absolute) !== path.resolve(os.tmpdir()) || !/^bb-ncb-/.test(path.basename(absolute))) throw new Error('unsafe fixture cleanup');
  fs.rmSync(absolute, { recursive: true, force: true });
}

const SOURCE = `export const answer = 2;
export function check(value) { if (value < 0) throw new Error('negative input'); return value; }
`;
const TESTS = `import test from 'node:test';
import assert from 'node:assert/strict';
import { answer, check } from './source.mjs';

test('answer is two', () => { assert.equal(answer, 2); });
test('rejects negative input', () => {
  assert.throws(() => check(-1), /negative input/);
});
test('mentions check only in text', () => {
  // check(-1) is only mentioned in this comment
  assert.equal('check(-1)'.length, 9);
});
test('vacuous negative', () => {
  check(1);
  assert.ok(true);
});
`;
// Temp-repository fixture following test/blackboard-jev.test.mjs (copied, not edited).
function fixture(t, { threshold = null, cases, bindings } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-ncb-'));
  t.after(() => removeFixture(root));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-b', 'main'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
  fs.writeFileSync(path.join(root, 'source.mjs'), SOURCE);
  fs.writeFileSync(path.join(root, 'test.mjs'), TESTS);
  fs.mkdirSync(path.join(root, 'docs/living/system'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs/living/system/state.md'), '# Current system\n\nThe baseline implementation is answer one.\n');
  git('add', '.'); git('commit', '-m', 'baseline'); const baseline = git('rev-parse', 'HEAD');
  const objective = { kind: 'BLACKBOARD_ARTIFACT', version: 1, artifactType: 'OBJECTIVE', artifactId: 'BB-1', outcome: 'Reject negatives', currentProblem: 'Negatives accepted', scope: ['check'], constraints: ['Keep interface'], successCriteria: ['negative input rejected'], currentSourceRefs: ['source.mjs'] };
  const plan = {
    kind: 'BLACKBOARD_ARTIFACT', version: 1, artifactType: 'READY_IMPLEMENT_PLAN', artifactId: 'BB-1', status: 'DRAFT', objective: { ref: 'objective.json', hash: hash(objective) },
    scope: ['check'], outOfScope: [], constraints: ['Keep interface'], invariants: ['negatives fail closed'], architectureDecisions: ['Throw on negative'],
    sourceSeams: { requiredExisting: ['source.mjs'], expectedNew: [], expectedTests: ['test.mjs'] },
    sourceScope: { read: ['source.mjs', 'test.mjs', 'docs/living/**'], write: ['source.mjs', 'test.mjs', 'docs/living/**'], forbiddenWrite: [] },
    implementationSlices: ['Throw on negative'], livingDocs: { refs: ['docs/living/system/state.md'], questionId: 'LIVING_DOCS', statement: 'Current Living Docs describe the delivered implementation.' },
    acceptanceCriteria: [{ id: 'AC1', statement: 'negative input is rejected', verificationIds: ['unit'], evidenceRequired: ['unit output'] }, { id: 'AC2', statement: 'answer is two', verificationIds: ['unit', 'extra'], evidenceRequired: ['unit output'] }],
    invariantCoverage: [{ invariant: 'negatives fail closed', criterionIds: ['AC1'] }],
    verificationPlan: [{ id: 'unit', command: 'node --test test.mjs' }, { id: 'extra', command: 'node --test --test-name-pattern="^answer " test.mjs' }],
    negativeVerificationCases: cases ?? ['A negative value is rejected with a typed error.'],
    ...(bindings === null ? {} : { negativeCaseBindings: bindings ?? [binding()] })
  };
  const task = { id: 'BB-1', status: 'PLANNED', lane: 'RESEARCH_SA', phase: 'RESEARCH', dependencies: [], components: ['outer/blackboard'], artifacts: { inputRefs: ['objective.json', 'plan.json'], outputRefs: [], consolidatedRefs: ['docs/living/system/state.md'] }, contract: { objectiveRef: 'objective.json', planRef: 'plan.json', researchBaselineSha: baseline } };
  write(root, 'objective.json', objective); write(root, 'plan.json', plan); write(root, 'docs/blackboard/work-graph.json', { tasks: [task], features: [] });
  write(root, 'docs/blackboard/jev-policy.json', { model: 'jev-1.13.0', policy: 'atomic-claims-1', maxPayloadBytes: 524288, negativeCaseBindingsFromWorkId: threshold, pricing: null });
  let calls = 0;
  const response = (payload, choose) => ({ model: payload.model, answers: Object.fromEntries(Object.keys(payload.questions).map(id => { const choice = choose(id); return [id, { type: 'choice', choice, confidence: 0.01, probabilities: Object.fromEntries(['SATISFIED', 'IMPLEMENTATION_DEFECT', 'INSUFFICIENT_EVIDENCE', 'PLAN_INPUT_CONTRADICTION'].map(o => [o, o === choice ? 1 : 0])) }]; })), usage: { input_tokens: 100, output_tokens: 20 } });
  const mock = (choose = () => 'SATISFIED') => async (_url, init) => { calls++; return new Response(JSON.stringify(response(JSON.parse(init.body), choose)), { status: 200 }); };
  const ev = async choose => evaluate(materialize(root, 'BB-1'), { root, apiKey: 'fixture', fetchImpl: mock(choose), bypassCache: true });
  const ready = async () => publishEvaluation(root, 'BB-1', await ev());
  // Commit the READY plan as the candidate and collect real verification evidence.
  const collect = () => {
    git('add', 'objective.json', 'plan.json'); git('commit', '-m', 'record ready plan'); const workerBaseline = git('rev-parse', 'HEAD');
    fs.writeFileSync(path.join(root, 'docs/living/system/state.md'), '# Current system\n\nThe delivered implementation rejects negative input.\n');
    git('add', 'docs/living/system/state.md'); git('commit', '-m', 'candidate');
    const candidateSha = git('rev-parse', 'HEAD');
    const graph = read(root, 'docs/blackboard/work-graph.json');
    Object.assign(graph.tasks[0].contract, { candidateSha, baselineSha: workerBaseline }); write(root, 'docs/blackboard/work-graph.json', graph);
    return collectEvidence(root, 'BB-1');
  };
  return { root, git, baseline, plan, ev, ready, collect, calls: () => calls };
}
function binding(extra = {}) {
  return { id: 'NEG-0', negativeCaseIndex: 0, criterionId: 'AC1', verificationId: 'unit', testRef: 'test.mjs', testTitle: 'rejects negative input', subjectSymbol: 'check', ...extra };
}
function planWith(t, bindings, extra = {}) { return { ...fixture(t, { bindings: null }).plan, negativeCaseBindings: bindings, ...extra }; }

test('NB1 bindings must cover every negative case exactly once with known criterion, verification and expected test', t => {
  const good = planWith(t, [binding()]);
  assert.deepEqual(assertNegativeCaseBindings(good), [binding()]);
  assert.equal(assertPlan(good), good);
  const two = { ...good, negativeVerificationCases: ['first', 'second'] };
  assert.throws(() => assertPlan({ ...two, negativeCaseBindings: [binding()] }), /negative case 1 is not bound/);
  assert.throws(() => assertPlan({ ...two, negativeCaseBindings: [binding(), binding({ id: 'NEG-1' })] }), /negative case 0 bound more than once/);
  assert.equal(assertPlan({ ...two, negativeCaseBindings: [binding(), binding({ id: 'NEG-1', negativeCaseIndex: 1, testTitle: 'answer is two' })] }).negativeCaseBindings.length, 2);
  for (const [extra, pattern] of [
    [{ negativeCaseIndex: 3 }, /negativeCaseIndex out of range/],
    [{ negativeCaseIndex: '0' }, /negativeCaseIndex out of range/],
    [{ criterionId: 'AC9' }, /unknown negativeCaseBinding criterion/],
    [{ verificationId: 'nope' }, /unknown negativeCaseBinding verification/],
    [{ verificationId: 'extra' }, /does not verify criterion AC1/],
    [{ testRef: 'source.mjs' }, /testRef is not an expected test/],
    [{ testTitle: '  ' }, /testTitle required/],
    [{ subjectSymbol: 'check()' }, /unsafe negativeCaseBinding subjectSymbol/],
    [{ subjectSymbol: '1check' }, /unsafe negativeCaseBinding subjectSymbol/],
    [{ id: '../x' }, /unsafe negativeCaseBinding id/],
    [{ id: 'AC1' }, /collides with a Jev question/],
    [{ id: 'LIVING_DOCS' }, /collides with a Jev question/],
    [{ note: 'x' }, /field not allowed: note/]
  ]) assert.throws(() => assertPlan({ ...good, negativeCaseBindings: [binding(extra)] }), pattern);
  assert.throws(() => assertPlan({ ...good, negativeCaseBindings: [binding(), binding({ id: 'NEG-0' })] }), /duplicate negativeCaseBinding id/);
  assert.throws(() => assertPlan({ ...good, negativeCaseBindings: {} }), /must be an array/);
  const { negativeVerificationCases, ...noCases } = good;
  assert.throws(() => assertPlan(noCases), /requires negativeVerificationCases/);
});

test('NB1 enforcement applies only at or above the policy work-id threshold', async t => {
  const plan = planWith(t, undefined);
  delete plan.negativeCaseBindings;
  assert.equal(negativeCaseBindingsRequired({ negativeCaseBindingsFromWorkId: null }, 'BB-500', plan), false);
  assert.equal(negativeCaseBindingsRequired({}, 'BB-500', plan), false);
  assert.equal(negativeCaseBindingsRequired({ negativeCaseBindingsFromWorkId: 'BB-100' }, 'BB-099', plan), false);
  assert.equal(negativeCaseBindingsRequired({ negativeCaseBindingsFromWorkId: 'BB-100' }, 'BB-100', plan), true);
  assert.equal(negativeCaseBindingsRequired({ negativeCaseBindingsFromWorkId: 'BB-100' }, 'BB-101', { ...plan, negativeVerificationCases: [] }), false);
  assert.throws(() => negativeCaseBindingsRequired({ negativeCaseBindingsFromWorkId: '100' }, 'BB-100', plan), /must be a BB id or null/);
  assert.throws(() => assertNegativeCaseEnforcement({ negativeCaseBindingsFromWorkId: 'BB-100' }, 'BB-100', plan), /require negativeCaseBindings at or above BB-100: BB-100/);
  assert.doesNotThrow(() => assertNegativeCaseEnforcement({ negativeCaseBindingsFromWorkId: 'BB-101' }, 'BB-100', plan));
  // Readiness materialization fails before any provider call when enforced negatives are unbound.
  const enforced = fixture(t, { threshold: 'BB-1', bindings: null });
  await assert.rejects(() => enforced.ev(), /require negativeCaseBindings at or above BB-1: BB-1/);
  assert.equal(enforced.calls(), 0);
  const grandfathered = fixture(t, { threshold: 'BB-2', bindings: null });
  assert.equal((await grandfathered.ev()).verdict, 'SATISFIED');
  const off = fixture(t, { threshold: null, bindings: null });
  assert.equal('readiness-negativeCaseBindings' in materialize(off.root, 'BB-1').payload.questions, false);
});

test('NB1 repository plans still validate unchanged under the delivered policy', () => {
  const dir = 'docs/blackboard/artifacts/ready-implement-plan';
  const policy = read('.', 'docs/blackboard/jev-policy.json');
  assert.match(policy.negativeCaseBindingsFromWorkId, /^BB-\d+$/);
  const graph = read('.', 'docs/blackboard/work-graph.json');
  let checked = 0;
  for (const name of fs.readdirSync(dir).filter(n => /^BB-\d+\.json$/.test(n))) {
    const plan = read('.', `${dir}/${name}`);
    if (plan.artifactType !== 'READY_IMPLEMENT_PLAN') continue;
    assert.equal(assertPlan(plan), plan, name);
    const id = name.slice(0, -5);
    const threshold = Number(policy.negativeCaseBindingsFromWorkId.slice(3));
    // Grandfathered: every task registered before the threshold keeps its plan valid without bindings.
    // A task at or after the threshold may be registered with a DRAFT plan; once READY it must satisfy enforcement.
    if (Number(id.slice(3)) < threshold || plan.status === 'READY') assert.doesNotThrow(() => assertNegativeCaseEnforcement(policy, id, plan), name);
    checked++;
  }
  assert.ok(checked > 10);
  // The threshold may not be moved past already-registered work silently: it must name a registered task.
  assert.ok(graph.tasks.some(x => x.id === policy.negativeCaseBindingsFromWorkId), 'negativeCaseBindingsFromWorkId names a registered task');
});

test('NB2 spec and TAP logs bind exact passing titles only', () => {
  const title = 'rejects negative input';
  assert.deepEqual(testPassedInLog(`▶ suite\n  ✔ ${title} (1.25ms)\n✔ suite (2ms)\n`, title), { ok: true });
  assert.deepEqual(testPassedInLog(`✔ ${title}\n`, title), { ok: true });
  assert.deepEqual(testPassedInLog(`TAP version 13\n# Subtest: ${title}\nok 2 - ${title}\n  ---\n`, title), { ok: true });
  assert.deepEqual(testPassedInLog(`    ok 1 - ${title}\n`, title), { ok: true });
  assert.deepEqual(testPassedInLog(`✖ ${title} (3ms)\n`, title), { ok: false, reason: 'TEST_FAILED' });
  assert.deepEqual(testPassedInLog(`not ok 2 - ${title}\n`, title), { ok: false, reason: 'TEST_FAILED' });
  assert.deepEqual(testPassedInLog(`✔ ${title} (1ms)\n✖ failing tests:\n✖ ${title} (1ms)\n`, title), { ok: false, reason: 'TEST_FAILED' });
  assert.deepEqual(testPassedInLog(`ok 2 - ${title} # SKIP\n`, title), { ok: false, reason: 'TEST_SKIPPED' });
  assert.deepEqual(testPassedInLog(`﹣ ${title} (0.1ms) # SKIP\n`, title), { ok: false, reason: 'TEST_SKIPPED' });
  assert.deepEqual(testPassedInLog('ok 1 - something else\n', title), { ok: false, reason: 'TITLE_MISSING' });
  assert.deepEqual(testPassedInLog(`ok 1 - ${title} and more\n✔ prefix ${title}\n# Subtest: ${title}\n`, title), { ok: false, reason: 'TITLE_MISSING' });
  assert.deepEqual(testPassedInLog(`ok 1 - ${title}\nok 2 - ${title}\n`, title), { ok: false, reason: 'TITLE_DUPLICATE' });
  assert.deepEqual(testPassedInLog('', ''), { ok: false, reason: 'TITLE_MISSING' });
  assert.deepEqual(testPassedInLog('ok 1 - uses \\# hash\n', 'uses # hash'), { ok: true });
});

test('NB2 extraction tokenizes quotes, templates, regexes and comments and requires one exact match', () => {
  const source = [
    "// test('commented title', () => { assert.ok(false); })",
    "/* test('block title', () => {}) */",
    "test(\"double ) quoted\", () => { assert.equal(')'.length, 1); check(1); });",
    "test(`template title`, async () => { const s = `a ${fn(')')} b`; assert.match(s, /\\)[)]/); check(2); });",
    "it('single title', function () { assert.deepEqual({ a: '(' }, { a: '(' }); check(3); });",
    "test('dup', () => {}); test('dup', () => {});",
    "test(`interp ${x}`, () => {});",
    "t.test('member title', () => { assert.ok(check(4)); });"
  ].join('\n');
  assert.equal(extractTestBody(source, 'commented title').reason, 'BODY_NOT_FOUND');
  assert.equal(extractTestBody(source, 'block title').reason, 'BODY_NOT_FOUND');
  assert.equal(extractTestBody(source, 'double ) quoted').body, "test(\"double ) quoted\", () => { assert.equal(')'.length, 1); check(1); })");
  assert.match(extractTestBody(source, 'template title').body, /check\(2\); }\)$/);
  assert.match(extractTestBody(source, 'single title').body, /^it\('single title'.*check\(3\); }\)$/);
  assert.match(extractTestBody(source, 'member title').body, /^t\.test\('member title'/);
  assert.equal(extractTestBody(source, 'dup').reason, 'BODY_AMBIGUOUS');
  assert.equal(extractTestBody(source, 'interp ${x}').reason, 'BODY_NOT_FOUND');
  assert.equal(extractTestBody(source, 'double').reason, 'BODY_NOT_FOUND');
  assert.equal(extractTestBody("test('open', () => {", 'open').reason, 'SOURCE_UNPARSEABLE');
});

test('NB2 bound bodies must invoke the subject and contain a non-vacuous assertion', () => {
  const log = title => `ok 1 - ${title}\n`;
  const run = (title, subjectSymbol = 'check') => checkBinding({ binding: binding({ testTitle: title, subjectSymbol }), log: log(title), testSource: TESTS });
  assert.equal(run('rejects negative input').ok, true);
  assert.equal(run('rejects negative input', 'answer').reason, 'SUBJECT_NOT_INVOKED');
  assert.equal(run('mentions check only in text').reason, 'SUBJECT_NOT_INVOKED');
  assert.equal(run('vacuous negative').reason, 'VACUOUS_ASSERTION');
  assert.equal(checkBinding({ binding: binding(), log: '✖ rejects negative input\n', testSource: TESTS }).reason, 'TEST_FAILED');
  assert.equal(checkBinding({ binding: binding(), log: 'ok 1 - other\n', testSource: TESTS }).reason, 'TITLE_MISSING');
  const shape = inner => `test('t', () => { ${inner} });`;
  const body = inner => checkBinding({ binding: binding({ testTitle: 't', subjectSymbol: 'subject' }), log: 'ok 1 - t\n', testSource: shape(inner) });
  assert.equal(body('assert.equal(subject(1), 1);').ok, true);
  assert.equal(body('const x = new subject(); assert.ok(x);').ok, true);
  assert.equal(body('assert.ok(api.subject?.(1));').ok, true);
  assert.equal(body('subject(1); assert.ok(subject(1) || true);').reason, 'VACUOUS_ASSERTION');
  assert.equal(body('subject(1); assert.ok(true);').reason, 'VACUOUS_ASSERTION');
  assert.equal(body('subject(1); assert(true);').reason, 'VACUOUS_ASSERTION');
  assert.equal(body('subject(1); assert.equal(1, 1);').reason, 'VACUOUS_ASSERTION');
  assert.equal(body('subject(1);').reason, 'NO_ASSERTION');
  assert.equal(body("subject(1); console.log('assert.ok(x)');").reason, 'NO_ASSERTION');
  assert.equal(body("assert.throws(subject); /* subject(1) */").reason, 'SUBJECT_NOT_INVOKED');
  assert.equal(body("function subject() {} assert.ok(1);").reason, 'SUBJECT_NOT_INVOKED');
  // An object subject (adapter/facade) is invoked through one of its methods, not by property reads.
  assert.equal(body('const { args } = subject.buildInvocation({ a: 1 }); assert.ok(args.includes(1));').ok, true);
  assert.equal(body('assert.ok(subject?.run(1));').ok, true);
  assert.equal(body('assert.equal(subject.name, "x");').reason, 'SUBJECT_NOT_INVOKED');
  assert.equal(body('assert.equal(other.subject.name, "x");').reason, 'SUBJECT_NOT_INVOKED');
  assert.equal(body('assert.ok(other.subject.run(1));').reason, 'SUBJECT_NOT_INVOKED');
});

test('NB2 collect fails closed on unbound negatives and records body hashes for passing bindings', async t => {
  const f = fixture(t);
  await f.ready();
  const collected = f.collect();
  const claim = collected.evidence.claims.find(c => c.id === 'AC1');
  const body = extractTestBody(TESTS, 'rejects negative input').body;
  assert.deepEqual(claim.negativeCases, [{ id: 'NEG-0', logRef: 'docs/blackboard/evidence/BB-1/unit.txt', testRef: 'test.mjs', bodyHash: hash(body) }]);
  assert.equal('negativeCases' in collected.evidence.claims.find(c => c.id === 'AC2'), false);
  for (const [extra, reason] of [
    [{ testTitle: 'missing negative test' }, 'TITLE_MISSING'],
    [{ testTitle: 'mentions check only in text' }, 'SUBJECT_NOT_INVOKED'],
    [{ testTitle: 'vacuous negative' }, 'VACUOUS_ASSERTION'],
    [{ subjectSymbol: 'answer' }, 'SUBJECT_NOT_INVOKED']
  ]) {
    const bad = fixture(t, { bindings: [binding(extra)] });
    await bad.ready();
    assert.throws(() => bad.collect(), new RegExp(`negative case unbound: NEG-0: ${reason}`));
  }
  // Under enforcement a bound plan still converges through readiness and collection.
  const enforced = fixture(t, { threshold: 'BB-1' });
  await enforced.ready();
  assert.equal(enforced.collect().evidence.claims.find(c => c.id === 'AC1').negativeCases.length, 1);
});

test('NB3 worker materialization emits one atomic question per binding with the extracted body', async t => {
  const f = fixture(t, { cases: ['A negative value is rejected with a typed error.', 'Answer stays two.'], bindings: [binding(), binding({ id: 'NEG-1', negativeCaseIndex: 1, criterionId: 'AC2', testTitle: 'answer is two', subjectSymbol: 'equal' })] });
  const readiness = materialize(f.root, 'BB-1');
  assert.match(readiness.payload.questions['readiness-negativeCaseBindings'].instructions, /Each of the 2 negative verification cases is bound to exactly one distinct executed test title/);
  assert.deepEqual(readiness.payload.state.plan.negativeCaseBindings.map(b => b.id), ['NEG-0', 'NEG-1']);
  await f.ready();
  f.collect();
  const input = materialize(f.root, 'BB-1');
  const ids = Object.keys(input.payload.questions);
  assert.deepEqual(ids.filter(id => id.startsWith('NEG-')), ['NEG-0', 'NEG-1']);
  assert.ok(ids.includes('AC1') && ids.includes('AC2') && ids.includes('LIVING_DOCS'));
  assert.match(input.payload.questions['NEG-0'].instructions, /The executed test rejects negative input establishes negative case: A negative value is rejected with a typed error\. against check/);
  assert.deepEqual(input.payload.state.negativeCaseEvidence.map(({ id, criterionId, testRef, subjectSymbol }) => ({ id, criterionId, testRef, subjectSymbol })), [
    { id: 'NEG-0', criterionId: 'AC1', testRef: 'test.mjs', subjectSymbol: 'check' },
    { id: 'NEG-1', criterionId: 'AC2', testRef: 'test.mjs', subjectSymbol: 'equal' }
  ]);
  assert.equal(input.payload.state.negativeCaseEvidence[0].body, extractTestBody(TESTS, 'rejects negative input').body);
  // Verdict rules and confidence-as-telemetry are unchanged: low confidence SATISFIED passes, one atomic miss repairs.
  assert.equal((await f.ev()).verdict, 'SATISFIED');
  assert.equal((await f.ev(id => id === 'NEG-1' ? 'INSUFFICIENT_EVIDENCE' : 'SATISFIED')).verdict, 'REPAIR_REQUIRED');
  assert.equal((await f.ev(id => id === 'NEG-0' ? 'PLAN_INPUT_CONTRADICTION' : 'SATISFIED')).verdict, 'RESEARCH_REQUIRED');
  const answers = choice => Object.fromEntries(ids.map(id => [id, { type: 'choice', choice }]));
  assert.equal(verdict(answers('SATISFIED'), 'WORKER'), 'SATISFIED');
  assert.equal(verdict({ ...answers('SATISFIED'), 'NEG-0': { type: 'choice', choice: 'IMPLEMENTATION_DEFECT' } }, 'WORKER'), 'REPAIR_REQUIRED');
  assert.equal(read(f.root, 'docs/blackboard/jev-policy.json').confidenceGate, undefined);
  // A body rewritten after collection no longer matches its bound hash.
  const evidenceRef = read(f.root, 'docs/blackboard/work-graph.json').tasks[0].contract.evidenceRef;
  const evidence = read(f.root, evidenceRef);
  evidence.claims.find(c => c.id === 'AC1').negativeCases[0].bodyHash = 'f'.repeat(64);
  write(f.root, evidenceRef, evidence);
  assert.throws(() => materialize(f.root, 'BB-1'), /negative case body changed: NEG-0/);
  delete evidence.claims.find(c => c.id === 'AC1').negativeCases;
  write(f.root, evidenceRef, evidence);
  assert.throws(() => materialize(f.root, 'BB-1'), /negative case unbound: NEG-0: NOT_COLLECTED/);
});

test('NB3 plans without bindings keep identical questions and state', t => {
  const f = fixture(t, { bindings: null });
  const input = materialize(f.root, 'BB-1');
  assert.equal('readiness-negativeCaseBindings' in input.payload.questions, false);
  assert.equal('negativeCaseBindings' in input.payload.state.plan, false);
  assert.equal(input.payload.state.evidence.find(e => e.ref === 'blackboard://plan/readiness').body.includes('negativeCaseBindings'), false);
});

test('NB4 real BB-064 fail-closed test bound to createOracleContextResolver fails SUBJECT_NOT_INVOKED', t => {
  const source = execFileSync('git', ['show', `${BB064_SHA}:${BB064_TEST}`], { encoding: 'utf8' });
  const log = `TAP version 13\n# Subtest: ${BB064_TITLE}\nok 3 - ${BB064_TITLE}\n`;
  const result = checkBinding({ binding: { id: 'FAIL_CLOSED-0', testTitle: BB064_TITLE, subjectSymbol: 'createOracleContextResolver' }, log, testSource: source });
  assert.equal(result.reason, 'SUBJECT_NOT_INVOKED');
  assert.doesNotMatch(result.body, /createOracleContextResolver/);
  assert.equal((result.body.match(/\bassert\./g) ?? []).length, 2);
  t.diagnostic(`BB-064 ${BB064_TITLE}: SUBJECT_NOT_INVOKED for createOracleContextResolver (2 assertions)`);
});

test('NB4 BB-064 eight failureMatrix classes bound to one title fail coverage', () => {
  const plan = read('.', 'docs/blackboard/artifacts/ready-implement-plan/BB-064.json');
  assert.equal(plan.failureMatrix.length, 8);
  const probe = { ...plan, negativeVerificationCases: plan.failureMatrix.map(entry => entry.case),
    negativeCaseBindings: plan.failureMatrix.map((_, index) => ({ id: `FAIL_CLOSED-${index}`, negativeCaseIndex: index, criterionId: 'FAIL_CLOSED', verificationId: 'foundation', testRef: BB064_TEST, testTitle: BB064_TITLE, subjectSymbol: 'createOracleContextResolver' })) };
  assert.throws(() => assertNegativeCaseBindings(probe), /one test title cannot establish several negative cases/);
  const distinct = { ...probe, negativeCaseBindings: probe.negativeCaseBindings.map(b => ({ ...b, testTitle: `${BB064_TITLE} #${b.negativeCaseIndex}` })) };
  assert.equal(assertNegativeCaseBindings(distinct).length, 8);
  // No retrofit: the DONE BB-064 plan itself is unchanged, valid and not subject to enforcement.
  assert.equal('negativeCaseBindings' in plan, false);
  assert.equal(assertPlan(plan), plan);
  assert.doesNotThrow(() => assertNegativeCaseEnforcement(read('.', 'docs/blackboard/jev-policy.json'), 'BB-064', plan));
});

test('NB4 no DONE artifact is modified or deleted relative to main', t => {
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  let base;
  try { base = git('merge-base', 'HEAD', 'refs/remotes/origin/main'); } catch { t.diagnostic('origin/main unavailable; artifact diff skipped'); return; }
  const graph = JSON.parse(git('show', `${base}:docs/blackboard/work-graph.json`));
  const done = new Set(graph.tasks.filter(x => x.status === 'DONE').map(x => x.id));
  const changes = git('diff', '--name-status', '--no-renames', base, 'HEAD', '--', 'docs/blackboard/artifacts').split('\n').filter(Boolean);
  const touched = changes.map(line => line.split('\t')).filter(([status, file]) => status !== 'A' && done.has(path.basename(file).match(/^(BB-\d+)\./)?.[1]));
  t.diagnostic(`docs/blackboard/artifacts changes vs ${base.slice(0, 12)}: ${changes.length ? changes.join('; ') : 'none'}`);
  assert.deepEqual(touched, []);
});
