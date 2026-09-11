import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign as cryptoSign, verify as cryptoVerify } from "node:crypto";
import {
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
  createStateMigrator,
  defineSubject,
  defineTrustPolicy,
  environmentRefFromValue,
  evaluateAttestationTrust,
  policyRefFromValue
} from "../src/index.js";

function signingFixture(identity = "verification-service") {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const issuer = createAttestationIssuer({
    identity,
    version: "1.0.0",
    roles: ["verification-attestor"],
    async sign({ payloadDigest }) {
      return {
        algorithm: "ed25519",
        keyId: `${identity}-test-key`,
        value: cryptoSign(null, Buffer.from(payloadDigest), privateKey).toString("base64")
      };
    }
  });
  const verifySignature = async ({ payloadDigest, signature }) => cryptoVerify(
    null,
    Buffer.from(payloadDigest),
    publicKey,
    Buffer.from(signature.value, "base64")
  );
  return { issuer, verifySignature };
}

function trustFixture({ subjectProducer = "implementation-agent", issuerIdentity = "verification-service" } = {}) {
  const subject = defineSubject({
    type: "git-commit",
    digest: "abc123",
    producer: subjectProducer == null ? null : { identity: subjectProducer, roles: ["change-author"] }
  });
  const policy = policyRefFromValue("verification-policy", {
    required: ["correctness", "architecture"]
  });
  const evidenceEnvironment = environmentRefFromValue({ image: "verify@sha256:111", node: 22 }, { name: "verification-env" });
  const attestationEnvironment = environmentRefFromValue({ service: "attestor", image: "attestor@sha256:222" }, { name: "attestation-env" });
  const evidence = [
    createEvidenceArtifact({
      subject,
      kind: "TEST_REPORT",
      producer: { identity: "unit-verifier", version: "2.1.0", roles: ["verifier"] },
      environment: evidenceEnvironment,
      generatedAt: "2026-09-11T04:00:00.000Z",
      content: { suite: "unit", passed: 120, failed: 0 }
    }),
    createEvidenceArtifact({
      subject,
      kind: "ARCHITECTURE_REVIEW",
      producer: { identity: "architecture-verifier", version: "4.0.0", roles: ["verifier"] },
      environment: evidenceEnvironment,
      generatedAt: "2026-09-11T04:01:00.000Z",
      content: { constraints: "satisfied" }
    })
  ];
  const decision = createDecisionArtifact({
    subject,
    boundary: TrustBoundary.VERIFICATION,
    policy,
    evaluator: { identity: "verification-policy-engine", version: "3.0.0", roles: ["evaluator"] },
    evidence,
    claims: [
      { name: "correctness", status: ClaimStatus.SATISFIED },
      { name: "architecture", status: ClaimStatus.SATISFIED }
    ],
    unresolved: [],
    verdict: "READY_FOR_INTEGRATION",
    generatedAt: "2026-09-11T04:02:00.000Z"
  });
  const signing = signingFixture(issuerIdentity);
  return { subject, policy, evidenceEnvironment, attestationEnvironment, evidence, decision, ...signing };
}

test("signed verification attestation is trusted only for exact subject, policy, environment, claims and issuer authority", async () => {
  const fixture = trustFixture();
  const attestation = await fixture.issuer.issue({
    decision: fixture.decision,
    environment: fixture.attestationEnvironment,
    issuedAt: "2026-09-11T04:03:00.000Z"
  });
  const trustPolicy = defineTrustPolicy({
    boundary: TrustBoundary.VERIFICATION,
    acceptedIssuers: [fixture.issuer.issuer.identity],
    acceptedPolicyDigests: [fixture.policy.digest],
    acceptedEnvironmentDigests: [fixture.attestationEnvironment.digest],
    requiredIssuerRoles: ["verification-attestor"],
    requiredClaims: ["correctness", "architecture"],
    requireIndependentIssuer: true,
    maxAgeMs: 60_000
  });

  const result = await evaluateAttestationTrust({
    attestation,
    currentSubject: fixture.subject,
    policy: trustPolicy,
    evidence: fixture.evidence,
    verifySignature: fixture.verifySignature,
    now: () => "2026-09-11T04:03:30.000Z"
  });

  assert.equal(result.trusted, true);
  assert.deepEqual(result.reasons, []);
});

