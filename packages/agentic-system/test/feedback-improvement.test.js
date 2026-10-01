import test from "node:test";
import assert from "node:assert/strict";
import {
  createImprovementHandoff,
} from "../src/feedback-improvement.js";
import {
  HOW_IMPROVEMENT_PROPOSAL_KIND,
  FEEDBACK_PROPOSAL_STATUS,
  howImprovementProposalIdFor,
} from "../src/feedback-contracts.js";

const D = "a".repeat(64);
const E = "b".repeat(64);
const F = "c".repeat(64);
const G = "d".repeat(64);
const ref = (kind, digest) => `${kind}:sha256:${digest}`;

function freezeInput(overrides = {}) {
  return {
    howSubject: { ref: ref("how-subject", D), digest: D },
    optimizerIdentity: { name: "gepa-0.1.4", ref: ref("optimizer", E) },
    partitions: {
      development: "dev-2026-q3",
      searchValidation: "search-val-2026-q3",
      finalHoldoutSealed: true,
    },
    metricPolicy: { ref: ref("metric-policy", F), digest: F, minEffect: 0.02 },
    ...overrides,
  };
}

function candidateRef() {
  return ref("candidate-evidence", G);
}

function repeats(values, caseName = "case-1") {
  return values.map((value) => ({ case: caseName, value }));
}

test("freezeExperimentScope returns a deep-frozen scope with deterministic scopeId", () => {
  const h = createImprovementHandoff();
  const scope = h.freezeExperimentScope(freezeInput());
  assert.ok(scope.scopeId);
  assert.equal(typeof scope.scopeId, "string");
  assert.ok(scope.frozenAt);
  assert.ok(Object.isFrozen(scope));
  assert.ok(Object.isFrozen(scope.howSubject));
  assert.ok(Object.isFrozen(scope.optimizerIdentity));
  assert.ok(Object.isFrozen(scope.partitions));
  assert.ok(Object.isFrozen(scope.metricPolicy));
  // Deterministic: same input (different frozenAt instant) -> same scopeId.
  const again = h.freezeExperimentScope(freezeInput());
  assert.equal(again.scopeId, scope.scopeId);
});

test("freezeExperimentScope rejects finalHoldoutMembers in partitions", () => {
  const h = createImprovementHandoff();
  const input = freezeInput({
    partitions: {
      development: "dev",
      searchValidation: "val",
      finalHoldoutSealed: true,
      finalHoldoutMembers: ["member-1", "member-2"],
    },
  });
  assert.throws(() => h.freezeExperimentScope(input), /FEEDBACK_IMPROVEMENT_INVALID/);
});

test("freezeExperimentScope rejects finalHoldoutEvidence nested anywhere in input", () => {
  const h = createImprovementHandoff();
  const input = freezeInput({
    metricPolicy: {
      ref: ref("metric-policy", F),
      digest: F,
      minEffect: 0.02,
      finalHoldoutEvidence: { blob: "x" },
    },
  });
  assert.throws(() => h.freezeExperimentScope(input), /FEEDBACK_IMPROVEMENT_INVALID/);
});

test("freezeExperimentScope records the final holdout NAME but nothing else", () => {
  const h = createImprovementHandoff();
  const scope = h.freezeExperimentScope(
    freezeInput({ partitions: { development: "d", searchValidation: "s", finalHoldoutSealed: true, finalHoldout: "holdout-final-01" } }),
  );
  assert.equal(scope.partitions.finalHoldout, "holdout-final-01");
  assert.equal(scope.partitions.finalHoldoutSealed, true);
});

test("freezeExperimentScope fails when finalHoldoutSealed is not true", () => {
  const h = createImprovementHandoff();
  assert.throws(
    () =>
      h.freezeExperimentScope(
        freezeInput({ partitions: { development: "d", searchValidation: "s", finalHoldoutSealed: false } }),
      ),
    /FEEDBACK_IMPROVEMENT_INVALID.*finalHoldoutSealed/,
  );
});

test("freezeExperimentScope fails on missing minEffect (never invents a percentage)", () => {
  const h = createImprovementHandoff();
  assert.throws(
    () =>
      h.freezeExperimentScope(
        freezeInput({ metricPolicy: { ref: ref("metric-policy", F), digest: F } }),
      ),
    /FEEDBACK_IMPROVEMENT_INVALID.*minEffect/,
  );
});

