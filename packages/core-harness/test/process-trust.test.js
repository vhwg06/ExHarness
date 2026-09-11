import test from "node:test";
import assert from "node:assert/strict";
import {
  ClaimStatus,
  ControlInputKind,
  ProcessTrustReasonCode,
  TrustBoundary,
  VerificationDomainDimension,
  controlInputFromValue,
  createAttestationIssuer,
  createDecisionArtifact,
  createEvidenceArtifact,
  createProcessAttestationIssuer,
  defineProcessTrustPolicy,
  defineSubject,
  environmentRefFromValue,
  evaluateProcessAttestationTrust,
  policyRefFromValue
} from "../src/index.js";

function signer(identity) {
  return async ({ payloadDigest }) => ({ value: `${identity}:${payloadDigest}` });
}

function signatureVerifier(identity) {
  return ({ payloadDigest, signature }) => signature?.value === `${identity}:${payloadDigest}`;
}

async function baseAttestationFixture() {
  const subject = defineSubject({
    type: "git-commit",
    digest: "abc123",
    producer: { identity: "coding-agent", roles: ["change-author"] }
  });
  const verificationEnvironment = environmentRefFromValue({ image: "verify@sha256:1" });
  const evidence = [createEvidenceArtifact({
    subject,
    kind: "TEST_REPORT",
    producer: { identity: "isolated-verifier", roles: ["verifier"] },
    environment: verificationEnvironment,
    content: { passed: true },
    generatedAt: "2026-09-11T06:00:00.000Z"
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
    generatedAt: "2026-09-11T06:01:00.000Z"
  });
  const issuer = createAttestationIssuer({
    identity: "verification-attestor",
    roles: ["attestor"],
    sign: signer("verification-attestor")
  });
  const attestation = await issuer.issue({
    decision,
    environment: verificationEnvironment,
    issuedAt: "2026-09-11T06:02:00.000Z"
  });
  return { attestation };
}

function controlInputs(reviewerPrompt = "reject authentication bypasses") {
  const authority = { identity: "security-team", roles: ["control-input-owner"] };
  return [
    controlInputFromValue("agents", "bounded implementation instructions", {
      kind: ControlInputKind.INSTRUCTION,
      source: "AGENTS.md",
      authority
    }),
    controlInputFromValue("reviewer", reviewerPrompt, {
      kind: ControlInputKind.RUBRIC,
      source: "reviewer.md",
      authority
    }),
    controlInputFromValue("verification-policy", { required: ["correctness"] }, {
      kind: ControlInputKind.POLICY,
      source: "verification-policy.yaml",
      authority
    }),
    controlInputFromValue("skills", ["backend", "security-review"], {
      kind: ControlInputKind.SKILL_BUNDLE,
      source: "skills/",
      authority
    }),
    controlInputFromValue("workflow", { stages: ["implement", "verify", "attest"] }, {
      kind: ControlInputKind.WORKFLOW,
      source: "workflow.yaml",
      authority
    })
  ];
}

async function issueProcessAttestation({ inputs = controlInputs(), domains }) {
  const base = await baseAttestationFixture();
  const processIssuer = createProcessAttestationIssuer({
    identity: "process-attestor",
    roles: ["process-attestor"],
    sign: signer("process-attestor")
  });
  const processEnvironment = environmentRefFromValue({ image: "process-attestor@sha256:2" });
  const processAttestation = await processIssuer.issue({
    baseAttestation: base.attestation,
    controlInputs: inputs,
    verificationDomains: domains,
    assumptions: [
      "verifier runtime executes requested commands correctly",
      "policy captures the intended engineering constraints"
    ],
    environment: processEnvironment,
    issuedAt: "2026-09-11T06:03:00.000Z"
  });
  return { base, processIssuer, processEnvironment, processAttestation };
}

function distinctDomains(inputs) {
  const instructionA = inputs.find((item) => item.name === "reviewer").digest;
  const instructionB = inputs.find((item) => item.name === "verification-policy").digest;
  return [
    {
      name: "review",
      actor: { identity: "review-agent", roles: ["verifier"] },
      model: "model-a",
      contextDigest: "sha256:review-context",
      instructionManifestDigest: instructionA,
      evidenceSource: "diff-review",
      environmentDigest: "sha256:review-env",
      runtimeDigest: "sha256:runtime-a"
    },
    {
      name: "test",
      actor: { identity: "test-agent", roles: ["verifier"] },
      model: "model-b",
      contextDigest: "sha256:test-context",
      instructionManifestDigest: instructionB,
      evidenceSource: "test-runner",
      environmentDigest: "sha256:test-env",
      runtimeDigest: "sha256:runtime-b"
    }
  ];
}

function baseTrustVerifier(baseAttestation) {
  return async (ref) => ({
    trusted: ref.id === baseAttestation.id && ref.digest === baseAttestation.digest,
    attestation: baseAttestation
  });
}

test("changing an agent instruction makes a previous process attestation stale", async () => {
  const inputs = controlInputs();
  const issued = await issueProcessAttestation({ inputs, domains: distinctDomains(inputs) });
  const current = controlInputs("treat intentional authentication deviations as acceptable");

  const result = await evaluateProcessAttestationTrust({
    processAttestation: issued.processAttestation,
    currentControlInputs: current,
    policy: defineProcessTrustPolicy({
      acceptedIssuers: [issued.processIssuer.issuer.identity],
      acceptedEnvironmentDigests: [issued.processEnvironment.digest],
      independence: { minimumDomains: 2 }
    }),
    verifySignature: signatureVerifier("process-attestor"),
    verifyBaseAttestation: baseTrustVerifier(issued.base.attestation)
  });

  assert.equal(result.trusted, false);
  assert.equal(result.reasons.some((reason) => reason.code === ProcessTrustReasonCode.STALE_CONTROL_INPUTS), true);
});

test("three agents sharing one poisoned instruction remain one instruction fault domain", async () => {
  const inputs = controlInputs();
  const sameInstruction = inputs.find((item) => item.name === "reviewer").digest;
  const domains = ["coder-review", "reviewer", "qa"].map((name, index) => ({
    name,
    actor: { identity: `${name}-agent`, roles: ["verifier"] },
    model: `model-${index}`,
    contextDigest: `sha256:context-${index}`,
    instructionManifestDigest: sameInstruction,
    evidenceSource: `source-${index}`,
    environmentDigest: `sha256:env-${index}`,
    runtimeDigest: `sha256:runtime-${index}`
  }));
  const issued = await issueProcessAttestation({ inputs, domains });

  const result = await evaluateProcessAttestationTrust({
    processAttestation: issued.processAttestation,
    currentControlInputs: inputs,
    policy: defineProcessTrustPolicy({
      acceptedIssuers: [issued.processIssuer.issuer.identity],
      independence: {
        minimumDomains: 3,
        dimensions: {
          [VerificationDomainDimension.INSTRUCTIONS]: 2
        }
      }
    }),
    verifySignature: signatureVerifier("process-attestor"),
    verifyBaseAttestation: baseTrustVerifier(issued.base.attestation)
  });

  assert.equal(result.trusted, false);
  assert.equal(
    result.reasons.some((reason) =>
      reason.code === ProcessTrustReasonCode.INSUFFICIENT_INDEPENDENCE &&
      reason.dimension === VerificationDomainDimension.INSTRUCTIONS &&
      reason.actual === 1
    ),
    true
  );
});

test("independence policy can require distinct instructions, evidence sources and execution environments", async () => {
  const inputs = controlInputs();
  const domains = distinctDomains(inputs);
  const issued = await issueProcessAttestation({ inputs, domains });

  const result = await evaluateProcessAttestationTrust({
    processAttestation: issued.processAttestation,
    currentControlInputs: inputs,
    policy: defineProcessTrustPolicy({
      acceptedIssuers: [issued.processIssuer.issuer.identity],
      requiredIssuerRoles: ["process-attestor"],
      acceptedEnvironmentDigests: [issued.processEnvironment.digest],
      requiredControlInputs: [
        { name: "agents", kind: ControlInputKind.INSTRUCTION },
        { name: "reviewer", kind: ControlInputKind.RUBRIC },
        { name: "verification-policy", kind: ControlInputKind.POLICY },
        { name: "skills", kind: ControlInputKind.SKILL_BUNDLE },
        { name: "workflow", kind: ControlInputKind.WORKFLOW }
      ],
      independence: {
        minimumDomains: 2,
        dimensions: {
          [VerificationDomainDimension.INSTRUCTIONS]: 2,
          [VerificationDomainDimension.EVIDENCE_SOURCE]: 2,
          [VerificationDomainDimension.ENVIRONMENT]: 2
        }
      }
    }),
    verifySignature: signatureVerifier("process-attestor"),
    verifyBaseAttestation: baseTrustVerifier(issued.base.attestation)
  });

  assert.equal(result.trusted, true);
  assert.deepEqual(result.reasons, []);
  assert.equal(result.assumptions.length, 2);
});

test("declared control-input authority is not trusted without independent authority verification", async () => {
  const inputs = controlInputs();
  const issued = await issueProcessAttestation({ inputs, domains: distinctDomains(inputs) });
  const policy = defineProcessTrustPolicy({
    acceptedIssuers: [issued.processIssuer.issuer.identity],
    acceptedControlInputAuthorities: ["security-team"],
    independence: { minimumDomains: 2 }
  });

  const withoutVerifier = await evaluateProcessAttestationTrust({
    processAttestation: issued.processAttestation,
    currentControlInputs: inputs,
    policy,
    verifySignature: signatureVerifier("process-attestor"),
    verifyBaseAttestation: baseTrustVerifier(issued.base.attestation)
  });
  assert.equal(withoutVerifier.trusted, false);
  assert.equal(
    withoutVerifier.reasons.some((reason) => reason.code === ProcessTrustReasonCode.UNVERIFIED_CONTROL_INPUT_AUTHORITY),
    true
  );

  const verified = await evaluateProcessAttestationTrust({
    processAttestation: issued.processAttestation,
    currentControlInputs: inputs,
    policy,
    verifySignature: signatureVerifier("process-attestor"),
    verifyBaseAttestation: baseTrustVerifier(issued.base.attestation),
    verifyControlInputAuthority({ input }) {
      return input.authority?.identity === "security-team";
    }
  });
  assert.equal(verified.trusted, true);
});

test("process attestation cannot elevate an untrusted base attestation", async () => {
  const inputs = controlInputs();
  const issued = await issueProcessAttestation({ inputs, domains: distinctDomains(inputs) });

  const result = await evaluateProcessAttestationTrust({
    processAttestation: issued.processAttestation,
    currentControlInputs: inputs,
    policy: defineProcessTrustPolicy({
      acceptedIssuers: [issued.processIssuer.issuer.identity],
      independence: { minimumDomains: 2 }
    }),
    verifySignature: signatureVerifier("process-attestor"),
    async verifyBaseAttestation() {
      return { trusted: false, attestation: issued.base.attestation };
    }
  });

  assert.equal(result.trusted, false);
  assert.equal(result.reasons.some((reason) => reason.code === ProcessTrustReasonCode.BASE_ATTESTATION_UNTRUSTED), true);
});