test("subject or policy change makes an otherwise valid attestation stale", async () => {
  const fixture = trustFixture();
  const attestation = await fixture.issuer.issue({
    decision: fixture.decision,
    environment: fixture.attestationEnvironment,
    issuedAt: "2026-09-11T04:03:00.000Z"
  });
  const result = await evaluateAttestationTrust({
    attestation,
    currentSubject: defineSubject({ type: "git-commit", digest: "def456", producer: { identity: "implementation-agent" } }),
    policy: defineTrustPolicy({
      acceptedIssuers: [fixture.issuer.issuer.identity],
      acceptedPolicyDigests: ["sha256:new-policy"],
      requireEvidenceArtifacts: false
    }),
    evidence: [],
    verifySignature: fixture.verifySignature
  });

  const codes = new Set(result.reasons.map((reason) => reason.code));
  assert.equal(codes.has(TrustReasonCode.STALE_SUBJECT), true);
  assert.equal(codes.has(TrustReasonCode.STALE_POLICY), true);
});

test("forged signature and missing required claim are independently visible trust failures", async () => {
  const fixture = trustFixture();
  const attestation = structuredClone(await fixture.issuer.issue({
    decision: fixture.decision,
    environment: fixture.attestationEnvironment,
    issuedAt: "2026-09-11T04:03:00.000Z"
  }));
  attestation.signature.value = Buffer.from("forged").toString("base64");

  const result = await evaluateAttestationTrust({
    attestation,
    currentSubject: fixture.subject,
    policy: defineTrustPolicy({
      acceptedIssuers: [fixture.issuer.issuer.identity],
      acceptedPolicyDigests: [fixture.policy.digest],
      requiredClaims: ["correctness", "security"]
    }),
    evidence: fixture.evidence,
    verifySignature: fixture.verifySignature
  });
  const codes = new Set(result.reasons.map((reason) => reason.code));
  assert.equal(codes.has(TrustReasonCode.INVALID_SIGNATURE), true);
  assert.equal(codes.has(TrustReasonCode.MISSING_CLAIM), true);
});

test("tampered evidence body cannot pass by retaining the original digest field", async () => {
  const fixture = trustFixture();
  const attestation = await fixture.issuer.issue({
    decision: fixture.decision,
    environment: fixture.attestationEnvironment,
    issuedAt: "2026-09-11T04:03:00.000Z"
  });
  const evidence = structuredClone(fixture.evidence);
  evidence[0].content.failed = 999;

  const result = await evaluateAttestationTrust({
    attestation,
    currentSubject: fixture.subject,
    policy: defineTrustPolicy({
      acceptedIssuers: [fixture.issuer.issuer.identity],
      acceptedPolicyDigests: [fixture.policy.digest]
    }),
    evidence,
    verifySignature: fixture.verifySignature
  });
  assert.equal(result.trusted, false);
  assert.equal(result.reasons.some((reason) => reason.code === TrustReasonCode.INVALID_PROVENANCE), true);
});

test("independent-issuer policy fails closed when subject producer authority is unknown or identical", async () => {
  for (const subjectProducer of [null, "verification-service"]) {
    const fixture = trustFixture({ subjectProducer, issuerIdentity: "verification-service" });
    const attestation = await fixture.issuer.issue({
      decision: fixture.decision,
      environment: fixture.attestationEnvironment,
      issuedAt: "2026-09-11T04:03:00.000Z"
    });
    const result = await evaluateAttestationTrust({
      attestation,
      currentSubject: fixture.subject,
      policy: defineTrustPolicy({
        acceptedIssuers: [fixture.issuer.issuer.identity],
        acceptedPolicyDigests: [fixture.policy.digest],
        requireIndependentIssuer: true
      }),
      evidence: fixture.evidence,
      verifySignature: fixture.verifySignature
    });
    assert.equal(result.trusted, false);
    assert.equal(result.reasons.some((reason) => reason.code === TrustReasonCode.AUTHORITY_NOT_INDEPENDENT), true);
  }
});

