import { readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditCoreTrace } from './core-arm.mjs';
import { sha256 } from './contract.mjs';
import { validateControlledTrials } from './controlled-trials.mjs';
import { loadValueProtocol } from './study.mjs';
import { candidateDigest } from './fixture/acceptance.mjs';

const fail = (message, code = 2) => {
  const error = new Error(`BASELINE_CONTROLLED_AUDIT_INVALID: ${message}`);
  error.exitCode = code;
  throw error;
};
const option = (args, name) => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
const plainJson = path => readFile(path, 'utf8').then(JSON.parse);
const hashBody = value => `sha256:${sha256(value)}`;

function checkRef(output, ref) {
  if (typeof ref !== 'string' || !ref || ref.startsWith('/') || ref.split('/').includes('..'))
    fail(`controlled evidence reference is not portable: ${ref}`);
  const path = resolve(output, ref);
  if (relative(resolve(output), path).startsWith('..')) fail(`controlled evidence reference escapes study output: ${ref}`);
  return path;
}

function recomputedOutcome(observed) {
  return observed.accepted ? (observed.recoveryWork ? 'RECOVERED_OR_FINALIZED' : 'ACCEPTED') : 'VERIFIER_REJECTED';
}

export async function auditControlledTrials({ output } = {}) {
  if (!output) fail('output is required');
  const directory = resolve(output);
  const manifest = await plainJson(join(directory, 'manifest.json'));
  const value = await loadValueProtocol('CORE_VALUE_V2');
  const artifact = await plainJson(join(directory, 'controlled-trials.json')).catch(() => null);
  if (!artifact) fail('controlled-trial artifact is missing');
  validateControlledTrials({ artifact, manifest, value });
  const byId = new Map(artifact.trials.map(row => [row.trialId, row]));
  for (const row of artifact.trials) {
    const oracle = await plainJson(checkRef(directory, row.oracleRef));
    if (hashBody(oracle) !== row.oracleHash) fail(`controlled oracle changed or mismatched: ${row.trialId}`);
    if (oracle.trialId !== row.trialId || oracle.scenario !== row.scenario || oracle.family !== row.family ||
        oracle.arm !== row.arm || oracle.faultScheduleHash !== manifest.faultScheduleHash)
      fail(`controlled oracle identity mismatch: ${row.trialId}`);
    for (const field of ['accepted', 'unsafeAcceptance', 'duplicateEffect', 'lostResult', 'recoveryWork']) {
      if (Boolean(oracle.observed?.[field]) !== Boolean(row[field]) &&
          !(field === 'recoveryWork' && Number(oracle.observed?.[field] ?? 0) === Number(row[field])))
        fail(`controlled outcome differs from reopened oracle: ${row.trialId}.${field}`);
    }
    if (recomputedOutcome(oracle.observed) !== row.outcome) fail(`controlled outcome recomputation mismatch: ${row.trialId}`);
    if (JSON.stringify(oracle.mechanism ?? null) !== JSON.stringify(row.mechanism ?? null))
      fail(`controlled mechanism differs from reopened oracle: ${row.trialId}`);
    const trialDir = dirname(checkRef(directory, row.oracleRef));
    const journal = await plainJson(join(trialDir, 'trial-journal.json')).catch(() => null);
    if (!journal || journal.finalized !== true || journal.executorCalls !== row.actionCalls)
      fail(`controlled trial journal contradicts the recorded counters: ${row.trialId}`);
    const currentDigest = await candidateDigest(join(trialDir, 'candidate'));
    if (currentDigest !== oracle.finalizedDigest) fail(`controlled candidate drifted after finalization: ${row.trialId}`);
    if (row.arm === 'EXHARNESS') {
      const trace = await plainJson(checkRef(directory, row.traceRef)).catch(() => null);
      if (!trace) fail(`controlled Core trace is missing: ${row.trialId}`);
      await auditCoreTrace(checkRef(directory, row.traceRef),
        { executionId: row.trialId, sessionId: `${manifest.cohortId}:${row.trialId}`, requirePromotion: false });
      const { createHash } = await import('node:crypto');
      const bytes = await readFile(checkRef(directory, row.traceRef));
      if (`sha256:${createHash('sha256').update(bytes).digest('hex')}` !== row.traceHash)
        fail(`controlled Core trace changed: ${row.trialId}`);
    }
    if (row.arm === 'EXHARNESS') {
      const directId = row.trialId.replace(/-EXHARNESS$/, '-DIRECT');
      const direct = byId.get(directId);
      if (!direct) fail(`controlled EXHARNESS trial lacks its DIRECT pair: ${row.trialId}`);
      const expected = direct.accepted === row.accepted &&
        Number(direct.recoveryWork ?? 0) === Number(row.recoveryWork ?? 0) ? 'COMMON' : 'CORE';
      if (row.attribution !== expected) fail(`controlled attribution contradicts the measured pair delta: ${row.trialId}`);
    }
  }
  return { mode: 'controlled-audit', count: artifact.trials.length, exitCode: 0 };
}

