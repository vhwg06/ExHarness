// Fresh-process audit of a materialized benchmark experiment directory.
import { AttemptLedger, auditAttempt } from '@exharness/benchmark';
import { loadExperiment, fileStore } from './attempt-runner.mjs';

export async function auditExperiment(root) {
  const findings = [];
  const loaded = await loadExperiment(root);
  let events = loaded.events;
  try {
    AttemptLedger.replay({ registration: loaded.registration, units: loaded.units, events, records: loaded.attempts.map(a => a.record).filter(Boolean) });
  } catch (error) {
    findings.push({ attempt: null, code: 'LEDGER_REPLAY', detail: error.message });
  }
  const started = new Set(events.filter(event => event.type === 'STARTED').map(event => event.attemptId));
  const materialized = new Set(loaded.attempts.map(a => a.record?.attemptId).filter(Boolean));
  for (const attemptId of started) if (!materialized.has(attemptId)) findings.push({ attempt: attemptId, code: 'UNREPRESENTED_ATTEMPT', detail: 'a STARTED attempt has no settled record' });
  const resetRegistry = new Set();
  const audits = [];
  for (const attempt of loaded.attempts) {
    if (!attempt.record || !attempt.manifest) { findings.push({ attempt: attempt.base, code: 'MISSING_EVIDENCE', detail: 'record or manifest missing' }); continue; }
    const unit = loaded.units.find(candidate => candidate.unitId === attempt.record.unitId);
    const audit = await auditAttempt({ registration: loaded.registration, unit, record: attempt.record, manifest: attempt.manifest, store: fileStore(attempt.evidenceDir), ledgerEvents: events, resetRegistry });
    audits.push({ attemptId: attempt.record.attemptId, status: audit.status, auditDigest: audit.auditDigest, findings: audit.findings });
    for (const item of audit.findings) findings.push({ attempt: attempt.record.attemptId, ...item });
  }
  return { kind: 'BENCHMARK_EXPERIMENT_AUDIT', experimentId: loaded.registration.experimentId, registrationDigest: loaded.registration.registrationDigest,
    attempts: audits.length, status: findings.length ? 'FAIL' : 'PASS', findings, audits };
}
