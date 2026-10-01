import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  defineFeedbackEpisode,
  feedbackEpisodeIdFor,
  FeedbackBindingStatus,
} from "../src/feedback-contracts.js";
import {
  createFeedbackProjector,
  createCrossEpisodeProjector,
} from "../src/feedback-projection.js";

const D = "a".repeat(64);
const E = "b".repeat(64);
const F = "c".repeat(64);
const G = "d".repeat(64);
const ref = (kind, digest) => `${kind}:sha256:${digest}`;

function observation(overrides = {}) {
  return {
    kind: "FEEDBACK_OBSERVATION_V1",
    version: 1,
    source: { ref: ref("attempt", D), digest: D },
    subject: "attempt:subject-1",
    evidence: { attempts: 3, failures: 1, providerNarrative: "provider claims a miracle speedup" },
    provenance: { observer: "observer-1", observedAt: "2026-10-01T00:00:00Z" },
    uncertainty: "sampling noise on 3 attempts",
    ...overrides,
  };
}

// A valid CURRENT Oracle ContextResolution-like for a given observation ref.
function resolutionFor(obsRef, overrides = {}) {
  return {
    ref: ref("oracle-resolution", E),
    digest: E,
    currentness: "CURRENT",
    sourceObservationRef: obsRef,
    ...overrides,
  };
}

function projectorWith(stub) {
  return createFeedbackProjector({ resolveContext: stub ?? (async () => null) });
}

const FINDING_STATEMENT = "finding: attempt failures cluster on step 2";
const IMPACT_STATEMENT = "impact: retry budget exhausted on step 2";

// Projects a BOUND episode via the seam stub; returns { episode, obsRef }.
async function projectBoundEpisode(cohortKey = null, overrides = {}) {
  const projector = projectorWith(async ({ observationRef }) => resolutionFor(observationRef));
  const result = await projector.projectObservation({
    observation: observation(),
    findingStatement: FINDING_STATEMENT,
    findingSourceRef: ref("evidence", F),
    impactStatement: IMPACT_STATEMENT,
    cohortKey,
    ...overrides,
  });
  assert.ok(result.episode, "expected a BOUND episode");
  return result;
}

// ---------------------------------------------------------------------------
// S3 — observation/context projection
// ---------------------------------------------------------------------------

test("S3: valid resolution projects a frozen episode with deterministic id", async () => {
  const first = await projectBoundEpisode();
  const second = await projectBoundEpisode();
  assert.equal(feedbackEpisodeIdFor(first.episode), feedbackEpisodeIdFor(second.episode));
  assert.ok(Object.isFrozen(first.episode));
  assert.ok(Object.isFrozen(first.episode.finding));
  assert.equal(first.episode.contextBinding.status, FeedbackBindingStatus.BOUND);
  // Deterministic identity is grounded on the observation, not the args.
  assert.equal(first.episode.observationRef, second.episode.observationRef);
});

test("S3: finding/impact come from explicit args, never inferred from provider prose", async () => {
  const { episode } = await projectBoundEpisode();
  assert.equal(episode.finding.statement, FINDING_STATEMENT);
  assert.equal(episode.finding.sourceRef, ref("evidence", F));
  assert.equal(episode.impact.statement, IMPACT_STATEMENT);
  assert.ok(!episode.finding.statement.includes("miracle speedup"));
  assert.ok(!episode.impact.statement.includes("miracle speedup"));
});

test("S3: explicit cohortKey passes through to the episode", async () => {
  const { episode } = await projectBoundEpisode("cohort-alpha");
  assert.equal(episode.cohortKey, "cohort-alpha");
  const { episode: none } = await projectBoundEpisode();
  assert.equal(none.cohortKey, null);
});

test("S3: null contextResolution yields UNRESOLVED MISSING_CONTEXT and no episode", async () => {
  let seamCalls = 0;
  const projector = projectorWith(async () => {
    seamCalls += 1;
    return resolutionFor("unused");
  });
  const result = await projector.projectObservation({
    observation: observation(),
    contextResolution: null,
    findingStatement: FINDING_STATEMENT,
    findingSourceRef: ref("evidence", F),
    impactStatement: IMPACT_STATEMENT,
  });
  assert.equal(result.episode, undefined);
  assert.ok(result.unresolved);
  assert.equal(result.unresolved.reason, "MISSING_CONTEXT");
  assert.equal(result.unresolved.binding.status, FeedbackBindingStatus.UNRESOLVED);
  assert.equal(result.unresolved.binding.unresolvedReason, "MISSING_CONTEXT");
  assert.ok(Object.isFrozen(result.unresolved.binding));
  assert.equal(seamCalls, 0);
});

