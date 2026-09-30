// Deterministic, credential-free and model-free local calibration of the Harbor substrate.
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AttemptLedger, createBenchmarkUnit, createExperimentRegistration } from '@exharness/benchmark';
import { createHarborSubstrate, EVALUATOR_IDENTITY } from './harbor/adapter.mjs';
import { resolveHarborIdentity, taskBundleDigests, instructionDigest, environmentIdentity } from './harbor/identity.mjs';
import { runAttempt, writeExperiment } from './attempt-runner.mjs';
import { SUBSTRATE_ROOT, HARBOR, fileDigest, readJson, sourceIdentity } from './common.mjs';

export const EXPECT_KEYS = ['quality', 'termination', 'providerStatus', 'infrastructureStatus', 'extractionStatus', 'usageStatus', 'producerStatus', 'artifactFiles'];

export function observe(record, normalizationInput) {
  return {
    quality: record.quality.verdict, termination: record.termination, providerStatus: record.providerStatus, infrastructureStatus: record.infrastructureStatus,
    extractionStatus: record.candidate.extractionStatus, usageStatus: record.usage.status, producerStatus: normalizationInput?.outcomeInput?.producerStatus ?? null,
    artifactFiles: normalizationInput?.artifactFiles ?? null
  };
}

export function compareCase(expect, observed) {
  return Object.keys(expect).filter(key => expect[key] !== observed[key]).map(key => ({ key, expected: expect[key], observed: observed[key] }));
}

// Structural checks the calibration matrix must satisfy before anything runs.
export function validateCalibrationManifest(manifest, fixtures) {
  const problems = [];
  const fixtureIds = new Set(fixtures.fixtures.map(fixture => fixture.id));
  const seen = new Set();
  for (const item of manifest.cases) {
    if (seen.has(item.caseId)) problems.push(`duplicate case ${item.caseId}`);
    if (!fixtureIds.has(item.fixture)) problems.push(`${item.caseId}: unknown fixture ${item.fixture}`);
    if (item.retryOfCaseId && !seen.has(item.retryOfCaseId)) problems.push(`${item.caseId}: retry target ${item.retryOfCaseId} must run earlier`);
    for (const key of Object.keys(item.expect)) if (!EXPECT_KEYS.includes(key)) problems.push(`${item.caseId}: unknown expectation ${key}`);
    if (!['ORACLE', 'NOP', 'CALIBRATION_PRODUCER'].includes(item.producer.kind)) problems.push(`${item.caseId}: producer ${item.producer.kind} is not model-free`);
    seen.add(item.caseId);
  }
  for (const fixture of fixtureIds) if (!manifest.cases.some(item => item.fixture === fixture)) problems.push(`fixture ${fixture} has no case`);
  if (manifest.codingModelCalls !== 0) problems.push('local calibration must make zero coding-model calls');
  return problems;
}

