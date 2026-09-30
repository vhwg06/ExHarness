// S3/S5 — Kernel integration: registers the experiment/units and routes every
// attempt through the shared AttemptLedger plus upstream evidence/accounting/
// audit APIs. Adapters contribute experiment-specific raw observations only.
// The committed cohort is a deterministic OFFLINE fixture: the scripted model
// decides the producer outcome, the independent evaluator step below owns the
// verdict, and no live provider call is ever made here. See --live for the
// fail-closed live entry point (never invoked by tests).
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  ARMS,
  COHORT_ID,
  DEVELOPMENT_TASKS,
  EVALUATOR_IDENTITY,
  EXECUTOR_ID,
  EXPERIMENT_ID,
  MODEL_PROFILE,
  PROTOCOL_ID,
  PROTOCOL_VERSION,
  REPEATS,
  RESOURCE_BUDGET,
  SUBSTRATE_MANIFEST_REF,
  SUBSTRATE_PIN,
  environmentIdentityFor,
  instructionDigestFor,
  protocolHash
} from './constants.mjs';
import { createCoreSyncAdapter } from './adapters/core-sync.mjs';
import { createDirectCodeactAdapter } from './adapters/direct-codeact.mjs';
import { buildTaskScript } from './adapters/shared.mjs';
import { observeEconomics } from './economics.mjs';
import { assertNotHeldOut, cohortBinding, cohortUnitIds, unitIdFor } from './protocol.mjs';
import { reduceComparison } from './reducer.mjs';

const sha = (text) => `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
const bytesOf = (value) => Buffer.from(typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`, 'utf8');

export const PRODUCER_PROFILE_ID = 'bb077-codeact-profile';
export const RESOURCE_BUDGET_ID = 'bb077-sync-budget';
export const SOURCE_IDENTITY = 'benchmarks/harness-efficiency/run.mjs';
export const T0_MS = Date.parse('2026-09-30T00:00:00.000Z');

export function adapters() {
  return Object.freeze({
    DIRECT_CODEACT: createDirectCodeactAdapter(),
    CORE_SYNC: createCoreSyncAdapter()
  });
}

// Deterministic fixture script per (task, repeat), shared by both arms. The
// script drives the real strategy run; the independent evaluator step below
// owns the verdict. Covers ACCEPTED/REJECTED/NOT_EVALUATED with
// KNOWN/PARTIAL/UNKNOWN accounting.
export function defaultScript({ taskId, taskIndex, repeatIndex }) {
  return buildTaskScript({ taskId, taskIndex, repeatIndex });
}

// Independent evaluator step. Runs AFTER the producer settled and reads only
// the candidate artifact the producer wrote: marker good->PASS, bad->FAIL.
// The producer result never carries quality.
export function evaluateArtifact({ marker }) {
  if (marker !== 'good' && marker !== 'bad') {
    throw new Error(`PRECONDITION: evaluator needs artifact marker good|bad, found ${marker ?? 'none'}`);
  }
  return { verdict: marker === 'good' ? 'PASS' : 'FAIL', identity: EVALUATOR_IDENTITY, evidenceRef: 'verifier/reward.txt' };
}

function outcomeInputFor({ raw, evaluation }) {
  if (raw.status === 'ERROR') {
    return {
      producerStatus: 'PRODUCER_ERROR',
      termination: 'AGENT_ERROR',
      providerStatus: raw.errorCode === 'PROVIDER_TIMEOUT' ? 'PROVIDER_TIMEOUT' : 'NONE',
      infrastructureStatus: 'NONE',
      candidate: { extractionStatus: 'NOT_PRODUCED', evaluable: false },
      evaluator: { verdict: 'NOT_RUN', identity: EVALUATOR_IDENTITY, evidenceRef: null }
    };
  }
  return {
    producerStatus: 'SUCCESS',
    termination: 'COMPLETED',
    providerStatus: 'NONE',
    infrastructureStatus: 'NONE',
    candidate: { extractionStatus: 'EXTRACTED', evaluable: true },
    evaluator: evaluation
  };
}

const ACCOUNTING_FIELDS = ['inputTokens', 'outputTokens', 'cachedTokens', 'cacheWriteTokens', 'providerCostUsd', 'normalizedCostUsd'];