test("S3: undefined contextResolution uses the resolveContext seam", async () => {
  let seen = null;
  const projector = projectorWith(async (args) => {
    seen = args;
    return resolutionFor(args.observationRef);
  });
  const result = await projector.projectObservation({
    observation: observation(),
    findingStatement: FINDING_STATEMENT,
    findingSourceRef: ref("evidence", F),
    impactStatement: IMPACT_STATEMENT,
  });
  assert.ok(seen && typeof seen.observationRef === "string");
  assert.ok(result.episode);
  assert.equal(result.episode.contextBinding.status, FeedbackBindingStatus.BOUND);
});

test("S3: seam returning null fails closed to MISSING_CONTEXT", async () => {
  const projector = projectorWith(async () => null);
  const result = await projector.projectObservation({
    observation: observation(),
    findingStatement: FINDING_STATEMENT,
    findingSourceRef: ref("evidence", F),
    impactStatement: IMPACT_STATEMENT,
  });
  assert.equal(result.episode, undefined);
  assert.equal(result.unresolved.reason, "MISSING_CONTEXT");
});

test("S3: stale currentness fails closed with STALE_CONTEXT", async () => {
  const projector = projectorWith(async ({ observationRef }) =>
    resolutionFor(observationRef, { currentness: "STALE" }),
  );
  const result = await projector.projectObservation({
    observation: observation(),
    findingStatement: FINDING_STATEMENT,
    findingSourceRef: ref("evidence", F),
    impactStatement: IMPACT_STATEMENT,
  });
  assert.equal(result.episode, undefined);
  assert.equal(result.unresolved.reason, "STALE_CONTEXT");
  assert.equal(result.unresolved.binding.unresolvedReason, "STALE_CONTEXT");
});

test("S3: digest mismatch fails closed with RESOLUTION_DIGEST_MISMATCH", async () => {
  const projector = projectorWith(async ({ observationRef }) =>
    resolutionFor(observationRef, { digest: G }),
  );
  const result = await projector.projectObservation({
    observation: observation(),
    findingStatement: FINDING_STATEMENT,
    findingSourceRef: ref("evidence", F),
    impactStatement: IMPACT_STATEMENT,
  });
  assert.equal(result.episode, undefined);
  assert.equal(result.unresolved.reason, "RESOLUTION_DIGEST_MISMATCH");
});

test("S3: source observation mismatch fails closed with SOURCE_OBSERVATION_MISMATCH", async () => {
  const projector = projectorWith(async () => resolutionFor(ref("attempt", G)));
  const result = await projector.projectObservation({
    observation: observation(),
    findingStatement: FINDING_STATEMENT,
    findingSourceRef: ref("evidence", F),
    impactStatement: IMPACT_STATEMENT,
  });
  assert.equal(result.episode, undefined);
  assert.equal(result.unresolved.reason, "SOURCE_OBSERVATION_MISMATCH");
});

test("S3: malformed resolution (missing fields) fails closed with MISSING_CONTEXT", async () => {
  const projector = projectorWith(async ({ observationRef }) => ({
    ref: ref("oracle-resolution", E),
    currentness: "CURRENT",
    sourceObservationRef: observationRef,
  }));
  const result = await projector.projectObservation({
    observation: observation(),
    findingStatement: FINDING_STATEMENT,
    findingSourceRef: ref("evidence", F),
    impactStatement: IMPACT_STATEMENT,
  });
  assert.equal(result.episode, undefined);
  assert.equal(result.unresolved.reason, "MISSING_CONTEXT");
});

test("S3: invalid observation throws contract validation", async () => {
  const projector = projectorWith();
  await assert.rejects(
    () =>
      projector.projectObservation({
        observation: observation({ kind: "WRONG_KIND" }),
        findingStatement: FINDING_STATEMENT,
        findingSourceRef: ref("evidence", F),
        impactStatement: IMPACT_STATEMENT,
      }),
    /FEEDBACK_CONTRACT_INVALID/,
  );
});

