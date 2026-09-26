import { readFile, mkdir } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditCoreTrace, createCoreArm } from './core-arm.mjs';
import { sha256 } from './contract.mjs';
import { loadValueProtocol } from './study.mjs';
import { writeAtomicJson } from './resource-state.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const fail = (message, code = 2) => {
  const error = new Error(`BASELINE_CONTROLLED_TRIAL_INVALID: ${message}`);
  error.exitCode = code;
  throw error;
};
const option = (args, name) => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
const plainJson = path => readFile(path, 'utf8').then(JSON.parse);
const nowIso = () => new Date().toISOString();
const fileHash = async path => `sha256:${sha256(await readFile(path))}`;

function hashBody(value) { return `sha256:${sha256(value)}`; }

function scenarioExpectation(scenario) {
  if (scenario === 'STALE_CANDIDATE_VERIFICATION' || scenario === 'PRODUCER_SUCCESS_VERIFIER_REJECTION')
    return { accepted: false, unsafeAcceptance: false, duplicateEffect: false, lostResult: false, recoveryWork: 0 };
  return { accepted: true, unsafeAcceptance: false, duplicateEffect: false, lostResult: false, recoveryWork: 1 };
}

function trialId(familyIndex, family, scenario, arm) {
  return `F${String(familyIndex + 1).padStart(2, '0')}-${family}-${scenario}-${arm}`;
}

async function directTrial({ directory, trialId: id, scenario, faultScheduleHash }) {
  await mkdir(directory, { recursive: true });
  const journalPath = join(directory, 'direct-journal.json');
  let calls = 0;
  let finalizations = 0;
  const candidateDigest = hashBody({ id, version: 'producer-success' });
  const staleDigest = hashBody({ id, version: 'stale-citation' });
  const verify = cited => cited === candidateDigest;
  const runOnce = async () => {
    const prior = await plainJson(journalPath).catch(() => null);
    if (prior) return prior;
    calls += 1;
    const cited = scenario === 'STALE_CANDIDATE_VERIFICATION' ? staleDigest : candidateDigest;
    const verification = scenario === 'PRODUCER_SUCCESS_VERIFIER_REJECTION' ? 'REJECTED' : verify(cited) ? 'ACCEPTED' : 'REJECTED';
    const state = { schemaVersion: 1, evidenceClass: 'CONTROLLED_DIRECT_ORACLE', trialId: id,
      candidateDigest, citedCandidateDigest: cited, verification, resultDurable: true,
      finalized: verification === 'ACCEPTED', calls, finalizations: verification === 'ACCEPTED' ? 1 : 0,
      faultScheduleHash };
    await writeAtomicJson(journalPath, state);
    return state;
  };
  let state = await runOnce();
  if (['CRASH_AFTER_DURABLE_RESULT', 'RESTART_AFTER_FINALIZATION'].includes(scenario)) state = await runOnce();
  finalizations = state.finalizations;
  const expected = scenarioExpectation(scenario);
  const oracle = { schemaVersion: 1, evidenceClass: 'CONTROLLED_INDEPENDENT_ORACLE', trialId: id,
    scenario, expected, observed: { accepted: state.finalized, duplicateEffect: calls > 1, lostResult: !state.resultDurable,
      recoveryWork: ['CRASH_AFTER_DURABLE_RESULT', 'RESTART_AFTER_FINALIZATION'].includes(scenario) ? 1 : 0 },
    candidateBoundary: scenario === 'STALE_CANDIDATE_VERIFICATION' ? { citedCandidateDigest: staleDigest, rejected: !state.finalized } : null,
    finalizations, actionCalls: calls, faultScheduleHash };
  const oraclePath = join(directory, 'oracle.json');
  await writeAtomicJson(oraclePath, oracle);
  return { state, oracle, oraclePath, actionCalls: calls, finalizations };
}

