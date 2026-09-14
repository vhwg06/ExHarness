import {
  ClaimStatus,
  createEvidenceArtifact,
  digestValue
} from "../../core-harness/src/index.js";

function invariant(condition, message) {
  if (!condition) throw new TypeError(message);
}

function freezeClone(value) {
  return Object.freeze(structuredClone(value));
}

export function validateApplicationEvidenceArtifact(raw, { label = "Application evidence" } = {}) {
  invariant(raw && typeof raw === "object", `${label} artifact is required`);
  invariant(raw.type === "EVIDENCE", `${label} must be an ExHarness EVIDENCE artifact`);
  if (raw.content != null) {
    invariant(digestValue(raw.content) === raw.contentDigest, `${label} content digest is invalid`);
  }
  const recreated = createEvidenceArtifact({
    subject: raw.subject,
    kind: raw.kind,
    producer: raw.producer,
    environment: raw.environment,
    content: raw.content ?? null,
    contentDigest: raw.contentDigest,
    uri: raw.uri ?? null,
    metadata: raw.metadata ?? null,
    generatedAt: raw.generatedAt
  });
  invariant(recreated.id === raw.id && recreated.digest === raw.digest, `${label} artifact digest is invalid`);
  return freezeClone(raw);
}

export function buildEvidenceClaimState(evidence, requiredClaims) {
  const byClaim = new Map();
  for (const artifact of evidence) {
    const claim = artifact.metadata?.claim;
    const status = artifact.metadata?.verificationStatus;
    if (typeof claim !== "string" || typeof status !== "string") continue;
    const statuses = byClaim.get(claim) ?? new Set();
    statuses.add(status);
    byClaim.set(claim, statuses);
  }

  const missing = [];
  const failed = [];
  const inconclusive = [];
  const claims = [];

  for (const claim of requiredClaims) {
    const statuses = byClaim.get(claim);
    let status = ClaimStatus.UNKNOWN;
    if (!statuses || statuses.size === 0) {
      missing.push(claim);
    } else if (statuses.has("FAIL")) {
      failed.push(claim);
      status = ClaimStatus.UNSATISFIED;
    } else if (statuses.has("INCONCLUSIVE") || !statuses.has("PASS")) {
      inconclusive.push(claim);
    } else {
      status = ClaimStatus.SATISFIED;
    }
    claims.push({
      name: claim,
      status,
      details: { verificationStatuses: statuses ? [...statuses].sort() : [] }
    });
  }

  return Object.freeze({
    missing: Object.freeze(missing),
    failed: Object.freeze(failed),
    inconclusive: Object.freeze(inconclusive),
    claims: Object.freeze(claims)
  });
}