test("S3: BOUND projection without explicit statements throws FEEDBACK_PROJECTION_INVALID", async () => {
  const projector = projectorWith(async ({ observationRef }) => resolutionFor(observationRef));
  await assert.rejects(
    () =>
      projector.projectObservation({
        observation: observation(),
        findingSourceRef: ref("evidence", F),
        impactStatement: IMPACT_STATEMENT,
      }),
    /FEEDBACK_PROJECTION_INVALID: findingStatement/,
  );
});

test("S3: constructor requires the resolveContext seam", () => {
  assert.throws(() => createFeedbackProjector({}), /FEEDBACK_PROJECTION_INVALID/);
  assert.throws(() => createFeedbackProjector({ resolveContext: "nope" }), /FEEDBACK_PROJECTION_INVALID/);
});

// ---------------------------------------------------------------------------
// S5 — cross-episode projection and reinforcement
// ---------------------------------------------------------------------------

function sha256Hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

test("S5: ingestEpisode stores by deterministic id; duplicates are a no-op", async () => {
  const { episode } = await projectBoundEpisode("cohort-alpha");
  const xp = createCrossEpisodeProjector();
  const first = xp.ingestEpisode(episode);
  assert.equal(first.deduplicated, false);
  assert.equal(first.episodeId, feedbackEpisodeIdFor(episode));
  const second = xp.ingestEpisode(structuredClone(episode));
  assert.equal(second.deduplicated, true);
  assert.equal(second.episodeId, first.episodeId);
  const patterns = xp.projectPatterns();
  assert.equal(patterns.length, 1);
  assert.equal(patterns[0].support, 1);
});

test("S5: episodes group only on explicit cohortKey", async () => {
  const xp = createCrossEpisodeProjector();
  const a = await projectBoundEpisode("cohort-alpha");
  // A second alpha episode with different evidence (different observation id).
  const projector = projectorWith(async ({ observationRef }) => resolutionFor(observationRef));
  const other = await projector.projectObservation({
    observation: observation({ subject: "attempt:subject-2", evidence: { attempts: 5, failures: 2 } }),
    findingStatement: FINDING_STATEMENT,
    findingSourceRef: ref("evidence", F),
    impactStatement: IMPACT_STATEMENT,
    cohortKey: "cohort-alpha",
  });
  const b = await projectBoundEpisode("cohort-beta");
  xp.ingestEpisode(a.episode);
  xp.ingestEpisode(other.episode);
  xp.ingestEpisode(b.episode);
  const patterns = xp.projectPatterns();
  assert.equal(patterns.length, 2);
  const alpha = patterns.find((p) => p.cohortKey === "cohort-alpha");
  const beta = patterns.find((p) => p.cohortKey === "cohort-beta");
  assert.equal(alpha.support, 2);
  assert.equal(beta.support, 1);
  assert.deepEqual(alpha.memberEpisodeIds, [...alpha.memberEpisodeIds].sort());
});

test("S5: episodes with null cohortKey are never grouped", async () => {
  const xp = createCrossEpisodeProjector();
  const a = await projectBoundEpisode(null);
  const projector = projectorWith(async ({ observationRef }) => resolutionFor(observationRef));
  const b = await projector.projectObservation({
    observation: observation({ subject: "attempt:subject-9" }),
    findingStatement: FINDING_STATEMENT,
    findingSourceRef: ref("evidence", F),
    impactStatement: IMPACT_STATEMENT,
  });
  xp.ingestEpisode(a.episode);
  xp.ingestEpisode(b.episode);
  const patterns = xp.projectPatterns();
  assert.equal(patterns.length, 2);
  for (const p of patterns) {
    assert.equal(p.cohortKey, null);
    assert.equal(p.support, 1);
    assert.equal(p.memberEpisodeIds.length, 1);
  }
  assert.notEqual(patterns[0].patternId, patterns[1].patternId);
});