test("freezeExperimentScope fails on non-finite minEffect", () => {
  const h = createImprovementHandoff();
  for (const minEffect of [NaN, Infinity, -Infinity, "5%"]) {
    assert.throws(
      () => h.freezeExperimentScope(freezeInput({ metricPolicy: { ref: ref("metric-policy", F), digest: F, minEffect } })),
      /FEEDBACK_IMPROVEMENT_INVALID.*minEffect/,
    );
  }
});

test("freezeExperimentScope fails on digest mismatch", () => {
  const h = createImprovementHandoff();
  assert.throws(
    () => h.freezeExperimentScope(freezeInput({ howSubject: { ref: ref("how-subject", D), digest: E } })),
    /FEEDBACK_IMPROVEMENT_INVALID/,
  );
  assert.throws(
    () =>
      h.freezeExperimentScope(
        freezeInput({ metricPolicy: { ref: ref("metric-policy", F), digest: E, minEffect: 0.02 } }),
      ),
    /FEEDBACK_IMPROVEMENT_INVALID/,
  );
});

test("submitCandidate returns a PROPOSED proposal with matching id in record-only mode", () => {
  const h = createImprovementHandoff();
  const scope = h.freezeExperimentScope(freezeInput());
  const { proposal, proposalId } = h.submitCandidate({ scopeId: scope.scopeId, candidateEvidenceRef: candidateRef() });
  assert.equal(proposal.kind, HOW_IMPROVEMENT_PROPOSAL_KIND);
  assert.equal(proposal.version, 1);
  assert.equal(proposal.status, FEEDBACK_PROPOSAL_STATUS.PROPOSED);
  assert.equal(proposal.candidateEvidenceRef, candidateRef());
  assert.equal(proposal.howSubject.digest, D);
  assert.equal(proposal.optimizerIdentity.name, "gepa-0.1.4");
  assert.equal(proposal.partitions.finalHoldoutSealed, true);
  assert.equal(proposal.metricPolicy.minEffect, 0.02);
  assert.equal(proposalId, howImprovementProposalIdFor(proposal));
  assert.ok(Object.isFrozen(proposal));
});

test("submitCandidate ignores optimizer accepted/promoted/verdict/score claims", () => {
  const h = createImprovementHandoff();
  const scope = h.freezeExperimentScope(freezeInput());
  const { proposal } = h.submitCandidate({
    scopeId: scope.scopeId,
    optimizerResult: {
      candidateEvidenceRef: candidateRef(),
      accepted: true,
      promoted: true,
      verdict: "ACCEPT",
      score: 0.99,
    },
  });
  assert.equal(proposal.status, FEEDBACK_PROPOSAL_STATUS.PROPOSED);
  assert.ok(!("accepted" in proposal));
  assert.ok(!("promoted" in proposal));
  assert.ok(!("verdict" in proposal));
  assert.ok(!("score" in proposal));
  assert.equal(proposal.candidateEvidenceRef, candidateRef());
});

test("submitCandidate fails on unknown scopeId", () => {
  const h = createImprovementHandoff();
  assert.throws(
    () => h.submitCandidate({ scopeId: "nope", candidateEvidenceRef: candidateRef() }),
    /FEEDBACK_IMPROVEMENT_INVALID.*unknown scopeId/,
  );
});

test("submitCandidate fails when benchmark reservation returns null", () => {
  const calls = [];
  const h = createImprovementHandoff({
    benchmark: {
      registerAttempt(args) {
        calls.push(args);
        return null;
      },
    },
  });
  const scope = h.freezeExperimentScope(freezeInput());
  assert.throws(
    () => h.submitCandidate({ scopeId: scope.scopeId, candidateEvidenceRef: candidateRef() }),
    /FEEDBACK_IMPROVEMENT_INVALID.*reservation/,
  );
  // Reservation was attempted before acceptance.
  assert.deepEqual(calls, [{ scopeId: scope.scopeId, candidateEvidenceRef: candidateRef() }]);
});

test("submitCandidate fails when benchmark.registerAttempt throws", () => {
  const h = createImprovementHandoff({
    benchmark: {
      registerAttempt() {
        throw new Error("quota exhausted");
      },
    },
  });
  const scope = h.freezeExperimentScope(freezeInput());
  assert.throws(
    () => h.submitCandidate({ scopeId: scope.scopeId, candidateEvidenceRef: candidateRef() }),
    /FEEDBACK_IMPROVEMENT_INVALID.*registerAttempt/,
  );
});

