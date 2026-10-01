// Delivery rebuild 2026-10-01: re-validated on current main.
import test from "node:test";
import assert from "node:assert/strict";
import {
  defineFeedbackEpisode,
  episodeIdFor,
  defineFeedbackOutcomePolicy,
  outcomePolicyDigestFor,
  defineFeedbackResponse,
  defineFeedbackOutcome,
  defineFeedbackResolution,
} from "../src/feedback-lifecycle-contracts.js";

function pin(ref) {
  const digest = ref.match(/:sha256:([a-f0-9]{64})$/)?.[1];
  assert.ok(digest, `ref is not content addressed: ${ref}`);
  return { ref, digest };
}
const REF_A = `grounded-finding-input:sha256:${"a".repeat(64)}`;
const REF_B = `grounded-finding-input:sha256:${"b".repeat(64)}`;
const EPI_REF = `feedback-episode:sha256:${"c".repeat(64)}`;
const RESP_REF = `feedback-response:sha256:${"d".repeat(64)}`;
const OUT_REF = `feedback-outcome:sha256:${"e".repeat(64)}`;

function baseEpisode(overrides = {}) {
  return {
    kind: "FEEDBACK_EPISODE_V1",
    version: 1,
    groundedInputRefs: [pin(REF_A)],
    finding: {
      kind: "LATENCY_REGRESSION",
      statement: "p99 increased on checkout",
      evidenceRefs: [pin(REF_A)],
      producer: { kind: "OBSERVER", id: "observer-1" },
    },
    impact: {
      basis: "HYPOTHESIZED",
      measurements: [],
    },
    scopeKey: "checkout",
    contraryEvidenceRefs: [],
    ...structuredClone(overrides),
  };
}

function basePolicy(overrides = {}) {
  return {
    kind: "FEEDBACK_OUTCOME_POLICY_V1",
    version: 1,
    metricKey: "p99_ms",
    direction: "LOWER_IS_BETTER",
    minEffect: 50,
    noChangeBand: 10,
    requiredMeasurementKeys: ["p99_ms"],
    ...structuredClone(overrides),
  };
}

test("episode binds exact refs and computes deterministic episodeId", () => {
  const first = defineFeedbackEpisode(baseEpisode());
  const second = defineFeedbackEpisode(baseEpisode());
  assert.equal(first.episodeId, second.episodeId);
  assert.match(first.episodeId, /^[a-f0-9]{64}$/);
  assert.equal(first.episodeId, episodeIdFor(first));
  const changed = defineFeedbackEpisode(
    baseEpisode({ scopeKey: "checkout-v2" }),
  );
  assert.notEqual(changed.episodeId, first.episodeId);
});

test("episode rejects digest mismatch and non-pin refs", () => {
  assert.throws(
    () =>
      defineFeedbackEpisode(
        baseEpisode({ groundedInputRefs: [{ ref: REF_A, digest: "0".repeat(64) }] }),
      ),
    /digest mismatch/,
  );
  assert.throws(() => defineFeedbackEpisode(baseEpisode({ groundedInputRefs: [] })), /at least one/);
  assert.throws(
    () => defineFeedbackEpisode(baseEpisode({ groundedInputRefs: [{ ref: "not-a-ref", digest: "a".repeat(64) }] })),
    /digest mismatch|pin/,
  );
});

test("episode rejects forbidden authority fields at any depth", () => {
  for (const key of ["principal", "disposition", "verdict", "accepted", "promoted", "resolution"]) {
    const raw = baseEpisode();
    raw.finding.producer[key] = "smuggled";
    assert.throws(() => defineFeedbackEpisode(raw), /forbidden authority/);
  }
  const raw = baseEpisode();
  raw[keyed()] = "x";
  function keyed() {
    return "principal";
  }
  assert.throws(() => defineFeedbackEpisode(raw), /forbidden authority/);
});

