// Shared fixed-factor contract for both arm adapters. The two arms differ only
// in `orchestration`; every fixed factor is byte-identical by construction.
import {
  CAPABILITY_SURFACE,
  EVALUATOR_IDENTITY,
  EXECUTOR_ID,
  MODEL_PROFILE,
  RESOURCE_BUDGET,
  STRATEGY_CONFIG,
  environmentIdentityFor,
  fixedFactorDigest,
  instructionDigestFor
} from '../constants.mjs';

export function sharedFixedFactors({ taskId, bundleDigest }) {
  return Object.freeze({
    modelRoute: `${MODEL_PROFILE.transport}/${MODEL_PROFILE.model}`,
    modelVersion: MODEL_PROFILE.model,
    provider: MODEL_PROFILE.provider,
    fallback: MODEL_PROFILE.fallback,
    taskId,
    bundleDigest,
    workspace: environmentIdentityFor(),
    instructionDigest: instructionDigestFor(bundleDigest),
    strategyConfig: { ...STRATEGY_CONFIG },
    executor: EXECUTOR_ID,
    capabilities: [...CAPABILITY_SURFACE],
    evaluator: EVALUATOR_IDENTITY,
    budget: { ...RESOURCE_BUDGET }
  });
}

export function fixedDigest({ taskId, bundleDigest }) {
  return fixedFactorDigest({ taskId, bundleDigest });
}
