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

// Predeclared before any candidate outcome is evaluated.
const TARGET_SCENARIO_ID = "cancellation-late-reconciliation";
const DEVELOPMENT_CONTROL_IDS = Object.freeze([
  "artifact-outage",
  "retry-recorded-effect"
]);
const HELD_OUT_SCENARIO_IDS = Object.freeze(["review-delay"]);
const EXPERIMENT_BUDGET = Object.freeze({
  scenarios: 4,
  policyIdentities: 2,
  repeatPasses: 2,
  externalMutations: 0
});

const baselineCandidate = Object.freeze({
  id: "workflow-policy",
  version: replayArtifact.policyPair.baseline.id
});

function evaluation(id, candidate, observationIds) {
  return {
    id,
    candidate,
    metadata: {
      inputSnapshot: { observationIds, verificationIds: [] }
    }
  };
}

let state = {
  id: "bb034-self-upgrade",
  revision: 1,
  currentCandidate: baselineCandidate,
  persistentMemory: {
    observations: [{ id: "observation-bb038-failure", candidate: baselineCandidate }],
    verifications: [],
    evaluations: [evaluation(
      "evaluation-bb038-failure",
      baselineCandidate,
      ["observation-bb038-failure"]
    )]
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
    revision: "1",
    async verify({ proposal }) {
      const hasEvaluation = proposal.sourceRefs.some(
        (ref) => ref.kind === SemanticMemorySourceRefKind.EVALUATION
      );
      return {
        verdict: hasEvaluation ? GroundingVerdict.GROUNDED : GroundingVerdict.REJECTED,
        reason: hasEvaluation
          ? "recorded evaluation supports the bounded failure reflection"
          : "a fresh evaluation source is required",
        confidence: hasEvaluation ? 1 : 0
      };
    }
  }),
  clock: createDeterministicClock({ start: "2026-09-16T00:01:00.000Z" }),
  idFactory: createDeterministicIdFactory("bb034-cognition")
});

const reflection = await cognition.deriveReflection({
  sessionId: state.id,
  content: "Recorded BB-038 evaluation reproduces late finding reconciliation reviving SUPERSEDED work; test a terminal-cancellation guard only inside the recorded policy experiment.",
  tags: ["bb024", "cancellation", "self-upgrade-pilot"],
  confidence: 1,
  sourceRefs: [{
    kind: SemanticMemorySourceRefKind.EVALUATION,
    id: "evaluation-bb038-failure"
  }],
  provenance: {
    source: "bb034-self-upgrade-probe",
    sourceId: "bb038-cancellation-regression"
  }
});
assert.equal(reflection.memory.status, "ACTIVE");

state = {
  ...structuredClone(state),
  revision: 2,
  currentCandidate: {
    id: "workflow-policy",
    version: replayArtifact.policyPair.candidate.id
  }
};

let staleEvaluationRejected = false;
try {
  await cognition.deriveReflection({
    sessionId: state.id,
    content: "This must not activate from the old baseline evaluation after candidate state changed.",
    tags: ["stale-evidence-check"],
    confidence: 1,
    sourceRefs: [{
      kind: SemanticMemorySourceRefKind.EVALUATION,
      id: "evaluation-bb038-failure"
    }],
    provenance: {
      source: "bb034-self-upgrade-probe",
      sourceId: "stale-evaluation-negative-control"
    }
  });
} catch {
  staleEvaluationRejected = true;
}
assert.equal(staleEvaluationRejected, true);

function scenarioById(artifact, id) {
  return artifact.comparison.find((item) => item.scenarioId === id) ?? null;
}

function evaluateDevelopment(artifact) {
  const target = scenarioById(artifact, TARGET_SCENARIO_ID);
  const developmentControls = DEVELOPMENT_CONTROL_IDS.map((id) => scenarioById(artifact, id));
  const targetFixed = target?.changed === true &&
    target.baselineFinalStatus === "REOPENED" &&
    target.candidateFinalStatus === "SUPERSEDED";
  const developmentControlsStable = developmentControls.every(
    (item) => item != null && item.changed === false
  );
  const noExternalDispatch = artifact.metrics.externalDispatchCount === 0 &&
    artifact.comparison.every((item) => item.externalDispatchCount === 0);
  const budgetRespected = artifact.metrics.scenarioCount === EXPERIMENT_BUDGET.scenarios &&
    artifact.comparison.length === EXPERIMENT_BUDGET.scenarios &&
    artifact.metrics.deterministicRepeatPasses === EXPERIMENT_BUDGET.repeatPasses;
  const accepted = targetFixed && developmentControlsStable && noExternalDispatch && budgetRespected;
  return Object.freeze({
    accepted,
    targetFixed,
    developmentControlsStable,
    noExternalDispatch,
    budgetRespected
  });
}

