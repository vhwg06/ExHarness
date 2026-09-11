import { invariant, normalizeCandidate, requireText } from "./contracts.js";

export const VerificationStatus = Object.freeze({
  PASS: "PASS",
  FAIL: "FAIL",
  INCONCLUSIVE: "INCONCLUSIVE"
});

export const VerificationSourceKind = Object.freeze({
  MANUAL: "MANUAL",
  CAPABILITY: "CAPABILITY"
});

export function verificationCapabilityName(name) {
  return `verify.${requireText(name, "verifier.name")}`;
}

export function defineVerifier(definition) {
  invariant(definition && typeof definition === "object", "verifier definition is required");
  const name = requireText(definition.name, "verifier.name");
  invariant(typeof definition.verify === "function", `verifier ${name} requires verify()`);

  return Object.freeze({
    name,
    description: definition.description ?? null,
    verify: definition.verify
  });
}

export function normalizeVerificationRecord(record) {
  invariant(record && typeof record === "object", "verification record is required");
  const candidate = normalizeCandidate(record.candidate);
  const status = record.status;
  invariant(Object.values(VerificationStatus).includes(status), "verification status is invalid");

  const claim = requireText(record.claim, "verification.claim");
  const evidence = Object.freeze([...(record.evidence ?? [])]);
  if (status !== VerificationStatus.INCONCLUSIVE) {
    invariant(evidence.length > 0, `${status.toLowerCase()} verification requires evidence`);
  }

  const source = record.source ?? { kind: VerificationSourceKind.MANUAL };
  invariant(source && typeof source === "object", "verification.source is required");
  invariant(Object.values(VerificationSourceKind).includes(source.kind), "verification source kind is invalid");

  if (source.kind === VerificationSourceKind.CAPABILITY) {
    requireText(source.name, "verification.source.name");
  }

  return Object.freeze({
    candidate,
    claim,
    status,
    evidence,
    summary: record.summary ?? null,
    details: record.details ?? null,
    request: record.request ?? null,
    source: Object.freeze({
      kind: source.kind,
      name: source.name ?? null
    })
  });
}
