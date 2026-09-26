import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditCoreTrace, createCoreArm } from './core-arm.mjs';
import { sha256 } from './contract.mjs';
import { coordinateDirectAttempt, loadValueProtocol } from './study.mjs';
import { writeAtomicJson } from './resource-state.mjs';
import { candidateDigest, verifyCandidate } from './fixture/acceptance.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const selfPath = fileURLToPath(import.meta.url);
const fail = (message, code = 2) => {
  const error = new Error(`BASELINE_CONTROLLED_TRIAL_INVALID: ${message}`);
  error.exitCode = code;
  throw error;
};
const option = (args, name) => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
const plainJson = path => readFile(path, 'utf8').then(JSON.parse);
const nowIso = () => new Date().toISOString();
const fileHash = async path => `sha256:${sha256(await readFile(path))}`;
const TRIAL_FILES = Object.freeze(['server.mjs', 'index.html', 'client.js', 'smoke.mjs']);
const ZERO_PROVIDER = Object.freeze({ wireRequests: 0, modelCalls: 0, inputTokens: 0, outputTokens: 0, usageUnknown: false });

function hashBody(value) { return `sha256:${sha256(value)}`; }

function trialId(familyIndex, family, scenario, arm) {
  return `F${String(familyIndex + 1).padStart(2, '0')}-${family}-${scenario}-${arm}`;
}

async function seedTrialCandidate(candidateDir) {
  await mkdir(candidateDir, { recursive: true });
  for (const name of TRIAL_FILES) await copyFile(join(root, 'fixture', name), join(candidateDir, name));
  return candidateDigest(candidateDir);
}

async function mechanicalProducerOp(candidateDir, trialIdValue, { claimSuccess = false } = {}) {
  const serverPath = join(candidateDir, 'server.mjs');
  const body = await readFile(serverPath, 'utf8');
  await writeFile(serverPath, `${body}\n// controlled-producer ${trialIdValue}${claimSuccess ? ' success-claim' : ''}\n`);
  return { candidateDigest: await candidateDigest(candidateDir), claimedSuccess: claimSuccess };
}

async function swapTrialCandidate(candidateDir, trialIdValue) {
  const serverPath = join(candidateDir, 'server.mjs');
  const body = await readFile(serverPath, 'utf8');
  await writeFile(serverPath, `${body}\n// controlled-swap ${trialIdValue} ${nowIso()}\n`);
  return candidateDigest(candidateDir);
}

function journalPathFor(directory) { return join(directory, 'trial-journal.json'); }

async function readTrialJournal(directory) {
  return plainJson(journalPathFor(directory)).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
}

async function writeTrialJournal(directory, journal) {
  await writeAtomicJson(journalPathFor(directory), journal);
  return journal;
}

async function noteProducerCall(directory, journal) {
  journal.executorCalls += 1;
  await writeTrialJournal(directory, journal);
  if (journal.executorCalls > 1) fail(`controlled producer re-executed in ${directory}`);
}

function guardResumable({ journal, scenario }) {
  if (!journal) return 'fresh';
  if (journal.finalized) return 'finalized';
  if (scenario === 'CRASH_AFTER_DURABLE_RESULT' && journal.resultDurable === true && journal.executorCalls === 1)
    return 'resume-crash';
  fail(`interrupted controlled trial requires a fresh output directory: ${journal.trialId}`);
  return 'unreachable';
}

