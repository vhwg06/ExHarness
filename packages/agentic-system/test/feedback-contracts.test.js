import test from "node:test";
import assert from "node:assert/strict";
import {
  FEEDBACK_OBSERVATION_KIND,
  FEEDBACK_CONTEXT_BINDING_KIND,
  FEEDBACK_EPISODE_KIND,
  FEEDBACK_RESPONSE_KIND,
  FEEDBACK_OUTCOME_KIND,
  HOW_IMPROVEMENT_PROPOSAL_KIND,
  FeedbackDisposition,
  FeedbackOutcomeValue,
  FeedbackBindingStatus,
  defineSourceIdentity,
  defineApplicationPrincipal,
  defineFeedbackObservation,
  feedbackObservationIdFor,
  defineFeedbackContextBinding,
  feedbackContextBindingIdFor,
  defineFeedbackEpisode,
  feedbackEpisodeIdFor,
  defineFeedbackResponse,
  feedbackResponseIdFor,
  defineFeedbackOutcome,
  feedbackOutcomeIdFor,
  defineHowImprovementProposal,
  howImprovementProposalIdFor,
} from "../src/feedback-contracts.js";

const D = "a".repeat(64);
const E = "b".repeat(64);
const F = "c".repeat(64);
const ref = (kind, digest) => `${kind}:sha256:${digest}`;

function observation(overrides = {}) {
  return {
    kind: FEEDBACK_OBSERVATION_KIND,
    version: 1,
    source: { ref: ref("attempt", D), digest: D },
    subject: "attempt:subject-1",
    evidence: { attempts: 3, failures: 1 },
    provenance: { observer: "observer-1", observedAt: "2026-10-01T00:00:00Z" },
    uncertainty: "sampling noise on 3 attempts",
    ...overrides,
  };
}

function boundBinding(obsRef) {
  return {
    kind: FEEDBACK_CONTEXT_BINDING_KIND,
    version: 1,
    observationRef: obsRef,
    status: "BOUND",
    resolution: {
      ref: ref("oracle-resolution", E),
      digest: E,
      currentness: "CURRENT",
      sourceObservationRef: obsRef,
    },
  };
}

function episode(overrides = {}) {
  const obsRef = ref(FEEDBACK_OBSERVATION_KIND, D);
  return {
    kind: FEEDBACK_EPISODE_KIND,
    version: 1,
    observationRef: obsRef,
    contextBinding: boundBinding(obsRef),
    finding: { statement: "retry storm after provider timeout", sourceRef: ref("attempt", D) },
    impact: { statement: "p99 latency +40%" },
    ...overrides,
  };
}

test("defineSourceIdentity requires matching ref digest", () => {
  assert.throws(() => defineSourceIdentity({ ref: ref("attempt", D), digest: E }), /digest must equal/);
  assert.throws(() => defineSourceIdentity({ ref: "attempt", digest: D }), /content-addressed/);
  const id = defineSourceIdentity({ ref: ref("attempt", D), digest: D });
  assert.equal(id.digest, D);
  assert.ok(Object.isFrozen(id));
});

test("defineApplicationPrincipal rejects non-application roles", () => {
  for (const role of ["observer", "evaluator", "provider", "gepa", "model"]) {
    assert.throws(
      () => defineApplicationPrincipal({ id: "x", role }),
      /cannot act as the application principal/,
      `role ${role}`,
    );
  }
  const p = defineApplicationPrincipal({ id: "app-1", role: "application" });
  assert.equal(p.role, "application");
});

test("defineFeedbackObservation requires explicit uncertainty", () => {
  const { uncertainty, ...noUncertainty } = observation();
  assert.equal(uncertainty, "sampling noise on 3 attempts");
  assert.throws(() => defineFeedbackObservation(noUncertainty), /uncertainty/);
});

test("defineFeedbackObservation rejects missing source digest", () => {
  assert.throws(
    () => defineFeedbackObservation(observation({ source: { ref: ref("attempt", D) } })),
    /digest/,
  );
});

test("feedbackObservationIdFor is deterministic and content-addressed", () => {
  const a = feedbackObservationIdFor(observation());
  const b = feedbackObservationIdFor(observation());
  assert.equal(a, b);
  assert.ok(a.startsWith(`${FEEDBACK_OBSERVATION_KIND}:sha256:`));
});