function usageObservationFor({ arm, script }) {
  const values = Object.fromEntries(ACCOUNTING_FIELDS.map((field) => [field, script.usage?.[field] ?? null]));
  return {
    source: `bb077-${arm.toLowerCase()}-producer`,
    reportedFields: script.usage ? Object.keys(script.usage) : [],
    values
  };
}

export async function runCohort({ kernel, manifest, rawManifest, scripts = {}, withRetry = true } = {}) {
  if (!kernel) throw new Error('PRECONDITION: runCohort needs the benchmark kernel');
  if (!manifest) throw new Error('PRECONDITION: runCohort needs the substrate manifest');
  const binding = cohortBinding({ substrateManifest: manifest });
  const workloadDigest = sha(rawManifest ?? JSON.stringify(manifest));
  const producerHash = sha(JSON.stringify({ profile: PRODUCER_PROFILE_ID, strategy: 'javascript-codeact', executor: EXECUTOR_ID }));
  const budgetHash = sha(JSON.stringify({ budget: RESOURCE_BUDGET_ID, ...RESOURCE_BUDGET }));

  const unitIds = cohortUnitIds();
  const registration = kernel.createExperimentRegistration({
    experimentId: EXPERIMENT_ID,
    protocol: { id: PROTOCOL_ID, version: PROTOCOL_VERSION, hash: protocolHash() },
    sourceIdentity: SOURCE_IDENTITY,
    workloadManifest: { ref: SUBSTRATE_MANIFEST_REF, digest: workloadDigest },
    environmentIdentity: environmentIdentityFor(),
    producerProfile: { id: PRODUCER_PROFILE_ID, hash: producerHash },
    resourceBudget: { id: RESOURCE_BUDGET_ID, hash: budgetHash },
    artifactPolicy: { declared: ['artifacts/patch.diff'] },
    evaluatorIdentity: EVALUATOR_IDENTITY,
    resetPolicy: { freshTrialPerAttempt: true },
    unitIds,
    createdAt: new Date(T0_MS).toISOString()
  });

  const ledger = new kernel.AttemptLedger({ registration });
  const armAdapters = adapters();
  const units = [];
  for (let taskIndex = 0; taskIndex < DEVELOPMENT_TASKS.length; taskIndex += 1) {
    const task = DEVELOPMENT_TASKS[taskIndex];
    assertNotHeldOut(task.id);
    for (let repeatIndex = 0; repeatIndex < REPEATS; repeatIndex += 1) {
      for (const arm of ARMS) {
        const unit = kernel.createBenchmarkUnit({
          unitId: unitIdFor({ taskId: task.id, arm, repeatIndex }),
          experimentId: EXPERIMENT_ID,
          task: { id: task.bundle, bundleDigest: task.bundleDigest },
          environmentIdentity: environmentIdentityFor(),
          instructionDigest: instructionDigestFor(task.bundleDigest),
          producerProfile: PRODUCER_PROFILE_ID,
          repeatIndex,
          arm,
          budgetProfileHash: budgetHash
        }, { registration });
        ledger.registerUnit(unit);
        units.push(unit);
      }
    }
  }

  const settled = [];
  const stores = new Map();
  let clock = 0;
  const scriptFor = (taskId, taskIndex, repeatIndex, arm) =>
    scripts[`${taskId}:${arm}:r${repeatIndex}`] ?? scripts[`${taskId}:r${repeatIndex}`] ?? defaultScript({ taskId, taskIndex, repeatIndex });

  async function executeAttempt({ unit, attemptId, retryOfAttemptId = null, script }) {
    const task = DEVELOPMENT_TASKS.find((entry) => unitIdFor({ taskId: entry.id, arm: unit.arm, repeatIndex: unit.repeatIndex }) === unit.unitId);
    assertNotHeldOut(task.id);
    const startedAt = new Date(T0_MS + clock * 1000).toISOString();
    ledger.beginAttempt({ unitId: unit.unitId, attemptId, retryOfAttemptId, startedAt });
    const adapter = armAdapters[unit.arm];
    // The adapter really executes the shared strategy here; every number in
    // `raw` was measured from that run.
    const raw = await adapter.run({ taskId: task.id, bundleDigest: task.bundleDigest, attemptId, script });
    const trialId = `${unit.unitId}--${attemptId}`;
    const usageObservation = usageObservationFor({ arm: unit.arm, script });
    const usage = kernel.normalizeAccounting(usageObservation);
    // Independent evaluator step: judges only the artifact the producer wrote.
    const evaluation = raw.status === 'ERROR' ? null : evaluateArtifact({ marker: raw.result?.marker ?? null });
    const outcomeInput = outcomeInputFor({ raw, evaluation });
    const outcome = kernel.normalizeOutcome(outcomeInput);
    const elapsedMs = raw.elapsedMs;
    const endedAt = new Date(Date.parse(startedAt) + elapsedMs).toISOString();
    clock += 1;
    const economics = observeEconomics({
      adapterRun: raw,
      usage: { cachedTokens: usage.cachedTokens },
      startedAt,
      endedAt
    });

    const files = new Map();
    const entries = [];
    const put = (role, ref, value) => {
      const bytes = bytesOf(value);
      files.set(ref, bytes);
      entries.push({ role, ref, digest: digestOf(bytes), bytes: bytes.length });
      return ref;
    };
    put('RAW_RESULT', 'raw/result.json', {
      arm: unit.arm, unitId: unit.unitId, attemptId, trialId,
      status: raw.status, modelTurns: raw.modelTurns, toolCalls: raw.toolCalls, cellsExecuted: raw.cellsExecuted
    });
    put('RESET_IDENTITY', 'reset.json', {
      kind: 'BENCHMARK_RESET_IDENTITY_V1', attemptId, trialId,
      workspaceRef: `ws/${unit.unitId}/${attemptId}`, outputRef: `out/${unit.unitId}/${attemptId}`, preexisting: []
    });
    put('USAGE_OBSERVATION', 'usage.json', usageObservation);
    put('NORMALIZATION', 'normalization.json', { kind: 'BENCHMARK_NORMALIZATION_INPUT_V1', outcomeInput });
    put('TRAJECTORY', 'trajectory/economics.json', economics);
    const extracted = outcomeInput.candidate.extractionStatus === 'EXTRACTED';
    let candidate;
    if (extracted) {
      put('VERIFIER_OUTPUT', 'verifier/reward.txt', evaluation.verdict === 'PASS' ? '1\n' : '0\n');
      const artifactBytes = bytesOf(`patch for ${task.id}\nmarker:${raw.result.marker}\nterminal:${JSON.stringify(raw.result)}\n`);
      const artifactDigest = digestOf(artifactBytes);
      files.set('artifacts/patch.diff', artifactBytes);
      entries.push({ role: 'ARTIFACT', ref: 'artifacts/patch.diff', digest: artifactDigest, bytes: artifactBytes.length });
      const listing = { kind: 'BENCHMARK_ARTIFACT_MANIFEST_V1', files: [{ ref: 'artifacts/patch.diff', digest: artifactDigest, bytes: artifactBytes.length }] };
      const listingBytes = bytesOf(listing);
      const listingDigest = digestOf(listingBytes);
      files.set('artifacts/manifest.json', listingBytes);
      entries.push({ role: 'ARTIFACT_MANIFEST', ref: 'artifacts/manifest.json', digest: listingDigest, bytes: listingBytes.length });
      // Kernel identity: the candidate digest is the artifact-manifest entry
      // digest (same convention as the delivered downstream fixture).
      candidate = { artifactRef: 'artifacts/patch.diff', artifactDigest: listingDigest, extractionStatus: 'EXTRACTED' };
    } else {
      candidate = { artifactRef: null, artifactDigest: null, extractionStatus: 'NOT_PRODUCED' };
    }

    const manifestDoc = kernel.createEvidenceManifest({
      experimentId: EXPERIMENT_ID, unitId: unit.unitId, attemptId, entries
    });
    const { record } = ledger.settleAttempt({
      experimentId: EXPERIMENT_ID,
      cohortId: COHORT_ID,
      unitId: unit.unitId,
      attemptId,
      retryOfAttemptId,
      protocolHash: registration.protocol.hash,
      task: {
        id: task.bundle,
        bundleDigest: task.bundleDigest,
        environmentIdentity: environmentIdentityFor(),
        instructionDigest: instructionDigestFor(task.bundleDigest)
      },
      runtime: {
        substrate: SUBSTRATE_PIN.substrate,
        substrateVersion: SUBSTRATE_PIN.version,
        substrateCommit: SUBSTRATE_PIN.commit,
        sourceSha: 'fixture-deterministic',
        profileHash: producerHash
      },
      producer: { kind: unit.arm, identity: `${unit.arm.toLowerCase()}-adapter@1`, model: MODEL_PROFILE.model, provider: MODEL_PROFILE.provider },
      budget: { ...RESOURCE_BUDGET },
      candidate,
      evidence: {
        substrateTrialRef: trialId,
        resultRef: 'raw/result.json',
        trajectoryRef: 'trajectory/economics.json',
        verifierRefs: extracted ? ['verifier/reward.txt'] : [],
        artifactManifestRef: extracted ? 'artifacts/manifest.json' : null,
        manifestDigest: manifestDoc.manifestDigest
      },
      usage,
      timing: { startedAt, endedAt, elapsedMs, providerWaitMs: null, capabilityWaitMs: null },
      quality: outcome.quality,
      termination: outcome.termination,
      providerStatus: outcome.providerStatus,
      infrastructureStatus: outcome.infrastructureStatus,
      failureFingerprint: economics.failureFingerprint
    }, { settledAt: endedAt });
    stores.set(attemptId, files);
    const item = { unit, record, manifest: manifestDoc, economics };
    settled.push(item);
    return item;
  }

  for (const unit of units) {
    const taskIndex = DEVELOPMENT_TASKS.findIndex((entry) => unit.unitId.startsWith(`${entry.id}--`));
    const taskId = DEVELOPMENT_TASKS[taskIndex].id;
    await executeAttempt({
      unit,
      attemptId: `${unit.unitId}--attempt-1`,
      script: scriptFor(taskId, taskIndex, unit.repeatIndex, unit.arm)
    });
  }

  // One deterministic retry: a failed first attempt is preserved and a new
  // attempt settles the retry. History is append-only.
  if (withRetry) {
    const target = units[0];
    const taskId = DEVELOPMENT_TASKS[0].id;
    await executeAttempt({
      unit: target,
      attemptId: `${target.unitId}--attempt-2`,
      retryOfAttemptId: `${target.unitId}--attempt-1`,
      script: {
        kind: 'solve',
        marker: 'good',
        usage: { inputTokens: 1100, outputTokens: 250 },
        cells: {
          'explore': { toolCalls: [{ capability: 'record_note', input: { text: `retry:${taskId}` } }], stdout: 'surveyed' }
        },
        terminalCode: 'finish',
        terminalValue: { ok: true, marker: 'good', taskId }
      }
    });
  }

  const comparison = reduceComparison({
    attempts: settled.map(({ record, economics }) => ({ record, economics }))
  });
  return { registration, units, ledger, settled, stores, comparison, binding };
}

