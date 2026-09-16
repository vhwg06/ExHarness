import assert from "node:assert/strict";
import test from "node:test";

import { sessionHandoffFromBlackboard } from "../src/index.js";

const PROJECT_ID = "bb020-probe";
const INTENT_ID = "deliver-backend-change";
const ROOT_ID = `INTENT:${INTENT_ID}`;

function rootItem() {
  return {
    id: ROOT_ID,
    work: "Deliver a Backend change through QA while preserving declared user constraints.",
    status: "DONE",
    owner: null,
    dependsOn: [],
    remainingWork: [],
    blockers: [],
    artifactRefs: [],
    evidenceRefs: [],
    followUpRefs: [],
    reviewRequirements: [],
    reviews: [],
    findings: [],
    origin: {
      kind: "USER_INTENT_ROOT",
      projectId: PROJECT_ID,
      userIntent: {
        id: INTENT_ID,
        source: "USER",
        objective: "Deliver a Backend change through QA while preserving declared user constraints.",
        bullets: ["Backend implementation", "QA verification"],
        constraints: [
          "preserve public contract compatibility",
          "architecture judgment must not own project coordination"
        ]
      }
    }
  };
}

function deliveryItem() {
  return {
    id: "delivery",
    work: "Deliver the requested Backend change through QA.",
    status: "READY",
    owner: null,
    dependsOn: [ROOT_ID],
    remainingWork: ["Backend implementation", "QA verification"],
    blockers: [],
    artifactRefs: ["artifact:delivery-spec"],
    evidenceRefs: [],
    followUpRefs: [],
    reviewRequirements: [],
    reviews: [],
    findings: [],
    origin: {
      rootIntentId: INTENT_ID,
      rootItemId: ROOT_ID
    }
  };
}

function handoff() {
  return sessionHandoffFromBlackboard({
    version: 1,
    items: [rootItem(), deliveryItem()]
  }, { projectId: PROJECT_ID });
}

function chars(value) {
  return JSON.stringify(value).length;
}

function pmContext(session, scenario, saAssessment = null) {
  return {
    projectId: session.projectId,
    intent: session.intent,
    work: session.lifecycle.eligibleWork.map((item) => ({
      id: item.id,
      work: item.work,
      dependsOn: item.dependsOn,
      remainingWork: item.remainingWork,
      blockers: item.blockers,
      reviewRequirements: item.reviewRequirements
    })),
    coordinationFacts: scenario.coordination,
    saAssessment: saAssessment == null ? null : {
      artifactRef: saAssessment.artifactRef,
      targetItemId: saAssessment.targetItemId,
      requiresArchitectureReview: saAssessment.requiresArchitectureReview
    }
  };
}

function saContext(session, scenario) {
  return {
    projectId: session.projectId,
    intent: {
      id: session.intent.id,
      objective: session.intent.objective,
      constraints: session.intent.constraints
    },
    targetItemId: "delivery",
    architectureFacts: scenario.architecture,
    evidenceRefs: scenario.architectureEvidenceRefs
  };
}

function universalContext(session, scenario) {
  return {
    session,
    coordinationFacts: scenario.coordination,
    architectureFacts: scenario.architecture,
    architectureEvidenceRefs: scenario.architectureEvidenceRefs
  };
}

function saAssess(context) {
  const changed = context.architectureFacts.publicBoundaryChanged === true;
  if (!changed) return null;
  assert.ok(context.evidenceRefs.length > 0, "architecture assessment requires exact evidence refs");
  return Object.freeze({
    kind: "SA_ARCHITECTURE_ASSESSMENT",
    targetItemId: context.targetItemId,
    artifactRef: `artifact:sa-assessment:${context.targetItemId}`,
    evidenceRefs: [...context.evidenceRefs],
    requiresArchitectureReview: true,
    finding: "Public architecture boundary changed; independent architecture review remains required."
  });
}

function staticCoordination() {
  return Object.freeze({
    obligations: ["BACKEND", "QA"],
    dependencies: [["QA", "BACKEND"]],
    blockers: [],
    reviewRequirements: [],
    intentPatch: null
  });
}

