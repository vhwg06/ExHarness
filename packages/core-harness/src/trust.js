import { createHash } from "node:crypto";
import { invariant, requireText } from "./contracts.js";

export const TrustBoundary = Object.freeze({
  VERIFICATION: "VERIFICATION",
  COORDINATION: "COORDINATION",
  RELEASE_BUILD: "RELEASE_BUILD",
  ACCEPTANCE: "ACCEPTANCE"
});

export const ClaimStatus = Object.freeze({
  SATISFIED: "SATISFIED",
  UNSATISFIED: "UNSATISFIED",
  UNKNOWN: "UNKNOWN"
});

export const TrustReasonCode = Object.freeze({
  STALE_SUBJECT: "STALE_SUBJECT",
  STALE_POLICY: "STALE_POLICY",
  UNTRUSTED_ENVIRONMENT: "UNTRUSTED_ENVIRONMENT",
  UNTRUSTED_ISSUER: "UNTRUSTED_ISSUER",
  MISSING_ISSUER_ROLE: "MISSING_ISSUER_ROLE",
  AUTHORITY_NOT_INDEPENDENT: "AUTHORITY_NOT_INDEPENDENT",
  MISSING_CLAIM: "MISSING_CLAIM",
  UNSATISFIED_CLAIM: "UNSATISFIED_CLAIM",
  INVALID_SIGNATURE: "INVALID_SIGNATURE",
  INVALID_PROVENANCE: "INVALID_PROVENANCE",
  EXPIRED: "EXPIRED",
  WRONG_BOUNDARY: "WRONG_BOUNDARY"
});

