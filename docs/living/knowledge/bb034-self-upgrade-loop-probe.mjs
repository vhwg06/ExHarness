import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ActionIntentAuthorizationDecision,
  ActionIntentStatus,
  ActionIntentTargetKind,
  GroundingVerdict,
  createDeliberationController,
  createDeliberationStore,
  createGroundedCognitionPort,
  defineGroundingVerifier
} from "../../../packages/core-harness/src/cognition.js";
import {
  ClaimStatus,
  SemanticMemorySourceRefKind,
  TrustBoundary,
  createAttestationIssuer,
  createDecisionArtifact,
  createEvidenceArtifact,
  createInMemorySemanticMemoryProvider,
  createSemanticMemoryPort,
  defineSubject,
  defineTrustPolicy,
  environmentRefFromValue,
  evaluateTrustBoundary,
  policyRefFromValue
} from "../../../packages/core-harness/src/index.js";
import {
  createDeterministicClock,
  createDeterministicIdFactory
} from "../../../packages/core-harness/src/testing.js";

const root = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const replayArtifact = JSON.parse(await readFile(
  join(root, "artifacts", "bb038-workflow-replay-eval.json"),
  "utf8"
));
const replayDigest = createHash("sha256")
  .update(JSON.stringify(replayArtifact))
  .digest("hex");

const TARGET_SCENARIO_ID = "cancellation-late-reconciliation";
const DEVELOPMENT_CONTROL_IDS = Object.freeze([
  "artifact-outage",
  "retry-recorded-effect"
]);
const HELD_OUT_CONTROL_IDS = Object.freeze(["review-delay"]);
const EXPERIMENT_BUDGET = Object.freeze({
  scenarios: 4,
  policyIdentities: 2,
  repeatPasses: 2,
  externalMutations: 0
});
const EXPERIMENT_ACTION_NAME = "evaluation.compare-recorded-policy";
const REPLAY_ARTIFACT_REF = "artifacts/bb038-workflow-replay-eval.json";

function scenarioById(artifact, id) {
  return artifact.comparison.find((item) => item.scenarioId === id) ?? null;
}

const failureScenario = scenarioById(replayArtifact, TARGET_SCENARIO_ID);
assert.ok(failureScenario, "BB-034 target replay scenario must exist");
assert.equal(failureScenario.baselineFinalStatus, "REOPENED");
assert.equal(failureScenario.candidateFinalStatus, "SUPERSEDED");

const baselineCandidate = Object.freeze({
  id: "workflow-policy",
  version: replayArtifact.policyPair.baseline.id
});
const candidateCandidate = Object.freeze({
  id: "workflow-policy",
  version: replayArtifact.policyPair.candidate.id
});

const failureObservation = Object.freeze({
  id: "observation-bb038-failure",
  candidate: baselineCandidate,
  kind: "RECORDED_POLICY_FAILURE",
  replayArtifactRef: REPLAY_ARTIFACT_REF,
  replayArtifactDigest: replayDigest,
  scenarioId: TARGET_SCENARIO_ID,
  changedEventId: failureScenario.changedEventId,
  baselineFinalStatus: failureScenario.baselineFinalStatus,
  candidateFinalStatus: failureScenario.candidateFinalStatus
});
const failureEvaluation = Object.freeze({
  id: "evaluation-bb038-failure",
  candidate: baselineCandidate,
  verdict: "FAIL",
  failureCode: "TERMINAL_CANCELLATION_VIOLATED",
  metadata: {
    replayArtifactRef: REPLAY_ARTIFACT_REF,
    replayArtifactDigest: replayDigest,
    scenarioId: TARGET_SCENARIO_ID,
    baselineFinalStatus: failureScenario.baselineFinalStatus,
    candidateFinalStatus: failureScenario.candidateFinalStatus,
    inputSnapshot: {
      observationIds: [failureObservation.id],
      verificationIds: []
    }
  }
});

let state = {
  id: "bb034-self-upgrade",
  revision: 1,
  currentCandidate: baselineCandidate,
  persistentMemory: {
    observations: [failureObservation],
    verifications: [],
    evaluations: [failureEvaluation]
  }
};
const sessionStore = {
  async load(id) {
    return id === state.id ? structuredClone(state) : null;
  }
};