test("submitCandidate reserves the attempt before accepting the candidate", () => {
  const calls = [];
  const h = createImprovementHandoff({
    benchmark: {
      registerAttempt(args) {
        calls.push(args);
        return { attemptId: "attempt-1" };
      },
    },
  });
  const scope = h.freezeExperimentScope(freezeInput());
  const { proposal } = h.submitCandidate({ scopeId: scope.scopeId, candidateEvidenceRef: candidateRef() });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].scopeId, scope.scopeId);
  assert.equal(calls[0].candidateEvidenceRef, candidateRef());
  assert.equal(proposal.status, FEEDBACK_PROPOSAL_STATUS.PROPOSED);
});

test("submitCandidate works when benchmark has no registerAttempt (record-only)", () => {
  const h = createImprovementHandoff({ benchmark: {} });
  const scope = h.freezeExperimentScope(freezeInput());
  const { proposal } = h.submitCandidate({ scopeId: scope.scopeId, candidateEvidenceRef: candidateRef() });
  assert.equal(proposal.status, FEEDBACK_PROPOSAL_STATUS.PROPOSED);
});

test("evaluateFinal IMPROVED on decisive aggregate margin over frozen minEffect", () => {
  const h = createImprovementHandoff();
  const scope = h.freezeExperimentScope(freezeInput()); // minEffect 0.02
  const out = h.evaluateFinal({
    scopeId: scope.scopeId,
    baselineEvidenceRef: ref("baseline-evidence", D),
    candidateEvidenceRef: ref("candidate-evidence", E),
    measurements: {
      baseline: repeats([0.5, 0.51, 0.49], "case-1"),
      candidate: repeats([0.6, 0.61, 0.59], "case-1"),
    },
    policy: { modelBacked: true },
  });
  assert.equal(out.outcome, "IMPROVED");
  assert.ok(out.detail.effect >= 0.02);
  assert.ok(Object.isFrozen(out));
  assert.ok(Object.isFrozen(out.detail));
});

test("evaluateFinal NO_CHANGE when effect is below frozen minEffect", () => {
  const h = createImprovementHandoff();
  const scope = h.freezeExperimentScope(freezeInput()); // minEffect 0.02
  const out = h.evaluateFinal({
    scopeId: scope.scopeId,
    baselineEvidenceRef: ref("baseline-evidence", D),
    candidateEvidenceRef: ref("candidate-evidence", E),
    measurements: {
      baseline: repeats([0.5], "case-1"),
      candidate: repeats([0.505], "case-1"),
    },
  });
  assert.equal(out.outcome, "NO_CHANGE");
});

test("evaluateFinal REGRESSED on decisive negative aggregate margin", () => {
  const h = createImprovementHandoff();
  const scope = h.freezeExperimentScope(freezeInput()); // minEffect 0.02
  const out = h.evaluateFinal({
    scopeId: scope.scopeId,
    baselineEvidenceRef: ref("baseline-evidence", D),
    candidateEvidenceRef: ref("candidate-evidence", E),
    measurements: {
      baseline: repeats([0.6], "case-1"),
      candidate: repeats([0.4], "case-1"),
    },
  });
  assert.equal(out.outcome, "REGRESSED");
});

test("evaluateFinal INCONCLUSIVE when model-backed has fewer than 3 paired repeats", () => {
  const h = createImprovementHandoff();
  const scope = h.freezeExperimentScope(freezeInput());
  const out = h.evaluateFinal({
    scopeId: scope.scopeId,
    baselineEvidenceRef: ref("baseline-evidence", D),
    candidateEvidenceRef: ref("candidate-evidence", E),
    measurements: {
      baseline: repeats([0.5, 0.51], "case-1"),
      candidate: repeats([0.9, 0.91], "case-1"),
    },
    policy: { modelBacked: true },
  });
  assert.equal(out.outcome, "INCONCLUSIVE");
  assert.notEqual(out.outcome, "IMPROVED");
});

test("evaluateFinal REGRESSED on critical regression even when aggregate improves", () => {
  const h = createImprovementHandoff();
  const scope = h.freezeExperimentScope(freezeInput());
  const out = h.evaluateFinal({
    scopeId: scope.scopeId,
    baselineEvidenceRef: ref("baseline-evidence", D),
    candidateEvidenceRef: ref("candidate-evidence", E),
    measurements: {
      baseline: repeats([0.5, 0.5, 0.5], "case-1").concat(repeats([0.9, 0.9, 0.9], "case-2")),
      candidate: repeats([0.99, 0.99, 0.99], "case-1").concat([
        { case: "case-2", value: 0.0, criticalRegression: true },
        { case: "case-2", value: 0.0, criticalRegression: true },
        { case: "case-2", value: 0.0, criticalRegression: true },
      ]),
    },
    policy: { modelBacked: true },
  });
  assert.equal(out.outcome, "REGRESSED");
  assert.deepEqual(out.detail.regressedCases, ["case-2"]);
});

