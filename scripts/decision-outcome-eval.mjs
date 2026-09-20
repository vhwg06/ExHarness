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

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sameRef(left, right) {
  return left?.kind === right?.kind && left?.id === right?.id
    && (left?.revision == null || right?.revision == null || left.revision === right.revision);
}

function requireInvariant(condition, reason) {
  if (!condition) throw new Error(reason);
}

function refKey(ref) {
  return `${ref.kind}:${ref.id}`;
}

function buildArtifactIndex(artifacts) {
  return new Map([
    ["DELIBERATION:delib-1", artifacts.deliberation],
    ["ACTION_INTENT:intent-1", artifacts.actionIntent],
    ["EFFECT_OPERATION:effect-1", artifacts.effectOperation],
    ["EVALUATION:qa-eval-v2", artifacts.evaluation],
    ["MEMORY:memory-reflection-1", artifacts.reflectionMemory],
    ["GROUNDING:ground-1", artifacts.grounding],
    ["INTENT_REFLECTION_ALIGNMENT:align-1", artifacts.alignment]
  ]);
}

function observedStatus(evaluation) {
  return evaluation.verdict === "PASS" ? "SUCCESS" : "PARTIAL_FAILURE";
}

function verifySummary(candidateSummary, artifacts) {
  const index = buildArtifactIndex(artifacts);
  let exactArtifactReads = 0;
  const resolve = (ref, label) => {
    const artifact = index.get(refKey(ref));
    exactArtifactReads += 1;
    requireInvariant(artifact != null, `${label} missing`);
    return artifact;
  };

  requireInvariant(candidateSummary?.kind === "DECISION_OUTCOME_SUMMARY" && candidateSummary?.version === 1, "summary kind/version invalid");
  requireInvariant(candidateSummary.workItemId === workItem.id, "summary work item mismatch");
  requireInvariant(candidateSummary.authority?.rationaleIsCorrectnessEvidence === false, "rationale authority widened");
  requireInvariant(candidateSummary.authority?.summaryIsAcceptanceAuthority === false, "summary authority widened");
  requireInvariant(candidateSummary.authority?.acceptanceMustResolveEvidenceRefs === true, "acceptance exact-ref requirement missing");

  const deliberation = resolve(candidateSummary.decision.deliberationRef, "deliberation ref");
  requireInvariant(deliberation.id === candidateSummary.decision.deliberationRef.id, "deliberation id mismatch");
  requireInvariant(deliberation.judgment.selected === candidateSummary.decision.selected, "selected action conflicts with deliberation");
  requireInvariant(deliberation.judgment.alternatives.length === candidateSummary.alternatives.length, "alternatives count conflicts with deliberation");
  requireInvariant(JSON.stringify(deliberation.judgment.alternatives) === JSON.stringify(candidateSummary.alternatives), "alternatives conflict with deliberation");

  const actionIntent = resolve(candidateSummary.action.actionIntentRef, "action intent ref");
  requireInvariant(actionIntent.id === candidateSummary.action.actionIntentRef.id, "action intent id mismatch");
  requireInvariant(actionIntent.revision === candidateSummary.action.actionIntentRef.revision, "action intent revision mismatch");
  requireInvariant(sameRef(actionIntent.deliberationRef, candidateSummary.decision.deliberationRef), "action intent deliberation ref mismatch");
  requireInvariant(actionIntent.authorization.decision === candidateSummary.action.authorization.decision, "authorization conflicts with ActionIntent");
  requireInvariant(JSON.stringify(actionIntent.authorization.policy) === JSON.stringify(candidateSummary.action.authorization.policy), "authorization policy conflicts with ActionIntent");
  requireInvariant(JSON.stringify(actionIntent.authorization.evidenceRefs) === JSON.stringify(candidateSummary.action.authorization.evidenceRefs), "authorization evidence refs conflict with ActionIntent");
  requireInvariant(JSON.stringify(actionIntent.outcomeRefs) === JSON.stringify(candidateSummary.action.outcomeRefs), "outcome refs conflict with ActionIntent");

  const effectRef = candidateSummary.action.outcomeRefs.find((ref) => ref.kind === "EFFECT_OPERATION");
  requireInvariant(effectRef != null, "effect outcome ref missing");
  const effect = resolve(effectRef, "effect ref");
  requireInvariant(effect.status === "CONFIRMED", "effect is not confirmed");
  requireInvariant(sameRef(effect.actionIntentRef, candidateSummary.action.actionIntentRef), "effect ActionIntent ref mismatch");
  requireInvariant(candidateSummary.action.outcomeRefs.some((ref) => sameRef(ref, effect.resultRef)), "effect result ref missing from summary outcome refs");

  requireInvariant(candidateSummary.observedOutcome.evaluationRefs.length > 0, "observed outcome evaluation ref missing");
  const evaluation = resolve(candidateSummary.observedOutcome.evaluationRefs[0], "evaluation ref");
  const derivedObservedStatus = observedStatus(evaluation);
  requireInvariant(candidateSummary.observedOutcome.status === derivedObservedStatus, "observed outcome conflicts with evaluation");
  requireInvariant(candidateSummary.counterEvidenceRefs.some((ref) => sameRef(ref, candidateSummary.observedOutcome.evaluationRefs[0])), "counterevidence omits current outcome evaluation");
  for (const ref of candidateSummary.counterEvidenceRefs) resolve(ref, "counterevidence ref");

  const reflection = resolve(candidateSummary.reflection.reflectionRef, "reflection ref");
  requireInvariant(reflection.revision === candidateSummary.reflection.reflectionRef.revision, "reflection revision mismatch");
  requireInvariant(reflection.sourceRefs.some((ref) => sameRef(ref, candidateSummary.observedOutcome.evaluationRefs[0])), "reflection omits current evaluation source");

  const grounding = resolve(candidateSummary.reflection.groundingRef, "grounding ref");
  requireInvariant(grounding.verdict === "GROUNDED", "reflection grounding is not GROUNDED");
  requireInvariant(grounding.sourceSnapshots.some((snapshot) => sameRef(snapshot.ref, candidateSummary.observedOutcome.evaluationRefs[0])), "grounding omits current evaluation");

  const alignment = resolve(candidateSummary.reflection.alignmentRef, "alignment ref");
  requireInvariant(alignment.status === candidateSummary.reflection.status, "alignment status conflicts with summary");
  requireInvariant(alignment.divergence === candidateSummary.reflection.divergence, "alignment divergence conflicts with summary");
  requireInvariant(sameRef(alignment.reflectionRef, candidateSummary.reflection.reflectionRef), "alignment reflection ref mismatch");
  requireInvariant(sameRef(alignment.groundingRef, candidateSummary.reflection.groundingRef), "alignment grounding ref mismatch");
  requireInvariant(alignment.evaluationRefs.some((ref) => sameRef(ref, candidateSummary.observedOutcome.evaluationRefs[0])), "alignment omits current evaluation");

  return {
    exactArtifactReads,
    answers: {
      selectedAction: deliberation.judgment.selected,
      alternativesConsidered: deliberation.judgment.alternatives.length,
      authorizationDecision: actionIntent.authorization.decision,
      observedOutcome: derivedObservedStatus,
      alignmentStatus: alignment.status
    }
  };
}