const memory = createSemanticMemoryPort({
  provider: createInMemorySemanticMemoryProvider(),
  clock: createDeterministicClock({ start: "2026-09-16T00:00:00.000Z" }),
  idFactory: createDeterministicIdFactory("bb034-memory")
});

const cognition = createGroundedCognitionPort({
  memory,
  sessionStore,
  groundingVerifier: defineGroundingVerifier({
    name: "bb034-failure-grounder",
    revision: "2",
    async verify({ proposal, sources }) {
      const evaluation = sources.find((item) => item.id === failureEvaluation.id) ?? null;
      const observation = sources.find((item) => item.id === failureObservation.id) ?? null;
      const exactFailure =
        proposal.candidate.id === baselineCandidate.id &&
        proposal.candidate.version === baselineCandidate.version &&
        evaluation?.verdict === "FAIL" &&
        evaluation?.failureCode === "TERMINAL_CANCELLATION_VIOLATED" &&
        evaluation?.metadata?.replayArtifactRef === REPLAY_ARTIFACT_REF &&
        evaluation?.metadata?.replayArtifactDigest === replayDigest &&
        evaluation?.metadata?.scenarioId === TARGET_SCENARIO_ID &&
        observation?.kind === "RECORDED_POLICY_FAILURE" &&
        observation?.replayArtifactRef === REPLAY_ARTIFACT_REF &&
        observation?.replayArtifactDigest === replayDigest &&
        observation?.scenarioId === TARGET_SCENARIO_ID &&
        observation?.baselineFinalStatus === "REOPENED" &&
        observation?.candidateFinalStatus === "SUPERSEDED";
      return {
        verdict: exactFailure ? GroundingVerdict.GROUNDED : GroundingVerdict.REJECTED,
        reason: exactFailure
          ? "persisted evaluation and observation bind the reflection to the exact BB-038 cancellation replay digest and failure outcome"
          : "the persisted sources do not establish the exact BB-038 cancellation failure",
        confidence: exactFailure ? 1 : 0
      };
    }
  }),
  clock: createDeterministicClock({ start: "2026-09-16T00:01:00.000Z" }),
  idFactory: createDeterministicIdFactory("bb034-cognition")
});

const reflection = await cognition.deriveReflection({
  sessionId: state.id,
  content: "The exact recorded BB-038 cancellation scenario shows the baseline reopening terminally cancelled work; evaluate the terminal-cancellation candidate only inside the recorded experiment boundary.",
  tags: ["bb024", "cancellation", "self-upgrade-pilot"],
  confidence: 1,
  sourceRefs: [
    { kind: SemanticMemorySourceRefKind.OBSERVATION, id: failureObservation.id },
    { kind: SemanticMemorySourceRefKind.EVALUATION, id: failureEvaluation.id }
  ],
  provenance: {
    source: "bb034-self-upgrade-probe",
    sourceId: `sha256:${replayDigest}`
  }
});
assert.equal(reflection.memory.status, "ACTIVE");
assert.equal(reflection.grounding.verdict, GroundingVerdict.GROUNDED);
assert.equal(reflection.grounding.verifier.revision, "2");
assert.equal(reflection.grounding.sourceSnapshots.length, 2);

state = {
  ...structuredClone(state),
  revision: 2,
  currentCandidate: candidateCandidate
};
let staleEvaluationRejected = false;
try {
  await cognition.deriveReflection({
    sessionId: state.id,
    content: "This must not activate from the baseline evaluation after candidate state changed.",
    tags: ["stale-evidence-check"],
    confidence: 1,
    sourceRefs: [
      { kind: SemanticMemorySourceRefKind.OBSERVATION, id: failureObservation.id },
      { kind: SemanticMemorySourceRefKind.EVALUATION, id: failureEvaluation.id }
    ],
    provenance: {
      source: "bb034-self-upgrade-probe",
      sourceId: "stale-evaluation-negative-control"
    }
  });
} catch {
  staleEvaluationRejected = true;
}
assert.equal(staleEvaluationRejected, true);

