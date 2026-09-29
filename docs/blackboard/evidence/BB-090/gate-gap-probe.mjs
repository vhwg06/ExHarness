// Deterministic root-cause probe: why did the BB-064 Worker gate accept a facade that violates
// its own FAIL_CLOSED criterion? Reads only canonical committed artifacts and source.
// Usage from repository root: node docs/blackboard/evidence/BB-090/gate-gap-probe.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');
const read = (ref) => fs.readFileSync(path.join(root, ref), 'utf8');
const json = (ref) => JSON.parse(read(ref));

const plan = json('docs/blackboard/artifacts/ready-implement-plan/BB-064.json');
const evaluation = json('docs/blackboard/artifacts/ready-implement-plan/BB-064.candidate-jev-evaluation.json');
const result = json('docs/blackboard/artifacts/ready-implement-plan/BB-064.implementation-result.json');
const criterion = plan.acceptanceCriteria.find((c) => c.id === 'FAIL_CLOSED');
const foundationTest = read('test/oracle-context-intelligence-foundation.test.mjs');
const failClosedBody = foundationTest.slice(foundationTest.indexOf("test('fail-closed negatives"), foundationTest.indexOf("test('Living foundation truth"));
const foundationLog = read('docs/blackboard/evidence/BB-064/foundation.txt');
const collector = read('scripts/blackboard-delivery.mjs');
const benchmarkProfile = read('scripts/oracle-context-intelligence/benchmark-profile.mjs');
const facadeProbe = json('docs/blackboard/evidence/BB-087/facade-probe-result.json');

const out = {
  kind: 'BB090_GATE_GAP_PROBE_RESULT', version: 1,
  subject: 'BB-064 Worker delivery gate',
  plan: {
    failClosedEvidenceRequired: criterion.evidenceRequired,
    failureMatrixClasses: plan.failureMatrix.length,
    negativeVerificationCases: plan.negativeVerificationCases.length
  },
  executedEvidence: {
    failClosedClaimEvidenceRefs: result.claims.find((c) => c.id === 'FAIL_CLOSED').evidenceRefs,
    failClosedTestsInLog: (foundationLog.match(/fail-closed[^\n]*/g) ?? []),
    failClosedTestCallsFacade: /createOracleContextResolver\s*\(/.test(failClosedBody),
    failClosedTestAssertionCount: (failClosedBody.match(/assert\./g) ?? []).length,
    dispatchCounterEverIncrementable: /fakeCoreDispatch\s*\(/.test(failClosedBody.replace(/const fakeCoreDispatch[^\n]*/, ''))
  },
  judgment: {
    failClosedChoice: evaluation.answers.FAIL_CLOSED.choice,
    failClosedProbabilities: evaluation.answers.FAIL_CLOSED.probabilities,
    questionsPerCriterion: 1
  },
  deterministicGate: {
    claimEvidenceIsWholeLog: /claims: plan\.acceptanceCriteria\.map\(c => \(\{ id: c\.id, evidenceRefs: verificationRuns\.filter/.test(collector),
    negativeCaseToTestBindingExists: /negativeCaseBindings|testTitle/.test(collector)
  },
  relatedVacuousCheck: {
    ref: 'scripts/oracle-context-intelligence/benchmark-profile.mjs',
    alwaysTrueAssertion: /\|\|\s*true\)/.test(benchmarkProfile)
  },
  deliveredDefectConfirmedBy: {
    ref: 'docs/blackboard/evidence/BB-087/facade-probe-result.json',
    observations: facadeProbe.observations
  }
};
out.rootCause = [
  out.executedEvidence.failClosedTestCallsFacade ? null : 'FAIL_CLOSED evidence never invokes createOracleContextResolver; its negatives exercise only defineContextResolution.',
  out.plan.failureMatrixClasses > out.executedEvidence.failClosedTestAssertionCount ? `Plan requires one negative per class (${out.plan.failureMatrixClasses} classes); the executed test has ${out.executedEvidence.failClosedTestAssertionCount} assertions.` : null,
  out.deterministicGate.claimEvidenceIsWholeLog && !out.deterministicGate.negativeCaseToTestBindingExists ? 'collectEvidence binds each criterion to whole passing logs; no plan-declared negative case is bound to an executed test identity.' : null,
  out.judgment.questionsPerCriterion === 1 ? 'Jev judges one aggregate question per criterion; the 8-class FAIL_CLOSED claim was a near tie (SATISFIED vs INSUFFICIENT_EVIDENCE).' : null
].filter(Boolean);
fs.writeFileSync(path.join(here, 'gate-gap-probe-result.json'), JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify({ rootCause: out.rootCause.length, facade: out.executedEvidence.failClosedTestCallsFacade, probs: out.judgment.failClosedProbabilities, vacuous: out.relatedVacuousCheck.alwaysTrueAssertion }));
