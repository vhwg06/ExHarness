import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  ClaimStatus,
  TrustBoundary,
  createAttestationIssuer,
  createDecisionArtifact,
  createEvidenceArtifact,
  environmentRefFromValue,
  policyRefFromValue,
  subjectFromValue
} from "../../core-harness/src/index.js";
import {
  BlackboardStatus,
  FollowUpDisposition,
  ReviewRequirementSource,
  ReviewVerdict,
  createApplicationOrchestrator,
  createBackendQaProjectAcceptanceController,
  createJsonBlackboardStore,
  createJsonTrustArtifactStore
} from "../src/index.js";

const ITEM_ID = "BB-019-FINDING";
const REVIEW_KEY = "BACKEND_QA_PROJECT_ACCEPTANCE";
const GENERATED_AT = "2026-09-16T15:20:00.000Z";
const ACCEPTANCE_POLICY = Object.freeze({
  name: "backend-qa-project-acceptance",
  requiredInputs: ["backend", "qa"],
  version: 1
});
const ACCEPTANCE_POLICY_REF = policyRefFromValue(
  "backend-qa-project-acceptance-policy",
  ACCEPTANCE_POLICY,
  { version: "1" }
);
const ROLE_POLICY = policyRefFromValue("role-acceptance", { version: 1 }, { version: "1" });
const ROLE_ENV = environmentRefFromValue({ image: "role@sha256:bb019" }, { name: "role" });
const REVIEW_ENV = environmentRefFromValue({ image: "review@sha256:bb019" }, { name: "review" });
const ATTEST_ENV = environmentRefFromValue({ image: "attest@sha256:bb019" }, { name: "attest" });

function reviewTrust() {
  return {
    trustPolicyFor() {
      return {
        acceptedIssuers: ["project-attestor"],
        acceptedPolicyDigests: [ACCEPTANCE_POLICY_REF.digest],
        acceptedEnvironmentDigests: [ATTEST_ENV.digest],
        acceptedEvaluators: ["project-reviewer"],
        acceptedEvidenceProducers: ["project-verifier"],
        acceptedEvidenceEnvironmentDigests: [REVIEW_ENV.digest]
      };
    },
    verifySignature({ payloadDigest, signature }) {
      return signature?.value === `signed:${payloadDigest}`;
    },
    verifyEvaluatorAuthority({ evaluator, reviewer }) {
      return evaluator?.identity === reviewer && evaluator.roles.includes("reviewer");
    },
    verifyEvidenceAuthority({ producer, environment }) {
      return producer?.identity === "project-verifier" &&
        producer.roles.includes("verifier") &&
        environment?.digest === REVIEW_ENV.digest;
    }
  };
}

function roleBundle(role) {
  const subject = subjectFromValue(
    { role, revision: "rev-2" },
    { type: `${role}-result`, producer: { identity: `${role}-worker`, roles: ["producer"] } }
  );
  const evidence = createEvidenceArtifact({
    subject,
    kind: "ROLE_ACCEPTANCE",
    producer: { identity: `${role}-verifier`, roles: ["verifier"] },
    environment: ROLE_ENV,
    content: { accepted: true },
    generatedAt: GENERATED_AT,
    metadata: { role }
  });
  const decision = createDecisionArtifact({
    subject,
    boundary: TrustBoundary.ACCEPTANCE,
    policy: ROLE_POLICY,
    evaluator: { identity: `${role}-completion-policy`, roles: ["evaluator"] },
    evidence: [evidence],
    claims: [{ name: `${role}.accepted`, status: ClaimStatus.SATISFIED }],
    unresolved: [],
    verdict: "ACCEPT",
    generatedAt: GENERATED_AT
  });
  return { evidence, decision };
}

async function persistRole(store, role) {
  const bundle = roleBundle(role);
  await store.putEvidence(bundle.evidence);
  return store.putDecision(bundle.decision);
}

function issuer() {
  return createAttestationIssuer({
    identity: "project-attestor",
    roles: ["attestor"],
    async sign({ payloadDigest }) {
      return { algorithm: "test", value: `signed:${payloadDigest}` };
    }
  });
}