async function directTrial({ trialRoot, trialId: id, family, scenario, faultScheduleHash }) {
  const directory = join(trialRoot, 'DIRECT');
  await mkdir(directory, { recursive: true });
  const candidateDir = join(directory, 'candidate');
  const prior = await readTrialJournal(directory);
  const resumable = guardResumable({ journal: prior, scenario });
  let journal = prior;
  if (resumable === 'fresh') {
    const resetDigest = await seedTrialCandidate(candidateDir);
    journal = await writeTrialJournal(directory, { schemaVersion: 1, trialId: id, scenario, arm: 'DIRECT',
      resetDigest, executorCalls: 0, finalized: false, resultDurable: false });
  }
  if (resumable === 'finalized') fail(`controlled trial already finalized: ${id}`);
  const runExecutor = async () => {
    const current = await readTrialJournal(directory);
    await noteProducerCall(directory, current);
    Object.assign(journal, current);
    const produced = await mechanicalProducerOp(candidateDir, id,
      { claimSuccess: scenario === 'PRODUCER_SUCCESS_VERIFIER_REJECTION' });
    return { candidateDigest: produced.candidateDigest, candidateRef: 'candidate',
      claimedSuccess: produced.claimedSuccess, provider: { ...ZERO_PROVIDER },
      timing: { activeMs: 1, providerWaitMs: 0, startedAt: nowIso(), terminalAt: nowIso() },
      driverResult: { controlled: true } };
  };
  const verifyReal = async () => {
    const result = await verifyCandidate({ candidateDir, fault: family, browser: true });
    return { status: result.status, candidateDigest: result.candidateDigest, checks: result.checks };
  };
  let mechanism;
  let verification;
  let finalizedDigest;
  if (scenario === 'STALE_CANDIDATE_VERIFICATION') {
    const coordinated = await coordinateDirectAttempt({ runExecutor, verifyCandidate: verifyReal,
      onVerified: async ({ common }) => {
        const citedDigest = common.candidateDigest;
        const swappedDigest = await swapTrialCandidate(candidateDir, id);
        return { cutPoint: 'POST_VERIFICATION_SWAP', citedDigest, swappedDigest, swapObserved: citedDigest !== swappedDigest };
      } });
    verification = coordinated.verification;
    finalizedDigest = await candidateDigest(candidateDir);
    mechanism = { ...coordinated.hook, finalizedDigest,
      swapSurvivedFinalize: finalizedDigest === verification.candidateDigest };
  } else if (scenario === 'PRODUCER_SUCCESS_VERIFIER_REJECTION') {
    const coordinated = await coordinateDirectAttempt({ runExecutor, verifyCandidate: verifyReal });
    verification = coordinated.verification;
    finalizedDigest = await candidateDigest(candidateDir);
    mechanism = { cutPoint: 'PRODUCER_SUCCESS_CLAIM', claimedSuccess: Boolean(coordinated.common.claimedSuccess),
      verifierStatus: verification.status, finalizedDigest,
      defectiveObserved: Boolean(coordinated.common.claimedSuccess) && verification.status !== 'ACCEPTED' };
  } else if (scenario === 'CRASH_AFTER_DURABLE_RESULT') {
    if (resumable !== 'resume-crash') {
      const child = spawnSync(process.execPath, [selfPath, '--mode', 'crash-phase-direct',
        '--trial-dir', directory, '--family', family, '--trial-id', id],
        { encoding: 'utf8', timeout: 300000 });
      if (child.status === 0) fail(`crash-phase child finalized instead of dying: ${String(child.stdout ?? '').slice(-512)}`);
      if (child.status == null) fail(`crash-phase child did not terminate: ${child.error?.message}`);
      journal = await readTrialJournal(directory);
      if (!journal || journal.executorCalls !== 1 || journal.resultDurable !== true || journal.finalized)
        fail('crash-phase child left no single durable result');
    }
    const durable = await plainJson(join(directory, 'verification.json'));
    verification = durable.verification;
    finalizedDigest = await candidateDigest(candidateDir);
    if (finalizedDigest !== verification.candidateDigest || durable.candidateDigest !== verification.candidateDigest)
      fail('durable crash result is not candidate-bound');
    journal = await writeTrialJournal(directory, { ...journal, resumedWithoutReplay: journal.executorCalls === 1 });
    mechanism = { cutPoint: 'KILL_AFTER_DURABLE_RESULT', killObserved: true,
      resumedWithoutReplay: journal.executorCalls === 1, finalizedDigest };
  } else if (scenario === 'RESTART_AFTER_FINALIZATION') {
    const coordinated = await coordinateDirectAttempt({ runExecutor, verifyCandidate: verifyReal });
    verification = coordinated.verification;
    finalizedDigest = await candidateDigest(candidateDir);
    journal = await writeTrialJournal(directory, { ...journal, finalized: true, finalizedDigest,
      verificationHash: hashBody(verification) });
    const child = spawnSync(process.execPath, [selfPath, '--mode', 'restart-phase-direct',
      '--trial-dir', directory, '--family', family, '--trial-id', id],
      { encoding: 'utf8', timeout: 300000 });
    if (child.status !== 0) fail(`restart-phase child replayed or failed: ${child.status} ${String(child.stderr ?? '').slice(-512)}`);
    const proof = await plainJson(join(directory, 'restart-proof.json'));
    journal = await readTrialJournal(directory);
    mechanism = { cutPoint: 'RESTART_AFTER_FINALIZATION', restartWithoutReplay: proof.restartWithoutReplay === true &&
      journal.executorCalls === 1, finalizedDigest };
  } else fail(`unknown controlled scenario: ${scenario}`);
  const bound = finalizedDigest === verification.candidateDigest;
  const observed = { accepted: bound && verification.status === 'ACCEPTED', bound,
    unsafeAcceptance: false, duplicateEffect: journal.executorCalls > 1, lostResult: false,
    recoveryWork: scenario === 'CRASH_AFTER_DURABLE_RESULT' ? 1 : 0 };
  journal = await writeTrialJournal(directory, { ...journal, finalized: true, accepted: observed.accepted });
  const oracle = { schemaVersion: 1, evidenceClass: 'CONTROLLED_INDEPENDENT_ORACLE', trialId: id,
    family, arm: 'DIRECT', scenario, observed, mechanism, verificationStatus: verification.status,
    candidateDigest: verification.candidateDigest, finalizedDigest, faultScheduleHash };
  const oraclePath = join(directory, 'oracle.json');
  await writeAtomicJson(oraclePath, oracle);
  return { oracle, oraclePath, oracleHash: hashBody(oracle), actionCalls: journal.executorCalls, mechanism, observed };
}