function boundedPmProposal(context) {
  const obligations = ["BACKEND"];
  const dependencies = [];
  const blockers = [];
  const reviewRequirements = [];

  if (context.coordinationFacts.schemaMigrationRequired) {
    obligations.push("MIGRATION");
    dependencies.push(["MIGRATION", "BACKEND"]);
  }

  obligations.push("QA");
  dependencies.push(["QA", context.coordinationFacts.schemaMigrationRequired ? "MIGRATION" : "BACKEND"]);

  if (context.coordinationFacts.artifactUnavailable) {
    obligations.push("ARTIFACT_RECOVERY_LINK");
    blockers.push({
      targetItemId: "delivery",
      reason: "Required artifact is unavailable",
      existingWorkRef: context.coordinationFacts.recoveryWorkRef
    });
  }

  if (context.saAssessment?.requiresArchitectureReview) {
    obligations.push("ARCH_REVIEW");
    reviewRequirements.push({
      targetItemId: context.saAssessment.targetItemId,
      key: "architecture",
      source: "PM",
      reasonRef: context.saAssessment.artifactRef
    });
  }

  return Object.freeze({
    kind: "PM_COORDINATION_PROPOSAL",
    rootIntentId: context.intent.id,
    obligations,
    dependencies,
    blockers,
    reviewRequirements,
    progress: {
      completed: 0,
      total: obligations.filter((item) => item !== "ARTIFACT_RECOVERY_LINK").length
    },
    intentPatch: null,
    architectureVerdict: null
  });
}

function validatePmProposal(proposal, session) {
  assert.equal(proposal.kind, "PM_COORDINATION_PROPOSAL");
  assert.equal(proposal.rootIntentId, session.intent.id, "PM proposal must remain rooted in durable user intent");
  assert.equal(proposal.intentPatch, null, "PM cannot rewrite user intent");
  assert.equal(proposal.architectureVerdict, null, "PM cannot become architecture judgment authority");
  for (const [child, parent] of proposal.dependencies) {
    assert.ok(proposal.obligations.includes(child), `unknown PM dependency child: ${child}`);
    assert.ok(proposal.obligations.includes(parent), `unknown PM dependency parent: ${parent}`);
    assert.notEqual(child, parent, "PM dependency cannot self-cycle");
  }
  for (const requirement of proposal.reviewRequirements) {
    assert.equal(requirement.source, "PM", "coordination review requirement must remain PM-sourced");
    assert.equal(requirement.targetItemId, "delivery");
  }
  return true;
}

function validateSaAssessment(assessment, context) {
  if (assessment == null) return true;
  assert.equal(assessment.kind, "SA_ARCHITECTURE_ASSESSMENT");
  assert.equal(assessment.targetItemId, context.targetItemId);
  assert.ok(assessment.evidenceRefs.length > 0, "SA assessment requires architecture evidence");
  assert.equal("dependsOn" in assessment, false, "SA cannot own project dependencies");
  assert.equal("priority" in assessment, false, "SA cannot own project priority");
  assert.equal("status" in assessment, false, "SA cannot mutate Blackboard lifecycle");
  return true;
}

function coverage(expected, actual) {
  const matched = expected.filter((item) => actual.includes(item)).length;
  return { matched, expected: expected.length, ratio: matched / expected.length };
}

const scenarios = [
  {
    id: "simple",
    coordination: { schemaMigrationRequired: false, artifactUnavailable: false, recoveryWorkRef: null },
    architecture: { publicBoundaryChanged: false },
    architectureEvidenceRefs: [],
    expectedObligations: ["BACKEND", "QA"]
  },
  {
    id: "migration",
    coordination: { schemaMigrationRequired: true, artifactUnavailable: false, recoveryWorkRef: null },
    architecture: { publicBoundaryChanged: false },
    architectureEvidenceRefs: [],
    expectedObligations: ["BACKEND", "MIGRATION", "QA"]
  },
  {
    id: "architecture-boundary",
    coordination: { schemaMigrationRequired: false, artifactUnavailable: false, recoveryWorkRef: null },
    architecture: { publicBoundaryChanged: true },
    architectureEvidenceRefs: ["evidence:public-contract-diff"],
    expectedObligations: ["BACKEND", "QA", "ARCH_REVIEW"]
  },
  {
    id: "artifact-blocker",
    coordination: {
      schemaMigrationRequired: false,
      artifactUnavailable: true,
      recoveryWorkRef: "work:artifact-source-recovery"
    },
    architecture: { publicBoundaryChanged: false },
    architectureEvidenceRefs: [],
    expectedObligations: ["BACKEND", "QA", "ARTIFACT_RECOVERY_LINK"]
  }
];