function isPlainObject(value) {
  if (value == null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function stableValue(value, label = "value") {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    invariant(Number.isFinite(value), `${label} must contain finite numbers`);
    return value;
  }
  if (Array.isArray(value)) return value.map((item, index) => stableValue(item, `${label}[${index}]`));
  invariant(isPlainObject(value), `${label} must contain only plain structured data`);
  const output = {};
  for (const key of Object.keys(value).sort()) {
    invariant(value[key] !== undefined, `${label}.${key} must not be undefined`);
    output[key] = stableValue(value[key], `${label}.${key}`);
  }
  return output;
}

function freezeStructured(value) {
  return Object.freeze(structuredClone(value));
}

export function canonicalize(value) {
  return JSON.stringify(stableValue(value));
}

export function digestValue(value) {
  return `sha256:${createHash("sha256").update(canonicalize(value)).digest("hex")}`;
}

function normalizeRoles(roles = []) {
  invariant(Array.isArray(roles), "authority roles must be an array");
  return Object.freeze([...new Set(roles.map((role) => requireText(role, "authority role")))].sort());
}

export function defineAuthority({ identity, version = null, roles = [] }) {
  return Object.freeze({
    identity: requireText(identity, "authority.identity"),
    version: version == null ? null : requireText(version, "authority.version"),
    roles: normalizeRoles(roles)
  });
}

export function defineSubject({ type, digest, producer = null, metadata = null }) {
  return Object.freeze({
    type: requireText(type, "subject.type"),
    digest: requireText(digest, "subject.digest"),
    producer: producer == null ? null : defineAuthority(producer),
    metadata: metadata == null ? null : freezeStructured(stableValue(metadata, "subject.metadata"))
  });
}

export function subjectFromValue(value, { type = "artifact", producer = null, metadata = null } = {}) {
  return defineSubject({ type, digest: digestValue(value), producer, metadata });
}

export function definePolicyRef({ name, digest, version = null }) {
  return Object.freeze({
    name: requireText(name, "policy.name"),
    digest: requireText(digest, "policy.digest"),
    version: version == null ? null : requireText(version, "policy.version")
  });
}

export function policyRefFromValue(name, value, { version = null } = {}) {
  return definePolicyRef({ name, digest: digestValue(value), version });
}

export function defineEnvironmentRef({ digest, name = null, metadata = null }) {
  return Object.freeze({
    digest: requireText(digest, "environment.digest"),
    name: name == null ? null : requireText(name, "environment.name"),
    metadata: metadata == null ? null : freezeStructured(stableValue(metadata, "environment.metadata"))
  });
}

export function environmentRefFromValue(value, { name = null, metadata = null } = {}) {
  return defineEnvironmentRef({ digest: digestValue(value), name, metadata });
}

function artifactRef(artifact, label) {
  invariant(artifact && typeof artifact === "object", `${label} is required`);
  return Object.freeze({
    id: requireText(artifact.id, `${label}.id`),
    digest: requireText(artifact.digest, `${label}.digest`)
  });
}

function evidenceBody(artifact) {
  return {
    type: artifact.type,
    subject: artifact.subject,
    kind: artifact.kind,
    producer: artifact.producer,
    environment: artifact.environment,
    contentDigest: artifact.contentDigest,
    uri: artifact.uri ?? null,
    metadata: artifact.metadata ?? null,
    generatedAt: artifact.generatedAt
  };
}

function evidenceIntegrity(artifact) {
  if (!artifact || artifact.type !== "EVIDENCE") return false;
  if (artifact.content != null && digestValue(stableValue(artifact.content, "evidence.content")) !== artifact.contentDigest) return false;
  const digest = digestValue(evidenceBody(artifact));
  return digest === artifact.digest && artifact.id === `evidence:${digest}`;
}

export function createEvidenceArtifact({
  subject,
  kind,
  producer,
  environment,
  content = null,
  contentDigest = null,
  uri = null,
  metadata = null,
  generatedAt
}) {
  const resolvedContentDigest = contentDigest == null
    ? digestValue(stableValue(content, "evidence.content"))
    : requireText(contentDigest, "evidence.contentDigest");
  const body = {
    type: "EVIDENCE",
    subject: defineSubject(subject),
    kind: requireText(kind, "evidence.kind"),
    producer: defineAuthority(producer),
    environment: defineEnvironmentRef(environment),
    contentDigest: resolvedContentDigest,
    uri: uri == null ? null : requireText(uri, "evidence.uri"),
    metadata: metadata == null ? null : stableValue(metadata, "evidence.metadata"),
    generatedAt: requireText(generatedAt, "evidence.generatedAt")
  };
  const digest = digestValue(body);
  return Object.freeze({
    id: `evidence:${digest}`,
    digest,
    ...freezeStructured(body),
    content: content == null ? null : freezeStructured(stableValue(content, "evidence.content"))
  });
}

function normalizeClaim(claim) {
  invariant(claim && typeof claim === "object", "decision claim is required");
  invariant(Object.values(ClaimStatus).includes(claim.status), "decision claim status is invalid");
  return Object.freeze({
    name: requireText(claim.name, "decision claim name"),
    status: claim.status,
    details: claim.details == null ? null : freezeStructured(stableValue(claim.details, "decision claim details"))
  });
}

function evidenceManifest(evidence) {
  const refs = evidence.map((artifact) => artifactRef(artifact, "evidence artifact"));
  refs.sort((left, right) => `${left.id}:${left.digest}`.localeCompare(`${right.id}:${right.digest}`));
  return Object.freeze({ refs: Object.freeze(refs), digest: digestValue(refs) });
}

function decisionBody(decision) {
  return {
    type: decision.type,
    subject: decision.subject,
    boundary: decision.boundary,
    policy: decision.policy,
    evaluator: decision.evaluator,
    evidenceManifest: decision.evidenceManifest,
    claims: decision.claims,
    unresolved: decision.unresolved,
    verdict: decision.verdict,
    generatedAt: decision.generatedAt,
    metadata: decision.metadata ?? null
  };
}

function decisionIntegrity(decision) {
  if (!decision || decision.type !== "DECISION") return false;
  const digest = digestValue(decisionBody(decision));
  return digest === decision.digest && decision.id === `decision:${digest}`;
}

export function createDecisionArtifact({
  subject,
  boundary = TrustBoundary.VERIFICATION,
  policy,
  evaluator,
  evidence = [],
  claims = [],
  unresolved = [],
  verdict,
  generatedAt,
  metadata = null
}) {
  invariant(Object.values(TrustBoundary).includes(boundary), "decision boundary is invalid");
  const normalizedClaims = claims.map(normalizeClaim);
  const names = new Set();
  for (const claim of normalizedClaims) {
    invariant(!names.has(claim.name), `duplicate decision claim: ${claim.name}`);
    names.add(claim.name);
  }
  const body = {
    type: "DECISION",
    subject: defineSubject(subject),
    boundary,
    policy: definePolicyRef(policy),
    evaluator: defineAuthority(evaluator),
    evidenceManifest: evidenceManifest(evidence),
    claims: normalizedClaims,
    unresolved: stableValue(unresolved, "decision.unresolved"),
    verdict: requireText(verdict, "decision.verdict"),
    generatedAt: requireText(generatedAt, "decision.generatedAt"),
    metadata: metadata == null ? null : stableValue(metadata, "decision.metadata")
  };
  const digest = digestValue(body);
  return Object.freeze({ id: `decision:${digest}`, digest, ...freezeStructured(body) });
}

export function attestationRef(attestation) {
  return artifactRef(attestation, "attestation");
}

function normalizeUpstream(upstream = []) {
  const refs = upstream.map((item) => artifactRef(item, "upstream attestation"));
  refs.sort((left, right) => `${left.id}:${left.digest}`.localeCompare(`${right.id}:${right.digest}`));
  return Object.freeze(refs);
}

function attestationPayload(attestation) {
  return {
    type: attestation.type,
    boundary: attestation.boundary,
    subject: attestation.subject,
    decision: attestation.decision,
    policy: attestation.policy,
    issuer: attestation.issuer,
    environment: attestation.environment,
    evidenceManifest: attestation.evidenceManifest,
    upstreamAttestations: attestation.upstreamAttestations,
    issuedAt: attestation.issuedAt
  };
}

export function createAttestationIssuer({ identity, version = null, roles = [], sign }) {
  invariant(typeof sign === "function", "attestation issuer requires sign()");
  const issuer = defineAuthority({ identity, version, roles });
  return Object.freeze({
    issuer,
    async issue({ decision, environment, upstreamAttestations = [], issuedAt }) {
      invariant(decisionIntegrity(decision), "attestation requires an intact decision artifact");
      const payload = {
        type: "ATTESTATION",
        boundary: decision.boundary,
        subject: defineSubject(decision.subject),
        decision: Object.freeze({ id: decision.id, digest: decision.digest, verdict: decision.verdict, claims: decision.claims }),
        policy: definePolicyRef(decision.policy),
        issuer,
        environment: defineEnvironmentRef(environment),
        evidenceManifest: decision.evidenceManifest,
        upstreamAttestations: normalizeUpstream(upstreamAttestations),
        issuedAt: requireText(issuedAt, "attestation.issuedAt")
      };
      const payloadDigest = digestValue(payload);
      const signature = await sign({ payloadDigest, payload: freezeStructured(payload), issuer });
      invariant(signature != null, "attestation issuer sign() must return a signature");
      const normalizedSignature = stableValue(signature, "attestation.signature");
      const digest = digestValue({ payloadDigest, signature: normalizedSignature });
      return Object.freeze({
        id: `attestation:${digest}`,
        digest,
        payloadDigest,
        ...freezeStructured(payload),
        signature: freezeStructured(normalizedSignature)
      });
    }
  });
}

export function defineTrustPolicy({
  boundary = null,
  acceptedIssuers = [],
  acceptedPolicyDigests = [],
  acceptedEnvironmentDigests = [],
  requiredIssuerRoles = [],
  requiredClaims = [],
  requireSignature = true,
  requireEvidenceArtifacts = true,
  requireDecisionArtifact = true,
  requireIndependentIssuer = false,
  maxAgeMs = null
} = {}) {
  if (boundary != null) invariant(Object.values(TrustBoundary).includes(boundary), "trust policy boundary is invalid");
  if (maxAgeMs != null) invariant(Number.isFinite(maxAgeMs) && maxAgeMs >= 0, "trust policy maxAgeMs must be non-negative");
  return Object.freeze({
    boundary,
    acceptedIssuers: Object.freeze([...new Set(acceptedIssuers.map((item) => requireText(item, "accepted issuer")))]),
    acceptedPolicyDigests: Object.freeze([...new Set(acceptedPolicyDigests.map((item) => requireText(item, "accepted policy digest")))]),
    acceptedEnvironmentDigests: Object.freeze([...new Set(acceptedEnvironmentDigests.map((item) => requireText(item, "accepted environment digest")))]),
    requiredIssuerRoles: normalizeRoles(requiredIssuerRoles),
    requiredClaims: Object.freeze([...new Set(requiredClaims.map((item) => requireText(item, "required claim")))]),
    requireSignature: requireSignature !== false,
    requireEvidenceArtifacts: requireEvidenceArtifacts !== false,
    requireDecisionArtifact: requireDecisionArtifact !== false,
    requireIndependentIssuer: requireIndependentIssuer === true,
    maxAgeMs
  });
}

function refSet(items) {
  return new Set(items.map((item) => `${item.id}:${item.digest}`));
}

function validateEvidenceManifest(attestation, evidence) {
  const provided = evidenceManifest(evidence);
  const expectedRefs = attestation.evidenceManifest?.refs ?? [];
  const providedSet = refSet(provided.refs);
  const expectedSet = refSet(expectedRefs);
  return provided.digest === attestation.evidenceManifest?.digest &&
    provided.refs.length === expectedRefs.length &&
    providedSet.size === expectedSet.size &&
    [...providedSet].every((ref) => expectedSet.has(ref));
}

function sameDecisionSummary(attestation, decision) {
  return attestation.decision?.id === decision.id &&
    attestation.decision?.digest === decision.digest &&
    attestation.decision?.verdict === decision.verdict &&
    digestValue(attestation.decision?.claims ?? []) === digestValue(decision.claims ?? []);
}

export async function evaluateAttestationTrust({
  attestation,
  currentSubject,
  policy = defineTrustPolicy(),
  evidence = [],
  decision = null,
  verifySignature = null,
  now = () => new Date().toISOString()
}) {
  invariant(attestation && typeof attestation === "object", "attestation is required");
  const resolvedPolicy = defineTrustPolicy(policy);
  const reasons = [];

  const recomputedPayloadDigest = digestValue(attestationPayload(attestation));
  const recomputedEnvelopeDigest = digestValue({ payloadDigest: recomputedPayloadDigest, signature: attestation.signature });
  if (
    recomputedPayloadDigest !== attestation.payloadDigest ||
    recomputedEnvelopeDigest !== attestation.digest ||
    attestation.id !== `attestation:${recomputedEnvelopeDigest}`
  ) {
    reasons.push(Object.freeze({ code: TrustReasonCode.INVALID_PROVENANCE, detail: "attestation digest mismatch" }));
  }

  const normalizedCurrentSubject = defineSubject(currentSubject);
  if (attestation.subject?.type !== normalizedCurrentSubject.type || attestation.subject?.digest !== normalizedCurrentSubject.digest) {
    reasons.push(Object.freeze({ code: TrustReasonCode.STALE_SUBJECT }));
  }
  if (resolvedPolicy.boundary != null && attestation.boundary !== resolvedPolicy.boundary) {
    reasons.push(Object.freeze({ code: TrustReasonCode.WRONG_BOUNDARY, expected: resolvedPolicy.boundary, actual: attestation.boundary }));
  }
  if (resolvedPolicy.acceptedPolicyDigests.length > 0 && !resolvedPolicy.acceptedPolicyDigests.includes(attestation.policy?.digest)) {
    reasons.push(Object.freeze({ code: TrustReasonCode.STALE_POLICY, digest: attestation.policy?.digest ?? null }));
  }
  if (resolvedPolicy.acceptedEnvironmentDigests.length > 0 && !resolvedPolicy.acceptedEnvironmentDigests.includes(attestation.environment?.digest)) {
    reasons.push(Object.freeze({ code: TrustReasonCode.UNTRUSTED_ENVIRONMENT, digest: attestation.environment?.digest ?? null }));
  }
  if (resolvedPolicy.acceptedIssuers.length > 0 && !resolvedPolicy.acceptedIssuers.includes(attestation.issuer?.identity)) {
    reasons.push(Object.freeze({ code: TrustReasonCode.UNTRUSTED_ISSUER, issuer: attestation.issuer?.identity ?? null }));
  }
  const issuerRoles = new Set(attestation.issuer?.roles ?? []);
  for (const role of resolvedPolicy.requiredIssuerRoles) {
    if (!issuerRoles.has(role)) reasons.push(Object.freeze({ code: TrustReasonCode.MISSING_ISSUER_ROLE, role }));
  }
  if (resolvedPolicy.requireIndependentIssuer) {
    const producer = normalizedCurrentSubject.producer?.identity ?? null;
    if (producer == null || producer === attestation.issuer?.identity) {
      reasons.push(Object.freeze({
        code: TrustReasonCode.AUTHORITY_NOT_INDEPENDENT,
        issuer: attestation.issuer?.identity ?? null,
        producer,
        detail: producer == null ? "subject producer authority is unknown" : "subject producer equals attestation issuer"
      }));
    }
  }

  const claims = new Map((attestation.decision?.claims ?? []).map((claim) => [claim.name, claim]));
  for (const required of resolvedPolicy.requiredClaims) {
    const claim = claims.get(required);
    if (!claim) reasons.push(Object.freeze({ code: TrustReasonCode.MISSING_CLAIM, claim: required }));
    else if (claim.status !== ClaimStatus.SATISFIED) {
      reasons.push(Object.freeze({ code: TrustReasonCode.UNSATISFIED_CLAIM, claim: required, status: claim.status }));
    }
  }

  if (resolvedPolicy.requireEvidenceArtifacts) {
    if (evidence.some((artifact) => !evidenceIntegrity(artifact))) {
      reasons.push(Object.freeze({ code: TrustReasonCode.INVALID_PROVENANCE, detail: "evidence artifact integrity failure" }));
    }
    if (!validateEvidenceManifest(attestation, evidence)) {
      reasons.push(Object.freeze({ code: TrustReasonCode.INVALID_PROVENANCE, detail: "evidence manifest mismatch" }));
    }
  }

  if (resolvedPolicy.requireDecisionArtifact) {
    if (!decisionIntegrity(decision)) {
      reasons.push(Object.freeze({ code: TrustReasonCode.INVALID_PROVENANCE, detail: "decision artifact missing or invalid" }));
    } else {
      if (!sameDecisionSummary(attestation, decision)) {
        reasons.push(Object.freeze({ code: TrustReasonCode.INVALID_PROVENANCE, detail: "attestation decision reference mismatch" }));
      }
      if (decision.subject?.type !== attestation.subject?.type || decision.subject?.digest !== attestation.subject?.digest) {
        reasons.push(Object.freeze({ code: TrustReasonCode.INVALID_PROVENANCE, detail: "decision subject mismatch" }));
      }
      if (decision.policy?.digest !== attestation.policy?.digest || decision.evidenceManifest?.digest !== attestation.evidenceManifest?.digest) {
        reasons.push(Object.freeze({ code: TrustReasonCode.INVALID_PROVENANCE, detail: "decision provenance mismatch" }));
      }
    }
  }

  if (resolvedPolicy.maxAgeMs != null) {
    const issued = Date.parse(attestation.issuedAt);
    const current = Date.parse(now());
    if (!Number.isFinite(issued) || !Number.isFinite(current) || issued > current || current - issued > resolvedPolicy.maxAgeMs) {
      reasons.push(Object.freeze({ code: TrustReasonCode.EXPIRED }));
    }
  }

  if (resolvedPolicy.requireSignature) {
    if (typeof verifySignature !== "function") {
      reasons.push(Object.freeze({ code: TrustReasonCode.INVALID_SIGNATURE, detail: "signature verifier unavailable" }));
    } else {
      const valid = await verifySignature({
        payloadDigest: attestation.payloadDigest,
        signature: attestation.signature,
        issuer: attestation.issuer,
        attestation
      });
      if (valid !== true) reasons.push(Object.freeze({ code: TrustReasonCode.INVALID_SIGNATURE }));
    }
  }

  return Object.freeze({
    trusted: reasons.length === 0,
    reasons: Object.freeze(reasons),
    subject: freezeStructured(attestation.subject),
    boundary: attestation.boundary,
    issuer: freezeStructured(attestation.issuer),
    decision: freezeStructured(attestation.decision)
  });
}

export function evidenceFromVerificationArtifact(verification, { subject, environment, generatedAt = verification?.at } = {}) {
  invariant(verification && typeof verification === "object", "verification artifact is required");
  const source = verification.source ?? { kind: "MANUAL", name: null };
  const producer = {
    identity: source.name ? `${source.kind.toLowerCase()}:${source.name}` : source.kind.toLowerCase(),
    version: null,
    roles: ["verifier"]
  };
  return createEvidenceArtifact({
    subject,
    kind: "VERIFICATION",
    producer,
    environment,
    generatedAt,
    metadata: {
      verificationId: verification.id ?? null,
      claim: verification.claim,
      verificationStatus: verification.status
    },
    content: {
      claim: verification.claim,
      status: verification.status,
      evidence: verification.evidence ?? [],
      summary: verification.summary ?? null,
      details: verification.details ?? null,
      request: verification.request ?? null
    }
  });
}

function claimsFromEvidence(evidence) {
  const grouped = new Map();
  for (const artifact of evidence) {
    const claim = artifact.metadata?.claim;
    const status = artifact.metadata?.verificationStatus;
    if (!claim || !status) continue;
    const statuses = grouped.get(claim) ?? new Set();
    statuses.add(status);
    grouped.set(claim, statuses);
  }
  return [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([name, statuses]) => {
    let status = ClaimStatus.UNKNOWN;
    if (statuses.size === 1 && statuses.has("PASS")) status = ClaimStatus.SATISFIED;
    if (statuses.has("FAIL")) status = ClaimStatus.UNSATISFIED;
    return Object.freeze({ name, status, details: { verificationStatuses: [...statuses].sort() } });
  });
}

export function decisionFromEvaluation(evaluation, {
  subject,
  boundary = TrustBoundary.VERIFICATION,
  policy,
  evaluator,
  evidence = [],
  claims = null,
  unresolved = [],
  verdict = evaluation?.verdict,
  generatedAt = evaluation?.at
} = {}) {
  invariant(evaluation && typeof evaluation === "object", "evaluation is required");
  return createDecisionArtifact({
    subject,
    boundary,
    policy,
    evaluator,
    evidence,
    claims: claims ?? claimsFromEvidence(evidence),
    unresolved,
    verdict,
    generatedAt,
    metadata: {
      evaluationId: evaluation.id ?? null,
      validity: evaluation.validity ?? null,
      originalVerdict: evaluation.verdict ?? null
    }
  });
}

export function validateTrustBundle({ evidence = [], decision, attestation }) {
  invariant(evidence.every(evidenceIntegrity), "trust bundle contains invalid evidence artifact");
  invariant(decisionIntegrity(decision), "trust bundle requires intact decision artifact");
  invariant(attestation && attestation.type === "ATTESTATION", "trust bundle requires attestation");
  invariant(decision.digest === attestation.decision?.digest, "attestation decision digest does not match decision artifact");
  invariant(decision.id === attestation.decision?.id, "attestation decision id does not match decision artifact");
  invariant(decision.subject.type === attestation.subject?.type && decision.subject.digest === attestation.subject?.digest, "attestation subject does not match decision subject");
  invariant(decision.policy.digest === attestation.policy?.digest, "attestation policy does not match decision policy");
  invariant(validateEvidenceManifest(attestation, evidence), "attestation evidence manifest does not match evidence artifacts");
  const payloadDigest = digestValue(attestationPayload(attestation));
  invariant(payloadDigest === attestation.payloadDigest, "attestation payload digest is invalid");
  invariant(digestValue({ payloadDigest, signature: attestation.signature }) === attestation.digest, "attestation envelope digest is invalid");
  return Object.freeze({
    evidence: Object.freeze(evidence.map((item) => freezeStructured(item))),
    decision: freezeStructured(decision),
    attestation: freezeStructured(attestation)
  });
}
