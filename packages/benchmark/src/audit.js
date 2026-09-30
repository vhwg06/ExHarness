// BENCHMARK_AUDIT_V1: reopen materialized evidence and deterministically recompute candidate, evaluator,
// outcome, accounting and record identity. Any missing, altered or mismatched evidence fails closed.
import { CONTRACT_KINDS, BenchmarkContractError, digestBytes, digestOf, seal, isPlainObject } from './contracts.js';
import { assertExperimentRegistration } from './experiment.js';
import { assertBenchmarkUnit } from './unit.js';
import { assertAttemptRecord } from './attempt-ledger.js';
import { assertEvidenceManifest, entriesFor } from './evidence.js';
import { normalizeOutcome } from './outcome.js';
import { normalizeAccounting } from './accounting.js';

export const NORMALIZATION_KIND = 'BENCHMARK_NORMALIZATION_INPUT_V1';
export const ARTIFACT_MANIFEST_KIND = 'BENCHMARK_ARTIFACT_MANIFEST_V1';
export const RESET_IDENTITY_KIND = 'BENCHMARK_RESET_IDENTITY_V1';

function finding(code, detail) {
  return { code, detail };
}

function parseJson(bytes, ref) {
  try {
    return JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch {
    throw new BenchmarkContractError('MALFORMED_EVIDENCE', `${ref} is not JSON`);
  }
}

function same(a, b) {
  return digestOf(a) === digestOf(b);
}

// store: EvidenceStorePort { read(ref) -> bytes } rooted at the attempt evidence directory.
// resetRegistry: optional Set shared across attempts to reject reused trial/workspace/output identities.
export async function auditAttempt({ registration, unit, record, manifest, store, ledgerEvents = null, resetRegistry = null }) {
  const findings = [];
  const recomputed = { recordDigest: null, manifestDigest: null, outcomeDigest: null, accountingDigest: null, candidateDigest: null, evaluatorIdentity: null };
  const ids = { experimentId: record?.experimentId ?? null, unitId: record?.unitId ?? null, attemptId: record?.attemptId ?? null };
  try {
    assertExperimentRegistration(registration);
    assertBenchmarkUnit(unit, { registration });
    assertAttemptRecord(record, { registration, unit });
    recomputed.recordDigest = record.recordDigest;
    assertEvidenceManifest(manifest);
    recomputed.manifestDigest = manifest.manifestDigest;
    if (manifest.experimentId !== record.experimentId || manifest.unitId !== record.unitId || manifest.attemptId !== record.attemptId)
      findings.push(finding('IDENTITY', 'manifest identity does not match the record'));
    if (record.evidence.manifestDigest !== manifest.manifestDigest) findings.push(finding('TAMPERED', 'record is bound to a different evidence manifest'));

    const bytesByRef = new Map();
    for (const entry of manifest.entries) {
      let bytes;
      try {
        bytes = await store.read(entry.ref);
      } catch {
        findings.push(finding('MISSING_EVIDENCE', `${entry.role} ${entry.ref} cannot be reopened`));
        continue;
      }
      if (digestBytes(bytes) !== entry.digest || bytes.length !== entry.bytes) {
        findings.push(finding('TAMPERED', `${entry.role} ${entry.ref} digest or size changed`));
        continue;
      }
      bytesByRef.set(entry.ref, bytes);
    }
    const one = role => {
      const entries = entriesFor(manifest, role);
      if (entries.length !== 1) { findings.push(finding('MISSING_EVIDENCE', `expected exactly one ${role} entry, found ${entries.length}`)); return null; }
      const bytes = bytesByRef.get(entries[0].ref);
      return bytes ? { entry: entries[0], bytes } : null;
    };

    const raw = one('RAW_RESULT');
    if (raw && record.evidence.resultRef !== raw.entry.ref) findings.push(finding('IDENTITY', 'record.evidence.resultRef is not the manifest RAW_RESULT'));

    const reset = one('RESET_IDENTITY');
    if (reset) {
      const identity = parseJson(reset.bytes, reset.entry.ref);
      if (identity.kind !== RESET_IDENTITY_KIND || identity.attemptId !== record.attemptId || identity.trialId !== record.evidence.substrateTrialRef)
        findings.push(finding('RESET_IDENTITY', 'reset identity does not bind this attempt and trial'));
      if (!Array.isArray(identity.preexisting) || identity.preexisting.length) findings.push(finding('RESET_IDENTITY', 'attempt started with pre-existing candidate/output files'));
      if (resetRegistry) {
        for (const key of ['trialId', 'workspaceRef', 'outputRef']) {
          const value = `${key}:${identity[key]}`;
          if (resetRegistry.has(value)) findings.push(finding('RESET_REUSED', `${key} ${identity[key]} was already used by another attempt`));
          resetRegistry.add(value);
        }
      }
    }

    const normalization = one('NORMALIZATION');
    if (normalization) {
      const input = parseJson(normalization.bytes, normalization.entry.ref);
      if (input.kind !== NORMALIZATION_KIND || !isPlainObject(input.outcomeInput)) {
        findings.push(finding('MALFORMED_EVIDENCE', 'normalization evidence has the wrong shape'));
      } else {
        const outcome = normalizeOutcome(input.outcomeInput);
        recomputed.outcomeDigest = digestOf(outcome);
        recomputed.evaluatorIdentity = outcome.quality.evaluatorIdentity;
        const stored = { quality: record.quality, termination: record.termination, providerStatus: record.providerStatus, infrastructureStatus: record.infrastructureStatus };
        if (!same(outcome, stored)) findings.push(finding('OUTCOME_MISMATCH', 'stored outcome differs from the outcome recomputed from evidence'));
        if (outcome.quality.evaluatorIdentity !== registration.evaluatorIdentity) findings.push(finding('EVALUATOR_IDENTITY', 'evaluator identity differs from the registered evaluator'));
        if (input.outcomeInput.candidate.extractionStatus !== record.candidate.extractionStatus) findings.push(finding('CANDIDATE_MISMATCH', 'extraction status differs from evidence'));
        const verdict = input.outcomeInput.evaluator.verdict;
        const verifierRefs = entriesFor(manifest, 'VERIFIER_OUTPUT').map(entry => entry.ref).sort();
        if (verdict !== 'NOT_RUN' && verifierRefs.length === 0) findings.push(finding('MISSING_EVIDENCE', 'an evaluator verdict has no verifier output'));
        if (!same([...record.evidence.verifierRefs].sort(), verifierRefs)) findings.push(finding('IDENTITY', 'record.evidence.verifierRefs differ from the manifest'));
        if (record.quality.evidenceRef !== null && !verifierRefs.includes(record.quality.evidenceRef)) findings.push(finding('IDENTITY', 'quality evidence ref is not a verifier output'));
      }
    }

    const usage = one('USAGE_OBSERVATION');
    if (usage) {
      const accounting = normalizeAccounting(parseJson(usage.bytes, usage.entry.ref));
      recomputed.accountingDigest = accounting.accountingDigest;
      if (accounting.accountingDigest !== record.usage.accountingDigest) findings.push(finding('ACCOUNTING_MISMATCH', 'stored usage differs from usage recomputed from the raw observation'));
    }

    if (record.candidate.extractionStatus === 'EXTRACTED') {
      const artifactManifest = one('ARTIFACT_MANIFEST');
      if (artifactManifest) {
        recomputed.candidateDigest = artifactManifest.entry.digest;
        if (record.candidate.artifactDigest !== artifactManifest.entry.digest || record.evidence.artifactManifestRef !== artifactManifest.entry.ref)
          findings.push(finding('CANDIDATE_MISMATCH', 'candidate identity is not the artifact manifest digest'));
        const listing = parseJson(artifactManifest.bytes, artifactManifest.entry.ref);
        if (listing.kind !== ARTIFACT_MANIFEST_KIND || !Array.isArray(listing.files) || listing.files.length === 0) {
          findings.push(finding('MALFORMED_EVIDENCE', 'artifact manifest has the wrong shape'));
        } else {
          const artifacts = new Map(entriesFor(manifest, 'ARTIFACT').map(entry => [entry.ref, entry.digest]));
          for (const file of listing.files) if (artifacts.get(file.ref) !== file.digest) findings.push(finding('CANDIDATE_MISMATCH', `artifact ${file.ref} is not bound in the evidence manifest`));
        }
      }
    } else if (entriesFor(manifest, 'ARTIFACT_MANIFEST').length && record.candidate.extractionStatus !== 'FAILED') {
      findings.push(finding('CANDIDATE_MISMATCH', `artifact manifest present while extraction is ${record.candidate.extractionStatus}`));
    }

    if (ledgerEvents) {
      const settled = ledgerEvents.filter(event => event.type === 'SETTLED' && event.attemptId === record.attemptId);
      const started = ledgerEvents.filter(event => event.type === 'STARTED' && event.attemptId === record.attemptId);
      if (started.length !== 1 || settled.length !== 1 || settled[0].recordDigest !== record.recordDigest || started[0].sequence > settled[0].sequence)
        findings.push(finding('LEDGER_MISMATCH', 'attempt is not exactly STARTED then SETTLED with this record in the ledger'));
    }
  } catch (error) {
    findings.push(finding(error instanceof BenchmarkContractError ? error.code : 'AUDIT_ERROR', error.message));
  }
  return seal({ kind: CONTRACT_KINDS.AUDIT, ...ids, status: findings.length ? 'FAIL' : 'PASS', findings, recomputed }, 'auditDigest');
}