async function crashPhaseDirect({ trialDir, family, trialId: id }) {
  const candidateDir = join(trialDir, 'candidate');
  const journal = await readTrialJournal(trialDir);
  if (!journal) fail('crash-phase child found no seeded trial journal');
  await noteProducerCall(trialDir, journal);
  const produced = await mechanicalProducerOp(candidateDir, id);
  const verification = await verifyCandidate({ candidateDir, fault: family, browser: true });
  if (verification.candidateDigest !== produced.candidateDigest) fail('crash-phase verification is not candidate-bound');
  await writeAtomicJson(join(trialDir, 'verification.json'), { schemaVersion: 1, trialId: id,
    verification: { status: verification.status, candidateDigest: verification.candidateDigest, checks: verification.checks },
    candidateDigest: produced.candidateDigest });
  await writeTrialJournal(trialDir, { ...journal, executorCalls: 1, resultDurable: true,
    verificationHash: hashBody(verification), candidateDigest: produced.candidateDigest });
  process.exit(1);
}

async function restartPhaseDirect({ trialDir, trialId: id }) {
  const journal = await readTrialJournal(trialDir);
  if (!journal?.finalized) fail('restart-phase child found no finalized trial');
  const finalizedDigest = await candidateDigest(join(trialDir, 'candidate'));
  if (finalizedDigest !== journal.finalizedDigest) fail('restart-phase candidate changed after finalization');
  await writeAtomicJson(join(trialDir, 'restart-proof.json'), { schemaVersion: 1, trialId: id,
    restartWithoutReplay: journal.executorCalls === 1, executorCalls: journal.executorCalls, finalizedDigest });
}

function coreOptions({ directory, candidateDir, trialId: id, family, scenario, cohortId, journal, executor }) {
  return {
    directory,
    executionId: id,
    cohortId,
    work: { taskId: family, family, scenario, controlled: true },
    seedCandidate: { id, version: journal.resetDigest ?? 'sha256:unseeded' },
    executeAttempt: executor,
    verifyCandidate: async () => {
      const result = await verifyCandidate({ candidateDir, fault: family, browser: true });
      return { status: result.status, candidateDigest: result.candidateDigest, checks: result.checks };
    },
    clock: () => nowIso()
  };
}

