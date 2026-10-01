import { createHash } from "node:crypto";

// BB-083 S2 — Typed feedback lifecycle contracts.
//
// Immutable value contracts for the application-owned feedback loop:
// Observation -> ContextBinding -> FeedbackEpisode -> FeedbackResponse ->
// FeedbackOutcome, plus the HOW_IMPROVEMENT_PROPOSAL_V1 envelope for the
// independent improvement handoff.
//
// Authority rules (hard):
// - Only an application-owned principal may create or revise a
//   FeedbackResponse. Observer, evaluator, provider payload, GEPA output or
//   model-generated rationale can never supply the application principal.
// - Contracts bind exact ref+digest identities. Missing digests, mismatched
//   subjects, forged provider identities or unresolved Oracle context are
//   rejected or remain explicitly unresolved; they never become grounded
//   causal findings.
// - Uncertainty is explicit. Missing fresh outcome evidence is UNKNOWN,
//   never IMPROVED.
// - A HOW_IMPROVEMENT_PROPOSAL_V1 is never accepted or promoted by BB-083;
//   it crosses to the independent BB-059 evaluation/promotion authority.

export const FEEDBACK_OBSERVATION_KIND = "FEEDBACK_OBSERVATION_V1";
export const FEEDBACK_OBSERVATION_VERSION = 1;
export const FEEDBACK_CONTEXT_BINDING_KIND = "FEEDBACK_CONTEXT_BINDING_V1";
export const FEEDBACK_CONTEXT_BINDING_VERSION = 1;
export const FEEDBACK_EPISODE_KIND = "FEEDBACK_EPISODE_V1";
export const FEEDBACK_EPISODE_VERSION = 1;
export const FEEDBACK_RESPONSE_KIND = "FEEDBACK_RESPONSE_V1";
export const FEEDBACK_RESPONSE_VERSION = 1;
export const FEEDBACK_OUTCOME_KIND = "FEEDBACK_OUTCOME_V1";
export const FEEDBACK_OUTCOME_VERSION = 1;
export const HOW_IMPROVEMENT_PROPOSAL_KIND = "HOW_IMPROVEMENT_PROPOSAL_V1";
export const HOW_IMPROVEMENT_PROPOSAL_VERSION = 1;

export const FeedbackDisposition = Object.freeze({
  ACTED: "ACTED",
  REJECTED: "REJECTED",
  DEFERRED: "DEFERRED",
  SUPERSEDED: "SUPERSEDED",
});

export const FeedbackOutcomeValue = Object.freeze({
  IMPROVED: "IMPROVED",
  NO_CHANGE: "NO_CHANGE",
  REGRESSED: "REGRESSED",
  UNKNOWN: "UNKNOWN",
});

export const FeedbackBindingStatus = Object.freeze({
  BOUND: "BOUND",
  UNRESOLVED: "UNRESOLVED",
});

export const FEEDBACK_UNRESOLVED_REASONS = Object.freeze([
  "MISSING_CONTEXT",
  "STALE_CONTEXT",
  "AMBIGUOUS_CONTEXT",
  "RESOLUTION_DIGEST_MISMATCH",
  "SOURCE_OBSERVATION_MISMATCH",
]);

export const FEEDBACK_PROPOSAL_STATUS = Object.freeze({
  PROPOSED: "PROPOSED",
});

// Principals that are never the application principal. Any attempt to use
// one of these roles as the response principal is rejected.
const NON_APPLICATION_PRINCIPAL_ROLES = Object.freeze([
  "observer",
  "evaluator",
  "provider",
  "gepa",
  "model",
]);

const HEX64 = /^[a-f0-9]{64}$/;
const REF_PATTERN = /^[A-Za-z0-9_.-]+:sha256:[a-f0-9]{64}$/;