test("defineFeedbackContextBinding rejects stale currentness", () => {
  const obsRef = ref(FEEDBACK_OBSERVATION_KIND, D);
  const binding = boundBinding(obsRef);
  binding.resolution.currentness = "STALE";
  assert.throws(() => defineFeedbackContextBinding(binding), /CURRENT/);
});

test("defineFeedbackContextBinding rejects digest mismatch (fail closed)", () => {
  const obsRef = ref(FEEDBACK_OBSERVATION_KIND, D);
  const binding = boundBinding(obsRef);
  binding.resolution.digest = F;
  assert.throws(() => defineFeedbackContextBinding(binding), /digest must equal/);
});

test("defineFeedbackContextBinding rejects source observation mismatch", () => {
  const obsRef = ref(FEEDBACK_OBSERVATION_KIND, D);
  const binding = boundBinding(ref(FEEDBACK_OBSERVATION_KIND, F));
  binding.observationRef = obsRef;
  assert.throws(() => defineFeedbackContextBinding(binding), /sourceObservationRef must equal/);
});

test("defineFeedbackContextBinding represents unresolved explicitly", () => {
  const b = defineFeedbackContextBinding({
    kind: FEEDBACK_CONTEXT_BINDING_KIND,
    version: 1,
    observationRef: ref(FEEDBACK_OBSERVATION_KIND, D),
    status: "UNRESOLVED",
    unresolvedReason: "STALE_CONTEXT",
  });
  assert.equal(b.status, FeedbackBindingStatus.UNRESOLVED);
  assert.equal(b.unresolvedReason, "STALE_CONTEXT");
  assert.throws(
    () =>
      defineFeedbackContextBinding({
        kind: FEEDBACK_CONTEXT_BINDING_KIND,
        version: 1,
        observationRef: ref(FEEDBACK_OBSERVATION_KIND, D),
        status: "UNRESOLVED",
        unresolvedReason: "BOGUS",
      }),
    /unresolvedReason/,
  );
});

test("defineFeedbackEpisode rejects unresolved context (no invented causal truth)", () => {
  const obsRef = ref(FEEDBACK_OBSERVATION_KIND, D);
  assert.throws(
    () =>
      defineFeedbackEpisode({
        kind: FEEDBACK_EPISODE_KIND,
        version: 1,
        observationRef: obsRef,
        contextBinding: {
          kind: FEEDBACK_CONTEXT_BINDING_KIND,
          version: 1,
          observationRef: obsRef,
          status: "UNRESOLVED",
          unresolvedReason: "MISSING_CONTEXT",
        },
        finding: { statement: "x", sourceRef: ref("attempt", D) },
        impact: { statement: "y" },
      }),
    /BOUND/,
  );
});

test("feedbackEpisodeIdFor deduplicates identical episodes", () => {
  assert.equal(feedbackEpisodeIdFor(episode()), feedbackEpisodeIdFor(episode()));
  const other = episode({ impact: { statement: "different" } });
  assert.notEqual(feedbackEpisodeIdFor(episode()), feedbackEpisodeIdFor(other));
});

test("defineFeedbackResponse requires application principal", () => {
  const base = {
    kind: FEEDBACK_RESPONSE_KIND,
    version: 1,
    episodeRef: ref(FEEDBACK_EPISODE_KIND, D),
    disposition: "ACTED",
    revision: 1,
    rationale: "mitigate retry storm",
  };
  assert.throws(
    () => defineFeedbackResponse({ ...base, principal: { id: "g", role: "gepa" } }),
    /cannot act as the application principal/,
  );
  assert.throws(
    () => defineFeedbackResponse({ ...base, principal: { id: "e", role: "evaluator" } }),
    /cannot act as the application principal/,
  );
  const r = defineFeedbackResponse({ ...base, principal: { id: "app-1", role: "application" } });
  assert.equal(r.disposition, FeedbackDisposition.ACTED);
  assert.ok(Object.isFrozen(r));
});