async function coreTrial({ trialRoot, trialId: id, family, scenario, cohortId, faultScheduleHash, directObserved }) {
  const directory = join(trialRoot, 'EXHARNESS');
  await mkdir(directory, { recursive: true });
  const candidateDir = join(directory, 'candidate');
  const prior = await readTrialJournal(directory);
  const resumable = guardResumable({ journal: prior, scenario });
  let journal = prior;
  if (resumable === 'fresh') {
    const resetDigest = await seedTrialCandidate(candidateDir);
    journal = await writeTrialJournal(directory, { schemaVersion: 1, trialId: id, scenario, arm: 'EXHARNESS',
      resetDigest, executorCalls: 0, finalized: false, resultDurable: false });
  }
  if (resumable === 'finalized') fail(`controlled trial already finalized: ${id}`);
  const countingExecutor = async () => {
    const current = await readTrialJournal(directory);
    await noteProducerCall(directory, current);
    Object.assign(journal, current);
    const produced = await mechanicalProducerOp(candidateDir, id,
      { claimSuccess: scenario === 'PRODUCER_SUCCESS_VERIFIER_REJECTION' });
    return { candidateDigest: produced.candidateDigest, candidateRef: 'controlled-candidate',
      claimedSuccess: produced.claimedSuccess, provider: { ...ZERO_PROVIDER },
      timing: { activeMs: 1, providerWaitMs: 0, startedAt: nowIso(), terminalAt: nowIso() },
      driverResult: { controlled: true } };
  };
  const throwingExecutor = async () => { throw new Error('controlled recovery replayed provider action'); };
  const verificationRef = `controlled/${id}/verification.json`;
  let mechanism;
  let first;
  let arm;
  if (scenario === 'CRASH_AFTER_DURABLE_RESULT') {
    if (resumable !== 'resume-crash') {
      const child = spawnSync(process.execPath, [selfPath, '--mode', 'crash-phase-core',
        '--trial-dir', directory, '--family', family, '--trial-id', id, '--cohort-id', cohortId],
        { encoding: 'utf8', timeout: 300000 });
      if (child.status === 0) fail(`core crash-phase child finalized instead of dying: ${String(child.stdout ?? '').slice(-512)}`);
      if (child.status == null) fail(`core crash-phase child did not terminate: ${child.error?.message}`);
      journal = await readTrialJournal(directory);
      if (!journal || journal.executorCalls !== 1 || journal.resultDurable !== true || journal.finalized)
        fail('core crash-phase child left no single durable result');
    }
    const resumed = await plainJson(join(directory, 'verification.json'));
    if (resumed.trialId !== id || !resumed.verification || typeof resumed.verification.status !== 'string' ||
        resumed.candidateDigest !== resumed.verificationCandidate || resumed.verificationCandidate == null)
      fail('durable core crash result is not candidate-bound');
    const reboundDigest = await candidateDigest(candidateDir);
    if (reboundDigest !== resumed.candidateDigest) fail('core crash result candidate changed before resume');
    arm = createCoreArm(coreOptions({ directory, candidateDir, trialId: id, family, scenario,
      cohortId, journal, executor: throwingExecutor }));
    first = { verification: resumed.verification, candidateDigest: resumed.candidateDigest,
      executor: null, promotion: null };
    journal = await writeTrialJournal(directory, { ...journal, resumedWithoutReplay: journal.executorCalls === 1 });
    mechanism = { cutPoint: 'KILL_AFTER_DURABLE_RESULT', killObserved: true,
      resumedWithoutReplay: journal.executorCalls === 1 };
  } else {
    arm = createCoreArm(coreOptions({ directory, candidateDir, trialId: id, family, scenario,
      cohortId, journal, executor: countingExecutor }));
    first = await arm.run({ attemptId: `${id}:attempt-1`, taskId: family, fault: scenario, verificationRef });
    journal = await readTrialJournal(directory);
    if (scenario === 'STALE_CANDIDATE_VERIFICATION') {
      let staleRejected = null;
      try {
        await arm.harness.recordVerification(id, { candidate: { id, version: hashBody({ id, version: 'stale-candidate' }) },
          claim: 'controlled stale candidate', status: 'FAIL', evidence: [`controlled/${id}/oracle.json`],
          summary: 'stale candidate rejected', source: { kind: 'CAPABILITY', name: 'controlled.oracle' } });
      } catch (error) { staleRejected = { rejected: true, errorType: error.constructor?.name ?? 'Error', message: String(error.message).slice(0, 160) }; }
      const citedDigest = first.candidateDigest;
      const swappedDigest = await swapTrialCandidate(candidateDir, id);
      mechanism = { cutPoint: 'STALE_RECORD_AND_SWAP', staleCandidateBoundary: staleRejected,
        citedDigest, swappedDigest, swapObserved: citedDigest !== swappedDigest,
        swapSurvivedFinalize: swappedDigest === first.verification?.candidateDigest };
    } else if (scenario === 'PRODUCER_SUCCESS_VERIFIER_REJECTION') {
      mechanism = { cutPoint: 'PRODUCER_SUCCESS_CLAIM', claimedSuccess: true,
        verifierStatus: first.verification?.status ?? null,
        defectiveObserved: first.verification?.status !== 'ACCEPTED' && first.verification?.status !== 'PASS' };
    } else if (scenario === 'RESTART_AFTER_FINALIZATION') {
      journal = await writeTrialJournal(directory, { ...journal, finalized: true,
        finalizedDigest: await candidateDigest(candidateDir) });
      const child = spawnSync(process.execPath, [selfPath, '--mode', 'restart-phase-core',
        '--trial-dir', directory, '--family', family, '--trial-id', id, '--cohort-id', cohortId],
        { encoding: 'utf8', timeout: 300000 });
      if (child.status !== 0) fail(`core restart-phase child replayed or failed: ${child.status} ${String(child.stderr ?? '').slice(-512)}`);
      const proof = await plainJson(join(directory, 'restart-proof.json'));
      journal = await readTrialJournal(directory);
      mechanism = { cutPoint: 'RESTART_AFTER_FINALIZATION',
        restartWithoutReplay: proof.restartWithoutReplay === true && journal.executorCalls === 1 };
    } else fail(`unknown controlled scenario: ${scenario}`);
  }
  const tracePath = join(directory, 'core-events.json');
  await auditCoreTrace(tracePath, { executionId: id, sessionId: `${cohortId}:${id}`, requirePromotion: false });
  const traceHash = await fileHash(tracePath);
  const state = await arm.state();
  const finalizedDigest = await candidateDigest(candidateDir);
  const verificationStatus = first.verification?.status ?? null;
  const verifiedAccept = verificationStatus === 'PASS' || verificationStatus === 'ACCEPTED';
  const observed = { accepted: verifiedAccept && (scenario === 'STALE_CANDIDATE_VERIFICATION'
      ? mechanism.citedDigest === finalizedDigest : true),
    bound: scenario === 'STALE_CANDIDATE_VERIFICATION' ? mechanism.citedDigest === finalizedDigest : true,
    duplicateEffect: journal.executorCalls > 1, lostResult: false,
    recoveryWork: scenario === 'CRASH_AFTER_DURABLE_RESULT' ? 1 : 0, unsafeAcceptance: false };
  journal = await writeTrialJournal(directory, { ...journal, finalized: true, accepted: observed.accepted });
  const oracle = { schemaVersion: 1, evidenceClass: 'CONTROLLED_INDEPENDENT_ORACLE', trialId: id,
    family, arm: 'EXHARNESS', scenario, observed, mechanism, verificationStatus,
    candidateDigest: first.candidateDigest, finalizedDigest, faultScheduleHash, traceHash };
  const oraclePath = join(directory, 'oracle.json');
  await writeAtomicJson(oraclePath, oracle);
  return { first, state, tracePath, traceHash, oraclePath, oracle, oracleHash: hashBody(oracle),
    actionCalls: journal.executorCalls, mechanism, observed };
}