function evaluateDevelopment(artifact) {
  const target = scenarioById(artifact, TARGET_SCENARIO_ID);
  const controls = DEVELOPMENT_CONTROL_IDS.map((id) => scenarioById(artifact, id));
  const targetFixed = target?.changed === true &&
    target.baselineFinalStatus === "REOPENED" &&
    target.candidateFinalStatus === "SUPERSEDED";
  const developmentControlsStable = controls.every(
    (item) => item != null && item.changed === false
  );
  const noExternalDispatch = artifact.metrics.externalDispatchCount === 0 &&
    artifact.comparison.every((item) => item.externalDispatchCount === 0);
  const policyIdentityCount = new Set([
    artifact.policyPair.baseline.id,
    artifact.policyPair.candidate.id
  ]).size;
  const scenarioBudgetRespected = artifact.metrics.scenarioCount === EXPERIMENT_BUDGET.scenarios &&
    artifact.comparison.length === EXPERIMENT_BUDGET.scenarios;
  const policyIdentityBudgetRespected = policyIdentityCount === EXPERIMENT_BUDGET.policyIdentities;
  const repeatBudgetRespected = artifact.metrics.deterministicRepeatPasses === EXPERIMENT_BUDGET.repeatPasses;
  const externalMutationBudgetRespected = noExternalDispatch && EXPERIMENT_BUDGET.externalMutations === 0;
  const budgetRespected = scenarioBudgetRespected &&
    policyIdentityBudgetRespected &&
    repeatBudgetRespected &&
    externalMutationBudgetRespected;
  return Object.freeze({
    accepted: targetFixed && developmentControlsStable && budgetRespected,
    targetFixed,
    developmentControlsStable,
    noExternalDispatch,
    budgetRespected,
    policyIdentityCount,
    policyIdentityBudgetRespected
  });
}

function evaluateHeldOutControl(artifact) {
  const controls = HELD_OUT_CONTROL_IDS.map((id) => scenarioById(artifact, id));
  const heldOutControlStable = controls.every((item) => item != null && item.changed === false);
  return Object.freeze({
    accepted: heldOutControlStable,
    heldOutControlStable
  });
}

function evaluateCandidate(artifact) {
  const development = evaluateDevelopment(artifact);
  const heldOut = evaluateHeldOutControl(artifact);
  const accepted = development.accepted && heldOut.accepted;
  return Object.freeze({
    accepted,
    developmentAccepted: development.accepted,
    targetFixed: development.targetFixed,
    developmentControlsStable: development.developmentControlsStable,
    heldOutAccepted: heldOut.accepted,
    heldOutStable: heldOut.heldOutControlStable,
    noExternalDispatch: development.noExternalDispatch,
    budgetRespected: development.budgetRespected,
    policyIdentityCount: development.policyIdentityCount,
    policyIdentityBudgetRespected: development.policyIdentityBudgetRespected,
    stopReason: accepted ? "PROPOSE_FOR_REVIEW" : "KEEP_BASELINE"
  });
}

const heldOutFailureFixture = structuredClone(replayArtifact);
const heldOutFailure = scenarioById(heldOutFailureFixture, HELD_OUT_CONTROL_IDS[0]);
assert.ok(heldOutFailure, "held-out control scenario must exist");
heldOutFailure.changed = true;
heldOutFailure.changedEventId = "heldout:review-delay-regression";
heldOutFailure.candidateFinalStatus = "REOPENED";
heldOutFailureFixture.metrics.behavioralDivergenceCount += 1;
heldOutFailureFixture.metrics.unaffectedScheduleCount -= 1;

const EXPERIMENT_PAYLOAD = Object.freeze({
  artifactRef: REPLAY_ARTIFACT_REF,
  artifactDigest: replayDigest,
  baselinePolicy: replayArtifact.policyPair.baseline,
  candidatePolicy: replayArtifact.policyPair.candidate,
  targetScenarioId: TARGET_SCENARIO_ID,
  developmentControlScenarioIds: DEVELOPMENT_CONTROL_IDS,
  heldOutControlScenarioIds: HELD_OUT_CONTROL_IDS,
  budget: EXPERIMENT_BUDGET,
  adoptionAuthority: false
});
const expectedPayloadJson = JSON.stringify(EXPERIMENT_PAYLOAD);

function exactExperimentAction(actionIntent) {
  return actionIntent?.action?.target === ActionIntentTargetKind.CUSTOM &&
    actionIntent.action.name === EXPERIMENT_ACTION_NAME &&
    JSON.stringify(actionIntent.action.payload) === expectedPayloadJson;
}

