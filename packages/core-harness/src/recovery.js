import { invariant } from "./contracts.js";
import { RecoveryRequiredError } from "./errors.js";
import { AgentRunErrorCode, VariationStatus, VariationTermination } from "./variation.js";

export function defineRecoveryPolicy({ staleAfterMs = 5 * 60 * 1000 } = {}) {
  invariant(Number.isInteger(staleAfterMs) && staleAfterMs >= 0, "recovery staleAfterMs must be a non-negative integer");
  return Object.freeze({ staleAfterMs });
}

function toMillis(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function findRunningVariation(state) {
  return [...(state.persistentMemory?.variations ?? [])]
    .reverse()
    .find((item) => item.status === VariationStatus.RUNNING) ?? null;
}

export function assessRecovery(state, {
  policy = {},
  now = () => new Date().toISOString()
} = {}) {
  const resolved = defineRecoveryPolicy(policy);
  const running = findRunningVariation(state);
  if (!running) {
    return Object.freeze({ required: false, stale: false, variation: null, lastActivityAt: null });
  }

  const startMs = toMillis(running.startedAt);
  let lastActivityAt = running.startedAt;
  for (const item of state.trajectory ?? []) {
    const eventMs = toMillis(item.at);
    if (eventMs == null || startMs == null || eventMs < startMs) continue;
    if (toMillis(lastActivityAt) == null || eventMs >= toMillis(lastActivityAt)) lastActivityAt = item.at;
  }

  const nowMs = toMillis(now());
  const lastMs = toMillis(lastActivityAt);
  const stale = resolved.staleAfterMs === 0 || (
    nowMs != null && lastMs != null && nowMs - lastMs >= resolved.staleAfterMs
  );

  return Object.freeze({
    required: true,
    stale,
    variation: structuredClone(running),
    lastActivityAt
  });
}

export async function recoverInterruptedVariation(core, sessionId, {
  force = false,
  policy = {},
  now = () => new Date().toISOString()
} = {}) {
  invariant(core && typeof core.workState === "function", "recovery requires core.workState()");
  invariant(core && typeof core.completeVariation === "function", "recovery requires core.completeVariation()");

  const state = await core.workState(sessionId);
  const assessment = assessRecovery(state, { policy, now });
  if (!assessment.required) {
    return Object.freeze({ recovered: false, assessment });
  }

  if (!force && !assessment.stale) {
    throw new RecoveryRequiredError({
      sessionId,
      variationId: assessment.variation.id,
      lastActivityAt: assessment.lastActivityAt
    });
  }

  const variation = await core.completeVariation(sessionId, assessment.variation.id, {
    termination: VariationTermination.INTERRUPTED,
    capabilityCalls: assessment.variation.capabilityCalls ?? 0,
    failure: {
      name: "VariationInterruptedError",
      message: "variation was recovered after interruption",
      code: AgentRunErrorCode.VARIATION_INTERRUPTED,
      attemptedCapability: null
    }
  });

  return Object.freeze({
    recovered: true,
    assessment,
    variation
  });
}
