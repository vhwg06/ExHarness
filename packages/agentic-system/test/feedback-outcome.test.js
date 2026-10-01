import test from "node:test";
import assert from "node:assert/strict";
import { classifyFeedbackOutcome } from "../src/feedback-outcome.js";
import { defineFeedbackOutcomePolicy } from "../src/feedback-lifecycle-contracts.js";

function higherPolicy(overrides = {}) {
  return defineFeedbackOutcomePolicy({
    kind: "FEEDBACK_OUTCOME_POLICY_V1",
    version: 1,
    metricKey: "throughput",
    direction: "HIGHER_IS_BETTER",
    minEffect: 10,
    noChangeBand: 2,
    requiredMeasurementKeys: ["throughput"],
    ...overrides,
  });
}
function lowerPolicy(overrides = {}) {
  return defineFeedbackOutcomePolicy({
    kind: "FEEDBACK_OUTCOME_POLICY_V1",
    version: 1,
    metricKey: "p99_ms",
    direction: "LOWER_IS_BETTER",
    minEffect: 50,
    noChangeBand: 10,
    requiredMeasurementKeys: ["p99_ms"],
    ...overrides,
  });
}
const FRESH = Object.freeze({
  responseIsCurrent: true,
  freshInputStatus: "GROUNDED",
  isNewInput: true,
  attemptsDisjoint: true,
  boundariesStrictlyLater: true,
});
const meas = (key, value) => [{ key, value }];

test("higher-is-better boundaries: minEffect, band and regression", () => {
  const policy = higherPolicy();
  assert.equal(classifyFeedbackOutcome(policy, meas("throughput", 100), meas("throughput", 110), FRESH), "IMPROVED");
  assert.equal(classifyFeedbackOutcome(policy, meas("throughput", 100), meas("throughput", 109), FRESH), "NO_CHANGE");
  assert.equal(classifyFeedbackOutcome(policy, meas("throughput", 100), meas("throughput", 101), FRESH), "NO_CHANGE");
  assert.equal(classifyFeedbackOutcome(policy, meas("throughput", 100), meas("throughput", 100), FRESH), "NO_CHANGE");
  assert.equal(classifyFeedbackOutcome(policy, meas("throughput", 100), meas("throughput", 99), FRESH), "NO_CHANGE");
  assert.equal(classifyFeedbackOutcome(policy, meas("throughput", 100), meas("throughput", 97), FRESH), "REGRESSED");
  assert.equal(classifyFeedbackOutcome(policy, meas("throughput", 100), meas("throughput", 90), FRESH), "REGRESSED");
});

test("lower-is-better boundaries: improvement is a decrease", () => {
  const policy = lowerPolicy();
  assert.equal(classifyFeedbackOutcome(policy, meas("p99_ms", 200), meas("p99_ms", 150), FRESH), "IMPROVED");
  assert.equal(classifyFeedbackOutcome(policy, meas("p99_ms", 200), meas("p99_ms", 151), FRESH), "NO_CHANGE");
  assert.equal(classifyFeedbackOutcome(policy, meas("p99_ms", 200), meas("p99_ms", 200), FRESH), "NO_CHANGE");
  assert.equal(classifyFeedbackOutcome(policy, meas("p99_ms", 200), meas("p99_ms", 205), FRESH), "NO_CHANGE");
  assert.equal(classifyFeedbackOutcome(policy, meas("p99_ms", 200), meas("p99_ms", 211), FRESH), "REGRESSED");
});

test("missing or null required measurement is UNKNOWN, never zero", () => {
  const policy = lowerPolicy();
  assert.equal(classifyFeedbackOutcome(policy, [], meas("p99_ms", 100), FRESH), "UNKNOWN");
  assert.equal(classifyFeedbackOutcome(policy, meas("p99_ms", 200), [], FRESH), "UNKNOWN");
  assert.equal(classifyFeedbackOutcome(policy, meas("p99_ms", 200), meas("p99_ms", null), FRESH), "UNKNOWN");
  assert.equal(classifyFeedbackOutcome(policy, meas("p99_ms", null), meas("p99_ms", 100), FRESH), "UNKNOWN");
  // A missing value must not be coerced to zero: baseline 0 would look
  // improved, but a null baseline is UNKNOWN.
  assert.equal(classifyFeedbackOutcome(policy, [{ key: "p99_ms", value: null }], meas("p99_ms", 0), FRESH), "UNKNOWN");
  const multi = lowerPolicy({ requiredMeasurementKeys: ["p99_ms", "error_rate"] });
  assert.equal(
    classifyFeedbackOutcome(
      multi,
      [{ key: "p99_ms", value: 200 }, { key: "error_rate", value: 0.01 }],
      [{ key: "p99_ms", value: 100 }],
      FRESH,
    ),
    "UNKNOWN",
  );
});

test("UNRESOLVED fresh input is UNKNOWN and never IMPROVED", () => {
  const policy = lowerPolicy();
  const unresolved = { ...FRESH, freshInputStatus: "UNRESOLVED" };
  assert.equal(classifyFeedbackOutcome(policy, meas("p99_ms", 200), meas("p99_ms", 10), unresolved), "UNKNOWN");
  assert.equal(classifyFeedbackOutcome(policy, meas("p99_ms", 200), meas("p99_ms", 10), null), "UNKNOWN");
});

test("failed freshness is UNKNOWN", () => {
  const policy = lowerPolicy();
  const baseline = meas("p99_ms", 200);
  const fresh = meas("p99_ms", 100);
  for (const patch of [
    { responseIsCurrent: false },
    { isNewInput: false },
    { attemptsDisjoint: false },
    { boundariesStrictlyLater: false },
  ]) {
    assert.equal(classifyFeedbackOutcome(policy, baseline, fresh, { ...FRESH, ...patch }), "UNKNOWN");
  }
});