const deliberationStore = createDeliberationStore({
  clock: createDeterministicClock({ start: "2026-09-16T00:02:00.000Z" }),
  idFactory: createDeterministicIdFactory("bb034-deliberation")
});
const deliberation = createDeliberationController({
  store: deliberationStore,
  actionIntentPolicy: {
    name: "bb034-experiment-only-policy",
    revision: "2",
    async authorize({ actionIntent }) {
      const allowed = exactExperimentAction(actionIntent);
      return {
        decision: allowed
          ? ActionIntentAuthorizationDecision.ALLOW
          : ActionIntentAuthorizationDecision.DENY,
        reason: allowed
          ? "exact recorded-policy experiment payload authorized; mutation and adoption remain outside this ActionIntent"
          : "action intent is outside the exact BB-034 experiment-only subject/payload",
        evidenceRefs: [
          { kind: "MEMORY", id: reflection.memory.id },
          { kind: "EVALUATION", id: failureEvaluation.id }
        ]
      };
    }
  }
});

function experimentStep({ callId, action }) {
  return deliberation.deliberate({
    callId,
    turn: 1,
    sourceRefs: [
      { kind: "MEMORY", id: reflection.memory.id },
      { kind: "EVALUATION", id: failureEvaluation.id }
    ],
    contextRefs: [{ kind: "ARTIFACT", id: REPLAY_ARTIFACT_REF }],
    intent: "Evaluate one isolated recorded terminal-cancellation policy candidate without changing live runtime behavior.",
    expectedOutcome: "The candidate fixes the target regression while preserving controls under the fixed budget.",
    successCondition: "Target fixed, development controls stable, recorded held-out control stable, zero external dispatch, exact two-policy/four-scenario/two-repeat budget respected.",
    constraints: [
      { kind: "authority", value: "experiment-only" },
      { kind: "budget", value: "4-scenarios/2-policy-identities/2-repeat-passes/0-external-mutations" },
      { kind: "held-out-control", value: HELD_OUT_CONTROL_IDS.join(",") },
      { kind: "adoption", value: "proposal-only" }
    ],
    action
  });
}

const proposal = experimentStep({
  callId: "bb034-self-upgrade-experiment",
  action: {
    target: ActionIntentTargetKind.CUSTOM,
    name: EXPERIMENT_ACTION_NAME,
    payload: EXPERIMENT_PAYLOAD
  }
});
assert.equal(proposal.actionIntent.action.name, EXPERIMENT_ACTION_NAME);
assert.equal(JSON.stringify(proposal.actionIntent.action.payload), expectedPayloadJson);

let tamperedPayloadOperationRan = false;
const tamperedPayload = experimentStep({
  callId: "bb034-tampered-payload",
  action: {
    target: ActionIntentTargetKind.CUSTOM,
    name: EXPERIMENT_ACTION_NAME,
    payload: {
      ...structuredClone(EXPERIMENT_PAYLOAD),
      budget: { ...EXPERIMENT_BUDGET, scenarios: 999 }
    }
  }
});
let tamperedPayloadRejected = false;
try {
  await deliberation.execute(tamperedPayload.actionIntent.artifactRef, async () => {
    tamperedPayloadOperationRan = true;
    return null;
  });
} catch {
  tamperedPayloadRejected = true;
}
assert.equal(tamperedPayloadRejected, true);
assert.equal(tamperedPayloadOperationRan, false);
assert.equal(
  deliberation.getActionIntent(tamperedPayload.actionIntent.id).status,
  ActionIntentStatus.REJECTED
);

let mutationOperationRan = false;
const mutationAttempt = experimentStep({
  callId: "bb034-mutation-attempt",
  action: {
    target: ActionIntentTargetKind.CUSTOM,
    name: "repository.mutate",
    payload: { branch: "main", action: "replace-policy" }
  }
});
let mutationActionRejected = false;
try {
  await deliberation.execute(mutationAttempt.actionIntent.artifactRef, async () => {
    mutationOperationRan = true;
    return null;
  });
} catch {
  mutationActionRejected = true;
}
assert.equal(mutationActionRejected, true);
assert.equal(mutationOperationRan, false);