test("BB-019 accepted findings require existing reconciliation before DONE", async () => {
  const directory = await mkdtemp(join(tmpdir(), "exharness-bb019-findings-"));
  try {
    const orchestrator = createApplicationOrchestrator({
      store: createJsonBlackboardStore({ path: join(directory, "blackboard.json") }),
      reviewTrust: reviewTrust()
    });
    const trustArtifactStore = createJsonTrustArtifactStore({ path: join(directory, "trust") });
    const backendAcceptanceDecision = await persistRole(trustArtifactStore, "backend");
    const qaAcceptanceDecision = await persistRole(trustArtifactStore, "qa");

    await orchestrator.seed([{
      id: ITEM_ID,
      work: "Deliver Backend/QA project acceptance.",
      status: BlackboardStatus.PENDING_REVIEW,
      owner: null,
      dependsOn: [],
      remainingWork: [],
      blockers: [],
      artifactRefs: [],
      evidenceRefs: [backendAcceptanceDecision.id, qaAcceptanceDecision.id],
      followUpRefs: [],
      checkpoint: null,
      checkpointedBy: null,
      submission: {
        kind: "BACKEND_QA_WORKFLOW",
        version: 1,
        stage: "QA_COMPLETED",
        acceptedRevision: "rev-2",
        backendAcceptanceDecision,
        qaAcceptanceDecision,
        artifactRefs: [],
        evidenceRefs: [backendAcceptanceDecision.id, qaAcceptanceDecision.id]
      },
      submittedBy: "qa-session",
      reviewRequirements: [{
        key: REVIEW_KEY,
        source: ReviewRequirementSource.PM,
        reason: "Project completion requires trusted Backend/QA acceptance."
      }],
      reviews: [],
      findings: []
    }]);

    const controller = createBackendQaProjectAcceptanceController({
      orchestrator,
      trustArtifactStore,
      artifactReader: {
        async readArtifact() {
          throw new Error("no application artifact was declared");
        }
      },
      requirement: {
        key: REVIEW_KEY,
        source: ReviewRequirementSource.PM,
        reason: "Project completion requires trusted Backend/QA acceptance.",
        authorizedBy: { identity: "project-pm", version: "1" }
      },
      reviewer: { identity: "project-reviewer", version: "1" },
      verifier: {
        async verify({ subject }) {
          return [createEvidenceArtifact({
            subject,
            kind: "PROJECT_ACCEPTANCE",
            producer: { identity: "project-verifier", roles: ["verifier"] },
            environment: REVIEW_ENV,
            content: { checked: true },
            generatedAt: GENERATED_AT
          })];
        }
      },
      evaluator: {
        async evaluate() {
          return {
            verdict: ReviewVerdict.ACCEPTED,
            claims: [{ name: "project.acceptance", status: ClaimStatus.SATISFIED }],
            unresolved: [],
            findings: ["Document a non-blocking compatibility observation."]
          };
        }
      },
      attestationIssuer: issuer(),
      acceptancePolicy: ACCEPTANCE_POLICY,
      attestationEnvironment: ATTEST_ENV,
      now: () => GENERATED_AT
    });

    const reviewed = await controller.review({ itemId: ITEM_ID });
    assert.equal(reviewed.item.status, BlackboardStatus.PENDING_RECONCILIATION);
    assert.equal(reviewed.item.reviews[0].verdict, ReviewVerdict.ACCEPTED);
    assert.equal(reviewed.item.findings.length, 1);
    assert.equal(reviewed.item.findings[0].disposition, null);

    const reconciled = await orchestrator.reconcileFinding({
      itemId: ITEM_ID,
      findingId: reviewed.item.findings[0].id,
      disposition: FollowUpDisposition.NON_ACTIONABLE
    });
    assert.equal(reconciled.result.status, BlackboardStatus.DONE);
    assert.equal(reconciled.result.findings[0].disposition, FollowUpDisposition.NON_ACTIONABLE);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
