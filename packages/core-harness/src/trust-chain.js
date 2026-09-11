import { invariant, requireText } from "./contracts.js";
import { evaluateTrustBoundary } from "./trust-boundary.js";

export const TrustChainReasonCode = Object.freeze({
  UNTRUSTED_UPSTREAM_ATTESTATION: "UNTRUSTED_UPSTREAM_ATTESTATION",
  MISSING_UPSTREAM_BOUNDARY: "MISSING_UPSTREAM_BOUNDARY"
});

export async function evaluateAttestationChainTrust({
  attestation,
  requiredUpstreamBoundaries = [],
  verifyUpstream = null,
  ...localTrustInput
}) {
  invariant(attestation && typeof attestation === "object", "attestation is required");
  const requiredBoundaries = [...new Set(requiredUpstreamBoundaries.map((item) => requireText(item, "required upstream boundary")))];
  const local = await evaluateTrustBoundary({
    attestation,
    ...localTrustInput
  });
  const reasons = [...local.reasons];
  const verifiedUpstream = [];
  const refs = attestation.upstreamAttestations ?? [];

  for (const ref of refs) {
    let result = null;
    if (typeof verifyUpstream === "function") {
      result = await verifyUpstream(Object.freeze({ id: ref.id, digest: ref.digest }));
    }
    const suppliedAttestation = result?.attestation ?? null;
    const matchesRef = suppliedAttestation?.id === ref.id && suppliedAttestation?.digest === ref.digest;
    const trusted = result?.trusted === true && matchesRef;
    if (!trusted) {
      reasons.push(Object.freeze({
        code: TrustChainReasonCode.UNTRUSTED_UPSTREAM_ATTESTATION,
        ref: Object.freeze({ id: ref.id, digest: ref.digest }),
        detail: result == null
          ? "upstream trust verification unavailable"
          : matchesRef
            ? "upstream attestation was not trusted"
            : "upstream trust result does not match referenced attestation"
      }));
      continue;
    }
    verifiedUpstream.push(Object.freeze({
      ref: Object.freeze({ id: ref.id, digest: ref.digest }),
      boundary: result.boundary ?? suppliedAttestation.boundary ?? null
    }));
  }

  const trustedBoundaries = new Set(verifiedUpstream.map((item) => item.boundary).filter(Boolean));
  for (const boundary of requiredBoundaries) {
    if (!trustedBoundaries.has(boundary)) {
      reasons.push(Object.freeze({
        code: TrustChainReasonCode.MISSING_UPSTREAM_BOUNDARY,
        boundary
      }));
    }
  }

  return Object.freeze({
    trusted: reasons.length === 0,
    reasons: Object.freeze(reasons),
    local,
    upstream: Object.freeze(verifiedUpstream),
    attestation: Object.freeze({
      id: attestation.id,
      digest: attestation.digest,
      boundary: attestation.boundary
    }),
    boundary: attestation.boundary
  });
}
