// Deterministic in-memory fixtures for package tests. No substrate, model or credential.
import { createHash } from 'node:crypto';
import { createExperimentRegistration, createBenchmarkUnit, normalizeOutcome, normalizeAccounting, createEvidenceManifest } from '@exharness/benchmark';

export const sha = text => `sha256:${createHash('sha256').update(text).digest('hex')}`;
export const T0 = '2026-09-30T00:00:00.000Z';
export const T1 = '2026-09-30T00:00:05.000Z';
export const EVALUATOR = 'fixture-verifier@1';

export function registrationInput(overrides = {}) {
  return {
    experimentId: 'EXP-FIXTURE-01',
    protocol: { id: 'FIXTURE-PROTOCOL', version: '1', hash: sha('protocol') },
    sourceIdentity: 'git:0000000000000000000000000000000000000000',
    workloadManifest: { ref: 'fixtures/manifest.json', digest: sha('workload') },
    environmentIdentity: 'docker:fixture',
    producerProfile: { id: 'fixture-producer', hash: sha('producer') },
    resourceBudget: { id: 'fixture-budget', hash: sha('budget') },
    artifactPolicy: { paths: ['out/result.txt'] },
    evaluatorIdentity: EVALUATOR,
    resetPolicy: { freshTrial: true, freshWorkspace: true },
    unitIds: ['UNIT-A', 'UNIT-B'],
    createdAt: T0,
    ...overrides
  };
}

export function unitInput(unitId = 'UNIT-A', overrides = {}) {
  return {
    unitId,
    experimentId: 'EXP-FIXTURE-01',
    task: { id: `task-${unitId}`, bundleDigest: sha(`bundle-${unitId}`) },
    environmentIdentity: 'docker:fixture',
    instructionDigest: sha(`instruction-${unitId}`),
    producerProfile: 'fixture-producer',
    repeatIndex: 0,
    arm: 'CONTROL',
    budgetProfileHash: sha('budget'),
    ...overrides
  };
}

export function setup() {
  const registration = createExperimentRegistration(registrationInput());
  const units = ['UNIT-A', 'UNIT-B'].map(id => createBenchmarkUnit(unitInput(id), { registration }));
  return { registration, units };
}

export function outcomeInput(overrides = {}) {
  return {
    producerStatus: 'SUCCESS', termination: 'COMPLETED', providerStatus: 'NONE', infrastructureStatus: 'NONE',
    candidate: { extractionStatus: 'EXTRACTED', evaluable: true },
    evaluator: { verdict: 'PASS', identity: EVALUATOR, evidenceRef: 'verifier/reward.txt' },
    ...overrides
  };
}

export function usageObservation(values = {}, reportedFields = Object.keys(values)) {
  return { source: 'fixture-producer', reportedFields, values };
}

const text = value => Buffer.from(typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);

// Materialize one attempt's evidence files into an in-memory store and build its record input.
export function materializeAttempt({ unit, attemptId, retryOfAttemptId = null, outcome = outcomeInput(), usage = usageObservation(), artifact = 'calibrated\n' }) {
  const files = new Map();
  const put = (role, ref, value) => { const bytes = text(value); files.set(ref, { role, bytes }); return { role, ref, digest: sha(bytes), bytes: bytes.length }; };
  const entries = [];
  entries.push(put('RAW_RESULT', 'raw/result.json', { trial: `trial-${attemptId}`, ok: true }));
  entries.push(put('RESET_IDENTITY', 'reset.json', { kind: 'BENCHMARK_RESET_IDENTITY_V1', attemptId, trialId: `trial-${attemptId}`, workspaceRef: `ws/${attemptId}`, outputRef: `out/${attemptId}`, preexisting: [] }));
  entries.push(put('USAGE_OBSERVATION', 'usage.json', usage));
  entries.push(put('NORMALIZATION', 'normalization.json', { kind: 'BENCHMARK_NORMALIZATION_INPUT_V1', outcomeInput: outcome }));
  const verifierRefs = [];
  if (outcome.evaluator.verdict !== 'NOT_RUN') { entries.push(put('VERIFIER_OUTPUT', 'verifier/reward.txt', outcome.evaluator.verdict === 'PASS' ? '1\n' : '0\n')); verifierRefs.push('verifier/reward.txt'); }
  let candidate = { artifactRef: null, artifactDigest: null, extractionStatus: outcome.candidate.extractionStatus };
  let artifactManifestRef = null;
  if (outcome.candidate.extractionStatus === 'EXTRACTED') {
    const file = put('ARTIFACT', 'artifacts/out/result.txt', artifact);
    entries.push(file);
    const listing = put('ARTIFACT_MANIFEST', 'artifacts/manifest.json', { kind: 'BENCHMARK_ARTIFACT_MANIFEST_V1', files: [{ ref: file.ref, digest: file.digest, bytes: file.bytes }] });
    entries.push(listing);
    candidate = { artifactRef: file.ref, artifactDigest: listing.digest, extractionStatus: 'EXTRACTED' };
    artifactManifestRef = listing.ref;
  }
  const manifest = createEvidenceManifest({ experimentId: unit.experimentId, unitId: unit.unitId, attemptId, entries });
  const normalized = normalizeOutcome(outcome);
  const accounting = normalizeAccounting(usage);
  const record = {
    experimentId: unit.experimentId, cohortId: null, unitId: unit.unitId, attemptId, retryOfAttemptId, protocolHash: sha('protocol'),
    task: { id: unit.task.id, bundleDigest: unit.task.bundleDigest, environmentIdentity: unit.environmentIdentity, instructionDigest: unit.instructionDigest },
    runtime: { substrate: 'fixture', substrateVersion: '1', substrateCommit: null, sourceSha: 'fixture', profileHash: sha('producer') },
    producer: { kind: 'FIXTURE', identity: 'fixture-producer@1', model: null, provider: null },
    budget: { wallMs: 60000, inputTokens: null, outputTokens: null, costUsd: null, toolCalls: null },
    candidate,
    evidence: { substrateTrialRef: `trial-${attemptId}`, resultRef: 'raw/result.json', trajectoryRef: null, verifierRefs, artifactManifestRef, manifestDigest: manifest.manifestDigest },
    usage: accounting,
    timing: { startedAt: T0, endedAt: T1, elapsedMs: 5000, providerWaitMs: null, capabilityWaitMs: null },
    quality: normalized.quality, termination: normalized.termination, providerStatus: normalized.providerStatus, infrastructureStatus: normalized.infrastructureStatus,
    failureFingerprint: null
  };
  const store = { async read(ref) { const file = files.get(ref); if (!file) throw new Error(`missing ${ref}`); return file.bytes; }, files };
  return { record, manifest, store };
}
