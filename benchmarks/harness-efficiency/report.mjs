// S5 — Multidimensional synchronous baseline report. Complete vector over all
// attempts; paired distributions/medians only. Never a best-of-k selection and
// never one opaque winner score.
import { ARMS } from './constants.mjs';

export function assertNoWinnerScore(report) {
  const text = JSON.stringify(report);
  const forbidden = ['winner', 'promote', 'superior', 'bestOfK', 'best_of_k', 'overallScore', 'harnessScore'];
  const hit = forbidden.filter((token) => text.toLowerCase().includes(token.toLowerCase()));
  if (hit.length || 'winner' in report || 'score' in report) {
    throw new Error(`PRECONDITION: report must not publish a winner score (hit: ${hit.join(',')})`);
  }
  return true;
}

export function buildReport({ registration, ledger, comparison, binding, audits = [] }) {
  const attempts = ledger.attempts();
  const settled = attempts.filter((attempt) => attempt.status === 'SETTLED');
  if (settled.length !== attempts.length) {
    throw new Error('PRECONDITION: report requires every registered attempt to be settled');
  }
  const report = Object.freeze({
    kind: 'BB077_SYNC_BASELINE_REPORT_V1',
    experimentId: registration.experimentId,
    protocolHash: registration.protocol.hash,
    substrateDigest: binding.substrateDigest,
    attempts: settled.length,
    arms: Object.freeze([...ARMS]),
    comparison,
    audits: Object.freeze(audits.map((audit) => ({ status: audit.status, attemptId: audit.attemptId }))),
    limitations: Object.freeze([
      'deterministic fixture baseline; no live model or provider observation',
      'six development tasks only; held-out set untouched',
      'small cohort: no significance claim',
      'unknown provider cost/token/cache stays null/UNKNOWN'
    ])
  });
  assertNoWinnerScore(report);
  return report;
}