test("MEASURED impact requires finite measurements; HYPOTHESIZED allows empty", () => {
  const measured = defineFeedbackEpisode(
    baseEpisode({ impact: { basis: "MEASURED", measurements: [{ key: "p99_ms", value: 120, unit: "ms", evidenceRef: REF_A, reason: null }] } }),
  );
  assert.equal(measured.impact.basis, "MEASURED");
  assert.throws(
    () => defineFeedbackEpisode(baseEpisode({ impact: { basis: "MEASURED", measurements: [] } })),
    /MEASURED.*at least one/,
  );
  assert.throws(
    () =>
      defineFeedbackEpisode(
        baseEpisode({ impact: { basis: "MEASURED", measurements: [{ key: "p99_ms", value: null, reason: "missing" }] } }),
      ),
    /MEASURED.*finite/,
  );
});

test("response enforces disposition rules", () => {
  const policy = basePolicy();
  const acted = defineFeedbackResponse({
    kind: "FEEDBACK_RESPONSE_V1",
    version: 1,
    episodeRef: EPI_REF,
    episodeDigest: "c".repeat(64),
    previousResponseRef: null,
    principalAuthorityRef: "authority:1",
    disposition: "ACTED",
    rationaleRef: null,
    actionRefs: ["work:1"],
    successorEpisodeRef: null,
    revisitCondition: null,
    outcomePolicy: policy,
  });
  assert.equal(acted.disposition, "ACTED");
  assert.equal(acted.outcomePolicyDigest, outcomePolicyDigestFor(policy));

  assert.throws(
    () =>
      defineFeedbackResponse({
        kind: "FEEDBACK_RESPONSE_V1",
        version: 1,
        episodeRef: EPI_REF,
        episodeDigest: "c".repeat(64),
        previousResponseRef: null,
        principalAuthorityRef: "authority:1",
        disposition: "ACTED",
        rationaleRef: null,
        actionRefs: [],
        successorEpisodeRef: null,
        revisitCondition: null,
        outcomePolicy: policy,
      }),
    /ACTED.*actionRefs/,
  );
  assert.throws(
    () =>
      defineFeedbackResponse({
        kind: "FEEDBACK_RESPONSE_V1",
        version: 1,
        episodeRef: EPI_REF,
        episodeDigest: "c".repeat(64),
        previousResponseRef: null,
        principalAuthorityRef: "authority:1",
        disposition: "ACTED",
        rationaleRef: null,
        actionRefs: ["work:1"],
        successorEpisodeRef: null,
        revisitCondition: null,
        outcomePolicy: null,
      }),
    /ACTED.*outcomePolicy/,
  );
  assert.throws(
    () =>
      defineFeedbackResponse({
        kind: "FEEDBACK_RESPONSE_V1",
        version: 1,
        episodeRef: EPI_REF,
        episodeDigest: "c".repeat(64),
        previousResponseRef: null,
        principalAuthorityRef: "authority:1",
        disposition: "REJECTED",
        rationaleRef: null,
        actionRefs: [],
        successorEpisodeRef: null,
        revisitCondition: null,
        outcomePolicy: null,
      }),
    /REJECTED.*rationaleRef/,
  );
  assert.throws(
    () =>
      defineFeedbackResponse({
        kind: "FEEDBACK_RESPONSE_V1",
        version: 1,
        episodeRef: EPI_REF,
        episodeDigest: "c".repeat(64),
        previousResponseRef: null,
        principalAuthorityRef: "authority:1",
        disposition: "DEFERRED",
        rationaleRef: null,
        actionRefs: [],
        successorEpisodeRef: null,
        revisitCondition: null,
        outcomePolicy: null,
      }),
    /DEFERRED.*revisitCondition/,
  );
  assert.throws(
    () =>
      defineFeedbackResponse({
        kind: "FEEDBACK_RESPONSE_V1",
        version: 1,
        episodeRef: EPI_REF,
        episodeDigest: "c".repeat(64),
        previousResponseRef: null,
        principalAuthorityRef: "authority:1",
        disposition: "SUPERSEDED",
        rationaleRef: null,
        actionRefs: [],
        successorEpisodeRef: null,
        revisitCondition: null,
        outcomePolicy: null,
      }),
    /SUPERSEDED.*successorEpisodeRef/,
  );
});

