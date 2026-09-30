// S4 — Economics observations owned by this experiment: model-turn count,
// capability/tool-call count, monotonic MODEL/CALL intervals, stable-prefix and
// dynamic-suffix hashes/bytes, and comparison labels. Provider cache/token/cost
// observations stay nullable kernel accounting inputs: a repeated prefix proves
// ELIGIBLE, never a provider cache hit.
import { createHash } from 'node:crypto';

const sha = (text) => `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;

export const CACHE_LABELS = Object.freeze(['CONFIRMED', 'MISS', 'ELIGIBLE', 'UNKNOWN']);

// Conservative cache label. Repeated stable prefix without provider cache
// evidence yields ELIGIBLE, not CONFIRMED.
export function cacheLabel({ stablePrefixRepeats, providerCachedTokens = null, usageKnown = false }) {
  if (typeof providerCachedTokens === 'number' && providerCachedTokens > 0) return 'CONFIRMED';
  if (usageKnown && providerCachedTokens === 0) return 'MISS';
  if (stablePrefixRepeats) return 'ELIGIBLE';
  return 'UNKNOWN';
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function monotonic(values, label) {
  if (!Array.isArray(values) || values.some((value) => typeof value !== 'number' || value < 0)) {
    throw new Error(`PRECONDITION: ${label} must be non-negative durations`);
  }
  return [...values];
}

// Builds the per-attempt economics observation stored as TRAJECTORY evidence.
// `adapterRun` is the raw adapter observation; `usage` is the kernel accounting
// input shape ({ cachedTokens } or nulls) used only for labeling.
export function observeEconomics({ adapterRun, usage = null, startedAt, endedAt }) {
  const modelIntervals = monotonic(adapterRun.modelIntervals, 'modelIntervals');
  const callIntervals = monotonic(adapterRun.callIntervals, 'callIntervals');
  const modelActiveMs = sum(modelIntervals);
  const capabilityActiveMs = sum(callIntervals);
  const elapsedMs = Date.parse(endedAt) - Date.parse(startedAt);
  const overlapMs = Math.min(modelActiveMs, capabilityActiveMs);
  const unattributedHarnessMs = Math.max(0, elapsedMs - modelActiveMs - capabilityActiveMs + overlapMs);
  const usageKnown = usage !== null && typeof usage.cachedTokens === 'number';
  const stablePrefixRepeats = adapterRun.modelTurns > 1;
  const label = cacheLabel({
    stablePrefixRepeats,
    providerCachedTokens: usage?.cachedTokens ?? null,
    usageKnown
  });
  const noProgress = adapterRun.toolCalls === 0;
  return Object.freeze({
    kind: 'BB077_ECONOMICS_OBSERVATION_V1',
    arm: adapterRun.arm,
    orchestration: adapterRun.orchestration,
    attemptId: adapterRun.attemptId,
    modelTurns: adapterRun.modelTurns,
    toolCalls: adapterRun.toolCalls,
    modelIntervals: Object.freeze(modelIntervals),
    callIntervals: Object.freeze(callIntervals),
    modelActiveMs,
    capabilityActiveMs,
    overlapMs,
    elapsedMs,
    unattributedHarnessMs,
    stablePrefixHash: adapterRun.stablePrefixHash,
    stablePrefixBytes: adapterRun.stablePrefixBytes,
    dynamicSuffixHash: adapterRun.dynamicSuffixHash,
    cacheLabel: label,
    noProgress,
    failureFingerprint: fingerprint({ noProgress, toolCalls: adapterRun.toolCalls })
  });
}

export function fingerprint({ noProgress, toolCalls }) {
  if (noProgress) return 'NO_PROGRESS:NO_TOOL_CALLS';
  void toolCalls;
  return null;
}

export function economicsDigest(observation) {
  return sha(JSON.stringify(observation));
}
