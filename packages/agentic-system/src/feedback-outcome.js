import {
  FEEDBACK_OUTCOME_POLICY_KIND,
  defineFeedbackOutcomePolicy,
} from "./feedback-lifecycle-contracts.js";

function fail(message) {
  throw new TypeError(message);
}

function toMeasurementMap(list, label) {
  if (!Array.isArray(list)) fail(`${label} must be an array`);
  const map = new Map();
  for (const [index, entry] of list.entries()) {
    if (!entry || typeof entry !== "object") fail(`${label}[${index}] required`);
    const key = entry.key;
    if (typeof key !== "string" || key.trim().length === 0) fail(`${label}[${index}].key must be a non-empty string`);
    if (map.has(key)) fail(`${label} carries duplicate key ${key}`);
    map.set(key, entry.value ?? null);
  }
  return map;
}

// Pure outcome classification. Any missing or null required measurement, an
// UNRESOLVED fresh input or a failed freshness check yields UNKNOWN. Missing
// values are never coerced to zero. Otherwise the signed delta from the
// frozen policy decides IMPROVED, REGRESSED or NO_CHANGE.
export function classifyFeedbackOutcome(policy, baselineMeasurements, freshMeasurements, freshness) {
  const parsed = policy?.kind === FEEDBACK_OUTCOME_POLICY_KIND ? policy : defineFeedbackOutcomePolicy(policy);
  const baseline = toMeasurementMap(baselineMeasurements ?? [], "baselineMeasurements");
  const fresh = toMeasurementMap(freshMeasurements ?? [], "freshMeasurements");

  const freshFailed =
    !freshness ||
    typeof freshness !== "object" ||
    freshness.responseIsCurrent !== true ||
    freshness.isNewInput !== true ||
    freshness.attemptsDisjoint !== true ||
    freshness.boundariesStrictlyLater !== true ||
    (freshness.freshInputStatus ?? "UNRESOLVED") !== "GROUNDED";
  if (freshFailed) {
    return "UNKNOWN";
  }

  for (const key of parsed.requiredMeasurementKeys) {
    const b = baseline.has(key) ? baseline.get(key) : undefined;
    const f = fresh.has(key) ? fresh.get(key) : undefined;
    if (typeof b !== "number" || !Number.isFinite(b)) return "UNKNOWN";
    if (typeof f !== "number" || !Number.isFinite(f)) return "UNKNOWN";
  }

  const baselineValue = baseline.get(parsed.metricKey);
  const freshValue = fresh.get(parsed.metricKey);
  if (typeof baselineValue !== "number" || !Number.isFinite(baselineValue)) return "UNKNOWN";
  if (typeof freshValue !== "number" || !Number.isFinite(freshValue)) return "UNKNOWN";

  const directionFactor = parsed.direction === "HIGHER_IS_BETTER" ? 1 : -1;
  const delta = (freshValue - baselineValue) * directionFactor;
  if (delta >= parsed.minEffect) return "IMPROVED";
  if (delta < -parsed.noChangeBand) return "REGRESSED";
  return "NO_CHANGE";
}
