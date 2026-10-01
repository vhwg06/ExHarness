import { createHash } from "node:crypto";
import {
  FEEDBACK_CONTEXT_BINDING_KIND,
  FEEDBACK_EPISODE_KIND,
  FeedbackBindingStatus,
  FEEDBACK_UNRESOLVED_REASONS,
  defineFeedbackObservation,
  feedbackObservationIdFor,
  defineFeedbackContextBinding,
  defineFeedbackEpisode,
  feedbackEpisodeIdFor,
} from "./feedback-contracts.js";

// BB-083 S3 + S5 — Observation/context projection and cross-episode
// projection with reinforcement.
//
// S3 (createFeedbackProjector): normalizes a delivered
// FEEDBACK_OBSERVATION_V1 and binds it to an injected Oracle
// ContextResolution. Missing, stale, digest-mismatched or
// subject-mismatched context fails closed to an explicit UNRESOLVED
// binding; the observation is never discarded and no causal truth is
// inferred — finding/impact statements are explicit caller args.
//
// S5 (createCrossEpisodeProjector): deterministic cross-episode
// projection. Episodes deduplicate by deterministic id, group ONLY on
// explicit cohortKey, retain contrary evidence, require explicit
// mechanism evidence before any SYSTEMIC proposal, and record
// reinforcement without auto-escalation.

function fail(message) {
  throw new TypeError(`FEEDBACK_PROJECTION_INVALID: ${message}`);
}

function reqText(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) fail(`${label} must be a non-empty string`);
  return value;
}

const HEX64 = /^[a-f0-9]{64}$/;
const REF_PATTERN = /^[A-Za-z0-9_.-]+:sha256:[a-f0-9]{64}$/;

function reqRef(value, label) {
  const text = reqText(value, label);
  if (!REF_PATTERN.test(text)) fail(`${label} must be a content-addressed ref (<kind>:sha256:<hex>)`);
  return text;
}

function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function sha256Hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// S3 — Observation/context projection
// ---------------------------------------------------------------------------

function unresolvedBinding(observationRef, reason) {
  if (!FEEDBACK_UNRESOLVED_REASONS.includes(reason)) {
    fail(`unresolved reason must be one of ${FEEDBACK_UNRESOLVED_REASONS.join(", ")}`);
  }
  const binding = defineFeedbackContextBinding({
    kind: FEEDBACK_CONTEXT_BINDING_KIND,
    version: 1,
    observationRef,
    status: FeedbackBindingStatus.UNRESOLVED,
    unresolvedReason: reason,
  });
  return { binding, reason };
}

// Fail-closed evaluation of an injected Oracle ContextResolution-like
// { ref, digest, currentness, sourceObservationRef } against the exact
// observation identity. Never throws away the observation: every
// failure mode returns an explicit UNRESOLVED binding with a typed
// reason.
function evaluateResolution(observationRef, resolution) {
  if (resolution === null || resolution === undefined) {
    return unresolvedBinding(observationRef, "MISSING_CONTEXT");
  }
  if (typeof resolution !== "object" || Array.isArray(resolution)) {
    return unresolvedBinding(observationRef, "MISSING_CONTEXT");
  }
  const { ref, digest, currentness, sourceObservationRef } = resolution;
  if (
    typeof ref !== "string" ||
    typeof digest !== "string" ||
    typeof currentness !== "string" ||
    typeof sourceObservationRef !== "string"
  ) {
    return unresolvedBinding(observationRef, "MISSING_CONTEXT");
  }
  if (currentness !== "CURRENT") {
    return unresolvedBinding(observationRef, "STALE_CONTEXT");
  }
  if (!REF_PATTERN.test(ref) || !HEX64.test(digest) || ref.slice(-64) !== digest) {
    return unresolvedBinding(observationRef, "RESOLUTION_DIGEST_MISMATCH");
  }
  if (sourceObservationRef !== observationRef) {
    return unresolvedBinding(observationRef, "SOURCE_OBSERVATION_MISMATCH");
  }
  const binding = defineFeedbackContextBinding({
    kind: FEEDBACK_CONTEXT_BINDING_KIND,
    version: 1,
    observationRef,
    status: FeedbackBindingStatus.BOUND,
    resolution: { ref, digest, currentness, sourceObservationRef },
  });
  return { binding, reason: null };
}