test("attestation lineage can bind a coordination decision to upstream verification attestations", async () => {
  const fixture = trustFixture();
  const verificationAttestation = await fixture.issuer.issue({
    decision: fixture.decision,
    environment: fixture.attestationEnvironment,
    issuedAt: "2026-09-11T04:03:00.000Z"
  });
  const integrationSubject = defineSubject({ type: "git-tree", digest: "integration-head" });
  const coordinationPolicy = policyRefFromValue("coordination-policy", { mergeQueue: true });
  const coordinationDecision = createDecisionArtifact({
    subject: integrationSubject,
    boundary: TrustBoundary.COORDINATION,
    policy: coordinationPolicy,
    evaluator: { identity: "coordination-engine", roles: ["evaluator"] },
    evidence: [],
    claims: [{ name: "integration-safe", status: ClaimStatus.SATISFIED }],
    verdict: "MERGEABLE",
    generatedAt: "2026-09-11T04:04:00.000Z"
  });
  const coordinationIssuer = signingFixture("coordination-service").issuer;
  const coordination = await coordinationIssuer.issue({
    decision: coordinationDecision,
    environment: fixture.attestationEnvironment,
    upstreamAttestations: [verificationAttestation],
    issuedAt: "2026-09-11T04:05:00.000Z"
  });

  assert.equal(coordination.boundary, TrustBoundary.COORDINATION);
  assert.equal(coordination.upstreamAttestations.length, 1);
  assert.equal(coordination.upstreamAttestations[0].digest, verificationAttestation.digest);
});

test("production facade materializes and persists verification evidence, decision and attestation", async () => {
  const signing = signingFixture();
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
    attestationIssuer: signing.issuer
  });
  const snapshot = await harness.start({
    sessionId: "trust-session",
    work: { objective: "prove trust persistence" },
    seedCandidate: { id: "candidate", version: "v1" }
  });
  await harness.recordVerification("trust-session", {
    candidate: snapshot.candidate,
    claim: "correctness",
    status: VerificationStatus.PASS,
    evidence: [{ report: "unit" }],
    source: { kind: VerificationSourceKind.CAPABILITY, name: "unit" }
  });
  await harness.evaluate("trust-session");

  const subject = defineSubject({
    type: "git-commit",
    digest: "abc123",
    producer: { identity: "implementation-agent", roles: ["change-author"] }
  });
  const evidenceEnvironment = environmentRefFromValue({ runner: "verify-1" }, { name: "verify" });
  const attestationEnvironment = environmentRefFromValue({ runner: "attest-1" }, { name: "attest" });
  const bundle = await harness.attestCurrentEvaluation("trust-session", {
    subject,
    evidenceEnvironment,
    attestationEnvironment,
    evaluator: { identity: "objective-engine", roles: ["evaluator"] },
    verdict: "READY_FOR_INTEGRATION"
  });
  const persisted = await harness.trustArtifacts("trust-session");
  const resumed = await harness.resume("trust-session");

  assert.equal(resumed.schemaVersion, 2);
  assert.equal(bundle.evidence.length, 1);
  assert.equal(persisted.evidence.length, 1);
  assert.equal(persisted.decisions.length, 1);
  assert.equal(persisted.attestations.length, 1);
  assert.equal(resumed.progress.trust.attestations, 1);
});

test("built-in persistence migration upgrades v1 sessions to trust-capable v2 state", async () => {
  const migrated = await createStateMigrator().migrate({
    schemaVersion: 1,
    revision: 7,
    id: "legacy",
    work: {},
    currentCandidate: { id: "candidate", version: "v1" },
    persistentMemory: {
      implementations: [], observations: [], verifications: [], evaluations: [], knowledge: [], variations: [], lineage: []
    },
    trajectory: [],
    supervision: { inspections: 0, skipped: 0, interventions: [], lastInspectedEventId: null, lastDecision: null }
  });

  assert.equal(migrated.schemaVersion, 2);
  assert.deepEqual(migrated.persistentMemory.evidenceArtifacts, []);
  assert.deepEqual(migrated.persistentMemory.decisionArtifacts, []);
  assert.deepEqual(migrated.persistentMemory.attestations, []);
});