const currentBoundedAnswers = Object.fromEntries(Object.keys(canonical).map((key) => [key, null]));
const rawAnswers = {
  selectedAction: rawArtifacts.deliberation.judgment.selected,
  alternativesConsidered: rawArtifacts.deliberation.judgment.alternatives.length,
  authorizationDecision: rawArtifacts.actionIntent.authorization.decision,
  observedOutcome: observedStatus(rawArtifacts.evaluation),
  alignmentStatus: rawArtifacts.alignment.status
};
const summaryOrientationAnswers = Object.fromEntries(Object.keys(canonical).map((key) => [key, null]));
const verifiedSummary = verifySummary(summary, rawArtifacts);

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

const controls = [
  {
    name: "tampered-authorization-copy",
    mutate(candidateSummary) {
      candidateSummary.action.authorization.decision = "DENY";
    }
  },
  {
    name: "success-copy-over-failing-evaluation",
    mutate(candidateSummary) {
      candidateSummary.observedOutcome.status = "SUCCESS";
      candidateSummary.observedOutcome.statement = "The remediation passed.";
    }
  },
  {
    name: "tampered-authorization-evidence-ref",
    mutate(candidateSummary) {
      candidateSummary.action.authorization.evidenceRefs = [{ kind: "EVALUATION", id: "qa-eval-forged" }];
    }
  },
  {
    name: "tampered-outcome-ref",
    mutate(candidateSummary) {
      candidateSummary.action.outcomeRefs[1] = { kind: "REPOSITORY_REVISION", id: "rev-forged" };
    }
  },
  {
    name: "missing-underlying-evaluation",
    mutate(_candidateSummary, artifacts) {
      artifacts.evaluation = null;
    }
  },
  {
    name: "wrong-action-intent-revision",
    mutate(candidateSummary) {
      candidateSummary.action.actionIntentRef.revision = 2;
    }
  },
  {
    name: "omitted-counterevidence",
    mutate(candidateSummary) {
      candidateSummary.counterEvidenceRefs = [];
    }
  }
];

const antiLaundering = controls.map((control) => {
  const candidateSummary = clone(summary);
  const artifacts = clone(rawArtifacts);
  control.mutate(candidateSummary, artifacts);
  try {
    verifySummary(candidateSummary, artifacts);
    return { name: control.name, accepted: true, failClosed: false, reason: null };
  } catch (error) {
    return { name: control.name, accepted: false, failClosed: true, reason: error.message };
  }
});

requireInvariant(antiLaundering.every((control) => control.failClosed && !control.accepted), "anti-laundering control escaped verification");

const report = {
  evidenceClass: "DETERMINISTIC_SYNTHETIC_REPOSITORY_SHAPE",
  productionEvidence: false,
  questionCount: Object.keys(canonical).length,
  authority: {
    summaryOrientationIsCorrectnessEvidence: false,
    correctnessAnswersRequireExactUnderlyingReads: true,
    summaryAcceptanceAuthority: false
  },
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
    proposedSummaryOrientation: {
      contextChars: JSON.stringify(summary).length,
      boundedEntryReads: 1,
      additionalExactArtifactReadsForOrientation: 0,
      exactEvidenceReadsForCorrectness: 0,
      correlationJoins: 0,
      boundedDiscoverableDecisionChain: true,
      ...score(summaryOrientationAnswers)
    },
    proposedSummaryVerified: {
      contextChars: JSON.stringify(summary).length,
      boundedEntryReads: 1,
      additionalExactArtifactReadsForOrientation: 0,
      exactEvidenceReadsForCorrectness: verifiedSummary.exactArtifactReads,
      correlationJoins: 0,
      boundedDiscoverableDecisionChain: true,
      ...score(verifiedSummary.answers)
    }
  },
  antiLaundering: {
    controlCount: antiLaundering.length,
    escapedControls: antiLaundering.filter((control) => control.accepted).length,
    controls: antiLaundering
  }
};

console.log(JSON.stringify(report, null, 2));