const executed = await deliberation.execute(
  proposal.actionIntent.artifactRef,
  async (authorized) => {
    assert.equal(exactExperimentAction(authorized), true);
    return {
      artifactRef: { kind: "EXPERIMENT_RESULT", id: "bb034-terminal-cancellation-pilot-v2" },
      value: evaluateCandidate(replayArtifact)
    };
  }
);
assert.equal(executed.actionIntent.status, ActionIntentStatus.EXECUTED);
assert.equal(executed.result.value.accepted, true);

const negativeResult = evaluateCandidate(heldOutFailureFixture);
assert.equal(negativeResult.developmentAccepted, true);
assert.equal(negativeResult.heldOutAccepted, false);
assert.equal(negativeResult.accepted, false);
assert.equal(negativeResult.stopReason, "KEEP_BASELINE");

const experimentDigest = createHash("sha256")
  .update(JSON.stringify({
    replayDigest,
    payload: EXPERIMENT_PAYLOAD,
    outcome: executed.result.value,
    tamperedPayloadRejected,
    mutationActionRejected
  }))
  .digest("hex");
const subject = defineSubject({
  type: "self-upgrade-experiment",
  digest: experimentDigest,
  producer: { identity: "bb034-experiment-proposer", roles: ["proposer"] }
});
const evidenceEnvironment = environmentRefFromValue(
  { fixture: "bb038-workflow-policy-replay", digest: replayDigest },
  { name: "bb034-controlled-experiment" }
);
const attestationEnvironment = environmentRefFromValue(
  { fixture: "bb034-independent-attestation", version: 2 },
  { name: "bb034-attestation" }
);

const evidenceClaims = {
  failureGroundingBoundToReplayDigest: true,
  experimentScopeEnforced: tamperedPayloadRejected && mutationActionRejected,
  targetRegressionFixed: executed.result.value.targetFixed,
  developmentControlsStable: executed.result.value.developmentControlsStable,
  heldOutControlStable: executed.result.value.heldOutStable,
  noExternalDispatch: executed.result.value.noExternalDispatch,
  budgetRespected: executed.result.value.budgetRespected
};
const evidence = [createEvidenceArtifact({
  subject,
  kind: "SELF_UPGRADE_EXPERIMENT_RESULT",
  producer: { identity: "bb034-experiment-verifier", roles: ["verifier"] },
  environment: evidenceEnvironment,
  generatedAt: "2026-09-16T00:03:00.000Z",
  content: {
    ...evidenceClaims,
    evidenceClass: replayArtifact.evidenceClass,
    productionEvidence: replayArtifact.productionEvidence
  }
})];
const requiredClaims = [
  "failure-grounding-bound-to-replay",
  "experiment-scope-enforced",
  "target-regression-fixed",
  "development-controls-stable",
  "held-out-control-stable",
  "no-external-dispatch",
  "budget-respected"
];
const policy = policyRefFromValue("bb034-experiment-acceptance-v3", {
  required: requiredClaims
});
const decision = createDecisionArtifact({
  subject,
  boundary: TrustBoundary.ACCEPTANCE,
  policy,
  evaluator: { identity: "bb034-experiment-evaluator", roles: ["evaluator"] },
  evidence,
  claims: requiredClaims.map((name) => ({ name, status: ClaimStatus.SATISFIED })),
  verdict: "READY",
  generatedAt: "2026-09-16T00:04:00.000Z"
});
const issuer = createAttestationIssuer({
  identity: "bb034-experiment-attestor",
  roles: ["attestor"],
  async sign({ payloadDigest }) {
    return { value: payloadDigest };
  }
});
const attestation = await issuer.issue({
  decision,
  environment: attestationEnvironment,
  issuedAt: "2026-09-16T00:05:00.000Z"
});
const trust = await evaluateTrustBoundary({
  attestation,
  decision,
  currentSubject: subject,
  evidence,
  policy: defineTrustPolicy({
    acceptedIssuers: ["bb034-experiment-attestor"],
    acceptedPolicyDigests: [policy.digest],
    acceptedEvaluators: ["bb034-experiment-evaluator"],
    acceptedEvidenceProducers: ["bb034-experiment-verifier"],
    requiredClaims,
    requireIndependentIssuer: true,
    requireIndependentEvidenceProducers: true
  }),
  verifySignature: ({ payloadDigest, signature }) => signature.value === payloadDigest,
  verifyEvaluatorAuthority: ({ evaluator }) => evaluator.identity === "bb034-experiment-evaluator",
  verifyEvidenceAuthority: ({ producer }) => producer.identity === "bb034-experiment-verifier"
});
assert.equal(trust.trusted, true);