async function crashPhaseCore({ trialDir, family, trialId: id, cohortId }) {
  const candidateDir = join(trialDir, 'candidate');
  const journal = await readTrialJournal(trialDir);
  if (!journal) fail('core crash-phase child found no seeded trial journal');
  const executor = async () => {
    const current = await readTrialJournal(trialDir);
    await noteProducerCall(trialDir, current);
    Object.assign(journal, current);
    const produced = await mechanicalProducerOp(candidateDir, id);
    return { candidateDigest: produced.candidateDigest, candidateRef: 'controlled-candidate',
      provider: { ...ZERO_PROVIDER },
      timing: { activeMs: 1, providerWaitMs: 0, startedAt: nowIso(), terminalAt: nowIso() },
      driverResult: { controlled: true } };
  };
  const arm = createCoreArm(coreOptions({ directory: trialDir, candidateDir, trialId: id, family,
    scenario: 'CRASH_AFTER_DURABLE_RESULT', cohortId, journal, executor }));
  const result = await arm.run({ attemptId: `${id}:attempt-1`, taskId: family,
    fault: 'CRASH_AFTER_DURABLE_RESULT', verificationRef: `controlled/${id}/verification.json` });
  if (!result.verification || typeof result.verification.status !== 'string')
    fail('core crash-phase produced no durable verification');
  await writeAtomicJson(join(trialDir, 'verification.json'), { schemaVersion: 1, trialId: id,
    verification: result.verification, candidateDigest: result.candidateDigest,
    verificationCandidate: result.verification?.details?.candidateDigest ?? result.verification?.candidate?.version ?? null });
  await writeTrialJournal(trialDir, { ...journal, executorCalls: 1, resultDurable: true,
    candidateDigest: result.candidateDigest });
  process.exit(1);
}