function fail(message) {
  throw new TypeError(`FEEDBACK_CONTRACT_INVALID: ${message}`);
}
function reqText(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) fail(`${label} must be a non-empty string`);
  return value;
}
function reqHex(value, label) {
  reqText(value, label);
  if (!HEX64.test(value)) fail(`${label} must be sha256 hex`);
  return value;
}
function reqRef(value, label) {
  reqText(value, label);
  if (!REF_PATTERN.test(value)) fail(`${label} must be a content-addressed ref (<kind>:sha256:<hex>)`);
  return value;
}
function reqArray(value, label) {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  return value;
}
function reqObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    fail(`${label} must be a plain object`);
  }
  return value;
}
function reqEnum(value, allowed, label) {
  if (!Object.values(allowed).includes(value)) {
    fail(`${label} must be one of ${Object.values(allowed).join(", ")}`);
  }
  return value;
}
function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function canonicalString(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalString).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalString(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
function sha256Hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
function jsonSafe(value, label, seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "object" || seen.has(value)) fail(`${label} must be JSON-safe`);
  seen.add(value);
  let out;
  if (Array.isArray(value)) out = value.map((v, i) => jsonSafe(v, `${label}[${i}]`, seen));
  else {
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
      fail(`${label} must be JSON-safe`);
    }
    out = {};
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") fail(`${label} keys must be strings`);
      out[key] = jsonSafe(value[key], `${label}.${key}`, seen);
    }
  }
  seen.delete(value);
  return out;
}

// A source identity binds an exact content-addressed ref and its digest.
// Both must be present; a ref without a digest is not an identity.
export function defineSourceIdentity(raw) {
  const v = reqObject(raw, "source");
  const ref = reqRef(v.ref, "source.ref");
  const digest = reqHex(v.digest, "source.digest");
  const refDigest = ref.slice(-64);
  if (refDigest !== digest) fail("source.ref digest must equal source.digest");
  return freeze({ ref, digest });
}

// An application principal is an explicit application-owned identity.
// Observer / evaluator / provider / GEPA / model roles are rejected.
export function defineApplicationPrincipal(raw) {
  const v = reqObject(raw, "principal");
  const id = reqText(v.id, "principal.id");
  const role = reqText(v.role, "principal.role").toLowerCase();
  if (NON_APPLICATION_PRINCIPAL_ROLES.includes(role)) {
    fail(`principal role '${v.role}' cannot act as the application principal`);
  }
  if (role !== "application") fail("principal.role must be 'application'");
  return freeze({ id, role: "application" });
}

// Observation: delivered observation/event evidence. Never infers causal
// truth from provider prose; provenance and uncertainty are explicit.
export function defineFeedbackObservation(raw) {
  const v = reqObject(raw, "observation");
  if (v.kind !== FEEDBACK_OBSERVATION_KIND) fail(`observation.kind must be ${FEEDBACK_OBSERVATION_KIND}`);
  if (v.version !== FEEDBACK_OBSERVATION_VERSION) fail(`observation.version must be ${FEEDBACK_OBSERVATION_VERSION}`);
  const source = defineSourceIdentity(v.source);
  const subject = reqText(v.subject, "observation.subject");
  const evidence = jsonSafe(reqObject(v.evidence, "observation.evidence"), "observation.evidence");
  const provenance = reqObject(v.provenance, "observation.provenance");
  const observer = reqText(provenance.observer, "observation.provenance.observer");
  const observedAt = reqText(provenance.observedAt, "observation.provenance.observedAt");
  // Uncertainty is explicit and required; absence is not certainty.
  const uncertainty = reqText(v.uncertainty, "observation.uncertainty");
  const out = {
    kind: FEEDBACK_OBSERVATION_KIND,
    version: FEEDBACK_OBSERVATION_VERSION,
    source,
    subject,
    evidence,
    provenance: freeze({ observer, observedAt }),
    uncertainty,
  };
  return freeze(out);
}

export function feedbackObservationIdFor(observation) {
  const o = defineFeedbackObservation(observation);
  return `${FEEDBACK_OBSERVATION_KIND}:sha256:${sha256Hex(canonicalString(o))}`;
}