test("evaluateFinal INCONCLUSIVE on missing measurements, never IMPROVED", () => {
  const h = createImprovementHandoff();
  const scope = h.freezeExperimentScope(freezeInput());
  for (const measurements of [undefined, null]) {
    const out = h.evaluateFinal({
      scopeId: scope.scopeId,
      baselineEvidenceRef: ref("baseline-evidence", D),
      candidateEvidenceRef: ref("candidate-evidence", E),
      measurements,
    });
    assert.equal(out.outcome, "INCONCLUSIVE");
    assert.notEqual(out.outcome, "IMPROVED");
  }
});

test("evaluateFinal UNKNOWN on disjoint case keys, never IMPROVED", () => {
  const h = createImprovementHandoff();
  const scope = h.freezeExperimentScope(freezeInput());
  const out = h.evaluateFinal({
    scopeId: scope.scopeId,
    baselineEvidenceRef: ref("baseline-evidence", D),
    candidateEvidenceRef: ref("candidate-evidence", E),
    measurements: {
      baseline: repeats([0.5], "case-a"),
      candidate: repeats([0.9], "case-b"),
    },
  });
  assert.equal(out.outcome, "UNKNOWN");
  assert.notEqual(out.outcome, "IMPROVED");
});

test("evaluateFinal compares against the frozen minEffect, not caller policy", () => {
  const h = createImprovementHandoff();
  const scope = h.freezeExperimentScope(
    freezeInput({ metricPolicy: { ref: ref("metric-policy", F), digest: F, minEffect: 0.5 } }),
  );
  // A small effect that would IMPROVE against minEffect 0.02 is NO_CHANGE here.
  const out = h.evaluateFinal({
    scopeId: scope.scopeId,
    baselineEvidenceRef: ref("baseline-evidence", D),
    candidateEvidenceRef: ref("candidate-evidence", E),
    measurements: {
      baseline: repeats([0.5], "case-1"),
      candidate: repeats([0.6], "case-1"),
    },
    policy: { minEffect: 0.0 }, // ignored: threshold comes from the frozen scope
  });
  assert.equal(out.outcome, "NO_CHANGE");
});

test("evaluateFinal fails on unknown scopeId and bad evidence refs", () => {
  const h = createImprovementHandoff();
  assert.throws(
    () =>
      h.evaluateFinal({
        scopeId: "unknown",
        baselineEvidenceRef: ref("baseline-evidence", D),
        candidateEvidenceRef: ref("candidate-evidence", E),
        measurements: { baseline: [], candidate: [] },
      }),
    /FEEDBACK_IMPROVEMENT_INVALID.*unknown scopeId/,
  );
  const scope = h.freezeExperimentScope(freezeInput());
  assert.throws(
    () =>
      h.evaluateFinal({
        scopeId: scope.scopeId,
        baselineEvidenceRef: "not-a-ref",
        candidateEvidenceRef: ref("candidate-evidence", E),
        measurements: { baseline: [], candidate: [] },
      }),
    /FEEDBACK_IMPROVEMENT_INVALID/,
  );
});

test("evaluateFinal supports lower-is-better direction", () => {
  const h = createImprovementHandoff();
  const scope = h.freezeExperimentScope(freezeInput()); // minEffect 0.02
  const out = h.evaluateFinal({
    scopeId: scope.scopeId,
    baselineEvidenceRef: ref("baseline-evidence", D),
    candidateEvidenceRef: ref("candidate-evidence", E),
    measurements: {
      baseline: repeats([10.0], "case-1"),
      candidate: repeats([9.0], "case-1"),
    },
    policy: { direction: "lower" },
  });
  assert.equal(out.outcome, "IMPROVED");
});

test("clock injector drives frozenAt", () => {
  const h = createImprovementHandoff({ clock: { now: () => "2026-10-01T00:00:00Z" } });
  const scope = h.freezeExperimentScope(freezeInput());
  assert.equal(scope.frozenAt, "2026-10-01T00:00:00Z");
});
