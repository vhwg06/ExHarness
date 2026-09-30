// Shared test helpers: build a registered experiment over a sealed fixture and run attempts through
// the real attempt runner and Harbor adapter, with a fake Harbor binary instead of Docker.
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AttemptLedger, createBenchmarkUnit, createExperimentRegistration } from '@exharness/benchmark';
import { createHarborSubstrate, EVALUATOR_IDENTITY } from '../harbor/adapter.mjs';
import { runAttempt, writeExperiment } from '../attempt-runner.mjs';
import { SUBSTRATE_ROOT, HARBOR, fileDigest, readJson } from '../common.mjs';

export const FAKE_HARBOR = fileURLToPath(new URL('./fixtures/fake-harbor.mjs', import.meta.url));
export const RUN_CLI = join(SUBSTRATE_ROOT, 'run.mjs');
export const tempDir = prefix => mkdtemp(join(tmpdir(), prefix));

export async function sealedFixture(id) {
  const manifest = await readJson(join(SUBSTRATE_ROOT, 'fixtures', 'manifest.json'));
  const fixture = manifest.fixtures.find(item => item.id === id);
  return { ...fixture, dir: join(SUBSTRATE_ROOT, fixture.path) };
}

export function fakeSubstrate(outputRoot, { mode = 'pass', log } = {}) {
  const env = { ...process.env, FAKE_HARBOR_MODE: mode, ...(log ? { FAKE_HARBOR_LOG: log } : {}) };
  return createHarborSubstrate({ harborBin: FAKE_HARBOR, pythonBin: HARBOR.python, outputRoot, env });
}

export async function registeredExperiment({ experimentId = 'TEST-EXPERIMENT', fixtureId = 'SUBSTRATE-ARTIFACT-01', unitIds = ['U1'] } = {}) {
  const fixture = await sealedFixture(fixtureId);
  const registration = createExperimentRegistration({
    experimentId, protocol: { id: 'TEST', version: '1', hash: fileDigest('test-protocol') }, sourceIdentity: 'git:test',
    workloadManifest: { ref: 'benchmarks/substrate/fixtures/manifest.json', digest: fileDigest('fixtures') },
    environmentIdentity: fixture.environmentIdentity, producerProfile: { id: 'oracle', hash: fileDigest('oracle') },
    resourceBudget: { id: 'test-budget', hash: fileDigest('budget') }, artifactPolicy: { declaredBy: 'task.toml artifacts' },
    evaluatorIdentity: EVALUATOR_IDENTITY, resetPolicy: { newHarborTrialPerAttempt: true }, unitIds, createdAt: '2026-01-01T00:00:00.000Z'
  });
  const units = unitIds.map(unitId => createBenchmarkUnit({
    unitId, experimentId, task: { id: fixture.id, bundleDigest: fixture.bundleDigest }, environmentIdentity: fixture.environmentIdentity,
    instructionDigest: fixture.instructionDigest, producerProfile: 'oracle', repeatIndex: 0, arm: 'ORACLE', budgetProfileHash: registration.resourceBudget.hash
  }, { registration }));
  const ledger = new AttemptLedger({ registration });
  units.forEach(unit => ledger.registerUnit(unit));
  return { fixture, registration, units, ledger };
}

export async function runFakeAttempt({ experiment, substrate, experimentRoot, unitIndex = 0, attemptId = 'A1', retryOfAttemptId = null }) {
  return runAttempt({
    ledger: experiment.ledger, substrate, unit: experiment.units[unitIndex], attemptId, retryOfAttemptId,
    producer: { kind: 'ORACLE', identity: 'harbor-oracle@test' }, taskDir: experiment.fixture.dir,
    runtime: { sourceSha: 'test', profileHash: experiment.registration.producerProfile.hash },
    budget: { wallMs: null, inputTokens: null, outputTokens: null, costUsd: null, toolCalls: null }, experimentRoot
  });
}

export async function materialize(root, experiment) {
  await writeExperiment(root, { registration: experiment.registration, units: experiment.units });
}
