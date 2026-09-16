const workItem = {
  id: "BB-PROBE",
  work: "Remediate QA issue: cache invalidation remains stale.",
  status: "REOPENED",
  remainingWork: ["Remediate QA issues: cache invalidation remains stale"],
  artifactRefs: ["repo-artifact:patch-v1"],
  evidenceRefs: ["decision:backend-accept-v1", "decision:qa-continue-v1"],
  checkpoint: {
    kind: "BACKEND_QA_WORKFLOW",
    version: 1,
    stage: "BACKEND_REMEDIATION_PENDING",
    attempt: 0,
    acceptedBackend: {
      handoff: { revision: "rev-1", artifacts: [{ ref: "repo-artifact:patch-v1" }] },
      completionDecision: { id: "decision:backend-accept-v1", digest: "sha256:backend" }
    },
    qaIssues: ["cache invalidation remains stale"]
  }
};

const rawArtifacts = {
  deliberation: {
    id: "delib-1",
    judgment: {
      hypothesis: "Cache key is not invalidated after write.",
      alternatives: ["Invalidate after write", "Shorten TTL", "Bypass cache for the affected read"],
      selected: "Invalidate after write",
      rationale: "Targets the observed stale-read path without globally reducing cache effectiveness.",
      uncertainty: "The write path may have a second invalidation owner."
    },
    sourceRefs: [{ kind: "EVALUATION", id: "qa-eval-v1" }],
    contextRefs: [{ kind: "APPLICATION_ARTIFACT", id: "BB-PROBE" }],
    intent: "Repair the QA-observed stale cache behavior.",
    expectedOutcome: "The post-write read returns the new value.",
    successCondition: "Fresh evaluation passes the stale-cache regression.",
    constraints: [{ kind: "scope", value: "cache-invalidation" }],
    actionIntentRef: { kind: "ACTION_INTENT", id: "intent-1" }
  },
  actionIntent: {
    id: "intent-1",
    deliberationRef: { kind: "DELIBERATION", id: "delib-1" },
    action: { target: "CAPABILITY", name: "repo.patch", input: { file: "cache.js", operation: "invalidate-after-write" } },
    expectedOutcome: "The post-write read returns the new value.",
    successCondition: "Fresh evaluation passes the stale-cache regression.",
    status: "EXECUTED",
    authorization: {
      decision: "ALLOW",
      reason: "Change is scoped to the reproduced stale-cache path.",
      evidenceRefs: [{ kind: "EVALUATION", id: "qa-eval-v1" }],
      policy: { name: "backend-remediation-policy", revision: "3" }
    },
    outcomeRefs: [{ kind: "EFFECT_OPERATION", id: "effect-1" }, { kind: "REPOSITORY_REVISION", id: "rev-2" }],
    revision: 3
  },
  effectOperation: {
    operationId: "effect-1",
    status: "CONFIRMED",
    capability: "repo.patch",
    actionIntentRef: { kind: "ACTION_INTENT", id: "intent-1" },
    resultRef: { kind: "REPOSITORY_REVISION", id: "rev-2" }
  },
  evaluation: {
    id: "qa-eval-v2",
    candidate: { id: "candidate", version: "rev-2" },
    metadata: { inputSnapshot: { observationIds: ["obs-v2"], verificationIds: ["verify-v2"] } },
    verdict: "FAIL",
    reason: "A second write path still returns a stale value."
  },
  intentMemory: {
    id: "memory-intent-1",
    kind: "INTENT",
    status: "ACTIVE",
    revision: 1,
    content: "Fix stale cache behavior in this remediation attempt.",
    sourceRefs: [{ kind: "EVALUATION", id: "qa-eval-v1" }]
  },
  reflectionMemory: {
    id: "memory-reflection-1",
    kind: "REFLECTION",
    status: "ACTIVE",
    revision: 1,
    content: "The selected invalidation fixes one path but the QA regression still fails on a second write path.",
    sourceRefs: [
      { kind: "MEMORY", id: "memory-intent-1" },
      { kind: "EVALUATION", id: "qa-eval-v2" },
      { kind: "EXTERNAL", id: "grounding:ground-1" }
    ]
  },
  grounding: {
    id: "ground-1",
    sourceSnapshots: [
      { ref: { kind: "MEMORY", id: "memory-intent-1" }, revision: 1, digest: "sha256:intent" },
      { ref: { kind: "EVALUATION", id: "qa-eval-v2" }, revision: null, digest: "sha256:eval2" }
    ],
    verifier: { name: "evidence-grounder", revision: "1" },
    verdict: "GROUNDED",
    reason: "Fresh evaluation supports the bounded reflection.",
    confidence: 1
  },
  alignment: {
    id: "align-1",
    intentRef: { kind: "MEMORY", id: "memory-intent-1", revision: 1 },
    reflectionRef: { kind: "MEMORY", id: "memory-reflection-1", revision: 1 },
    groundingRef: { kind: "GROUNDING", id: "ground-1" },
    evaluationRefs: [{ kind: "EVALUATION", id: "qa-eval-v2" }],
    status: "DIVERGED",
    divergence: 0.85,
    reason: "Observed outcome only partially satisfies the intended fix."
  }
};

