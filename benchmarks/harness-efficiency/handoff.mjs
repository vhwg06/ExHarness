// S6 — Versioned handoff for the future held-out decision. Freezes the
// comparison manifest/report contract, the held-out manifest and the
// preregistered gate before any async result exists. This experiment never
// executes async candidates and never publishes a promotion verdict.
import { HELD_OUT_SET_ID } from './constants.mjs';
import { heldOutManifest } from './protocol.mjs';

export const COMPARISON_CONTRACT_VERSION = 'BB077_COMPARISON_MANIFEST_V1';
export const GATE_VERSION = 'BB077_FUTURE_GATE_V1';
export const REPORT_CONTRACT = 'BB077_SYNC_BASELINE_REPORT_V1';

// Preregistered gate frozen before async results (research § Predeclared future
// promotion gate). Missing pairs, unknown primary accounting, drift, safety
// failure or quality regression yield INCONCLUSIVE/KEEP_SYNC, never promotion.
export function futureGate() {
  return Object.freeze({
    kind: GATE_VERSION,
    quality: Object.freeze({ acceptedTaskRateCandidateGteCoreSync: true }),
    safety: Object.freeze({ duplicateExternalEffects: 0, recoveryNegativesPass: true }),
    economics: Object.freeze({ medianNormalizedCostRatioLte: 0.85 }),
    context: Object.freeze({ medianPromptInputTokenRatioLte: 0.9 }),
    interaction: Object.freeze({ medianModelTurnRatioLte: 1.0 }),
    latency: Object.freeze({ medianElapsedRatioLte: 1.1 }),
    fallback: 'INCONCLUSIVE-or-KEEP_SYNC on missing pairs, unknown primary accounting, drift, safety failure or quality regression'
  });
}

export function comparisonManifest({ binding, comparison }) {
  return Object.freeze({
    kind: COMPARISON_CONTRACT_VERSION,
    dataKind: 'OFFLINE_SCRIPTED_FIXTURE',
    liveBaseline: 'NOT_EXECUTED',
    cohortId: binding.cohortId,
    substrateDigest: binding.substrateDigest,
    metricVector: Object.freeze([
      'accepted quality',
      'provider cost when known',
      'prompt/output/cache tokens when known',
      'model turns',
      'tool/capability calls',
      'elapsed time',
      'MODEL/CALL interval-derived timing',
      'cache CONFIRMED|MISS|ELIGIBLE|UNKNOWN',
      'no-progress/failure fingerprint',
      'repeat consistency'
    ]),
    tasks: Object.freeze(Object.keys(comparison.perTask)),
    perTask: comparison.perTask
  });
}

export function buildHandoff({ binding, comparison }) {
  return Object.freeze({
    comparison: comparisonManifest({ binding, comparison }),
    heldOut: heldOutManifest(),
    heldOutSetId: HELD_OUT_SET_ID,
    gate: futureGate(),
    backbone: Object.freeze({
      kernel: '@exharness/benchmark',
      importRule: 'package root only',
      substrateKind: 'BENCHMARK_SUBSTRATE_MANIFEST_V1',
      substrateDigest: binding.substrateDigest
    }),
    asyncCandidates: 'NOT_EXECUTED',
    promotionVerdict: 'NOT_PUBLISHED'
  });
}