// ContextBinding: binds an observation to an exact Oracle ContextResolution
// identity. Missing or stale context is UNRESOLVED with an explicit reason;
// derived data can never self-certify CURRENT.
export function defineFeedbackContextBinding(raw) {
  const v = reqObject(raw, "contextBinding");
  if (v.kind !== FEEDBACK_CONTEXT_BINDING_KIND) fail(`contextBinding.kind must be ${FEEDBACK_CONTEXT_BINDING_KIND}`);
  if (v.version !== FEEDBACK_CONTEXT_BINDING_VERSION) {
    fail(`contextBinding.version must be ${FEEDBACK_CONTEXT_BINDING_VERSION}`);
  }
  const observationRef = reqRef(v.observationRef, "contextBinding.observationRef");
  const status = reqEnum(v.status, FeedbackBindingStatus, "contextBinding.status");
  if (status === FeedbackBindingStatus.BOUND) {
    const resolution = reqObject(v.resolution, "contextBinding.resolution");
    const resolutionRef = reqRef(resolution.ref, "contextBinding.resolution.ref");
    const resolutionDigest = reqHex(resolution.digest, "contextBinding.resolution.digest");
    if (resolutionRef.slice(-64) !== resolutionDigest) {
      fail("contextBinding.resolution.ref digest must equal contextBinding.resolution.digest");
    }
    const currentness = reqText(resolution.currentness, "contextBinding.resolution.currentness");
    if (currentness !== "CURRENT") fail("contextBinding.resolution.currentness must be CURRENT to bind");
    const sourceObservationRef = reqRef(
      resolution.sourceObservationRef,
      "contextBinding.resolution.sourceObservationRef",
    );
    if (sourceObservationRef !== observationRef) {
      fail("contextBinding.resolution.sourceObservationRef must equal contextBinding.observationRef");
    }
    return freeze({
      kind: FEEDBACK_CONTEXT_BINDING_KIND,
      version: FEEDBACK_CONTEXT_BINDING_VERSION,
      observationRef,
      status,
      resolution: freeze({
        ref: resolutionRef,
        digest: resolutionDigest,
        currentness,
        sourceObservationRef,
      }),
    });
  }
  const unresolvedReason = reqText(v.unresolvedReason, "contextBinding.unresolvedReason");
  if (!FEEDBACK_UNRESOLVED_REASONS.includes(unresolvedReason)) {
    fail(`contextBinding.unresolvedReason must be one of ${FEEDBACK_UNRESOLVED_REASONS.join(", ")}`);
  }
  return freeze({
    kind: FEEDBACK_CONTEXT_BINDING_KIND,
    version: FEEDBACK_CONTEXT_BINDING_VERSION,
    observationRef,
    status,
    unresolvedReason,
  });
}

export function feedbackContextBindingIdFor(binding) {
  const b = defineFeedbackContextBinding(binding);
  return `${FEEDBACK_CONTEXT_BINDING_KIND}:sha256:${sha256Hex(canonicalString(b))}`;
}