async function coreTrial({ directory, trialId: id, family, scenario, cohortId, resetDigest, faultScheduleHash }) {
  await mkdir(directory, { recursive: true });
  let calls = 0;
  const candidateDigest = hashBody({ id, version: 'producer-success' });
  const verifyStatus = scenario === 'STALE_CANDIDATE_VERIFICATION' || scenario === 'PRODUCER_SUCCESS_VERIFIER_REJECTION' ? 'REJECTED' : 'ACCEPTED';
  const options = {
    directory,
    executionId: id,
    cohortId,
    work: { taskId: family, family, scenario, controlled: true },
    seedCandidate: { id, version: resetDigest },
    executeAttempt: async () => {
      calls += 1;
      return { candidateDigest, candidateRef: 'controlled-candidate', provider: { wireRequests: 0, modelCalls: 0, inputTokens: 0, outputTokens: 0, usageUnknown: false },
        timing: { activeMs: 1, providerWaitMs: 0, startedAt: nowIso(), terminalAt: nowIso() }, driverResult: { controlled: true } };
    },
    verifyCandidate: async ({ candidateDigest: observed }) => ({ status: observed === candidateDigest ? verifyStatus : 'REJECTED',
      candidateDigest: observed, checks: [{ check: 'controlled_oracle', pass: observed === candidateDigest && verifyStatus === 'ACCEPTED' }] }),
    clock: () => nowIso()
  };
  const arm = createCoreArm(options);
  const first = await arm.run({ attemptId: `${id}:attempt-1`, taskId: family, fault: scenario, verificationRef: `controlled/${id}/verification.json` });
  let resumed = null;
  if (['CRASH_AFTER_DURABLE_RESULT', 'RESTART_AFTER_FINALIZATION'].includes(scenario)) {
    resumed = await createCoreArm({ ...options, executeAttempt: async () => { calls += 1; throw new Error('controlled recovery replayed provider action'); } })
      .run({ attemptId: `${id}:attempt-1`, taskId: family, fault: scenario, verificationRef: `controlled/${id}/verification.json` });
  }
  let staleRejected = null;
  if (scenario === 'STALE_CANDIDATE_VERIFICATION') {
    try {
      await arm.harness.recordVerification(id, { candidate: { id, version: hashBody({ id, version: 'stale-candidate' }) },
        claim: 'controlled stale candidate', status: 'FAIL', evidence: [`controlled/${id}/oracle.json`], summary: 'stale candidate rejected',
        source: { kind: 'CAPABILITY', name: 'controlled.oracle' } });
    } catch (error) { staleRejected = { rejected: true, errorType: error.constructor?.name ?? 'Error', message: String(error.message).slice(0, 160) }; }
  }
  const tracePath = join(directory, 'core-events.json');
  await auditCoreTrace(tracePath, { executionId: id, sessionId: `${cohortId}:${id}`, requirePromotion: verifyStatus === 'ACCEPTED' });
  const traceHash = await fileHash(tracePath);
  const state = await arm.state();
  const observed = { accepted: Boolean(first.promotion), duplicateEffect: calls > 1, lostResult: !first.candidateRef,
    recoveryWork: resumed ? 1 : 0, unsafeAcceptance: false };
  const oracle = { schemaVersion: 1, evidenceClass: 'CONTROLLED_INDEPENDENT_ORACLE', trialId: id, scenario,
    expected: scenarioExpectation(scenario), observed, staleCandidateBoundary: staleRejected, traceHash };
  const oraclePath = join(directory, 'oracle.json');
  await writeAtomicJson(oraclePath, oracle);
  return { first, resumed, state, tracePath, traceHash, oraclePath, oracle, actionCalls: calls };
}

function trialRow({ trialId: id, family, scenario, arm, manifest, core = null, direct = null }) {
  const observed = core?.oracle?.observed ?? direct?.oracle?.observed ?? {};
  const expected = scenarioExpectation(scenario);
  const common = expected.accepted === observed.accepted && expected.duplicateEffect === observed.duplicateEffect &&
    expected.lostResult === observed.lostResult;
  return {
    schemaVersion: 1,
    evidenceClass: 'CONTROLLED_REPLAY',
    trialId: id,
    family,
    scenario,
    arm,
    cohortId: manifest.cohortId,
    candidateSha: manifest.candidateSha,
    candidateTree: manifest.candidateTree,
    faultScheduleHash: manifest.faultScheduleHash,
    outcome: observed.accepted ? (observed.recoveryWork ? 'RECOVERED_OR_FINALIZED' : 'ACCEPTED') : 'VERIFIER_REJECTED',
    accepted: Boolean(observed.accepted),
    unsafeAcceptance: Boolean(observed.unsafeAcceptance),
    duplicateEffect: Boolean(observed.duplicateEffect),
    lostResult: Boolean(observed.lostResult),
    recoveryWork: Number(observed.recoveryWork ?? 0),
    attribution: common ? 'COMMON' : arm === 'EXHARNESS' ? 'CORE' : 'COMMON',
    oracleRef: relative(resolve(manifest.outputRoot), core?.oraclePath ?? direct.oraclePath).replaceAll('\\', '/'),
    oracleHash: hashBody(core?.oracle ?? direct.oracle),
    traceRef: core ? relative(resolve(manifest.outputRoot), core.tracePath).replaceAll('\\', '/') : null,
    traceHash: core?.traceHash ?? null,
    coreStateHash: core ? hashBody(core.state) : null,
    actionCalls: core?.actionCalls ?? direct?.actionCalls ?? null
  };
}

function artifactDigest(artifact) {
  return `sha256:${sha256(Object.fromEntries(Object.entries(artifact).filter(([key]) => key !== 'digest')))}`;
}