test("BB-020 separates PM coordination from SA architecture judgment and preserves Orchestrator authority", () => {
  const session = handoff();
  const runs = [];
  let baselineMatched = 0;
  let boundedMatched = 0;
  let expectedTotal = 0;
  let baselineFalseObligations = 0;
  let boundedFalseObligations = 0;
  let saAssessments = 0;
  let pmReplans = 0;
  let separateContextChars = 0;
  let universalContextChars = 0;

  for (const scenario of scenarios) {
    const saInput = saContext(session, scenario);
    const assessment = saAssess(saInput);
    validateSaAssessment(assessment, saInput);
    if (assessment != null) saAssessments += 1;

    const pmInput = pmContext(session, scenario, assessment);
    const baseline = staticCoordination();
    const candidate = boundedPmProposal(pmInput);
    validatePmProposal(candidate, session);

    const baselineCoverage = coverage(scenario.expectedObligations, baseline.obligations);
    const candidateCoverage = coverage(scenario.expectedObligations, candidate.obligations);
    baselineMatched += baselineCoverage.matched;
    boundedMatched += candidateCoverage.matched;
    expectedTotal += scenario.expectedObligations.length;
    baselineFalseObligations += baseline.obligations.filter((item) => !scenario.expectedObligations.includes(item)).length;
    boundedFalseObligations += candidate.obligations.filter((item) => !scenario.expectedObligations.includes(item)).length;

    if (JSON.stringify(candidate) !== JSON.stringify(baseline)) pmReplans += 1;
    const separated = chars(saInput) + chars(pmInput);
    const universal = chars(universalContext(session, scenario));
    separateContextChars += separated;
    universalContextChars += universal;
    assert.ok(separated < universal, `${scenario.id}: role-specific contexts should be smaller than one universal context`);

    runs.push({
      scenario: scenario.id,
      expectedObligations: scenario.expectedObligations,
      baselineObligations: baseline.obligations,
      boundedObligations: candidate.obligations,
      baselineCoverage: baselineCoverage.ratio,
      boundedCoverage: candidateCoverage.ratio,
      saAssessmentRef: assessment?.artifactRef ?? null,
      pmReviewRequirementRefs: candidate.reviewRequirements.map((item) => item.reasonRef),
      separatedContextChars: separated,
      universalContextChars: universal
    });
  }

  assert.equal(baselineMatched, 8);
  assert.equal(boundedMatched, 11);
  assert.equal(expectedTotal, 11);
  assert.equal(baselineFalseObligations, 0);
  assert.equal(boundedFalseObligations, 0);
  assert.equal(saAssessments, 1);
  assert.equal(pmReplans, 3);
  assert.ok(separateContextChars < universalContextChars);

  assert.throws(() => validatePmProposal({
    ...boundedPmProposal(pmContext(session, scenarios[0], null)),
    intentPatch: { objective: "invented objective" }
  }, session), /PM cannot rewrite user intent/);

  assert.throws(() => validatePmProposal({
    ...boundedPmProposal(pmContext(session, scenarios[0], null)),
    architectureVerdict: "ACCEPTED"
  }, session), /PM cannot become architecture judgment authority/);

  assert.throws(() => validateSaAssessment({
    kind: "SA_ARCHITECTURE_ASSESSMENT",
    targetItemId: "delivery",
    artifactRef: "artifact:bad-sa",
    evidenceRefs: ["evidence:x"],
    requiresArchitectureReview: true,
    dependsOn: ["backend"]
  }, saContext(session, scenarios[2])), /SA cannot own project dependencies/);

  assert.throws(() => saAssess({
    ...saContext(session, scenarios[2]),
    evidenceRefs: []
  }), /architecture assessment requires exact evidence refs/);

  const report = {
    experiment: "BB-020 bounded PM/SA coordination research probe",
    evidenceClass: "DETERMINISTIC_REFERENCE",
    productionEvidence: false,
    scenarioCount: scenarios.length,
    baseline: {
      obligationCoverage: baselineMatched / expectedTotal,
      matchedObligations: baselineMatched,
      expectedObligations: expectedTotal,
      falseObligations: baselineFalseObligations
    },
    bounded: {
      obligationCoverage: boundedMatched / expectedTotal,
      matchedObligations: boundedMatched,
      expectedObligations: expectedTotal,
      falseObligations: boundedFalseObligations,
      saAssessments,
      pmReplans,
      authorityFenceRejections: 4
    },
    context: {
      separatedChars: separateContextChars,
      universalChars: universalContextChars,
      reduction: 1 - (separateContextChars / universalContextChars)
    },
    authority: {
      pmMayRewriteIntent: false,
      pmMayIssueArchitectureVerdict: false,
      saMayOwnDependenciesOrPriority: false,
      rolesMayMutateBoardDirectly: false,
      orchestratorValidationRequired: true
    },
    runs,
    conclusion: {
      direction: "NARROW",
      reason: "Separate bounded PM coordination and SA architecture judgment can cover scenario-specific coordination obligations without widening either role into Blackboard lifecycle authority. Deterministic fixture evidence does not justify a generic role framework or production default.",
      runtimeDefaultAuthorized: false,
      genericRoleFrameworkJustified: false
    }
  };

  console.log(`bb020-pm-sa-research:${JSON.stringify(report)}`);
});