// FeedbackEpisode: a finding/impact record over one bound observation.
// The finding binds exact source/attempt/candidate and Oracle resolution
// identities. Missing/stale context stays unresolved; no causal truth is
// invented.
export function defineFeedbackEpisode(raw) {
  const v = reqObject(raw, "episode");
  if (v.kind !== FEEDBACK_EPISODE_KIND) fail(`episode.kind must be ${FEEDBACK_EPISODE_KIND}`);
  if (v.version !== FEEDBACK_EPISODE_VERSION) fail(`episode.version must be ${FEEDBACK_EPISODE_VERSION}`);
  const observationRef = reqRef(v.observationRef, "episode.observationRef");
  const contextBinding = defineFeedbackContextBinding(v.contextBinding);
  if (contextBinding.observationRef !== observationRef) {
    fail("episode.contextBinding.observationRef must equal episode.observationRef");
  }
  if (contextBinding.status !== FeedbackBindingStatus.BOUND) {
    fail("episode requires a BOUND contextBinding; unresolved context cannot ground a finding");
  }
  const finding = reqObject(v.finding, "episode.finding");
  const statement = reqText(finding.statement, "episode.finding.statement");
  const sourceRef = reqRef(finding.sourceRef, "episode.finding.sourceRef");
  const impact = reqObject(v.impact, "episode.impact");
  const impactStatement = reqText(impact.statement, "episode.impact.statement");
  // Optional explicit cohort key. Grouping without an explicit key is
  // forbidden downstream; absence here is not an implicit cohort.
  let cohortKey = null;
  if (v.cohortKey !== undefined && v.cohortKey !== null) {
    cohortKey = reqText(v.cohortKey, "episode.cohortKey");
  }
  const out = {
    kind: FEEDBACK_EPISODE_KIND,
    version: FEEDBACK_EPISODE_VERSION,
    observationRef,
    contextBinding,
    finding: freeze({ statement, sourceRef }),
    impact: freeze({ statement: impactStatement }),
    cohortKey,
  };
  return freeze(out);
}

// Deterministic episode identity for cross-episode deduplication.
export function feedbackEpisodeIdFor(episode) {
  const e = defineFeedbackEpisode(episode);
  return `${FEEDBACK_EPISODE_KIND}:sha256:${sha256Hex(canonicalString(e))}`;
}

// FeedbackResponse: application-owned disposition over an episode.
// Only the application principal may create or revise it.
export function defineFeedbackResponse(raw) {
  const v = reqObject(raw, "response");
  if (v.kind !== FEEDBACK_RESPONSE_KIND) fail(`response.kind must be ${FEEDBACK_RESPONSE_KIND}`);
  if (v.version !== FEEDBACK_RESPONSE_VERSION) fail(`response.version must be ${FEEDBACK_RESPONSE_VERSION}`);
  const episodeRef = reqRef(v.episodeRef, "response.episodeRef");
  const principal = defineApplicationPrincipal(v.principal);
  const disposition = reqEnum(v.disposition, FeedbackDisposition, "response.disposition");
  const revision = v.revision;
  if (!Number.isInteger(revision) || revision < 1) fail("response.revision must be a positive integer");
  const rationale = reqText(v.rationale, "response.rationale");
  return freeze({
    kind: FEEDBACK_RESPONSE_KIND,
    version: FEEDBACK_RESPONSE_VERSION,
    episodeRef,
    principal,
    disposition,
    revision,
    rationale,
  });
}

export function feedbackResponseIdFor(response) {
  const r = defineFeedbackResponse(response);
  return `${FEEDBACK_RESPONSE_KIND}:sha256:${sha256Hex(canonicalString(r))}`;
}

// FeedbackOutcome: fresh outcome evidence bound to a response.
// Missing fresh evidence is UNKNOWN, never IMPROVED.
export function defineFeedbackOutcome(raw) {
  const v = reqObject(raw, "outcome");
  if (v.kind !== FEEDBACK_OUTCOME_KIND) fail(`outcome.kind must be ${FEEDBACK_OUTCOME_KIND}`);
  if (v.version !== FEEDBACK_OUTCOME_VERSION) fail(`outcome.version must be ${FEEDBACK_OUTCOME_VERSION}`);
  const responseRef = reqRef(v.responseRef, "outcome.responseRef");
  const outcome = reqEnum(v.outcome, FeedbackOutcomeValue, "outcome.outcome");
  let evidenceRef = null;
  if (outcome !== FeedbackOutcomeValue.UNKNOWN) {
    evidenceRef = reqRef(v.evidenceRef, "outcome.evidenceRef");
  } else if (v.evidenceRef !== undefined && v.evidenceRef !== null) {
    evidenceRef = reqRef(v.evidenceRef, "outcome.evidenceRef");
  }
  const measuredAt = reqText(v.measuredAt, "outcome.measuredAt");
  return freeze({
    kind: FEEDBACK_OUTCOME_KIND,
    version: FEEDBACK_OUTCOME_VERSION,
    responseRef,
    outcome,
    evidenceRef,
    measuredAt,
  });
}