test("outcome policy freezes digest and validates bands", () => {
  const policy = defineFeedbackOutcomePolicy(basePolicy());
  assert.equal(policy.minEffect, 50);
  assert.equal(outcomePolicyDigestFor(policy), outcomePolicyDigestFor(structuredClone(policy)));
  assert.throws(() => defineFeedbackOutcomePolicy(basePolicy({ minEffect: 0 })), /minEffect/);
  assert.throws(() => defineFeedbackOutcomePolicy(basePolicy({ noChangeBand: 60 })), /noChangeBand/);
  assert.throws(() => defineFeedbackOutcomePolicy(basePolicy({ requiredMeasurementKeys: [] })), /at least one/);
  assert.throws(
    () => defineFeedbackOutcomePolicy(basePolicy({ requiredMeasurementKeys: ["other_key"] })),
    /must include metricKey/,
  );
});

test("outcome requires reasons for UNKNOWN and binds freshness identity", () => {
  const outcome = defineFeedbackOutcome({
    kind: "FEEDBACK_OUTCOME_V1",
    version: 1,
    responseRef: RESP_REF,
    responseDigest: "d".repeat(64),
    freshInputRef: REF_B,
    freshInputDigest: "b".repeat(64),
    freshness: { freshExecutionAttemptIds: ["execution-attempt-id:fresh-1"], effectiveAfterBoundary: "2026-01-02T00:00:00.000Z" },
    policyDigest: "f".repeat(64),
    baselineMeasurements: [{ key: "p99_ms", value: 200 }],
    freshMeasurements: [{ key: "p99_ms", value: 100 }],
    outcome: "IMPROVED",
    reasons: [],
  });
  assert.equal(outcome.outcome, "IMPROVED");
  assert.throws(
    () =>
      defineFeedbackOutcome({
        kind: "FEEDBACK_OUTCOME_V1",
        version: 1,
        responseRef: RESP_REF,
        responseDigest: "d".repeat(64),
        freshInputRef: REF_B,
        freshInputDigest: "b".repeat(64),
        freshness: { freshExecutionAttemptIds: [], effectiveAfterBoundary: "2026-01-02T00:00:00.000Z" },
        policyDigest: "f".repeat(64),
        baselineMeasurements: [],
        freshMeasurements: [],
        outcome: "UNKNOWN",
        reasons: [],
      }),
    /UNKNOWN.*reason/,
  );
});

test("resolution derives terminal values and binds refs", () => {
  const improved = defineFeedbackResolution({
    kind: "FEEDBACK_RESOLUTION_V1",
    version: 1,
    episodeRef: EPI_REF,
    episodeDigest: "c".repeat(64),
    finalResponseRef: RESP_REF,
    finalResponseDigest: "d".repeat(64),
    outcomeRef: OUT_REF,
    outcomeDigest: "e".repeat(64),
    resolution: "IMPROVED",
    principalAuthorityRef: "authority:1",
  });
  assert.equal(improved.resolution, "IMPROVED");
  const rejected = defineFeedbackResolution({
    kind: "FEEDBACK_RESOLUTION_V1",
    version: 1,
    episodeRef: EPI_REF,
    episodeDigest: "c".repeat(64),
    finalResponseRef: RESP_REF,
    finalResponseDigest: "d".repeat(64),
    outcomeRef: null,
    outcomeDigest: null,
    resolution: "REJECTED_ACKNOWLEDGED",
    principalAuthorityRef: "authority:1",
  });
  assert.equal(rejected.resolution, "REJECTED_ACKNOWLEDGED");
  assert.throws(
    () =>
      defineFeedbackResolution({
        kind: "FEEDBACK_RESOLUTION_V1",
        version: 1,
        episodeRef: EPI_REF,
        episodeDigest: "c".repeat(64),
        finalResponseRef: RESP_REF,
        finalResponseDigest: "d".repeat(64),
        outcomeRef: null,
        outcomeDigest: null,
        resolution: "IMPROVED",
        principalAuthorityRef: "authority:1",
      }),
    /requires an outcomeRef/,
  );
});
