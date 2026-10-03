// BB-086 I2 — Deterministic, read-only cross-episode pattern projection (D2-D6).
//
// projectImprovementPatterns projects FEEDBACK_RESOLUTION_V1 refs into
// IMPROVEMENT_PATTERN_PROJECTION_V1: grouped (cohortKey, findingKind, howAxis)
// patterns with support-unit dedup, retained outcome counts and contrary
// evidence, and mechanism-gated SYSTEMIC classification.
//
// Pure function: no I/O, no writes, no mutation of any response / acceptance /
// promotion / policy state. The module exposes no write port — its export
// surface is exactly ['PATTERN_POLICY_V1', 'projectImprovementPatterns'].
import { createHash } from "node:crypto";
import { defineFeedbackResolution } from "./feedback-lifecycle-contracts.js";

// PATTERN_POLICY_V1: findingKind -> HOW axis mapping.
//
// Unmapped finding kinds are EXCLUDED from projection with reason
// UNMAPPED_AXIS. An unmapped kind is never assigned a guessed HOW axis:
// inventing an axis from frequency or text similarity would corrupt the
// downstream HOW-improvement proposal eligibility gate (D7/SI2).
export const PATTERN_POLICY_V1 = Object.freeze({
  version: 1,
  minSupport: 2,
  findingKindToHowAxis: Object.freeze({
    MISSING_EVIDENCE: "evidence",
    STALE_CONTEXT: "context",
    WEAK_ACCEPTANCE: "acceptance",
    FLAKY_VERIFICATION: "verification",
  }),
});

function sha256Hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