export function feedbackOutcomeIdFor(outcome) {
  const o = defineFeedbackOutcome(outcome);
  return `${FEEDBACK_OUTCOME_KIND}:sha256:${sha256Hex(canonicalString(o))}`;
}

// HOW_IMPROVEMENT_PROPOSAL_V1: the independent improvement handoff envelope.
// Frozen subject, optimizer identity, partitions, metric-policy ref+digest
// and minEffect. Never carries accepted/promoted flags and never sees the
// final holdout. GEPA output is normalized to this envelope only.
export function defineHowImprovementProposal(raw) {
  const v = reqObject(raw, "proposal");
  if (v.kind !== HOW_IMPROVEMENT_PROPOSAL_KIND) fail(`proposal.kind must be ${HOW_IMPROVEMENT_PROPOSAL_KIND}`);
  if (v.version !== HOW_IMPROVEMENT_PROPOSAL_VERSION) {
    fail(`proposal.version must be ${HOW_IMPROVEMENT_PROPOSAL_VERSION}`);
  }
  const howSubject = defineSourceIdentity(v.howSubject);
  const optimizerIdentity = reqObject(v.optimizerIdentity, "proposal.optimizerIdentity");
  const optimizerName = reqText(optimizerIdentity.name, "proposal.optimizerIdentity.name");
  const optimizerRef = reqRef(optimizerIdentity.ref, "proposal.optimizerIdentity.ref");
  const partitions = reqObject(v.partitions, "proposal.partitions");
  const development = reqText(partitions.development, "proposal.partitions.development");
  const searchValidation = reqText(partitions.searchValidation, "proposal.partitions.searchValidation");
  const finalHoldoutSealed = partitions.finalHoldoutSealed;
  if (finalHoldoutSealed !== true) fail("proposal.partitions.finalHoldoutSealed must be true");
  const metricPolicy = reqObject(v.metricPolicy, "proposal.metricPolicy");
  const metricPolicyRef = reqRef(metricPolicy.ref, "proposal.metricPolicy.ref");
  const metricPolicyDigest = reqHex(metricPolicy.digest, "proposal.metricPolicy.digest");
  if (metricPolicyRef.slice(-64) !== metricPolicyDigest) {
    fail("proposal.metricPolicy.ref digest must equal proposal.metricPolicy.digest");
  }
  const minEffect = metricPolicy.minEffect;
  if (typeof minEffect !== "number" || !Number.isFinite(minEffect)) {
    fail("proposal.metricPolicy.minEffect must be a finite number");
  }
  const candidateEvidenceRef = reqRef(v.candidateEvidenceRef, "proposal.candidateEvidenceRef");
  const status = reqEnum(v.status, FEEDBACK_PROPOSAL_STATUS, "proposal.status");
  // The envelope must never carry acceptance or promotion authority.
  for (const forbidden of ["accepted", "promoted", "acceptance", "promotion", "verdict"]) {
    if (v[forbidden] !== undefined) fail(`proposal must not carry '${forbidden}'`);
  }
  return freeze({
    kind: HOW_IMPROVEMENT_PROPOSAL_KIND,
    version: HOW_IMPROVEMENT_PROPOSAL_VERSION,
    howSubject,
    optimizerIdentity: freeze({ name: optimizerName, ref: optimizerRef }),
    partitions: freeze({ development, searchValidation, finalHoldoutSealed: true }),
    metricPolicy: freeze({ ref: metricPolicyRef, digest: metricPolicyDigest, minEffect }),
    candidateEvidenceRef,
    status,
  });
}

export function howImprovementProposalIdFor(proposal) {
  const p = defineHowImprovementProposal(proposal);
  return `${HOW_IMPROVEMENT_PROPOSAL_KIND}:sha256:${sha256Hex(canonicalString(p))}`;
}
