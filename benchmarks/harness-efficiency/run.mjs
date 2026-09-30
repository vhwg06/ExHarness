// S3/S5 — Kernel integration: registers the experiment/units and routes every
// attempt through the shared AttemptLedger plus upstream evidence/accounting/
// audit APIs. Adapters contribute experiment-specific raw observations only.
// Deterministic and model-free: no live provider calls.
import { createHash } from 'node:crypto';
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

// Deterministic fixture script per (task, repeat). Both arms share the script
// so quality ties and only orchestration-driven economics vary. Covers
// ACCEPTED/REJECTED/NOT_EVALUATED with KNOWN/PARTIAL/UNKNOWN accounting.
export function defaultScript({ taskIndex, repeatIndex }) {
  switch ((taskIndex + repeatIndex) % 4) {
    case 0:
      return { verdict: 'PASS', usage: { inputTokens: 1200, outputTokens: 300 } };
    case 1:
      return { verdict: 'FAIL', usage: null };
    case 2:
      return { verdict: 'PASS', usage: { inputTokens: 900, providerCostUsd: 0.004 } };
    default:
      return { verdict: 'NOT_RUN', provider: 'PROVIDER_TIMEOUT' };
  }
}

function outcomeInputFor(script) {
  if (script.verdict === 'NOT_RUN') {
    return {
      producerStatus: 'PRODUCER_TIMEOUT',
      termination: 'AGENT_ERROR',
      providerStatus: script.provider ?? 'PROVIDER_TIMEOUT',
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
    evaluator: { verdict: script.verdict, identity: EVALUATOR_IDENTITY, evidenceRef: 'verifier/reward.txt' }
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
    scripts[`${taskId}:${arm}:r${repeatIndex}`] ?? scripts[`${taskId}:r${repeatIndex}`] ?? defaultScript({ taskIndex, repeatIndex });

  async function executeAttempt({ unit, attemptId, retryOfAttemptId = null, script }) {
    const task = DEVELOPMENT_TASKS.find((entry) => unitIdFor({ taskId: entry.id, arm: unit.arm, repeatIndex: unit.repeatIndex }) === unit.unitId);
    assertNotHeldOut(task.id);
    const startedAt = new Date(T0_MS + clock * 1000).toISOString();
    ledger.beginAttempt({ unitId: unit.unitId, attemptId, retryOfAttemptId, startedAt });
    const adapter = armAdapters[unit.arm];
    const raw = adapter.run({ taskId: task.id, bundleDigest: task.bundleDigest, attemptId, script });
    const trialId = `${unit.unitId}--${attemptId}`;
    const usageObservation = usageObservationFor({ arm: unit.arm, script });
    const usage = kernel.normalizeAccounting(usageObservation);
    const outcomeInput = outcomeInputFor(script);
    const outcome = kernel.normalizeOutcome(outcomeInput);
    const elapsedMs = raw.modelIntervals.reduce((a, b) => a + b, 0) + raw.callIntervals.reduce((a, b) => a + b, 0) + 50;
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
    put('RAW_RESULT', 'raw/result.json', { arm: unit.arm, unitId: unit.unitId, attemptId, trialId });
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
      put('VERIFIER_OUTPUT', 'verifier/reward.txt', script.verdict === 'PASS' ? '1\n' : '0\n');
      const artifactBytes = bytesOf(`${unit.arm} patch for ${task.id} ${attemptId}\n`);
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
    const taskIndex = 0;
    const taskId = DEVELOPMENT_TASKS[taskIndex].id;
    await executeAttempt({
      unit: target,
      attemptId: `${target.unitId}--attempt-2`,
      retryOfAttemptId: `${target.unitId}--attempt-1`,
      script: { verdict: 'PASS', usage: { inputTokens: 1100, outputTokens: 250 } }
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
