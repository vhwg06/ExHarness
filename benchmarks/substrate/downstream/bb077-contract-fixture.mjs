// BB-077 contract fixture: shows how a downstream harness comparison consumes the benchmark kernel.
// It imports only the @exharness/benchmark package root and reads the substrate fixture manifest.
// DIRECT_CODEACT / CORE_SYNC adapters, the fixed-factor protocol and the comparison reducer are
// owned here, not by packages/benchmark. Everything is model-free and in memory.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  AttemptLedger, auditAttempt, createBenchmarkUnit, createEvidenceManifest, createExperimentRegistration,
  normalizeAccounting, normalizeOutcome
} from '@exharness/benchmark';

export const CONSUMER = 'BB-077';
export const OWNS = Object.freeze(['DIRECT_CODEACT adapter', 'CORE_SYNC adapter', 'fixed-factor protocol', 'economics metrics', 'cohort/repeat schedule', 'harness comparison reducer']);
export const ARMS = Object.freeze(['DIRECT_CODEACT', 'CORE_SYNC']);
const SUBSTRATE_MANIFEST = new URL('../fixtures/manifest.json', import.meta.url);
const T0 = '2026-09-30T00:00:00.000Z';
const T1 = '2026-09-30T00:00:02.000Z';
const EVALUATOR = 'bb077-fixture-verifier@1';
const sha = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const bytesOf = value => Buffer.from(typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);

// Scripted, model-free arm behaviour per task (the fixture's own "adapters").
const SCRIPT = {
  DIRECT_CODEACT: { quality: 'PASS', usage: { inputTokens: 1200, outputTokens: 300 } },
  CORE_SYNC: { quality: 'FAIL', usage: null }
};

function fakeAdapter(arm) {
  return {
    arm,
    identity: () => ({ substrate: 'bb077-fixture', version: '1', commit: null }),
    run(unit, attemptId) {
      const script = SCRIPT[arm];
      const files = new Map();
      const entries = [];
      const put = (role, ref, value) => { const bytes = bytesOf(value); files.set(ref, bytes); entries.push({ role, ref, digest: sha(bytes), bytes: bytes.length }); return ref; };
      const outcomeInput = {
        producerStatus: 'SUCCESS', termination: 'COMPLETED', providerStatus: 'NONE', infrastructureStatus: 'NONE',
        candidate: { extractionStatus: 'EXTRACTED', evaluable: true },
        evaluator: { verdict: script.quality, identity: EVALUATOR, evidenceRef: 'verifier/reward.txt' }
      };
      // Usage observations are passed to the kernel as reported; absent usage is simply not reported.
      const usageObservation = script.usage
        ? { source: `${arm.toLowerCase()}-fixture`, reportedFields: Object.keys(script.usage), values: script.usage }
        : { source: `${arm.toLowerCase()}-fixture`, reportedFields: [], values: {} };
      put('RAW_RESULT', 'raw/result.json', { arm, attemptId, trial: `${arm}-${attemptId}` });
      put('RESET_IDENTITY', 'reset.json', { kind: 'BENCHMARK_RESET_IDENTITY_V1', attemptId, trialId: `${arm}-${attemptId}`, workspaceRef: `ws/${attemptId}`, outputRef: `out/${attemptId}`, preexisting: [] });
      put('USAGE_OBSERVATION', 'usage.json', usageObservation);
      put('NORMALIZATION', 'normalization.json', { kind: 'BENCHMARK_NORMALIZATION_INPUT_V1', outcomeInput });
      put('VERIFIER_OUTPUT', 'verifier/reward.txt', script.quality === 'PASS' ? '1\n' : '0\n');
      const artifactRef = put('ARTIFACT', 'artifacts/patch.diff', `${arm} patch for ${unit.task.id}\n`);
      const artifact = entries.at(-1);
      const listingRef = put('ARTIFACT_MANIFEST', 'artifacts/manifest.json', { kind: 'BENCHMARK_ARTIFACT_MANIFEST_V1', files: [{ ref: artifactRef, digest: artifact.digest, bytes: artifact.bytes }] });
      return { files, entries, outcomeInput, usageObservation, candidate: { artifactRef, artifactDigest: entries.at(-1).digest, extractionStatus: 'EXTRACTED' }, listingRef };
    }
  };
}