test("S5: patternId is sha256 of sorted member ids and output is deterministic", async () => {
  const a = await projectBoundEpisode("cohort-alpha");
  const projector = projectorWith(async ({ observationRef }) => resolutionFor(observationRef));
  const b = await projector.projectObservation({
    observation: observation({ subject: "attempt:subject-2" }),
    findingStatement: FINDING_STATEMENT,
    findingSourceRef: ref("evidence", F),
    impactStatement: IMPACT_STATEMENT,
    cohortKey: "cohort-alpha",
  });
  const xp1 = createCrossEpisodeProjector();
  xp1.ingestEpisode(a.episode);
  xp1.ingestEpisode(b.episode);
  const xp2 = createCrossEpisodeProjector();
  xp2.ingestEpisode(b.episode);
  xp2.ingestEpisode(a.episode);
  const [p1] = xp1.projectPatterns();
  const [p2] = xp2.projectPatterns();
  assert.equal(p1.patternId, p2.patternId);
  const expected = sha256Hex([...p1.memberEpisodeIds].sort().join("\n"));
  assert.equal(p1.patternId, expected);
});

test("S5: contrary evidence stays attached to the pattern projection", async () => {
  const a = await projectBoundEpisode("cohort-alpha");
  const projector = projectorWith(async ({ observationRef }) => resolutionFor(observationRef));
  const b = await projector.projectObservation({
    observation: observation({ subject: "attempt:subject-2" }),
    findingStatement: FINDING_STATEMENT,
    findingSourceRef: ref("evidence", F),
    impactStatement: "impact: CONTRARY outcome observed here",
    cohortKey: "cohort-alpha",
  });
  const contraryId = feedbackEpisodeIdFor(b.episode);
  const xp = createCrossEpisodeProjector({
    isContrary: (episode) => episode.impact.statement.includes("CONTRARY"),
  });
  xp.ingestEpisode(a.episode);
  xp.ingestEpisode(b.episode);
  const [pattern] = xp.projectPatterns();
  assert.deepEqual(pattern.contraryEvidence, [contraryId]);
  // Contrary evidence remains a member of the pattern.
  assert.ok(pattern.memberEpisodeIds.includes(contraryId));
  assert.equal(pattern.support, 2);
});

test("S5: proposeSystemic throws without mechanism evidence", async () => {
  const { episode } = await projectBoundEpisode("cohort-alpha");
  const xp = createCrossEpisodeProjector();
  xp.ingestEpisode(episode);
  const [pattern] = xp.projectPatterns();
  assert.throws(() => xp.proposeSystemic({ patternId: pattern.patternId }), /mechanism evidence/);
});

test("S5: proposeSystemic throws on frequency alone (support >= 2, no evidence)", async () => {
  const a = await projectBoundEpisode("cohort-alpha");
  const projector = projectorWith(async ({ observationRef }) => resolutionFor(observationRef));
  const b = await projector.projectObservation({
    observation: observation({ subject: "attempt:subject-2" }),
    findingStatement: FINDING_STATEMENT,
    findingSourceRef: ref("evidence", F),
    impactStatement: IMPACT_STATEMENT,
    cohortKey: "cohort-alpha",
  });
  const xp = createCrossEpisodeProjector();
  xp.ingestEpisode(a.episode);
  xp.ingestEpisode(b.episode);
  const [pattern] = xp.projectPatterns();
  assert.equal(pattern.support, 2);
  assert.throws(() => xp.proposeSystemic({ patternId: pattern.patternId }), /mechanism evidence/);
});

test("S5: proposeSystemic throws when mechanism evidence exists but support < 2", async () => {
  const { episode } = await projectBoundEpisode("cohort-alpha");
  const xp = createCrossEpisodeProjector();
  xp.ingestEpisode(episode);
  const [pattern] = xp.projectPatterns();
  xp.attachMechanismEvidence({
    patternId: pattern.patternId,
    evidenceRef: ref("evidence", G),
    statement: "mechanism: shared retry path",
  });
  assert.throws(() => xp.proposeSystemic({ patternId: pattern.patternId }), /support >= 2/);
});