export async function runLocalCalibration({ outputRoot }) {
  const fixtures = await readJson(join(SUBSTRATE_ROOT, 'fixtures', 'manifest.json'));
  const manifestBytes = await readFile(join(SUBSTRATE_ROOT, 'calibration', 'manifest.json'));
  const manifest = JSON.parse(manifestBytes);
  const problems = validateCalibrationManifest(manifest, fixtures);
  const harbor = await resolveHarborIdentity({ harborBin: HARBOR.bin, pythonBin: HARBOR.python });
  if (!harbor.pinned) problems.push(...harbor.problems);

  const fixtureIdentity = {};
  const dirs = fixtures.fixtures.map(fixture => join(SUBSTRATE_ROOT, fixture.path));
  const bundles = taskBundleDigests(dirs, { pythonBin: HARBOR.python });
  for (const fixture of fixtures.fixtures) {
    const dir = join(SUBSTRATE_ROOT, fixture.path);
    const observed = { bundleDigest: bundles[dir], instructionDigest: await instructionDigest(dir), environmentIdentity: await environmentIdentity(dir) };
    for (const key of Object.keys(observed)) if (observed[key] !== fixture[key]) problems.push(`${fixture.id} ${key} ${observed[key]} != sealed ${fixture[key]}`);
    fixtureIdentity[fixture.id] = { dir, ...observed };
  }
  if (problems.length) return { mode: 'local-calibration', status: 'FAIL', harbor: harbor.identity, problems };

  const { head, sourceIdentity: source } = sourceIdentity();
  const unitCases = manifest.cases.filter(item => !item.retryOfCaseId);
  const registration = createExperimentRegistration({
    experimentId: manifest.experimentId,
    protocol: { id: manifest.protocol.id, version: manifest.protocol.version, hash: fileDigest(manifestBytes) },
    sourceIdentity: source,
    workloadManifest: { ref: 'benchmarks/substrate/fixtures/manifest.json', digest: fileDigest(await readFile(join(SUBSTRATE_ROOT, 'fixtures', 'manifest.json'))) },
    environmentIdentity: `harbor-docker:${fixtures.baseImage}`,
    producerProfile: { id: 'substrate-model-free-producers', hash: fileDigest(JSON.stringify(manifest.cases.map(item => item.producer))) },
    resourceBudget: { id: 'substrate-calibration-budget', hash: fileDigest(JSON.stringify(manifest.budget)) },
    artifactPolicy: { declaredBy: 'task.toml artifacts', symlinkOrSpecialFile: 'ARTIFACT_EXTRACTION', undeclared: 'NOT_DECLARED' },
    evaluatorIdentity: EVALUATOR_IDENTITY,
    resetPolicy: { newHarborTrialPerAttempt: true, newAttemptOutputRoot: true, harborEnvironmentDelete: true, reusedOutputOrTrial: 'RESET_REUSED' },
    unitIds: unitCases.map(item => item.unitId),
    createdAt: new Date().toISOString()
  });
  const units = unitCases.map((item, index) => createBenchmarkUnit({
    unitId: item.unitId, experimentId: registration.experimentId,
    task: { id: item.fixture, bundleDigest: fixtureIdentity[item.fixture].bundleDigest },
    environmentIdentity: fixtureIdentity[item.fixture].environmentIdentity,
    instructionDigest: fixtureIdentity[item.fixture].instructionDigest,
    producerProfile: item.producer.kind === 'CALIBRATION_PRODUCER' ? `calibration-${item.producer.mode}` : item.producer.kind.toLowerCase(),
    repeatIndex: item.caseId.endsWith('-REPEAT') ? 1 : 0,
    arm: item.producer.kind,
    budgetProfileHash: registration.resourceBudget.hash
  }, { registration }));
  const experimentRoot = join(outputRoot, registration.experimentId);
  await writeExperiment(experimentRoot, { registration, units });
  const ledger = new AttemptLedger({ registration });
  units.forEach(unit => ledger.registerUnit(unit));
  const substrate = createHarborSubstrate({ harborBin: HARBOR.bin, pythonBin: HARBOR.python, outputRoot, identity: harbor.identity });

  // Cases run concurrently in fresh Harbor trials; a retry case starts only after its original settles.
  const concurrency = Math.max(1, Number(process.env.BENCHMARK_CALIBRATION_CONCURRENCY) || 6);
  const settledByCase = {};
  const runCase = async item => {
    const unit = ledger.unit(item.unitId);
    const attemptId = `${item.caseId}-attempt-1`;
    const retryOfAttemptId = item.retryOfCaseId ? (await settledByCase[item.retryOfCaseId]).attemptId : null;
    const producer = { ...item.producer, identity: item.producer.kind === 'CALIBRATION_PRODUCER' ? `exharness-calibration-producer@1.0.0:${item.producer.mode}` : `harbor-${item.producer.kind.toLowerCase()}@${harbor.identity.version}` };
    const { record, evidenceDir } = await runAttempt({ ledger, substrate, unit, attemptId, retryOfAttemptId,
      producer, taskDir: fixtureIdentity[item.fixture].dir, runtime: { sourceSha: head, profileHash: registration.producerProfile.hash }, budget: manifest.budget, experimentRoot });
    const normalization = JSON.parse(await readFile(join(evidenceDir, 'normalization.json'), 'utf8'));
    normalization.artifactFiles = record.candidate.extractionStatus === 'EXTRACTED'
      ? JSON.parse(await readFile(join(evidenceDir, 'artifacts', 'manifest.json'), 'utf8')).files.length : 0;
    const observed = observe(record, normalization);
    return { caseId: item.caseId, attemptId, retryOfAttemptId: record.retryOfAttemptId, trial: record.evidence.substrateTrialRef, observed, mismatches: compareCase(item.expect, observed), recordDigest: record.recordDigest };
  };
  const ordered = [...manifest.cases.filter(item => !item.retryOfCaseId), ...manifest.cases.filter(item => item.retryOfCaseId)];
  const resultByCase = {};
  let next = 0;
  const worker = async () => {
    while (next < ordered.length) {
      const item = ordered[next++];
      const promise = runCase(item);
      settledByCase[item.caseId] = promise;
      resultByCase[item.caseId] = await promise;
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, ordered.length) }, worker));
  const results = manifest.cases.map(item => resultByCase[item.caseId]);

  // Fresh-process audit: a new Node process reopens every materialized attempt and recomputes identities.
  const audit = spawnSync(process.execPath, [join(SUBSTRATE_ROOT, 'run.mjs'), '--mode', 'audit', '--input', experimentRoot], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  let auditSummary;
  try { auditSummary = JSON.parse(audit.stdout); } catch { auditSummary = { status: 'FAIL', findings: [{ code: 'AUDIT_PROCESS', detail: audit.stderr.slice(0, 2000) }] }; }
  const attempts = ledger.attempts();
  const retry = attempts.find(attempt => attempt.retryOfAttemptId);
  const status = results.every(result => result.mismatches.length === 0) && auditSummary.status === 'PASS' && audit.status === 0 ? 'PASS' : 'FAIL';
  return {
    mode: 'local-calibration', status, harbor: harbor.identity, experimentId: registration.experimentId, registrationDigest: registration.registrationDigest,
    outputRoot: experimentRoot, codingModelCalls: 0,
    ledger: { events: ledger.events().length, attempts: attempts.length, settled: attempts.filter(a => a.status === 'SETTLED').length,
      retryPreserved: retry ? { retry: retry.attemptId, of: retry.retryOfAttemptId, originalStillSettled: ledger.attempt(retry.retryOfAttemptId)?.status === 'SETTLED', originalQuality: ledger.attempt(retry.retryOfAttemptId)?.record?.quality.verdict } : null },
    distinctTrials: new Set(results.map(result => result.trial)).size,
    cases: results,
    freshProcessAudit: { status: auditSummary.status, attempts: auditSummary.attempts, findings: auditSummary.findings }
  };
}