export function createFeedbackProjector({ resolveContext } = {}) {
  if (typeof resolveContext !== "function") {
    fail("createFeedbackProjector requires an injected resolveContext function");
  }

  // Projects one observation. When contextResolution is undefined the
  // injected resolveContext({ observationRef }) seam is used to obtain
  // it; the projector never calls Oracle directly. An explicit null
  // never touches the seam and fails closed to MISSING_CONTEXT.
  //
  // Returns { episode } on a BOUND context or
  // { unresolved: { binding, reason } } otherwise. findingStatement,
  // findingSourceRef and impactStatement are explicit caller args: the
  // projector never infers causal truth from provider prose.
  async function projectObservation({
    observation,
    contextResolution,
    findingStatement,
    findingSourceRef,
    impactStatement,
    cohortKey = null,
  } = {}) {
    const observed = defineFeedbackObservation(observation);
    const observationRef = feedbackObservationIdFor(observed);
    let resolution = contextResolution;
    if (resolution === undefined) {
      resolution = await resolveContext({ observationRef });
    }
    const { binding, reason } = evaluateResolution(observationRef, resolution);
    if (binding.status === FeedbackBindingStatus.UNRESOLVED) {
      return freeze({ unresolved: freeze({ binding, reason }) });
    }
    const statement = reqText(findingStatement, "findingStatement");
    const sourceRef = reqRef(findingSourceRef, "findingSourceRef");
    const impact = reqText(impactStatement, "impactStatement");
    let key = null;
    if (cohortKey !== undefined && cohortKey !== null) {
      key = reqText(cohortKey, "cohortKey");
    }
    const episode = defineFeedbackEpisode({
      kind: FEEDBACK_EPISODE_KIND,
      version: 1,
      observationRef,
      contextBinding: binding,
      finding: { statement, sourceRef },
      impact: { statement: impact },
      cohortKey: key,
    });
    return freeze({ episode });
  }

  return freeze({ projectObservation });
}

// ---------------------------------------------------------------------------
// S5 — Cross-episode projection and reinforcement
// ---------------------------------------------------------------------------

const SYSTEMIC_PROPOSAL_KIND = "SYSTEMIC_PROPOSAL_CANDIDATE";
const SYSTEMIC_PROPOSAL_STATUS = "NEEDS_INDEPENDENT_REVIEW";