const report = {
  schemaVersion: 3,
  evidenceClass: "DETERMINISTIC_SELF_UPGRADE_RESEARCH_FIXTURE",
  productionEvidence: false,
  pilot: {
    observedFailure: "BB-024 delayed finding reconciliation can revive SUPERSEDED work",
    replayArtifactRef: REPLAY_ARTIFACT_REF,
    replayArtifactDigest: replayDigest,
    baselinePolicy: replayArtifact.policyPair.baseline.id,
    candidatePolicy: replayArtifact.policyPair.candidate.id,
    experimentBudget: EXPERIMENT_BUDGET,
    targetScenarioId: TARGET_SCENARIO_ID,
    developmentControlScenarioIds: DEVELOPMENT_CONTROL_IDS,
    heldOutControlScenarioIds: HELD_OUT_CONTROL_IDS
  },
  grounding: {
    reflectionActivatedFromFreshEvaluation: reflection.memory.status === "ACTIVE",
    failureGroundingBoundToReplayDigest: reflection.grounding.verdict === GroundingVerdict.GROUNDED,
    groundingVerifierRevision: reflection.grounding.verifier.revision,
    staleEvaluationRejected
  },
  proposal: {
    boundedDeliberationCreated: proposal.deliberation.actionIntentRef.id === proposal.actionIntent.id,
    actionPayloadPreserved: JSON.stringify(proposal.actionIntent.action.payload) === expectedPayloadJson,
    experimentActionExecuted: executed.actionIntent.status === ActionIntentStatus.EXECUTED,
    tamperedPayloadRejected,
    tamperedPayloadOperationRan,
    mutationActionRejected,
    mutationOperationRan,
    authorizedScope: "EXPERIMENT_ONLY",
    adoptionAuthorityGranted: false
  },
  experiment: {
    ...executed.result.value,
    negativeHeldOutControlRejected: negativeResult.accepted === false && negativeResult.developmentAccepted === true,
    negativeHeldOutStopReason: negativeResult.stopReason,
    scenarioCount: replayArtifact.metrics.scenarioCount,
    externalDispatchCount: replayArtifact.metrics.externalDispatchCount,
    inputFixtureBytes: replayArtifact.metrics.inputFixtureBytes,
    replayTraceBytes: replayArtifact.metrics.replayTraceBytes,
    heldOutIsRecordedControl: true,
    generalizationEvidence: false
  },
  independentAcceptance: {
    trusted: trust.trusted,
    boundary: trust.boundary,
    evaluator: decision.evaluator.identity,
    evidenceProducer: evidence[0].producer.identity,
    attestor: attestation.issuer.identity,
    identitySeparatedAuthorities: new Set([
      decision.evaluator.identity,
      evidence[0].producer.identity,
      attestation.issuer.identity
    ]).size === 3,
    proposalReadyForApplicationReview: trust.trusted,
    adoptionAuthorized: false
  },
  stopAndRollback: {
    pass: "PROPOSE_FOR_REVIEW",
    failOrInconclusive: "KEEP_BASELINE",
    heldOutFailure: "KEEP_BASELINE",
    selectedPolicyUntilApplicationAdoption: replayArtifact.policyPair.baseline.id,
    rollbackPolicyFieldForFixture: replayArtifact.policyPair.baseline.id,
    productionRollbackRecommendation: false
  },
  limitations: {
    fixtureOnly: true,
    sameProcessAuthorityFixture: true,
    candidateAlreadyKnownFromBB024Research: true,
    heldOutIsDeterministicRecordedControl: true,
    candidateGenerationQualityMeasured: false,
    implementationDeliveryDeferredToBB035: true,
    productionRolloutJustified: false,
    selfModificationAuthority: false
  }
};

const expected = JSON.parse(await readFile(
  join(root, "artifacts", "bb034-self-upgrade-loop-probe.json"),
  "utf8"
));
assert.deepEqual(report, expected, "BB-034 self-upgrade research probe drifted from its checked result");
console.log(`bb034-self-upgrade-loop:${JSON.stringify(report)}`);