async function restartPhaseCore({ trialDir, family, trialId: id, cohortId }) {
  const journal = await readTrialJournal(trialDir);
  if (!journal?.finalized) fail('core restart-phase child found no finalized trial');
  const reboundDigest = await candidateDigest(join(trialDir, 'candidate'));
  if (reboundDigest !== journal.finalizedDigest) fail('core restart-phase candidate changed after finalization');
  await auditCoreTrace(join(trialDir, 'core-events.json'), { executionId: id, sessionId: `${cohortId}:${id}`, requirePromotion: false });
  const after = await readTrialJournal(trialDir);
  await writeAtomicJson(join(trialDir, 'restart-proof.json'), { schemaVersion: 1, trialId: id, family,
    restartWithoutReplay: after.executorCalls === 1, executorCalls: after.executorCalls, finalizedDigest: reboundDigest });
}

function trialRow({ trialId: id, family, scenario, arm, manifest, observed, mechanism, oraclePath, oracleHash, tracePath = null, traceHash = null, coreStateHash = null, actionCalls, directObserved = null }) {
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
    attribution: arm === 'DIRECT' ? 'COMMON' : (directObserved &&
      directObserved.accepted === observed.accepted &&
      (directObserved.recoveryWork ?? 0) === (observed.recoveryWork ?? 0) ? 'COMMON' : 'CORE'),
    mechanism,
    oracleRef: relative(resolve(manifest.outputRoot), oraclePath).replaceAll('\\', '/'),
    oracleHash,
    traceRef: tracePath ? relative(resolve(manifest.outputRoot), tracePath).replaceAll('\\', '/') : null,
    traceHash,
    coreStateHash,
    actionCalls
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
  for (const row of artifact.trials) {
    if (!row.mechanism || typeof row.mechanism.cutPoint !== 'string') fail(`controlled trial lacks a measured fault mechanism: ${row.trialId}`);
    if (!Number.isInteger(row.actionCalls) || row.actionCalls !== 1)
      fail(`controlled trial replayed the producer: ${row.trialId}`);
    if (row.arm === 'DIRECT' && row.attribution !== 'COMMON')
      fail(`DIRECT trial misattributes shared safeguards: ${row.trialId}`);
    if (row.arm === 'EXHARNESS' && !['COMMON', 'CORE'].includes(row.attribution))
      fail(`EXHARNESS trial attribution is invalid: ${row.trialId}`);
    if (row.scenario === 'STALE_CANDIDATE_VERIFICATION' && (row.mechanism.swapObserved !== true || row.accepted !== false))
      fail(`stale candidate was not rejected at the cut-point: ${row.trialId}`);
    if (row.scenario === 'PRODUCER_SUCCESS_VERIFIER_REJECTION' &&
        (row.mechanism.defectiveObserved !== true || row.accepted !== false))
      fail(`defective producer success was not rejected: ${row.trialId}`);
    if (row.scenario === 'CRASH_AFTER_DURABLE_RESULT' &&
        (row.mechanism.killObserved !== true || row.mechanism.resumedWithoutReplay !== true || row.recoveryWork !== 1))
      fail(`crash recovery lacks a real kill and replay-free resume: ${row.trialId}`);
    if (row.scenario === 'RESTART_AFTER_FINALIZATION' && row.mechanism.restartWithoutReplay !== true)
      fail(`restart replayed finalized work: ${row.trialId}`);
  }
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
      const direct = await directTrial({ trialRoot, trialId: directId, family, scenario, faultScheduleHash: manifest.faultScheduleHash });
      const core = await coreTrial({ trialRoot, trialId: exharnessId, family, scenario,
        cohortId: manifest.cohortId, faultScheduleHash: manifest.faultScheduleHash, directObserved: direct.observed });
      trials.push(trialRow({ trialId: directId, family, scenario, arm: 'DIRECT',
        manifest: { ...manifest, outputRoot: directory }, observed: direct.observed, mechanism: direct.mechanism,
        oraclePath: direct.oraclePath, oracleHash: direct.oracleHash, actionCalls: direct.actionCalls }));
      trials.push(trialRow({ trialId: exharnessId, family, scenario, arm: 'EXHARNESS',
        manifest: { ...manifest, outputRoot: directory }, observed: core.observed, mechanism: core.mechanism,
        oraclePath: core.oraclePath, oracleHash: core.oracleHash, tracePath: core.tracePath, traceHash: core.traceHash,
        coreStateHash: hashBody(core.state), actionCalls: core.actionCalls, directObserved: direct.observed }));
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
  const mode = option(args, '--mode') ?? 'run';
  const profilePath = option(args, '--profile');
  const output = option(args, '--output');
  if (mode === 'crash-phase-direct') {
    await crashPhaseDirect({ trialDir: resolve(option(args, '--trial-dir')), family: option(args, '--family'), trialId: option(args, '--trial-id') });
    return { mode };
  }
  if (mode === 'restart-phase-direct') {
    await restartPhaseDirect({ trialDir: resolve(option(args, '--trial-dir')), family: option(args, '--family'), trialId: option(args, '--trial-id') });
    return { mode };
  }
  if (mode === 'crash-phase-core') {
    await crashPhaseCore({ trialDir: resolve(option(args, '--trial-dir')), family: option(args, '--family'),
      trialId: option(args, '--trial-id'), cohortId: option(args, '--cohort-id') });
    return { mode };
  }
  if (mode === 'restart-phase-core') {
    await restartPhaseCore({ trialDir: resolve(option(args, '--trial-dir')), family: option(args, '--family'),
      trialId: option(args, '--trial-id'), cohortId: option(args, '--cohort-id') });
    return { mode };
  }
  if (!profilePath || !output) fail('--profile and --output are required');
  return runControlledTrials({ profile: await plainJson(resolve(profilePath)), output: resolve(output) });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await main())); }
  catch (error) { console.error(error.message); process.exitCode = error.exitCode ?? 4; }
}
