import test from "node:test";
import assert from "node:assert/strict";
import {
  BoundaryTrustReasonCode,
  ClaimStatus,
  EvaluationValidity,
  EvaluationVerdict,
  TrustBoundary,
  TrustReasonCode,
  VerificationSourceKind,
  VerificationStatus,
  createAttestationIssuer,
  createDecisionArtifact,
  createEvidenceArtifact,
  createHarness,
  defineSubject,
  defineTrustPolicy,
  environmentRefFromValue,
  evaluateTrustBoundary,
  policyRefFromValue
} from "../src/index.js";

function issuer(identity = "trusted-attestor") {
  return createAttestationIssuer({
    identity,
    roles: ["attestor"],
    async sign({ payloadDigest }) {
      return { algorithm: "test", value: `signed:${payloadDigest}` };
    }
  });
}

function verifyTestSignature({ payloadDigest, signature }) {
  return signature?.value === `signed:${payloadDigest}`;
}

function fixture({
  evaluatorIdentity = "trusted-evaluator",
  evidenceProducer = "trusted-verifier",
  evidenceEnvironment = null,
  subjectProducer = "implementation-agent"
} = {}) {
  const subject = defineSubject({
    type: "git-commit",
    digest: "abc123",
    producer: subjectProducer == null ? null : { identity: subjectProducer, roles: ["change-author"] }
  });
  const verificationEnv = evidenceEnvironment ?? environmentRefFromValue(
    { image: "verify@sha256:aaa" },
    { name: "verification-env" }
  );
  const attestationEnv = environmentRefFromValue(
    { image: "attest@sha256:bbb" },
    { name: "attestation-env" }
  );
  const evidence = [createEvidenceArtifact({
    subject,
    kind: "TECHNICAL_VERIFICATION",
    producer: { identity: evidenceProducer, roles: ["verifier"] },
    environment: verificationEnv,
    generatedAt: "2026-09-11T05:00:00.000Z",
    content: { passed: true }
  })];
  const policy = policyRefFromValue("verification-policy", { required: ["correctness"] });
  const decision = createDecisionArtifact({
    subject,
    boundary: TrustBoundary.VERIFICATION,
    policy,
    evaluator: { identity: evaluatorIdentity, roles: ["evaluator"] },
    evidence,
    claims: [{ name: "correctness", status: ClaimStatus.SATISFIED }],
    verdict: "READY_FOR_INTEGRATION",
    generatedAt: "2026-09-11T05:01:00.000Z"
  });
  return { subject, verificationEnv, attestationEnv, evidence, policy, decision };
}

async function attest(values) {
  const attestor = issuer();
  const attestation = await attestor.issue({
    decision: values.decision,
    environment: values.attestationEnv,
    issuedAt: "2026-09-11T05:02:00.000Z"
  });
  return { attestor, attestation };
}

function fullPolicy(values, attestor, overrides = {}) {
  return defineTrustPolicy({
    acceptedIssuers: [attestor.issuer.identity],
    acceptedPolicyDigests: [values.policy.digest],
    acceptedEvaluators: ["trusted-evaluator"],
    requiredEvaluatorRoles: ["evaluator"],
    acceptedEvidenceProducers: ["trusted-verifier"],
    acceptedEvidenceEnvironmentDigests: [values.verificationEnv.digest],
    requiredEvidenceProducerRoles: ["verifier"],
    requireIndependentIssuer: true,
    requireIndependentEvidenceProducers: true,
    ...overrides
  });
}

function trustedEvaluator({ evaluator }) {
  return evaluator?.identity === "trusted-evaluator" && evaluator.roles.includes("evaluator");
}

function trustedEvidence({ producer, environment }) {
  return producer?.identity === "trusted-verifier" && environment?.name === "verification-env";
}

test("declared trusted identities are insufficient without independent authority verification", async () => {
  const values = fixture();
  const { attestor, attestation } = await attest(values);
  const result = await evaluateTrustBoundary({
    attestation,
    decision: values.decision,
    currentSubject: values.subject,
    evidence: values.evidence,
    policy: fullPolicy(values, attestor),
    verifySignature: verifyTestSignature
  });

  const codes = new Set(result.reasons.map((reason) => reason.code));
  assert.equal(codes.has(BoundaryTrustReasonCode.UNVERIFIED_EVALUATOR_AUTHORITY), true);
  assert.equal(codes.has(BoundaryTrustReasonCode.UNVERIFIED_EVIDENCE_AUTHORITY), true);
});

test("full authority chain is trusted only when issuer, evaluator and evidence authority verify independently", async () => {
  const values = fixture();
  const { attestor, attestation } = await attest(values);
  const result = await evaluateTrustBoundary({
    attestation,
    decision: values.decision,
    currentSubject: values.subject,
    evidence: values.evidence,
    policy: fullPolicy(values, attestor),
    verifySignature: verifyTestSignature,
    verifyEvaluatorAuthority: trustedEvaluator,
    verifyEvidenceAuthority: trustedEvidence
  });

  assert.equal(result.trusted, true);
  assert.deepEqual(result.reasons, []);
});