// Fixed-factor protocol: both arms get identical task, environment, instruction and budget; only the arm differs.
export async function runFixture({ tamper = null } = {}) {
  const substrate = JSON.parse(await readFile(SUBSTRATE_MANIFEST, 'utf8'));
  const tasks = substrate.fixtures.slice(0, 2);
  const budgetHash = sha('bb077-fixture-budget');
  const unitIds = tasks.flatMap(task => ARMS.map(arm => `${task.id}-${arm}`));
  const registration = createExperimentRegistration({
    experimentId: 'BB077-CONTRACT-FIXTURE',
    protocol: { id: 'BB077-FIXED-FACTOR-FIXTURE', version: '1', hash: sha(JSON.stringify({ arms: ARMS, tasks: tasks.map(task => task.id) })) },
    sourceIdentity: 'fixture:bb077-contract',
    workloadManifest: { ref: 'benchmarks/substrate/fixtures/manifest.json', digest: sha(await readFile(SUBSTRATE_MANIFEST)) },
    environmentIdentity: `harbor-docker:${substrate.baseImage}`,
    producerProfile: { id: 'bb077-scripted-arms', hash: sha(JSON.stringify(SCRIPT)) },
    resourceBudget: { id: 'bb077-fixture-budget', hash: budgetHash },
    artifactPolicy: { declared: ['artifacts/patch.diff'] },
    evaluatorIdentity: EVALUATOR,
    resetPolicy: { freshTrialPerAttempt: true },
    unitIds,
    createdAt: T0
  });
  const ledger = new AttemptLedger({ registration });
  const units = tasks.flatMap(task => ARMS.map(arm => createBenchmarkUnit({
    unitId: `${task.id}-${arm}`, experimentId: registration.experimentId,
    task: { id: task.id, bundleDigest: task.bundleDigest }, environmentIdentity: task.environmentIdentity, instructionDigest: task.instructionDigest,
    producerProfile: `bb077-${arm.toLowerCase()}`, repeatIndex: 0, arm, budgetProfileHash: budgetHash
  }, { registration })));
  units.forEach(unit => ledger.registerUnit(unit));

  const settled = [];
  for (const unit of units) {
    const adapter = fakeAdapter(unit.arm);
    const attemptId = `${unit.unitId}-attempt-1`;
    ledger.beginAttempt({ unitId: unit.unitId, attemptId, startedAt: T0 });
    const run = adapter.run(unit, attemptId);
    const manifest = createEvidenceManifest({ experimentId: registration.experimentId, unitId: unit.unitId, attemptId, entries: run.entries });
    const outcome = normalizeOutcome(run.outcomeInput);
    const identity = adapter.identity();
    const { record } = ledger.settleAttempt({
      experimentId: registration.experimentId, cohortId: null, unitId: unit.unitId, attemptId, retryOfAttemptId: null,
      protocolHash: registration.protocol.hash,
      task: { id: unit.task.id, bundleDigest: unit.task.bundleDigest, environmentIdentity: unit.environmentIdentity, instructionDigest: unit.instructionDigest },
      runtime: { substrate: identity.substrate, substrateVersion: identity.version, substrateCommit: identity.commit, sourceSha: 'fixture', profileHash: registration.producerProfile.hash },
      producer: { kind: unit.arm, identity: `${unit.arm.toLowerCase()}-fixture@1`, model: null, provider: null },
      budget: { wallMs: 60000, inputTokens: null, outputTokens: null, costUsd: null, toolCalls: null },
      candidate: run.candidate,
      evidence: { substrateTrialRef: `${unit.arm}-${attemptId}`, resultRef: 'raw/result.json', trajectoryRef: null, verifierRefs: ['verifier/reward.txt'], artifactManifestRef: run.listingRef, manifestDigest: manifest.manifestDigest },
      usage: normalizeAccounting(run.usageObservation),
      timing: { startedAt: T0, endedAt: T1, elapsedMs: 2000, providerWaitMs: null, capabilityWaitMs: null },
      quality: outcome.quality, termination: outcome.termination, providerStatus: outcome.providerStatus, infrastructureStatus: outcome.infrastructureStatus,
      failureFingerprint: null
    }, { settledAt: T1 });
    settled.push({ unit, record, manifest, files: run.files });
  }

  if (tamper) {
    const target = settled[0];
    target.files.set(tamper, Buffer.concat([target.files.get(tamper), Buffer.from('tampered\n')]));
  }
  const resetRegistry = new Set();
  const audits = [];
  for (const item of settled) {
    const store = { async read(ref) { if (!item.files.has(ref)) throw new Error(`missing ${ref}`); return item.files.get(ref); } };
    audits.push(await auditAttempt({ registration, unit: item.unit, record: item.record, manifest: item.manifest, store, ledgerEvents: ledger.events(), resetRegistry }));
  }
  return { registration, units, ledger, settled, audits, comparison: compareArms(ledger) };
}

// BB-077-owned reducer: summarizes kernel-normalized records per arm. It reads, never recomputes,
// outcome and accounting truth, and it makes no promotion decision.
export function compareArms(ledger) {
  const perArm = Object.fromEntries(ARMS.map(arm => [arm, { attempts: 0, accepted: 0, rejected: 0, notEvaluated: 0, usageKnown: 0, usageUnknown: 0 }]));
  for (const attempt of ledger.attempts()) {
    if (attempt.status !== 'SETTLED') continue;
    const arm = ledger.unit(attempt.unitId).arm;
    const bucket = perArm[arm];
    bucket.attempts += 1;
    const verdict = attempt.record.quality.verdict;
    if (verdict === 'ACCEPTED') bucket.accepted += 1; else if (verdict === 'REJECTED') bucket.rejected += 1; else bucket.notEvaluated += 1;
    if (attempt.record.usage.usageStatus === 'KNOWN') bucket.usageKnown += 1; else bucket.usageUnknown += 1;
  }
  return { kind: 'BB077_FIXTURE_ARM_SUMMARY', perArm };
}