export async function auditQualificationProbes({ output } = {}) {
  if (!output) fail('output is required');
  const directory = resolve(output);
  const manifest = await plainJson(join(directory, 'manifest.json'));
  const value = await loadValueProtocol(manifest.protocolId === 'CORE_VALUE_V2' ? 'CORE_VALUE_V2' : 'FIXTURE_VALUE_V1');
  const required = value.qualification?.requiredSuccessfulProbes ?? value.limits.maxProbeRequests;
  const probeManifest = await plainJson(join(directory, 'setup', 'probes.json')).catch(() => null);
  if (!probeManifest) fail('materialized qualification probes are missing');
  if (probeManifest.evidenceClass !== 'LIVE_PROVIDER_PROBES' || (probeManifest.probes ?? []).length < required)
    fail('materialized qualification probe count is incomplete');
  for (const probe of probeManifest.probes) {
    if (!probe.providerEvidenceRef || !probe.providerEvidenceHash) fail(`qualification probe lacks evidence: ${probe.probeId}`);
    const evidencePath = checkRef(directory, probe.providerEvidenceRef);
    const { createHash } = await import('node:crypto');
    const bytes = await readFile(evidencePath).catch(() => null);
    if (!bytes || `sha256:${createHash('sha256').update(bytes).digest('hex')}` !== probe.providerEvidenceHash)
      fail(`qualification probe evidence changed or missing: ${probe.probeId}`);
    const index = Number(probe.probeId?.match(/(\d+)$/)?.[1]);
    const result = await plainJson(checkRef(directory, `setup/${String(probe.probeId).toLowerCase()}/result.json`));
    if (result.status !== 'PASS' || result.toolCall?.toolName !== 'bash' ||
        result.toolCall?.command !== `printf 'EXHARNESS_PROBE_${index}'` ||
        result.providerEvidenceHash !== probe.providerEvidenceHash ||
        result.usage?.outputTokens !== probe.outputTokens)
      fail(`qualification probe result is invalid: ${probe.probeId}`);
    if (probe.outputTokens > value.limits.maxProbeOutputTokens) fail(`qualification probe exceeds output bound: ${probe.probeId}`);
  }
  if (manifest.qualificationHash) {
    const bundled = await plainJson(join(directory, 'qualification.json')).catch(() => null);
    if (!bundled || bundled.qualificationHash !== manifest.qualificationHash ||
        bundled.selectedProfileId !== probeManifest.selectedProfileId ||
        probeManifest.qualificationHash !== manifest.qualificationHash)
      fail('materialized probes do not match the hash-bound qualification record');
  }
  return { mode: 'qualification-audit', probes: probeManifest.probes.length, exitCode: 0 };
}

export async function main(args = process.argv.slice(2)) {
  const mode = option(args, '--mode') ?? 'controlled';
  const output = option(args, '--output');
  if (!output) fail('--output is required');
  if (mode === 'controlled') return auditControlledTrials({ output: resolve(output) });
  if (mode === 'qualification') return auditQualificationProbes({ output: resolve(output) });
  fail(`unknown mode: ${mode}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await main())); }
  catch (error) { console.error(error.message); process.exitCode = error.exitCode ?? 4; }
}