test("S5: proposeSystemic returns a frozen candidate and mutates nothing", async () => {
  const a = await projectBoundEpisode("cohort-alpha");
  const projector = projectorWith(async ({ observationRef }) => resolutionFor(observationRef));
  const b = await projector.projectObservation({
    observation: observation({ subject: "attempt:subject-2" }),
    findingStatement: FINDING_STATEMENT,
    findingSourceRef: ref("evidence", F),
    impactStatement: IMPACT_STATEMENT,
    cohortKey: "cohort-alpha",
  });
  const xp = createCrossEpisodeProjector();
  xp.ingestEpisode(a.episode);
  xp.ingestEpisode(b.episode);
  const before = xp.projectPatterns();
  const [pattern] = before;
  xp.attachMechanismEvidence({
    patternId: pattern.patternId,
    evidenceRef: ref("evidence", G),
    statement: "mechanism: shared retry path",
  });
  const proposal = xp.proposeSystemic({ patternId: pattern.patternId });
  assert.equal(proposal.patternId, pattern.patternId);
  assert.equal(proposal.kind, "SYSTEMIC_PROPOSAL_CANDIDATE");
  assert.equal(proposal.status, "NEEDS_INDEPENDENT_REVIEW");
  assert.ok(Object.isFrozen(proposal));
  for (const forbidden of ["accepted", "promoted", "acceptance", "promotion", "verdict"]) {
    assert.ok(!(forbidden in proposal), `proposal carries forbidden key ${forbidden}`);
  }
  const after = xp.projectPatterns();
  assert.deepEqual(after, xp.projectPatterns());
  assert.equal(after[0].mechanismEvidence.length, 1);
  assert.ok(!("status" in after[0]) || after[0].status === undefined);
});

test("S5: attachMechanismEvidence requires a known patternId", async () => {
  const xp = createCrossEpisodeProjector();
  assert.throws(
    () =>
      xp.attachMechanismEvidence({
        patternId: "nope",
        evidenceRef: ref("evidence", G),
        statement: "mechanism: x",
      }),
    /FEEDBACK_PROJECTION_INVALID/,
  );
});

test("S5: mechanism evidence is visible in projectPatterns output", async () => {
  const { episode } = await projectBoundEpisode("cohort-alpha");
  const xp = createCrossEpisodeProjector();
  xp.ingestEpisode(episode);
  const [pattern] = xp.projectPatterns();
  assert.deepEqual(pattern.mechanismEvidence, []);
  const attached = xp.attachMechanismEvidence({
    patternId: pattern.patternId,
    evidenceRef: ref("evidence", G),
    statement: "mechanism: shared retry path",
  });
  assert.equal(attached.mechanismEvidenceCount, 1);
  const [updated] = xp.projectPatterns();
  assert.equal(updated.mechanismEvidence.length, 1);
  assert.equal(updated.mechanismEvidence[0].statement, "mechanism: shared retry path");
  assert.equal(updated.mechanismEvidence[0].evidenceRef, ref("evidence", G));
});

test("S5: reinforce records evidence without escalating or mutating the pattern", async () => {
  const { episode } = await projectBoundEpisode("cohort-alpha");
  const xp = createCrossEpisodeProjector();
  xp.ingestEpisode(episode);
  const [pattern] = xp.projectPatterns();
  const before = structuredClone(pattern);
  const entry = xp.reinforce({ patternId: pattern.patternId, outcome: "IMPROVED" });
  assert.equal(entry.patternId, pattern.patternId);
  assert.equal(entry.outcome, "IMPROVED");
  assert.ok(typeof entry.at === "string" && Number.isFinite(Date.parse(entry.at)));
  assert.ok(Object.isFrozen(entry));
  const log = xp.reinforcementLog();
  assert.equal(log.length, 1);
  assert.deepEqual(structuredClone(log[0]), structuredClone(entry));
  assert.ok(Object.isFrozen(log));
  // No auto-escalation: proposing still fails and the pattern is untouched.
  assert.throws(() => xp.proposeSystemic({ patternId: pattern.patternId }), /mechanism evidence/);
  const [after] = xp.projectPatterns();
  assert.deepEqual(structuredClone(after), before);
  assert.ok(!("reinforced" in after) && !("escalated" in after));
});

test("S5: reinforce on an unknown patternId throws", () => {
  const xp = createCrossEpisodeProjector();
  assert.throws(
    () => xp.reinforce({ patternId: "nope", outcome: "IMPROVED" }),
    /FEEDBACK_PROJECTION_INVALID/,
  );
});

test("S5: ingestEpisode validates episodes through the contract", () => {
  const xp = createCrossEpisodeProjector();
  assert.throws(() => xp.ingestEpisode({ kind: "NOPE" }), /FEEDBACK_CONTRACT_INVALID/);
});

test("S5: projected episodes validate through defineFeedbackEpisode", async () => {
  const { episode } = await projectBoundEpisode("cohort-alpha");
  assert.doesNotThrow(() => defineFeedbackEpisode(structuredClone(episode)));
});