function evaluateHeldOut(artifact) {
  const heldOut = HELD_OUT_SCENARIO_IDS.map((id) => scenarioById(artifact, id));
  const heldOutStable = heldOut.every((item) => item != null && item.changed === false);
  return Object.freeze({ accepted: heldOutStable, heldOutStable });
}

function evaluateCandidate(artifact) {
  const development = evaluateDevelopment(artifact);
  const heldOut = evaluateHeldOut(artifact);
  const accepted = development.accepted && heldOut.accepted;
  return Object.freeze({
    accepted,
    developmentAccepted: development.accepted,
    targetFixed: development.targetFixed,
    developmentControlsStable: development.developmentControlsStable,
    heldOutAccepted: heldOut.accepted,
    heldOutStable: heldOut.heldOutStable,
    noExternalDispatch: development.noExternalDispatch,
    budgetRespected: development.budgetRespected,
    stopReason: accepted ? "PROPOSE_FOR_REVIEW" : "KEEP_BASELINE"
  });
}

// Negative held-out fixture is fixed before the candidate experiment is executed.
const heldOutFailureFixture = structuredClone(replayArtifact);
const heldOutFailure = scenarioById(heldOutFailureFixture, HELD_OUT_SCENARIO_IDS[0]);
assert.ok(heldOutFailure, "held-out scenario must exist");
heldOutFailure.changed = true;
heldOutFailure.changedEventId = "heldout:review-delay-regression";
heldOutFailure.candidateFinalStatus = "REOPENED";
heldOutFailureFixture.metrics.behavioralDivergenceCount += 1;
heldOutFailureFixture.metrics.unaffectedScheduleCount -= 1;

const deliberationStore = createDeliberationStore({
  clock: createDeterministicClock({ start: "2026-09-16T00:02:00.000Z" }),
  idFactory: createDeterministicIdFactory("bb034-deliberation")
});
const deliberation = createDeliberationController({
  store: deliberationStore,
  actionIntentPolicy: {
    name: "bb034-experiment-only-policy",
    revision: "1",
    async authorize() {
      return {
        decision: ActionIntentAuthorizationDecision.ALLOW,
        reason: "Only the isolated recorded replay experiment is authorized; adoption and runtime mutation remain outside this ActionIntent.",
        evidenceRefs: [
          { kind: "MEMORY", id: reflection.memory.id },
          { kind: "EVALUATION", id: "evaluation-bb038-failure" }
        ]
      };
    }
  }
});

const proposal = deliberation.deliberate({
  callId: "bb034-self-upgrade-experiment",
  turn: 1,
  sourceRefs: [
    { kind: "MEMORY", id: reflection.memory.id },
    { kind: "EVALUATION", id: "evaluation-bb038-failure" }
  ],
  contextRefs: [{ kind: "ARTIFACT", id: "artifacts/bb038-workflow-replay-eval.json" }],
  intent: "Evaluate one isolated terminal-cancellation policy candidate without changing live runtime behavior.",
  expectedOutcome: "The candidate fixes the target regression, preserves development controls, and passes the predeclared held-out review-delay schedule.",
  successCondition: "Target fixed, development controls stable, held-out stable, zero external dispatch, and fixed four-scenario/two-repeat budget respected.",
  constraints: [
    { kind: "authority", value: "experiment-only" },
    { kind: "budget", value: "4-scenarios/2-policy-identities/2-repeat-passes" },
    { kind: "held-out", value: HELD_OUT_SCENARIO_IDS.join(",") },
    { kind: "adoption", value: "proposal-only" }
  ],
  action: {
    target: ActionIntentTargetKind.CUSTOM,
    name: "evaluation.compare-recorded-policy",
    input: {
      artifactRef: "artifacts/bb038-workflow-replay-eval.json",
      baselinePolicy: replayArtifact.policyPair.baseline,
      candidatePolicy: replayArtifact.policyPair.candidate,
      targetScenarioId: TARGET_SCENARIO_ID,
      developmentControlScenarioIds: DEVELOPMENT_CONTROL_IDS,
      heldOutScenarioIds: HELD_OUT_SCENARIO_IDS,
      budget: EXPERIMENT_BUDGET
    }
  }
});

const executed = await deliberation.execute(
  proposal.actionIntent.artifactRef,
  async () => ({
    artifactRef: { kind: "EXPERIMENT_RESULT", id: "bb034-terminal-cancellation-pilot" },
    value: evaluateCandidate(replayArtifact)
  })
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
    baseline: replayArtifact.policyPair.baseline,
    candidate: replayArtifact.policyPair.candidate,
    targetScenarioId: TARGET_SCENARIO_ID,
    developmentControlScenarioIds: DEVELOPMENT_CONTROL_IDS,
    heldOutScenarioIds: HELD_OUT_SCENARIO_IDS,
    budget: EXPERIMENT_BUDGET,
    outcome: executed.result.value
  }))
  .digest("hex");