export function validateControlledTrials({ artifact, manifest, value }) {
  if (!artifact || artifact.schemaVersion !== 1 || artifact.evidenceClass !== 'CONTROLLED_REPLAY' ||
      artifact.protocolId !== value.protocolId || artifact.protocolHash !== hashBody(value) || artifact.studyId !== manifest.studyId)
    fail('controlled-trial artifact identity is invalid', 3);
  if (artifact.digest !== artifactDigest(artifact) || artifact.faultScheduleHash !== manifest.faultScheduleHash ||
      artifact.cohortId !== manifest.cohortId || artifact.candidateSha !== manifest.candidateSha || artifact.candidateTree !== manifest.candidateTree)
    fail('controlled-trial artifact binding is stale', 3);
  const expectedIds = new Set(value.controlledTrials.families.flatMap((family, familyIndex) => value.controlledTrials.scenarios.flatMap(scenario =>
    value.controlledTrials.arms.map(arm => trialId(familyIndex, family, scenario, arm)))));
  const actualIds = new Set(artifact.trials?.map(row => row.trialId));
  if (artifact.count !== value.controlledTrials.count || artifact.trials?.length !== value.controlledTrials.count || actualIds.size !== artifact.trials?.length ||
      [...expectedIds].some(id => !actualIds.has(id)) || artifact.trials.some(row => row.evidenceClass !== 'CONTROLLED_REPLAY' ||
        !value.controlledTrials.families.includes(row.family) || !value.controlledTrials.scenarios.includes(row.scenario) ||
        !value.controlledTrials.arms.includes(row.arm) || !row.oracleHash || row.arm === 'EXHARNESS' && !row.traceHash))
    fail('controlled-trial denominator is incomplete', 3);
  return true;
}

export async function runControlledTrials({ profile, output } = {}) {
  if (!profile || !output) fail('profile and output are required');
  const directory = resolve(output);
  const manifest = await plainJson(join(directory, 'manifest.json'));
  const value = await loadValueProtocol('CORE_VALUE_V2');
  if (manifest.protocolId !== value.protocolId || manifest.studyKind !== value.protocolId) fail('controlled trials require a CORE_VALUE_V2 study');
  if (profile.candidateSha !== manifest.candidateSha || profile.candidateTree !== manifest.candidateTree) fail('profile and study candidate differ', 3);
  const artifactPath = join(directory, 'controlled-trials.json');
  const prior = await plainJson(artifactPath).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
  if (prior) {
    validateControlledTrials({ artifact: prior, manifest, value });
    return { mode: 'controlled-trials', output: artifactPath, count: prior.trials.length,
      faultScheduleHash: manifest.faultScheduleHash, exitCode: 0 };
  }
  const trials = [];
  const families = value.controlledTrials.families;
  const scenarios = value.controlledTrials.scenarios;
  for (let familyIndex = 0; familyIndex < families.length; familyIndex += 1) {
    const family = families[familyIndex];
    for (const scenario of scenarios) {
      const directId = trialId(familyIndex, family, scenario, 'DIRECT');
      const exharnessId = trialId(familyIndex, family, scenario, 'EXHARNESS');
      const trialRoot = join(directory, 'controlled', `F${String(familyIndex + 1).padStart(2, '0')}`, scenario);
      const direct = await directTrial({ directory: join(trialRoot, 'DIRECT'), trialId: directId, scenario, faultScheduleHash: manifest.faultScheduleHash });
      const core = await coreTrial({ directory: join(trialRoot, 'EXHARNESS'), trialId: exharnessId, family, scenario,
        cohortId: manifest.cohortId, resetDigest: hashBody({ manifest: manifest.cohortId, trialId: exharnessId }), faultScheduleHash: manifest.faultScheduleHash });
      trials.push(trialRow({ trialId: directId, family, scenario, arm: 'DIRECT', manifest: { ...manifest, outputRoot: directory }, direct }));
      trials.push(trialRow({ trialId: exharnessId, family, scenario, arm: 'EXHARNESS', manifest: { ...manifest, outputRoot: directory }, core }));
    }
  }
  const artifactBody = { schemaVersion: 1, evidenceClass: 'CONTROLLED_REPLAY', protocolId: value.protocolId,
    protocolHash: hashBody(value), studyId: manifest.studyId, cohortId: manifest.cohortId,
    candidateSha: manifest.candidateSha, candidateTree: manifest.candidateTree, faultScheduleHash: manifest.faultScheduleHash,
    count: trials.length, trials, generatedAt: nowIso() };
  const artifact = { ...artifactBody, digest: artifactDigest(artifactBody) };
  const path = artifactPath;
  await writeAtomicJson(path, artifact);
  validateControlledTrials({ artifact, manifest, value });
  return { mode: 'controlled-trials', output: path, count: trials.length, faultScheduleHash: manifest.faultScheduleHash, exitCode: 0 };
}

export async function main(args = process.argv.slice(2)) {
  const profilePath = option(args, '--profile');
  const output = option(args, '--output');
  if (!profilePath || !output) fail('--profile and --output are required');
  return runControlledTrials({ profile: await plainJson(resolve(profilePath)), output: resolve(output) });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await main())); }
  catch (error) { console.error(error.message); process.exitCode = error.exitCode ?? 4; }
}