function digestOf(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

// S5 live entry point. Fail-closed: refuses to start unless the frozen route
// credential and the Harbor substrate binary are present AND the substrate
// manifest is sealed and compatible. Even then, live execution requires an
// explicitly authorized paid run, which this offline fixture never performs
// on its own. Tests must never invoke this path.
export async function runLiveEntry({ env = process.env, harborBin = 'harbor' } = {}) {
  if (!env.OPENROUTER_API_KEY) {
    throw new Error('LIVE_REFUSED: OPENROUTER_API_KEY is not set; the frozen route credential is required');
  }
  const probed = spawnSync(harborBin, ['--version'], { encoding: 'utf8' });
  if (probed.status !== 0) {
    throw new Error(`LIVE_REFUSED: Harbor substrate binary ${harborBin} is not available`);
  }
  const { loadSubstrateManifest } = await import('./preflight.mjs');
  await loadSubstrateManifest();
  throw new Error('LIVE_REFUSED: no authorized paid run in this environment; the live synchronous baseline is pending');
}

const invokedAsCli = typeof process.argv?.[1] === 'string' && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedAsCli) {
  const args = process.argv.slice(2);
  if (args.includes('--live')) {
    runLiveEntry().then(
      () => process.exit(0),
      (error) => {
        process.stderr.write(`${error.message}\n`);
        process.exit(2);
      }
    );
  } else {
    process.stderr.write('usage: node benchmarks/harness-efficiency/run.mjs --live\n');
    process.stderr.write('Without --live this module is a library only; the committed cohort is an offline fixture.\n');
    process.exit(2);
  }
}