const subject = defineSubject({
  type: "self-upgrade-experiment",
  digest: experimentDigest,
  producer: { identity: "bb034-experiment-proposer", roles: ["proposer"] }
});
const evidenceEnvironment = environmentRefFromValue(
  { fixture: "bb038-workflow-policy-replay", version: 1 },
  { name: "bb034-controlled-experiment" }
);
const attestationEnvironment = environmentRefFromValue(
  { fixture: "bb034-independent-attestation", version: 1 },
  { name: "bb034-attestation" }
);
const evidence = [createEvidenceArtifact({
  subject,
  kind: "SELF_UPGRADE_EXPERIMENT_RESULT",
  producer: { identity: "bb034-experiment-verifier", roles: ["verifier"] },
  environment: evidenceEnvironment,
  generatedAt: "2026-09-16T00:03:00.000Z",
  content: {
    ...executed.result.value,
    evidenceClass: replayArtifact.evidenceClass,
    productionEvidence: replayArtifact.productionEvidence
  }
})];
const policy = policyRefFromValue("bb034-experiment-acceptance-v2", {
  required: [
    "target-regression-fixed",
    "development-controls-stable",
    "held-out-stable",
    "no-external-dispatch",
    "budget-respected"
  ]
});
const decision = createDecisionArtifact({
  subject,
  boundary: TrustBoundary.ACCEPTANCE,
  policy,
  evaluator: { identity: "bb034-experiment-evaluator", roles: ["evaluator"] },
  evidence,
  claims: [
    { name: "target-regression-fixed", status: ClaimStatus.SATISFIED },
    { name: "development-controls-stable", status: ClaimStatus.SATISFIED },
    { name: "held-out-stable", status: ClaimStatus.SATISFIED },
    { name: "no-external-dispatch", status: ClaimStatus.SATISFIED },
    { name: "budget-respected", status: ClaimStatus.SATISFIED }
  ],
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
    requiredClaims: [
      "target-regression-fixed",
      "development-controls-stable",
      "held-out-stable",
      "no-external-dispatch",
      "budget-respected"
    ],
    requireIndependentIssuer: true,
    requireIndependentEvidenceProducers: true
  }),
  verifySignature: ({ payloadDigest, signature }) => signature.value === payloadDigest,
  verifyEvaluatorAuthority: ({ evaluator }) => evaluator.identity === "bb034-experiment-evaluator",
  verifyEvidenceAuthority: ({ producer }) => producer.identity === "bb034-experiment-verifier"
});
assert.equal(trust.trusted, true);

const report = {
  schemaVersion: 2,
  evidenceClass: "DETERMINISTIC_SELF_UPGRADE_RESEARCH_FIXTURE",
  productionEvidence: false,
  pilot: {
    observedFailure: "BB-024 delayed finding reconciliation can revive SUPERSEDED work",
    baselinePolicy: replayArtifact.policyPair.baseline.id,
    candidatePolicy: replayArtifact.policyPair.candidate.id,
    experimentRef: "artifacts/bb038-workflow-replay-eval.json",
    experimentBudget: EXPERIMENT_BUDGET,
    targetScenarioId: TARGET_SCENARIO_ID,
    developmentControlScenarioIds: DEVELOPMENT_CONTROL_IDS,
    heldOutScenarioIds: HELD_OUT_SCENARIO_IDS
  },
  grounding: {
    reflectionActivatedFromFreshEvaluation: reflection.memory.status === "ACTIVE",
    staleEvaluationRejected
  },
  proposal: {
    boundedDeliberationCreated: proposal.deliberation.actionIntentRef.id === proposal.actionIntent.id,
    experimentActionExecuted: executed.actionIntent.status === ActionIntentStatus.EXECUTED,
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
    replayTraceBytes: replayArtifact.metrics.replayTraceBytes
  },
  independentAcceptance: {
    trusted: trust.trusted,
    boundary: trust.boundary,
    evaluator: decision.evaluator.identity,
    evidenceProducer: evidence[0].producer.identity,
    attestor: attestation.issuer.identity,
    proposalReadyForApplicationReview: trust.trusted,
    adoptionAuthorized: false
  },
  stopAndRollback: {
    pass: "PROPOSE_FOR_REVIEW",
    failOrInconclusive: "KEEP_BASELINE",
    heldOutFailure: "KEEP_BASELINE",
    selectedPolicyUntilApplicationAdoption: replayArtifact.policyPair.baseline.id,
    rollbackPolicy: replayArtifact.policyPair.baseline.id
  },
  limitations: {
    fixtureOnly: true,
    candidateAlreadyKnownFromBB024Research: true,
    heldOutIsDeterministicRecordedSchedule: true,
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