const summary = {
  kind: "DECISION_OUTCOME_SUMMARY",
  version: 1,
  workItemId: "BB-PROBE",
  objective: "Remediate QA-observed stale cache behavior.",
  hypothesis: "Cache key is not invalidated after write.",
  alternatives: ["Invalidate after write", "Shorten TTL", "Bypass cache for the affected read"],
  decision: {
    selected: "Invalidate after write",
    rationale: "Targets the observed stale-read path without globally reducing cache effectiveness.",
    uncertainty: ["A second invalidation owner may exist."],
    deliberationRef: { kind: "DELIBERATION", id: "delib-1" }
  },
  action: {
    actionIntentRef: { kind: "ACTION_INTENT", id: "intent-1", revision: 3 },
    authorization: {
      decision: "ALLOW",
      policy: { name: "backend-remediation-policy", revision: "3" },
      evidenceRefs: [{ kind: "EVALUATION", id: "qa-eval-v1" }]
    },
    outcomeRefs: [{ kind: "EFFECT_OPERATION", id: "effect-1" }, { kind: "REPOSITORY_REVISION", id: "rev-2" }]
  },
  observedOutcome: {
    status: "PARTIAL_FAILURE",
    evaluationRefs: [{ kind: "EVALUATION", id: "qa-eval-v2" }],
    statement: "One stale path was repaired, but a second write path still fails the regression."
  },
  reflection: {
    reflectionRef: { kind: "MEMORY", id: "memory-reflection-1", revision: 1 },
    groundingRef: { kind: "GROUNDING", id: "ground-1" },
    alignmentRef: { kind: "INTENT_REFLECTION_ALIGNMENT", id: "align-1" },
    status: "DIVERGED",
    divergence: 0.85
  },
  counterEvidenceRefs: [{ kind: "EVALUATION", id: "qa-eval-v2" }],
  authority: {
    rationaleIsCorrectnessEvidence: false,
    summaryIsAcceptanceAuthority: false,
    acceptanceMustResolveEvidenceRefs: true
  }
};

const canonical = {
  selectedAction: "Invalidate after write",
  alternativesConsidered: 3,
  authorizationDecision: "ALLOW",
  observedOutcome: "PARTIAL_FAILURE",
  alignmentStatus: "DIVERGED"
};

const currentBoundedAnswers = Object.fromEntries(Object.keys(canonical).map((key) => [key, null]));
const rawAnswers = {
  selectedAction: rawArtifacts.deliberation.judgment.selected,
  alternativesConsidered: rawArtifacts.deliberation.judgment.alternatives.length,
  authorizationDecision: rawArtifacts.actionIntent.authorization.decision,
  observedOutcome: rawArtifacts.evaluation.verdict === "PASS" ? "SUCCESS" : "PARTIAL_FAILURE",
  alignmentStatus: rawArtifacts.alignment.status
};
const summaryAnswers = {
  selectedAction: summary.decision.selected,
  alternativesConsidered: summary.alternatives.length,
  authorizationDecision: summary.action.authorization.decision,
  observedOutcome: summary.observedOutcome.status,
  alignmentStatus: summary.reflection.status
};

function score(answers) {
  let correct = 0;
  let incorrect = 0;
  let unknown = 0;
  for (const key of Object.keys(canonical)) {
    if (answers[key] == null) unknown += 1;
    else if (answers[key] === canonical[key]) correct += 1;
    else incorrect += 1;
  }
  return { correct, incorrect, unknown };
}

const report = {
  evidenceClass: "DETERMINISTIC_SYNTHETIC_REPOSITORY_SHAPE",
  productionEvidence: false,
  questionCount: Object.keys(canonical).length,
  modes: {
    currentBoundedHandoff: {
      contextChars: JSON.stringify(workItem).length,
      boundedEntryReads: 1,
      additionalExactArtifactReadsForOrientation: 0,
      correlationJoins: 0,
      boundedDiscoverableDecisionChain: false,
      ...score(currentBoundedAnswers)
    },
    rawFullGraph: {
      contextChars: JSON.stringify({ workItem, rawArtifacts }).length,
      boundedEntryReads: 1 + Object.keys(rawArtifacts).length,
      additionalExactArtifactReadsForOrientation: Object.keys(rawArtifacts).length,
      correlationJoins: 7,
      boundedDiscoverableDecisionChain: false,
      ...score(rawAnswers)
    },
    proposedSummary: {
      contextChars: JSON.stringify(summary).length,
      boundedEntryReads: 1,
      additionalExactArtifactReadsForOrientation: 0,
      exactEvidenceReadsForAcceptance: 3,
      correlationJoins: 0,
      boundedDiscoverableDecisionChain: true,
      ...score(summaryAnswers)
    }
  }
};

console.log(JSON.stringify(report, null, 2));