// canonicalize: JSON.stringify with recursively sorted object keys so that
// digest inputs are stable regardless of insertion order.
function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  if (Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

const KNOWN_OUTCOMES = Object.freeze(["IMPROVED", "NO_CHANGE", "REGRESSED", "REJECTED_ACKNOWLEDGED"]);

function normalizeFindingKind(raw) {
  if (typeof raw === "string" && raw.trim().length > 0) return raw.trim().toUpperCase();
  return null;
}

// A support unit is the sorted set of observation refs behind an episode's
// GroundedFindingInputs. Retried or duplicated episodes share the unit and
// count once (D4, invariant INV-2).
function supportUnitOf(episode) {
  const inputs = Array.isArray(episode?.groundedInputRefs) ? episode.groundedInputRefs : [];
  const refs = [];
  for (const pin of inputs) {
    if (pin && typeof pin.ref === "string" && pin.ref.trim().length > 0) refs.push(pin.ref);
  }
  refs.sort();
  return [...new Set(refs)];
}

function episodePin(ref, digest) {
  return { ref, digest };
}

export function projectImprovementPatterns({
  resolutions,
  resolveArtifact,
  policy = PATTERN_POLICY_V1,
  supersededBy,
  mechanismEvidence,
}) {
  if (!Array.isArray(resolutions)) throw new TypeError("resolutions must be an array");
  if (typeof resolveArtifact !== "function") throw new TypeError("resolveArtifact must be a function");

  const inputRefs = [];
  for (const item of resolutions) {
    if (item && typeof item.ref === "string") inputRefs.push(item.ref);
  }
  const sortedInputRefs = [...new Set(inputRefs)].sort();

  const exclusions = []; // { ref, reason }
  const accepted = []; // accepted (ref, resolution artifact, episode artifact, unitKey, episodeRef)

  for (const item of resolutions) {
    const ref = item?.ref;
    const digest = item?.digest;
    const exclude = (reason) => exclusions.push({ ref: typeof ref === "string" ? ref : null, reason });

    let resolutionArtifact;
    try {
      resolutionArtifact = resolveArtifact(ref, digest);
    } catch {
      exclude("DIGEST_MISMATCH");
      continue;
    }
    if (!resolutionArtifact) {
      exclude("DIGEST_MISMATCH");
      continue;
    }
    if (supersededBy instanceof Map && supersededBy.has(ref)) {
      exclude("SUPERSEDED");
      continue;
    }
    let resolution;
    try {
      resolution = defineFeedbackResolution(resolutionArtifact);
    } catch {
      exclude("INVALID_RESOLUTION");
      continue;
    }
    if (resolution.kind !== "FEEDBACK_RESOLUTION_V1") {
      exclude("WRONG_KIND");
      continue;
    }

    let episode;
    try {
      episode = resolveArtifact(resolution.episodeRef, resolution.episodeDigest);
    } catch {
      exclude("EPISODE_DIGEST_MISMATCH");
      continue;
    }
    if (!episode) {
      exclude("EPISODE_DIGEST_MISMATCH");
      continue;
    }

    const findingKind = normalizeFindingKind(episode?.finding?.kind);
    const howAxis = findingKind ? policy?.findingKindToHowAxis?.[findingKind] : undefined;
    if (!findingKind || typeof howAxis !== "string") {
      exclude("UNMAPPED_AXIS");
      continue;
    }

    // cohortKey comes from the episode scopeKey; the documented fallback is
    // the episodeRef itself when the episode artifact lacks scopeKey.
    const cohortKey =
      typeof episode.scopeKey === "string" && episode.scopeKey.length > 0
        ? episode.scopeKey
        : resolution.episodeRef;

    let unit = supportUnitOf(episode);
    if (unit.length === 0) unit = [resolution.episodeRef]; // documented fallback
    const unitKey = sha256Hex(canonicalize(unit));

    const patternKey = sha256Hex(canonicalize({ cohortKey, findingKind, howAxis }));

    const contraryRefs = Array.isArray(episode.contraryEvidenceRefs) ? episode.contraryEvidenceRefs : [];
    accepted.push({ ref, digest, resolution, episode, cohortKey, findingKind, howAxis, patternKey, unit, unitKey, contraryRefs });
  }

  // Group by patternKey; dedup by unitKey within a group.
  const groups = new Map(); // patternKey -> group
  for (const a of accepted) {
    let group = groups.get(a.patternKey);
    if (!group) {
      group = {
        patternKey: a.patternKey,
        cohortKey: a.cohortKey,
        findingKind: a.findingKind,
        howAxis: a.howAxis,
        units: new Map(), // unitKey -> { unit, episodeRefs: Set }
        resolutionByEpisode: new Map(), // episodeRef -> resolution value (one per unit)
      };
      groups.set(a.patternKey, group);
    }
    let unitEntry = group.units.get(a.unitKey);
    if (!unitEntry) {
      unitEntry = { unit: a.unit, episodeRefs: new Set() };
      group.units.set(a.unitKey, unitEntry);
      group.resolutionByEpisode.set(a.resolution.episodeRef, a.resolution.resolution);
    }
    unitEntry.episodeRefs.add(a.resolution.episodeRef);
  }

  // Resolve mechanism evidence (optional). Only valid { ref, digest,
  // coveredEpisodeRefs } pins are usable; unresolvable entries are ignored
  // (never fabricated). SYSTEMIC requires coverage of EVERY supporting
  // episode — frequency alone never classifies SYSTEMIC (D5, INV-2).
  const resolvedMechanism = [];
  if (Array.isArray(mechanismEvidence)) {
    for (const m of mechanismEvidence) {
      if (!m || typeof m.ref !== "string" || typeof m.digest !== "string" || !Array.isArray(m.coveredEpisodeRefs)) continue;
      let artifact;
      try {
        artifact = resolveArtifact(m.ref, m.digest);
      } catch {
        continue;
      }
      if (!artifact) continue;
      resolvedMechanism.push({ ref: m.ref, digest: m.digest, coveredEpisodeRefs: m.coveredEpisodeRefs.filter((r) => typeof r === "string") });
    }
  }
  const coveredByMechanism = new Set();
  for (const m of resolvedMechanism) for (const r of m.coveredEpisodeRefs) coveredByMechanism.add(r);

  const patterns = [];
  const orderedGroups = [...groups.values()].sort((x, y) => (x.patternKey < y.patternKey ? -1 : x.patternKey > y.patternKey ? 1 : 0));
  for (const group of orderedGroups) {
    const outcomeCounts = { IMPROVED: 0, NO_CHANGE: 0, REGRESSED: 0, REJECTED_ACKNOWLEDGED: 0 };
    for (const value of group.resolutionByEpisode.values()) {
      if (KNOWN_OUTCOMES.includes(value)) outcomeCounts[value] += 1;
    }

    const contraryMap = new Map(); // ref -> digest
    const supportingEpisodeRefs = new Set();
    for (const unitEntry of group.units.values()) {
      for (const episodeRef of unitEntry.episodeRefs) supportingEpisodeRefs.add(episodeRef);
    }
    for (const a of accepted) {
      if (a.patternKey !== group.patternKey) continue;
      for (const pin of a.contraryRefs) {
        if (pin && typeof pin.ref === "string" && !contraryMap.has(pin.ref)) {
          contraryMap.set(pin.ref, typeof pin.digest === "string" ? pin.digest : null);
        }
      }
    }
    // NO_CHANGE and REGRESSED episodes remain in contrary evidence (D4).
    for (const a of accepted) {
      if (a.patternKey !== group.patternKey) continue;
      if (a.resolution.resolution === "NO_CHANGE" || a.resolution.resolution === "REGRESSED") {
        if (!contraryMap.has(a.resolution.episodeRef)) {
          contraryMap.set(a.resolution.episodeRef, a.resolution.episodeDigest ?? null);
        }
      }
    }
    const contraryEvidenceRefs = [...contraryMap.entries()]
      .sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0))
      .map(([ref, digest]) => ({ ref, digest }));

    const distinctUnits = group.units.size;
    const minSupport = typeof policy?.minSupport === "number" ? policy.minSupport : 2;
    let classification = "INSTANCE";
    if (distinctUnits >= minSupport) {
      classification = "RECURRING";
      const allCovered = resolvedMechanism.length > 0 && [...supportingEpisodeRefs].every((r) => coveredByMechanism.has(r));
      if (allCovered) classification = "SYSTEMIC";
    }

    patterns.push({
      patternKey: group.patternKey,
      cohortKey: group.cohortKey,
      findingKind: group.findingKind,
      howAxis: group.howAxis,
      classification,
      supportUnits: distinctUnits,
      supportingEpisodeRefs: [...supportingEpisodeRefs].sort(),
      outcomeCounts,
      contraryEvidenceRefs,
      mechanismEvidence: resolvedMechanism.map((m) => ({ ref: m.ref, digest: m.digest })),
    });
  }

  const policyDigest = sha256Hex(canonicalize(policy));
  const projectionId = sha256Hex(canonicalize({ policyDigest, inputRefs: sortedInputRefs }));

  return deepFreeze({
    kind: "IMPROVEMENT_PATTERN_PROJECTION_V1",
    version: 1,
    projectionId,
    policyDigest,
    inputResolutionRefs: sortedInputRefs,
    patterns,
    exclusions,
  });
}
