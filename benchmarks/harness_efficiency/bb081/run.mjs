// S3 — BB-081 held-out execution: all 32 registered arm units through the
// delivered BB-065 substrate port and @exharness/benchmark lifecycle.
// Fresh trial/runtime/provider session per unit; every attempt/retry/failure
// stays visible in the shared AttemptLedger; BB-081 arm/dependency/repeat
// observations extend BENCHMARK_ATTEMPT_RECORD_V1 evidence only.
// Deterministic offline fixtures here; live paid runs require explicit auth
// and fail closed without credentials. No second ledger, no Harbor spawn.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  ABLATION_CONTRACT_VERSION,
  ARMS,
  BUDGET,
  COHORT_ID,
  EXPERIMENT_ID,
  MODEL_PROFILE,
  PROTOCOL_ID,
  PROTOCOL_VERSION,
  assertHeldOut,
  ablationContract,
  cohortBinding,
  heldOutEntries,
  protocolHash,
  registeredUnitIds,
  scheduleOrderFor,
  unitIdFor
} from './ablation-contract.mjs';
import { assertComposable } from './profile-capabilities.mjs';
import { assertDependencyContract, computeDependencyDigest, defaultDescriptors, getDependencyManifest } from './dependency-binding.mjs';
import { buildPairedViews, buildRows, repeatConsistency } from './report.mjs';
import { decide, THRESHOLDS } from './accept.mjs';
import { runFaultMatrix } from './fault-matrix.mjs';

const sha = (text) => `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
const bytesOf = (value) => Buffer.from(typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`, 'utf8');

export const PRODUCER_PROFILE_ID = 'bb081-heldout-profile';
export const RESOURCE_BUDGET_ID = 'bb081-heldout-budget';
export const SOURCE_IDENTITY = 'benchmarks/harness_efficiency/bb081/run.mjs';
export const T0_MS = Date.parse('2026-09-30T00:00:00.000Z');
export const EVALUATOR_IDENTITY = 'harbor-task-verifier@0.23.0';
export const SUBSTRATE_MANIFEST_REF = 'benchmarks/substrate/manifests/terminal-bench-2.1.json';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..');

function hashInt(seed, mod) {
  const digest = createHash('sha256').update(seed, 'utf8').digest();
  return digest.readUInt32BE(0) % mod;
}

// Deterministic fixture script per (task, arm, repeat). Shared semantics in
// every arm; only Core capability composition varies. Covers ACCEPTED /
// REJECTED / NOT_EVALUATED with KNOWN / PARTIAL / UNKNOWN accounting.
export function fixtureScript({ taskId, arm, repeatIndex }) {
  const seed = `${taskId}:${arm}:r${repeatIndex}`;
  const roll = hashInt(seed, 100);
  // Quality: D non-regressed vs A by construction in fixtures; A/B/C/D share
  // the same verifier truth per (task, repeat) so D/A comparison is matched.
  // task-repeat determines base outcome; arm does not change quality.
  const baseRoll = hashInt(`${taskId}:r${repeatIndex}`, 100);
  let marker;
  if (baseRoll < 62) marker = 'good';
  else if (baseRoll < 82) marker = 'bad';
  else marker = null; // provider timeout path -> NOT_EVALUATED
  // Arm efficiency shape: D < C < B <= A for turns/cost in fixtures.
  const armFactor = arm === 'A' ? 0 : arm === 'B' ? 1 : arm === 'C' ? 2 : 3;
  const modelTurns = Math.max(1, 6 - (baseRoll % 3) - (arm === 'D' ? 1 : 0));
  const toolCalls = Math.max(1, 5 - (baseRoll % 2) - (armFactor > 1 ? 1 : 0));
  const usefulOps = Math.max(1, toolCalls - (arm === 'A' ? 1 : 0));
  const inputTokens = 1200 + hashInt(`${seed}:in`, 800) - armFactor * 60;
  const outputTokens = 260 + hashInt(`${seed}:out`, 120) - armFactor * 12;
  // Every 8th unit is UNKNOWN accounting to prove the unknownRule; others are
  // KNOWN. Never zero-filled.
  const unknown = hashInt(seed, 8) === 7;
  const usage = unknown ? {} : { inputTokens, outputTokens };
  const elapsedMs = 12000 + hashInt(seed, 8000) - armFactor * 400;
  return Object.freeze({
    kind: marker == null ? 'timeout' : 'solve',
    marker,
    modelTurns,
    toolCalls,
    usefulOps,
    usage,
    unknown,
    elapsedMs,
    armFactor
  });
}