test("defineFeedbackResponse validates disposition and revision", () => {
  const base = {
    kind: FEEDBACK_RESPONSE_KIND,
    version: 1,
    episodeRef: ref(FEEDBACK_EPISODE_KIND, D),
    principal: { id: "app-1", role: "application" },
    rationale: "r",
  };
  assert.throws(() => defineFeedbackResponse({ ...base, disposition: "IGNORED", revision: 1 }), /disposition/);
  assert.throws(() => defineFeedbackResponse({ ...base, disposition: "REJECTED", revision: 0 }), /revision/);
  for (const d of ["ACTED", "REJECTED", "DEFERRED", "SUPERSEDED"]) {
    const r = defineFeedbackResponse({ ...base, disposition: d, revision: 2 });
    assert.equal(r.disposition, d);
  }
});

test("defineFeedbackOutcome: missing evidence is UNKNOWN never IMPROVED", () => {
  const base = {
    kind: FEEDBACK_OUTCOME_KIND,
    version: 1,
    responseRef: ref(FEEDBACK_RESPONSE_KIND, D),
    measuredAt: "2026-10-01T01:00:00Z",
  };
  assert.throws(() => defineFeedbackOutcome({ ...base, outcome: "IMPROVED" }), /evidenceRef/);
  const u = defineFeedbackOutcome({ ...base, outcome: "UNKNOWN" });
  assert.equal(u.outcome, FeedbackOutcomeValue.UNKNOWN);
  assert.equal(u.evidenceRef, null);
  const i = defineFeedbackOutcome({ ...base, outcome: "IMPROVED", evidenceRef: ref("evidence", E) });
  assert.equal(i.evidenceRef, ref("evidence", E));
});

test("defineHowImprovementProposal requires sealed holdout and frozen policy", () => {
  const base = {
    kind: HOW_IMPROVEMENT_PROPOSAL_KIND,
    version: 1,
    howSubject: { ref: ref("how-subject", D), digest: D },
    optimizerIdentity: { name: "gepa-0.1.4", ref: ref("gepa", E) },
    partitions: { development: "dev-split", searchValidation: "val-split", finalHoldoutSealed: true },
    metricPolicy: { ref: ref("metric-policy", F), digest: F, minEffect: 0.05 },
    candidateEvidenceRef: ref("evidence", D),
    status: "PROPOSED",
  };
  const p = defineHowImprovementProposal(base);
  assert.equal(p.status, "PROPOSED");
  assert.ok(Object.isFrozen(p));
  assert.throws(
    () => defineHowImprovementProposal({ ...base, partitions: { ...base.partitions, finalHoldoutSealed: false } }),
    /finalHoldoutSealed must be true/,
  );
});

test("defineHowImprovementProposal rejects acceptance/promotion flags", () => {
  const base = {
    kind: HOW_IMPROVEMENT_PROPOSAL_KIND,
    version: 1,
    howSubject: { ref: ref("how-subject", D), digest: D },
    optimizerIdentity: { name: "gepa-0.1.4", ref: ref("gepa", E) },
    partitions: { development: "dev", searchValidation: "val", finalHoldoutSealed: true },
    metricPolicy: { ref: ref("metric-policy", F), digest: F, minEffect: 0.05 },
    candidateEvidenceRef: ref("evidence", D),
    status: "PROPOSED",
  };
  for (const forbidden of ["accepted", "promoted", "verdict"]) {
    assert.throws(
      () => defineHowImprovementProposal({ ...base, [forbidden]: true }),
      /must not carry/,
      `forbidden key ${forbidden}`,
    );
  }
});

test("howImprovementProposalIdFor is deterministic", () => {
  const base = {
    kind: HOW_IMPROVEMENT_PROPOSAL_KIND,
    version: 1,
    howSubject: { ref: ref("how-subject", D), digest: D },
    optimizerIdentity: { name: "gepa-0.1.4", ref: ref("gepa", E) },
    partitions: { development: "dev", searchValidation: "val", finalHoldoutSealed: true },
    metricPolicy: { ref: ref("metric-policy", F), digest: F, minEffect: 0.05 },
    candidateEvidenceRef: ref("evidence", D),
    status: "PROPOSED",
  };
  assert.equal(howImprovementProposalIdFor(base), howImprovementProposalIdFor(structuredClone(base)));
});