export function createCrossEpisodeProjector({ isContrary } = {}) {
  const contraryPredicate = isContrary === undefined ? () => false : isContrary;
  if (typeof contraryPredicate !== "function") fail("isContrary must be a function");

  const episodes = new Map(); // episodeId -> frozen FeedbackEpisode
  const mechanismEvidence = new Map(); // patternId -> [frozen evidence entries]
  const reinforcementLog = [];

  function ingestEpisode(episode) {
    const parsed = defineFeedbackEpisode(episode);
    const episodeId = feedbackEpisodeIdFor(parsed);
    if (episodes.has(episodeId)) {
      return freeze({ deduplicated: true, episodeId });
    }
    episodes.set(episodeId, parsed);
    return freeze({ deduplicated: false, episodeId });
  }

  function majorityImpact(memberIds) {
    const counts = new Map();
    for (const id of memberIds) {
      const statement = episodes.get(id).impact.statement;
      counts.set(statement, (counts.get(statement) ?? 0) + 1);
    }
    let best = null;
    for (const [statement, count] of counts) {
      if (best === null || count > best.count || (count === best.count && statement < best.statement)) {
        best = { statement, count };
      }
    }
    return best === null ? null : best.statement;
  }

  // Deterministic pattern computation. Grouping happens ONLY on an
  // explicit episode.cohortKey; episodes with a null cohortKey are
  // never grouped and each forms its own singleton pattern.
  function computePatterns() {
    const groups = new Map(); // groupKey -> { cohortKey, memberIds }
    for (const [id, episode] of episodes) {
      const key = episode.cohortKey === null ? `singleton:${id}` : `cohort:${episode.cohortKey}`;
      let group = groups.get(key);
      if (!group) {
        group = { cohortKey: episode.cohortKey, memberIds: [] };
        groups.set(key, group);
      }
      group.memberIds.push(id);
    }
    const patterns = [];
    for (const group of groups.values()) {
      const memberEpisodeIds = [...group.memberIds].sort();
      const patternId = sha256Hex(memberEpisodeIds.join("\n"));
      const hint = freeze({
        cohortKey: group.cohortKey,
        memberCount: memberEpisodeIds.length,
        majorityImpact: majorityImpact(memberEpisodeIds),
      });
      const contraryEvidence = memberEpisodeIds.filter((id) =>
        contraryPredicate(episodes.get(id), hint),
      );
      patterns.push({
        patternId,
        cohortKey: group.cohortKey,
        memberEpisodeIds,
        support: memberEpisodeIds.length,
        contraryEvidence,
        mechanismEvidence: [...(mechanismEvidence.get(patternId) ?? [])],
      });
    }
    patterns.sort((a, b) => (a.patternId < b.patternId ? -1 : a.patternId > b.patternId ? 1 : 0));
    return patterns;
  }

  function findPattern(patternId) {
    const wanted = reqText(patternId, "patternId");
    const found = computePatterns().find((p) => p.patternId === wanted);
    if (!found) fail(`unknown patternId: ${wanted}`);
    return found;
  }

  function projectPatterns() {
    return freeze(computePatterns().map((p) => freeze({ ...p, memberEpisodeIds: freeze([...p.memberEpisodeIds]), contraryEvidence: freeze([...p.contraryEvidence]), mechanismEvidence: freeze([...p.mechanismEvidence]) })));
  }

  // Explicit mechanism evidence is required before any SYSTEMIC
  // proposal. Evidence is attached per pattern and is visible in
  // subsequent projectPatterns() output.
  function attachMechanismEvidence({ patternId, evidenceRef, statement } = {}) {
    const pattern = findPattern(patternId);
    const entry = freeze({
      patternId: pattern.patternId,
      evidenceRef: reqRef(evidenceRef, "evidenceRef"),
      statement: reqText(statement, "statement"),
    });
    const list = mechanismEvidence.get(pattern.patternId) ?? [];
    list.push(entry);
    mechanismEvidence.set(pattern.patternId, list);
    return freeze({ patternId: pattern.patternId, evidence: entry, mechanismEvidenceCount: list.length });
  }

  // A SYSTEMIC proposal is a candidate for independent review only:
  // it carries no acceptance/promotion authority and never mutates
  // pattern state. Frequency alone (support >= 2 without mechanism
  // evidence) is insufficient.
  function proposeSystemic({ patternId } = {}) {
    const pattern = findPattern(patternId);
    if (pattern.mechanismEvidence.length < 1) {
      fail("SYSTEMIC proposal requires explicit mechanism evidence (frequency alone is insufficient)");
    }
    if (pattern.support < 2) {
      fail("SYSTEMIC proposal requires support >= 2");
    }
    return freeze({
      patternId: pattern.patternId,
      kind: SYSTEMIC_PROPOSAL_KIND,
      status: SYSTEMIC_PROPOSAL_STATUS,
    });
  }

  // Positive reinforcement records evidence only. It never
  // auto-escalates: it never calls proposeSystemic and never mutates
  // pattern status.
  function reinforce({ patternId, outcome } = {}) {
    const pattern = findPattern(patternId);
    const entry = freeze({
      patternId: pattern.patternId,
      outcome: reqText(outcome, "outcome"),
      at: new Date().toISOString(),
    });
    reinforcementLog.push(entry);
    return entry;
  }

  function getReinforcementLog() {
    return freeze([...reinforcementLog]);
  }

  return freeze({
    ingestEpisode,
    projectPatterns,
    attachMechanismEvidence,
    proposeSystemic,
    reinforce,
    reinforcementLog: getReinforcementLog,
  });
}