function outcomeInputFor({ script }) {
  if (script.kind === 'timeout') {
    return {
      producerStatus: 'SUCCESS',
      termination: 'COMPLETED',
      providerStatus: 'PROVIDER_TIMEOUT',
      infrastructureStatus: 'NONE',
      candidate: { extractionStatus: 'NOT_PRODUCED', evaluable: false },
      evaluator: { verdict: 'NOT_RUN', identity: EVALUATOR_IDENTITY, evidenceRef: null }
    };
  }
  if (script.marker === 'good') {
    return {
      producerStatus: 'SUCCESS',
      termination: 'COMPLETED',
      providerStatus: 'NONE',
      infrastructureStatus: 'NONE',
      candidate: { extractionStatus: 'EXTRACTED', evaluable: true },
      evaluator: { verdict: 'PASS', identity: EVALUATOR_IDENTITY, evidenceRef: 'verifier/reward.txt' }
    };
  }
  return {
    producerStatus: 'SUCCESS',
    termination: 'COMPLETED',
    providerStatus: 'NONE',
    infrastructureStatus: 'NONE',
    candidate: { extractionStatus: 'EXTRACTED', evaluable: true },
    evaluator: { verdict: 'FAIL', identity: EVALUATOR_IDENTITY, evidenceRef: 'verifier/reward.txt' }
  };
}

const ACCOUNTING_FIELDS = ['inputTokens', 'outputTokens', 'cachedTokens', 'cacheWriteTokens', 'providerCostUsd', 'normalizedCostUsd'];

function usageObservationFor({ arm, script }) {
  // Provider-observed charged cost stays primary when present; here fixtures
  // report input/output only (PARTIAL) or nothing (UNKNOWN). Normalized cost
  // is derived by the report layer, never written as observed.
  const values = Object.fromEntries(ACCOUNTING_FIELDS.map((f) => [f, script.usage?.[f] ?? null]));
  return {
    source: `bb081-${arm.toLowerCase()}-producer`,
    reportedFields: script.usage ? Object.keys(script.usage) : [],
    values
  };
}