test("trusted attestor cannot launder an untrusted evaluator", async () => {
  const values = fixture({ evaluatorIdentity: "untrusted-evaluator" });
  const { attestor, attestation } = await attest(values);
  const result = await evaluateTrustBoundary({
    attestation,
    decision: values.decision,
    currentSubject: values.subject,
    evidence: values.evidence,
    policy: fullPolicy(values, attestor),
    verifySignature: verifyTestSignature,
    verifyEvaluatorAuthority: trustedEvaluator,
    verifyEvidenceAuthority: trustedEvidence
  });

  const codes = new Set(result.reasons.map((reason) => reason.code));
  assert.equal(codes.has(TrustReasonCode.UNTRUSTED_EVALUATOR), true);
  assert.equal(codes.has(BoundaryTrustReasonCode.UNVERIFIED_EVALUATOR_AUTHORITY), true);
});

test("trusted attestor and evaluator cannot launder an untrusted evidence producer or environment", async () => {
  const values = fixture({ evidenceProducer: "unknown-verifier" });
  const { attestor, attestation } = await attest(values);
  const result = await evaluateTrustBoundary({
    attestation,
    decision: values.decision,
    currentSubject: values.subject,
    evidence: values.evidence,
    policy: fullPolicy(values, attestor),
    verifySignature: verifyTestSignature,
    verifyEvaluatorAuthority: trustedEvaluator,
    verifyEvidenceAuthority: trustedEvidence
  });

  const codes = new Set(result.reasons.map((reason) => reason.code));
  assert.equal(codes.has(TrustReasonCode.UNTRUSTED_EVIDENCE_PRODUCER), true);
  assert.equal(codes.has(BoundaryTrustReasonCode.UNVERIFIED_EVIDENCE_AUTHORITY), true);
});

test("evidence independence fails closed when verifier is the subject producer", async () => {
  const values = fixture({ evidenceProducer: "implementation-agent" });
  const { attestor, attestation } = await attest(values);
  const result = await evaluateTrustBoundary({
    attestation,
    decision: values.decision,
    currentSubject: values.subject,
    evidence: values.evidence,
    policy: fullPolicy(values, attestor, { acceptedEvidenceProducers: ["implementation-agent"] }),
    verifySignature: verifyTestSignature,
    verifyEvaluatorAuthority: trustedEvaluator,
    verifyEvidenceAuthority: () => true
  });

  assert.equal(result.trusted, false);
  assert.equal(
    result.reasons.some((reason) => reason.code === TrustReasonCode.EVIDENCE_AUTHORITY_NOT_INDEPENDENT),
    true
  );
});

test("attestCurrentEvaluation resolves provenance environment independently for each verifier", async () => {
  const attestor = issuer();
  const unitEnv = environmentRefFromValue({ image: "unit@sha256:1" }, { name: "unit-env" });
  const integrationEnv = environmentRefFromValue({ image: "integration@sha256:2" }, { name: "integration-env" });
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
    sessionId: "per-verifier-env",
    work: { objective: "preserve verifier environment provenance" },
    seedCandidate: { id: "candidate", version: "v1" }
  });
  for (const name of ["unit", "integration"]) {
    await harness.recordVerification("per-verifier-env", {
      candidate: snapshot.candidate,
      claim: name,
      status: VerificationStatus.PASS,
      evidence: [{ report: name }],
      source: { kind: VerificationSourceKind.CAPABILITY, name }
    });
  }
  await harness.evaluate("per-verifier-env");

  const bundle = await harness.attestCurrentEvaluation("per-verifier-env", {
    subject: defineSubject({
      type: "git-commit",
      digest: "abc123",
      producer: { identity: "implementation-agent", roles: ["change-author"] }
    }),
    evidenceEnvironment(verification) {
      if (verification.source.name === "unit") return unitEnv;
      if (verification.source.name === "integration") return integrationEnv;
      throw new Error(`unknown verifier ${verification.source.name}`);
    },
    attestationEnvironment: environmentRefFromValue({ image: "attestor@sha256:3" }, { name: "attestor-env" }),
    evaluator: { identity: "trusted-evaluator", roles: ["evaluator"] },
    verdict: "READY_FOR_INTEGRATION"
  });

  const byVerifier = new Map(bundle.evidence.map((artifact) => [
    artifact.metadata.verificationId,
    artifact.environment.digest
  ]));
  const verifications = await harness.verifications("per-verifier-env", { currentCandidateOnly: true });
  const unit = verifications.find((item) => item.source.name === "unit");
  const integration = verifications.find((item) => item.source.name === "integration");

  assert.equal(byVerifier.get(unit.id), unitEnv.digest);
  assert.equal(byVerifier.get(integration.id), integrationEnv.digest);
  assert.notEqual(unitEnv.digest, integrationEnv.digest);
});
