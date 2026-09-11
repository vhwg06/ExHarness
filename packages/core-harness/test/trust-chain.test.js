import test from "node:test";
import assert from "node:assert/strict";
import {
  ClaimStatus,
  EvaluationValidity,
  EvaluationVerdict,
  TrustBoundary,
  TrustChainReasonCode,
  VerificationSourceKind,
  VerificationStatus,
  createAttestationIssuer,
  createDecisionArtifact,
  createEvidenceArtifact,
  createHarness,
  defineSubject,
  defineTrustPolicy,
  environmentRefFromValue,
  evaluateAttestationChainTrust,
  evaluateTrustBoundary,
  policyRefFromValue
} from "../src/index.js";

function issuer(identity) {
  return createAttestationIssuer({
    identity,
    roles: ["attestor"],
    async sign({ payloadDigest }) {
      return { value: `${identity}:${payloadDigest}` };
    }
  });
}

function verifier(identity) {
  return ({ payloadDigest, signature }) => signature?.value === `${identity}:${payloadDigest}`;
}

test("attestation refuses to package an evaluation after its verification snapshot becomes stale", async () => {
  const attestor = issuer("verification-attestor");
  const harness = createHarness({
    strategy: { async run() { return null; } },
    environment: {
      async observe() { return null; },
      async act({ candidate }) { return { mutated: false, candidate }; }
    },
    objective: {
      async evaluate() {
        return { validity: EvaluationValidity.VALID, verdict: EvaluationVerdict.PASS };
      }
    },
    attestationIssuer: attestor
  });
  const snapshot = await harness.start({
    sessionId: "stale-attestation",
    work: { objective: "reject stale trust claims" },
    seedCandidate: { id: "candidate", version: "v1" }
  });
  await harness.recordVerification("stale-attestation", {
    candidate: snapshot.candidate,
    claim: "correctness",
    status: VerificationStatus.PASS,
    evidence: [{ report: "initial" }],
    source: { kind: VerificationSourceKind.CAPABILITY, name: "initial" }
  });
  await harness.evaluate("stale-attestation");
  await harness.recordVerification("stale-attestation", {
    candidate: snapshot.candidate,
    claim: "adversarial",
    status: VerificationStatus.FAIL,
    evidence: [{ report: "late-failure" }],
    source: { kind: VerificationSourceKind.CAPABILITY, name: "late" }
  });

  await assert.rejects(
    () => harness.attestCurrentEvaluation("stale-attestation", {
      subject: defineSubject({ type: "git-commit", digest: "abc123", producer: { identity: "author" } }),
      evidenceEnvironment: environmentRefFromValue({ runner: "verify" }),
      attestationEnvironment: environmentRefFromValue({ runner: "attest" }),
      evaluator: { identity: "objective-engine", roles: ["evaluator"] }
    }),
    /verification artifacts changed since evaluation/
  );
});

async function createVerificationTrust() {
  const subject = defineSubject({
    type: "git-commit",
    digest: "abc123",
    producer: { identity: "implementation-agent", roles: ["author"] }
  });
  const env = environmentRefFromValue({ image: "verify@sha256:1" });
  const evidence = [createEvidenceArtifact({
    subject,
    kind: "VERIFY",
    producer: { identity: "verification-worker", roles: ["verifier"] },
    environment: env,
    content: { passed: true },
    generatedAt: "2026-09-11T05:00:00.000Z"
  })];
  const policy = policyRefFromValue("verification-policy", { correctness: true });
  const decision = createDecisionArtifact({
    subject,
    boundary: TrustBoundary.VERIFICATION,
    policy,
    evaluator: { identity: "verification-evaluator", roles: ["evaluator"] },
    evidence,
    claims: [{ name: "correctness", status: ClaimStatus.SATISFIED }],
    verdict: "READY_FOR_INTEGRATION",
    generatedAt: "2026-09-11T05:01:00.000Z"
  });
  const attestor = issuer("verification-attestor");
  const attestation = await attestor.issue({
    decision,
    environment: env,
    issuedAt: "2026-09-11T05:02:00.000Z"
  });
  const trust = await evaluateTrustBoundary({
    attestation,
    decision,
    currentSubject: subject,
    evidence,
    policy: defineTrustPolicy({
      boundary: TrustBoundary.VERIFICATION,
      acceptedIssuers: ["verification-attestor"],
      acceptedPolicyDigests: [policy.digest],
      acceptedEvaluators: ["verification-evaluator"],
      acceptedEvidenceProducers: ["verification-worker"],
      requiredClaims: ["correctness"],
      requireIndependentIssuer: true,
      requireIndependentEvidenceProducers: true
    }),
    verifySignature: verifier("verification-attestor"),
    verifyEvaluatorAuthority: ({ evaluator }) => evaluator.identity === "verification-evaluator",
    verifyEvidenceAuthority: ({ producer }) => producer.identity === "verification-worker"
  });
  assert.equal(trust.trusted, true);
  return { attestation, trust };
}