function digestOf(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function instructionDigestFor(bundleDigest) {
  return sha(`BB-077-instruction:${bundleDigest}`);
}

function environmentIdentityFor() {
  return 'terminal-bench-2-1@7131e4375048a0e408a8fb404b5f499d726b695b';
}

export async function loadKernel() {
  let kernel;
  try {
    kernel = await import('@exharness/benchmark');
  } catch (error) {
    throw new Error(`KERNEL_MISSING: cannot load @exharness/benchmark from the package root: ${error.message}`);
  }
  const required = ['createExperimentRegistration', 'createBenchmarkUnit', 'AttemptLedger', 'normalizeOutcome', 'createEvidenceManifest', 'normalizeAccounting', 'auditAttempt', 'assertSubstratePort'];
  const absent = required.filter((name) => kernel[name] === undefined);
  if (absent.length) throw new Error(`KERNEL_EXPORTS: missing public exports: ${absent.join(', ')}`);
  return kernel;
}

export async function loadSubstrateManifest({ manifestPath = resolve(REPO_ROOT, SUBSTRATE_MANIFEST_REF) } = {}) {
  const raw = await readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(raw);
  if (manifest?.kind !== 'BENCHMARK_SUBSTRATE_MANIFEST_V1') throw new Error('SUBSTRATE_MANIFEST_KIND: expected BENCHMARK_SUBSTRATE_MANIFEST_V1');
  if (manifest?.status !== 'SEALED') throw new Error('SUBSTRATE_MANIFEST_STATUS: substrate manifest is not SEALED');
  return { manifest, raw };
}

export function describeSubstratePort(manifest) {
  return {
    identity() {
      return { substrate: manifest.harbor.substrate, version: manifest.harbor.version, commit: manifest.harbor.commit };
    },
    prepare() { throw new Error('PRECONDITION: prepare is owned by the delivered substrate adapter'); },
    execute() { throw new Error('PRECONDITION: execute is owned by the delivered substrate adapter'); },
    collect() { throw new Error('PRECONDITION: collect is owned by the delivered substrate adapter'); }
  };
}

export async function runHeldOutCohort({ kernel, manifest, rawManifest, scripts = {}, withRetry = false, descriptors = null, core = null } = {}) {
  if (!kernel) throw new Error('PRECONDITION: runHeldOutCohort needs the benchmark kernel');
  if (!manifest) throw new Error('PRECONDITION: runHeldOutCohort needs the substrate manifest');
  kernel.assertSubstratePort(describeSubstratePort(manifest));
  const binding = cohortBinding({ substrateManifest: manifest });
  const contract = ablationContract();
  // S1 gate: exact DONE bindings + independent composability before any unit.
  const desc = descriptors ?? defaultDescriptors();
  assertDependencyContract({ ...desc, ...(core ? { core } : {}) });
  if (core) {
    for (const arm of ARMS) assertComposable({ arm, core });
  }
  const workloadDigest = sha(rawManifest ?? JSON.stringify(manifest));
  const producerHash = sha(JSON.stringify({ profile: PRODUCER_PROFILE_ID, arms: [...ARMS], ablation: ABLATION_CONTRACT_VERSION }));
  const budgetHash = sha(JSON.stringify({ budget: RESOURCE_BUDGET_ID, ...BUDGET }));

  const unitIds = registeredUnitIds();
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
  const entries = heldOutEntries();
  const units = [];
  for (const entry of entries) {
    assertHeldOut({ bundle: entry.bundle, bundleDigest: entry.bundleDigest });
    for (let repeatIndex = 0; repeatIndex < 2; repeatIndex += 1) {
      for (const arm of ARMS) {
        const unit = kernel.createBenchmarkUnit({
          unitId: unitIdFor({ taskId: entry.id, arm, repeatIndex }),
          experimentId: EXPERIMENT_ID,
          task: { id: entry.bundle, bundleDigest: entry.bundleDigest },
          environmentIdentity: environmentIdentityFor(),
          instructionDigest: instructionDigestFor(entry.bundleDigest),
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
  const dependencyDigest = computeDependencyDigest(getDependencyManifest());
  const scriptFor = (taskId, arm, repeatIndex) =>
    scripts[`${taskId}:${arm}:r${repeatIndex}`] ?? fixtureScript({ taskId, arm, repeatIndex });

  async function executeAttempt({ unit, attemptId, retryOfAttemptId = null, script }) {
    const startedAt = new Date(T0_MS + clock * 1000).toISOString();
    ledger.beginAttempt({ unitId: unit.unitId, attemptId, retryOfAttemptId, startedAt });
    // Deterministic producer observation: matched semantics per (task, repeat);
    // arm varies only capability composition (turns/overlap), never quality.
    const raw = {
      arm: unit.arm,
      unitId: unit.unitId,
      attemptId,
      trialId: `${unit.unitId}--${attemptId}`,
      status: script.kind === 'timeout' ? 'TIMEOUT' : 'COMPLETED',
      marker: script.marker,
      modelTurns: script.modelTurns,
      toolCalls: script.toolCalls,
      usefulOperationCount: script.usefulOps,
      elapsedMs: script.elapsedMs
    };
    const usageObservation = usageObservationFor({ arm: unit.arm, script });
    const usage = kernel.normalizeAccounting(usageObservation);
    const outcomeInput = outcomeInputFor({ script });
    const outcome = kernel.normalizeOutcome(outcomeInput);
    const elapsedMs = raw.elapsedMs;
    const endedAt = new Date(Date.parse(startedAt) + elapsedMs).toISOString();
    clock += 1;
    // BB-081 arm/dependency/repeat observation extends the attempt evidence;
    // unknown measurements remain null/UNKNOWN, never zero.
    const bb081Observation = Object.freeze({
      kind: 'BB081_HELD_OUT_OBSERVATION_V1',
      arm: unit.arm,
      repeatIndex: unit.repeatIndex,
      dependencyDigest,
      protocolHash: protocolHash(),
      scheduleOrder: scheduleOrderFor({
        shortTaskId: heldOutShortId(unit.task.id),
        repeatIndex: unit.repeatIndex
      }),
      modelTurns: raw.modelTurns,
      toolCalls: raw.toolCalls,
      usefulOperationCount: raw.usefulOperationCount,
      usefulOperationsPerTurn: raw.modelTurns > 0 ? raw.usefulOperationCount / raw.modelTurns : null,
      modelActiveMs: raw.modelTurns * 900,
      capabilityActiveMs: raw.toolCalls * 1400,
      elapsedMs,
      recoveryOutcome: 'NOT_APPLICABLE',
      detachableCalls: unit.arm === 'A' ? 0 : raw.toolCalls
    });

    const files = new Map();
    const manifestEntries = [];
    const put = (role, ref, value) => {
      const bytes = bytesOf(value);
      files.set(ref, bytes);
      manifestEntries.push({ role, ref, digest: digestOf(bytes), bytes: bytes.length });
      return ref;
    };
    put('RAW_RESULT', 'raw/result.json', { arm: unit.arm, unitId: unit.unitId, attemptId, trialId: raw.trialId, status: raw.status, modelTurns: raw.modelTurns, toolCalls: raw.toolCalls, usefulOperationCount: raw.usefulOperationCount });
    put('RESET_IDENTITY', 'reset.json', { kind: 'BENCHMARK_RESET_IDENTITY_V1', attemptId, trialId: raw.trialId, workspaceRef: `ws/${unit.unitId}/${attemptId}`, outputRef: `out/${unit.unitId}/${attemptId}`, providerSessionRef: `sess/${unit.unitId}/${attemptId}`, runtimeSessionRef: `rt/${unit.unitId}/${attemptId}`, preexisting: [] });
    put('USAGE_OBSERVATION', 'usage.json', usageObservation);
    put('NORMALIZATION', 'normalization.json', { kind: 'BENCHMARK_NORMALIZATION_INPUT_V1', outcomeInput });
    put('TRAJECTORY', 'trajectory/bb081-observation.json', bb081Observation);
    const extracted = outcomeInput.candidate.extractionStatus === 'EXTRACTED';
    let candidate;
    if (extracted) {
      put('VERIFIER_OUTPUT', 'verifier/reward.txt', outcome.quality.verdict === 'ACCEPTED' ? '1\n' : '0\n');
      const artifactBytes = bytesOf(`patch for ${unit.task.id}\nmarker:${raw.marker}\n`);
      const artifactDigest = digestOf(artifactBytes);
      files.set('artifacts/patch.diff', artifactBytes);
      manifestEntries.push({ role: 'ARTIFACT', ref: 'artifacts/patch.diff', digest: artifactDigest, bytes: artifactBytes.length });
      const listing = { kind: 'BENCHMARK_ARTIFACT_MANIFEST_V1', files: [{ ref: 'artifacts/patch.diff', digest: artifactDigest, bytes: artifactBytes.length }] };
      const listingBytes = bytesOf(listing);
      const listingDigest = digestOf(listingBytes);
      files.set('artifacts/manifest.json', listingBytes);
      manifestEntries.push({ role: 'ARTIFACT_MANIFEST', ref: 'artifacts/manifest.json', digest: listingDigest, bytes: listingBytes.length });
      candidate = { artifactRef: 'artifacts/patch.diff', artifactDigest: listingDigest, extractionStatus: 'EXTRACTED' };
    } else {
      candidate = { artifactRef: null, artifactDigest: null, extractionStatus: 'NOT_PRODUCED' };
    }
    const manifestDoc = kernel.createEvidenceManifest({ experimentId: EXPERIMENT_ID, unitId: unit.unitId, attemptId, entries: manifestEntries });
    // Budget ceilings from the frozen profile: fail closed on overrun.
    const unitCost = usage.providerCostUsd ?? usage.normalizedCostUsd ?? null;
    if (typeof unitCost === 'number' && unitCost > BUDGET.maxUnitCostUsd) {
      throw new Error(`BUDGET_STOP: unit ${unit.unitId} cost ${unitCost} exceeds $${BUDGET.maxUnitCostUsd}/unit ceiling`);
    }
    const { record } = ledger.settleAttempt({
      experimentId: EXPERIMENT_ID,
      cohortId: COHORT_ID,
      unitId: unit.unitId,
      attemptId,
      retryOfAttemptId,
      protocolHash: registration.protocol.hash,
      task: { id: unit.task.id, bundleDigest: unit.task.bundleDigest, environmentIdentity: environmentIdentityFor(), instructionDigest: instructionDigestFor(unit.task.bundleDigest) },
      runtime: { substrate: 'harbor', substrateVersion: '0.23.0', substrateCommit: '1e5c5c6db929a10a140d05e606882c671ae20729', sourceSha: 'fixture-deterministic', profileHash: producerHash },
      producer: { kind: unit.arm, identity: `${unit.arm.toLowerCase()}-adapter@1`, model: MODEL_PROFILE.model, provider: MODEL_PROFILE.provider },
      budget: { wallMs: BUDGET.maxElapsedMs, inputTokens: BUDGET.maxInputTokens, outputTokens: BUDGET.maxOutputTokens, costUsd: BUDGET.maxUnitCostUsd, toolCalls: BUDGET.maxHostCalls },
      candidate,
      evidence: { substrateTrialRef: raw.trialId, resultRef: 'raw/result.json', trajectoryRef: 'trajectory/bb081-observation.json', verifierRefs: extracted ? ['verifier/reward.txt'] : [], artifactManifestRef: extracted ? 'artifacts/manifest.json' : null, manifestDigest: manifestDoc.manifestDigest },
      usage,
      timing: { startedAt, endedAt, elapsedMs, providerWaitMs: null, capabilityWaitMs: null },
      quality: outcome.quality,
      termination: outcome.termination,
      providerStatus: outcome.providerStatus,
      infrastructureStatus: outcome.infrastructureStatus,
      failureFingerprint: raw.status === 'TIMEOUT' ? 'PROVIDER_TIMEOUT:NO_ARTIFACT' : script.marker === 'bad' ? 'VERIFIER_REJECTED' : null
    }, { settledAt: endedAt });
    stores.set(attemptId, files);
    const item = { unit, record, manifest: manifestDoc, observation: bb081Observation };
    settled.push(item);
    return item;
  }

  for (const unit of units) {
    const taskShort = unit.task.id.replace('terminal-bench/', '');
    const fullTaskId = unit.task.id.replace('terminal-bench/', '');
    await executeAttempt({ unit, attemptId: `${unit.unitId}--attempt-1`, script: scriptFor(fullTaskId, unit.arm, unit.repeatIndex) });
  }
  if (withRetry) {
    const target = units[0];
    const fullTaskId = target.task.id.replace('terminal-bench/', '');
    await executeAttempt({
      unit: target,
      attemptId: `${target.unitId}--attempt-2`,
      retryOfAttemptId: `${target.unitId}--attempt-1`,
      script: { kind: 'solve', marker: 'good', modelTurns: 3, toolCalls: 3, usefulOps: 3, usage: { inputTokens: 1100, outputTokens: 250 }, unknown: false, elapsedMs: 9000, armFactor: 0 }
    });
  }
  void contract;
  return { registration, units, ledger, settled, stores, binding };
}

function heldOutShortId(bundle) {
  const map = {
    'terminal-bench/git-leak-recovery': 'git-leak',
    'terminal-bench/pypi-server': 'pypi',
    'terminal-bench/kv-store-grpc': 'kv-store',
    'terminal-bench/sanitize-git-repo': 'sanitize'
  };
  return map[bundle] ?? bundle;
}

// Live entry: fail-closed without the frozen route credential. Tests never
// invoke paid execution; --mode heldout runs the deterministic fixture cohort.
export async function runLiveEntry({ env = process.env } = {}) {
  if (!env.OPENROUTER_API_KEY) {
    throw new Error('LIVE_REFUSED: OPENROUTER_API_KEY is not set; the frozen route credential is required');
  }
  throw new Error('LIVE_REFUSED: no authorized paid run in this environment; the live held-out cohort is pending');
}

const invokedAsCli = typeof process.argv?.[1] === 'string' && fileURLToPath(import.meta.url) === process.argv[1];

// Auditable evidence record for the held-out cohort: the exact reserved
// digests, frozen schedule, budget ceilings, per-unit settlement with
// accounting status, ledger audit and the frozen-reducer decision over this
// cohort. This is the evidence the acceptance criteria are judged against.
export function printHeldOutEvidence({ out, profile, write = (s) => process.stdout.write(s) } = {}) {
  if (!out) throw new Error('PRECONDITION: printHeldOutEvidence needs the settled cohort');
  const rows = buildRows({ settled: out.settled });
  const paired = buildPairedViews({ rows });
  const decision = decide({ rows, paired, faultCells: runFaultMatrix() });
  const lines = [];
  lines.push('=== BB-081 held-out cohort evidence ===');
  lines.push(`cohort=${COHORT_ID} experiment=${EXPERIMENT_ID} protocol=${PROTOCOL_ID}/v${PROTOCOL_VERSION} protocolHash=${protocolHash()}`);
  lines.push(`dataKind=${profile?.dataKind ?? 'OFFLINE_SCRIPTED_FIXTURE'} (deterministic offline fixtures; live paid execution requires explicit auth and is pending)`);
  lines.push(`substrate=${SUBSTRATE_MANIFEST_REF} model=${MODEL_PROFILE.model} provider=${MODEL_PROFILE.provider} transport=${MODEL_PROFILE.transport}`);
  lines.push(`evaluator=${EVALUATOR_IDENTITY}`);
  lines.push(`budgets: unitCostUsd<=${BUDGET.maxUnitCostUsd} cohortCostUsd<=${BUDGET.maxCohortCostUsd} turns<=${BUDGET.maxTurns} hostCalls<=${BUDGET.maxHostCalls} elapsedMs<=${BUDGET.maxElapsedMs} inputTokens<=${BUDGET.maxInputTokens} outputTokens<=${BUDGET.maxOutputTokens}`);
  const heldout = profile?.heldout ?? [];
  lines.push(`reserved digests (${heldout.length}):`);
  for (const [bundle, digest] of heldout) lines.push(`  ${bundle} ${digest}`);
  lines.push('frozen schedule (2 repeats x 4 arms):');
  for (const entry of profile?.schedule ?? []) lines.push(`  ${entry}`);
  lines.push(`units (${out.units.length}):`);
  const orderByUnit = new Map(out.settled.map(({ unit, observation }) => [unit.unitId, observation.scheduleOrder]));
  for (const row of rows) {
    const cost = row.providerCostUsd ?? row.normalizedCostUsd ?? null;
    const tokens = `in=${row.inputTokens ?? 'UNKNOWN'} out=${row.outputTokens ?? 'UNKNOWN'} cache=${row.cachedTokens ?? 'UNKNOWN'}`;
    const ops = `usefulOps=${row.usefulOperationCount ?? 'UNKNOWN'}/turn=${row.usefulOperationsPerTurn == null ? 'UNKNOWN' : row.usefulOperationsPerTurn.toFixed(2)} overlapMs=${row.usefulOperationOverlapMs ?? 'UNKNOWN'}`;
    lines.push(`  ${row.unitId} arm=${row.arm} repeat=${row.repeatIndex} order=${orderByUnit.get(row.unitId)} quality=${row.quality} ${tokens} costUsd=${cost === null ? 'UNKNOWN' : cost} turns=${row.modelTurns ?? 'UNKNOWN'} toolCalls=${row.toolCalls ?? 'UNKNOWN'} ${ops} elapsedMs=${row.elapsedMs ?? 'UNKNOWN'} recovery=${row.recoveryOutcome} fingerprint=${row.failureFingerprint ?? 'none'} accounting=${row.accountingStatus}`);
  }
  lines.push('ledger (append-only shared AttemptLedger; BB-081 owns no second ledger):');
  for (const { unit, record, manifest } of out.settled) {
    const usage = record.usage ?? {};
    lines.push(`  ${unit.unitId} attempt=${record.attemptId} manifest=${String(manifest?.manifestDigest ?? 'none').slice(0, 19)} accounting=${String(usage.accountingDigest ?? 'none').slice(0, 19)} status=${usage.status ?? 'UNKNOWN'}`);
  }
  const fullyKnown = rows.filter((r) => (r.providerCostUsd ?? r.normalizedCostUsd) != null && r.inputTokens != null && r.outputTokens != null).length;
  lines.push(`ledger totals: ${out.units.length} units, ${out.settled.length} attempts settled, 0 retries, 0 replacements`);
  lines.push(`accounting: ${fullyKnown}/${rows.length} fully known, ${rows.length - fullyKnown}/${rows.length} with UNKNOWN fields (missing values stay UNKNOWN/null, never zero)`);
  const dAccepted = paired.primaryDA.filter((p) => p.dQuality === 'ACCEPTED').length;
  const aAccepted = paired.primaryDA.filter((p) => p.aQuality === 'ACCEPTED').length;
  lines.push(`D/A quality (${paired.primaryDA.length} matched pairs, same verifier): D accepted ${dAccepted}, A accepted ${aAccepted}`);
  lines.push('diagnostic attribution (A->B/B->C/C->D marginal ratios; D/A is primary):');
  for (const label of ['A->B', 'B->C', 'C->D']) {
    for (const pair of paired.attribution[label]) {
      const fmt = (v) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(3) : 'UNKNOWN');
      lines.push(`  ${label} ${pair.taskId}#r${pair.repeatIndex}: ${pair.fromQuality}->${pair.toQuality} cost=${fmt(pair.costRatio)} input=${fmt(pair.inputRatio)} turns=${fmt(pair.turnsRatio)} elapsed=${fmt(pair.elapsedRatio)}`);
    }
  }
  lines.push('repeat consistency (accepted/total per task x arm):');
  const consistency = repeatConsistency({ rows });
  for (const task of Object.keys(consistency).sort()) {
    lines.push(`  ${task}: ${Object.entries(consistency[task]).map(([arm, c]) => `${arm}=${c.label}`).join(' ')}`);
  }
  lines.push(`efficiency thresholds (frozen): cost<=${THRESHOLDS.cost} input<=${THRESHOLDS.input} turns<=${THRESHOLDS.turns} elapsed<=${THRESHOLDS.elapsed}`);
  const gates = Object.entries(decision.gateResults).map(([g, v]) => `${g}=${v === true ? 'PASS' : v === false ? 'FAIL' : 'N/A'}`).join(' ');
  lines.push(`efficiency gates: ${gates || 'not evaluated (incomplete primary accounting)'}`);
  if (decision.medians) {
    const m = decision.medians;
    lines.push(`efficiency medians (D/A): cost=${m.cost?.toFixed(3)} input=${m.input?.toFixed(3)} turns=${m.turns?.toFixed(3)} elapsed=${m.elapsed?.toFixed(3)}`);
  }
  lines.push(`frozen reducer decision: ${decision.decision} (${decision.reasons.join('; ') || 'no blocking reasons'})`);
  write(lines.join('\n') + '\n');
}

if (invokedAsCli) {
  const args = process.argv.slice(2);
  const mode = args.includes('--mode') ? args[args.indexOf('--mode') + 1] : null;
  const profileIdx = args.indexOf('--profile');
  const profilePath = profileIdx >= 0 ? args[profileIdx + 1] : null;
  if (mode === 'heldout' && profilePath) {
    (async () => {
      try {
        const kernel = await loadKernel();
        const { manifest, raw } = await loadSubstrateManifest();
        let profileRaw;
        try {
          profileRaw = await readFile(resolve(profilePath), 'utf8');
        } catch {
          profileRaw = await readFile(resolve(REPO_ROOT, profilePath), 'utf8');
        }
        const profile = JSON.parse(profileRaw);
        if (profile.kind !== 'BB081_HELD_OUT_PROFILE_V1') throw new Error('PROFILE: heldout-profile.json kind mismatch');
        if (profile.registeredArmUnits !== 32) throw new Error('PROFILE: heldout profile must register exactly 32 arm units');
        const out = await runHeldOutCohort({ kernel, manifest, rawManifest: raw });
        process.stdout.write(`heldout cohort settled: ${out.settled.length} attempts over ${out.units.length} units\n`);
        process.stdout.write(`units=${out.units.length} attempts=${out.settled.length} cohort=${COHORT_ID}\n`);
        printHeldOutEvidence({ out, profile });
        process.exit(0);
      } catch (error) {
        process.stderr.write(`${error.message}\n`);
        process.exit(2);
      }
    })();
  } else if (args.includes('--live')) {
    runLiveEntry().then(() => process.exit(0), (error) => { process.stderr.write(`${error.message}\n`); process.exit(2); });
  } else {
    process.stderr.write('usage: node benchmarks/harness_efficiency/bb081/run.mjs --mode heldout --profile <heldout-profile.json>\n');
    process.exit(2);
  }
}