async function createCoordinationAttestation(upstreamAttestation) {
  const subject = defineSubject({ type: "git-tree", digest: "integration-head" });
  const policy = policyRefFromValue("coordination-policy", { mergeQueue: true });
  const decision = createDecisionArtifact({
    subject,
    boundary: TrustBoundary.COORDINATION,
    policy,
    evaluator: { identity: "coordination-evaluator", roles: ["evaluator"] },
    evidence: [],
    claims: [{ name: "integration-safe", status: ClaimStatus.SATISFIED }],
    verdict: "MERGEABLE",
    generatedAt: "2026-09-11T05:03:00.000Z"
  });
  const attestor = issuer("coordination-attestor");
  const attestation = await attestor.issue({
    decision,
    environment: environmentRefFromValue({ image: "coordination@sha256:2" }),
    upstreamAttestations: [upstreamAttestation],
    issuedAt: "2026-09-11T05:04:00.000Z"
  });
  return { subject, policy, decision, attestor, attestation };
}

function coordinationInput(coordination) {
  return {
    attestation: coordination.attestation,
    decision: coordination.decision,
    currentSubject: coordination.subject,
    evidence: [],
    policy: defineTrustPolicy({
      boundary: TrustBoundary.COORDINATION,
      acceptedIssuers: ["coordination-attestor"],
      acceptedPolicyDigests: [coordination.policy.digest],
      acceptedEvaluators: ["coordination-evaluator"],
      requiredClaims: ["integration-safe"]
    }),
    verifySignature: verifier("coordination-attestor"),
    verifyEvaluatorAuthority: ({ evaluator }) => evaluator.identity === "coordination-evaluator",
    requiredUpstreamBoundaries: [TrustBoundary.VERIFICATION]
  };
}

test("coordination trust fails when upstream verification attestation is only referenced but not trusted", async () => {
  const upstream = await createVerificationTrust();
  const coordination = await createCoordinationAttestation(upstream.attestation);
  const result = await evaluateAttestationChainTrust(coordinationInput(coordination));

  assert.equal(result.trusted, false);
  const codes = new Set(result.reasons.map((reason) => reason.code));
  assert.equal(codes.has(TrustChainReasonCode.UNTRUSTED_UPSTREAM_ATTESTATION), true);
  assert.equal(codes.has(TrustChainReasonCode.MISSING_UPSTREAM_BOUNDARY), true);
});

test("coordination trust accepts exact upstream ref only after upstream verification boundary trust passes", async () => {
  const upstream = await createVerificationTrust();
  const coordination = await createCoordinationAttestation(upstream.attestation);
  const result = await evaluateAttestationChainTrust({
    ...coordinationInput(coordination),
    async verifyUpstream(ref) {
      assert.equal(ref.id, upstream.attestation.id);
      assert.equal(ref.digest, upstream.attestation.digest);
      return upstream.trust;
    }
  });

  assert.equal(result.trusted, true);
  assert.equal(result.upstream.length, 1);
  assert.equal(result.upstream[0].boundary, TrustBoundary.VERIFICATION);
});
