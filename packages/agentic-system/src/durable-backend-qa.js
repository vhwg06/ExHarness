import { BackendCompletionAction } from "./backend-completion.js";
import {
  prepareBackendObjective,
  recoverPreparedBackendObjective,
  runPreparedBackendObjective
} from "./backend-application.js";
import { BlackboardStatus } from "./blackboard-orchestrator.js";
import { BackendObjectiveSchema, BackendRunAction } from "./contracts.js";
import {
  BackendQaHandoffSchema,
  QaObjectiveSchema
} from "./qa-contracts.js";
import { QaCompletionAction } from "./qa-completion.js";
import {
  createQaHandoffFromBackendRun,
  runQaObjective
} from "./qa-application.js";

function invariant(condition, message) {
  if (!condition) throw new TypeError(message);
}

function requireText(value, name) {
  invariant(typeof value === "string" && value.trim().length > 0, `${name} must be a non-empty string`);
  return value;
}

function textArray(value, name, { min = 0 } = {}) {
  invariant(Array.isArray(value), `${name} must be an array`);
  const normalized = [...new Set(value.map((entry, index) => requireText(entry, `${name}[${index}]`)))];
  invariant(normalized.length >= min, `${name} must contain at least ${min} item(s)`);
  return normalized;
}

function freezeClone(value) {
  return Object.freeze(structuredClone(value));
}

const WORKFLOW_KIND = "BACKEND_QA_WORKFLOW";
const WORKFLOW_VERSION = 1;
const BACKEND_WORK = "Run Backend implementation and establish accepted revision provenance.";
const QA_WORK = "Run QA verification against the accepted Backend revision.";

export const BackendQaWorkflowStage = Object.freeze({
  BACKEND_PENDING: "BACKEND_PENDING",
  BACKEND_COORDINATION_PENDING: "BACKEND_COORDINATION_PENDING",
  QA_PENDING: "QA_PENDING",
  BACKEND_REMEDIATION_PENDING: "BACKEND_REMEDIATION_PENDING",
  AWAITING_REVIEW: "AWAITING_REVIEW",
  BLOCKED: "BLOCKED",
  CANCELED: "CANCELED"
});

function remediationWork(issues) {
  return `Remediate QA issues: ${issues.join(" | ")}`;
}

function parseDecisionRef(raw, name) {
  invariant(raw && typeof raw === "object" && !Array.isArray(raw), `${name} must be an object`);
  return {
    id: requireText(raw.id, `${name}.id`),
    digest: requireText(raw.digest, `${name}.digest`)
  };
}

function parseCoordinationRequirement(raw) {
  invariant(raw && typeof raw === "object" && !Array.isArray(raw), "Backend coordination requirement must be an object");
  invariant(
    [BackendRunAction.REQUEST_CONTEXT, BackendRunAction.ESCALATE].includes(raw.action),
    "Backend coordination requirement action is invalid"
  );
  invariant(
    [BackendQaWorkflowStage.BACKEND_PENDING, BackendQaWorkflowStage.BACKEND_REMEDIATION_PENDING].includes(raw.resumeStage),
    "Backend coordination requirement resumeStage is invalid"
  );
  const contextNeeds = textArray(raw.contextNeeds ?? [], "Backend coordination requirement.contextNeeds");
  if (raw.action === BackendRunAction.REQUEST_CONTEXT) {
    invariant(contextNeeds.length > 0, "REQUEST_CONTEXT coordination requires contextNeeds");
  }
  return freezeClone({
    action: raw.action,
    resumeStage: raw.resumeStage,
    objectiveId: requireText(raw.objectiveId, "Backend coordination requirement.objectiveId"),
    gapIds: textArray(raw.gapIds, "Backend coordination requirement.gapIds", { min: 1 }),
    contextNeeds,
    rationale: requireText(raw.rationale, "Backend coordination requirement.rationale"),
    completionDecision: parseDecisionRef(raw.completionDecision, "Backend coordination requirement.completionDecision"),
    attempt: Number.isInteger(raw.attempt) && raw.attempt >= 0 ? raw.attempt : 0
  });
}

function parseCoordinationResolution(raw, index) {
  invariant(raw && typeof raw === "object" && !Array.isArray(raw), `coordinationHistory[${index}] must be an object`);
  invariant(
    [BackendRunAction.REQUEST_CONTEXT, BackendRunAction.ESCALATE].includes(raw.action),
    `coordinationHistory[${index}].action is invalid`
  );
  return freezeClone({
    action: raw.action,
    resolvedBy: requireText(raw.resolvedBy, `coordinationHistory[${index}].resolvedBy`),
    rationale: requireText(raw.rationale, `coordinationHistory[${index}].rationale`),
    addedRequiredFiles: textArray(raw.addedRequiredFiles ?? [], `coordinationHistory[${index}].addedRequiredFiles`),
    completionDecision: parseDecisionRef(raw.completionDecision, `coordinationHistory[${index}].completionDecision`)
  });
}

function workflowCheckpoint(raw) {
  invariant(raw && typeof raw === "object" && !Array.isArray(raw), "Backend/QA workflow checkpoint is required");
  invariant(raw.kind === WORKFLOW_KIND, `Backend/QA workflow checkpoint kind must be ${WORKFLOW_KIND}`);
  invariant(raw.version === WORKFLOW_VERSION, `Backend/QA workflow checkpoint version must be ${WORKFLOW_VERSION}`);
  invariant(
    [
      BackendQaWorkflowStage.BACKEND_PENDING,
      BackendQaWorkflowStage.BACKEND_COORDINATION_PENDING,
      BackendQaWorkflowStage.QA_PENDING,
      BackendQaWorkflowStage.BACKEND_REMEDIATION_PENDING
    ].includes(raw.stage),
    "Backend/QA workflow checkpoint stage is invalid"
  );
  const spec = raw.spec;
  invariant(spec && typeof spec === "object" && !Array.isArray(spec), "Backend/QA workflow checkpoint spec is required");
  const coordination = raw.coordination == null ? null : parseCoordinationRequirement(raw.coordination);
  if (raw.stage === BackendQaWorkflowStage.BACKEND_COORDINATION_PENDING) {
    invariant(coordination != null, "BACKEND_COORDINATION_PENDING requires a coordination requirement");
  } else {
    invariant(coordination == null, `${raw.stage} cannot retain an unresolved coordination requirement`);
  }
  const coordinationHistory = Array.isArray(raw.coordinationHistory)
    ? raw.coordinationHistory.map(parseCoordinationResolution)
    : [];
  const qaIssues = Array.isArray(raw.qaIssues)
    ? raw.qaIssues.map((issue, index) => requireText(issue, `qaIssues[${index}]`))
    : [];
  const remediationObligations = Array.isArray(raw.remediationObligations)
    ? raw.remediationObligations.map((work, index) => requireText(work, `remediationObligations[${index}]`))
    : raw.stage === BackendQaWorkflowStage.BACKEND_REMEDIATION_PENDING && qaIssues.length > 0
      ? [remediationWork(qaIssues)]
      : [];
  if (raw.stage === BackendQaWorkflowStage.BACKEND_REMEDIATION_PENDING) {
    invariant(qaIssues.length > 0, "Backend remediation checkpoint requires issues");
    invariant(remediationObligations.length > 0, "Backend remediation checkpoint requires outstanding obligations");
  }
  const parsed = {
    kind: WORKFLOW_KIND,
    version: WORKFLOW_VERSION,
    stage: raw.stage,
    spec: {
      backendObjective: BackendObjectiveSchema.parse(spec.backendObjective),
      qaObjective: QaObjectiveSchema.parse(spec.qaObjective)
    },
    attempt: Number.isInteger(raw.attempt) && raw.attempt >= 0 ? raw.attempt : 0,
    acceptedBackend: raw.acceptedBackend == null ? null : freezeClone({
      handoff: BackendQaHandoffSchema.parse(raw.acceptedBackend.handoff),
      completionDecision: {
        id: requireText(raw.acceptedBackend.completionDecision?.id, "acceptedBackend.completionDecision.id"),
        digest: requireText(raw.acceptedBackend.completionDecision?.digest, "acceptedBackend.completionDecision.digest")
      },
      ...(raw.acceptedBackend.artifactManifestRef == null
        ? {}
        : { artifactManifestRef: requireText(raw.acceptedBackend.artifactManifestRef, "acceptedBackend.artifactManifestRef") })
    }),
    qaIssues,
    remediationObligations,
    backendRecoveryRequired: raw.backendRecoveryRequired === true
  };
  if (coordination != null) parsed.coordination = coordination;
  if (coordinationHistory.length > 0) parsed.coordinationHistory = coordinationHistory;
  return freezeClone(parsed);
}

function initialCheckpoint(backendObjective, qaObjective) {
  return workflowCheckpoint({
    kind: WORKFLOW_KIND,
    version: WORKFLOW_VERSION,
    stage: BackendQaWorkflowStage.BACKEND_PENDING,
    spec: {
      backendObjective: BackendObjectiveSchema.parse(backendObjective),
      qaObjective: QaObjectiveSchema.parse(qaObjective)
    },
    attempt: 0,
    acceptedBackend: null,
    qaIssues: [],
    remediationObligations: [],
    coordination: null,
    backendRecoveryRequired: false
  });
}

function boardItem(board, itemId) {
  const item = board.items.find((candidate) => candidate.id === itemId);
  invariant(item, `Blackboard item not found: ${itemId}`);
  return item;
}

function deriveRemediationObjective(checkpoint) {
  invariant(checkpoint.acceptedBackend != null, "Backend remediation requires an accepted Backend checkpoint");
  invariant(checkpoint.qaIssues.length > 0, "Backend remediation requires QA issues");
  const base = checkpoint.spec.backendObjective;
  const nextAttempt = checkpoint.attempt + 1;
  return BackendObjectiveSchema.parse({
    ...base,
    id: `${base.id}:remediation:${nextAttempt}`,
    task: `${base.task}\nRemediate QA issues: ${checkpoint.qaIssues.join("; ")}`,
    repository: {
      ...base.repository,
      revision: checkpoint.acceptedBackend.handoff.revision
    },
    constraints: [
      ...base.constraints,
      ...checkpoint.qaIssues.map((issue) => `Resolve QA issue: ${issue}`)
    ]
  });
}

function backendObjectiveFor(checkpoint) {
  return checkpoint.stage === BackendQaWorkflowStage.BACKEND_REMEDIATION_PENDING
    ? deriveRemediationObjective(checkpoint)
    : checkpoint.spec.backendObjective;
}

function backendWorkFor(checkpoint) {
  return checkpoint.stage === BackendQaWorkflowStage.BACKEND_REMEDIATION_PENDING
    ? remediationWork(checkpoint.qaIssues)
    : BACKEND_WORK;
}

function backendCheckpointAfterAccept(checkpoint, handoff, completionDecision, artifactManifestRef = null) {
  return workflowCheckpoint({
    ...checkpoint,
    stage: BackendQaWorkflowStage.QA_PENDING,
    attempt: checkpoint.stage === BackendQaWorkflowStage.BACKEND_REMEDIATION_PENDING
      ? checkpoint.attempt + 1
      : checkpoint.attempt,
    acceptedBackend: {
      handoff,
      completionDecision: {
        id: completionDecision.id,
        digest: completionDecision.digest
      },
      ...(artifactManifestRef == null ? {} : { artifactManifestRef })
    },
    qaIssues: [],
    remediationObligations: [],
    backendRecoveryRequired: false
  });
}

function remediationCheckpoint(checkpoint, issues) {
  return workflowCheckpoint({
    ...checkpoint,
    stage: BackendQaWorkflowStage.BACKEND_REMEDIATION_PENDING,
    qaIssues: issues,
    remediationObligations: [remediationWork(issues)],
    coordination: null,
    backendRecoveryRequired: false
  });
}

function coordinationCheckpoint(checkpoint, backend) {
  invariant(backend.advisory != null, `${backend.decision.action} requires persisted Advisor provenance`);
  return workflowCheckpoint({
    ...checkpoint,
    stage: BackendQaWorkflowStage.BACKEND_COORDINATION_PENDING,
    coordination: {
      action: backend.decision.action,
      resumeStage: checkpoint.stage,
      objectiveId: backend.objectiveId,
      gapIds: backend.advisory.gapIds,
      contextNeeds: backend.advisory.contextNeeds,
      rationale: backend.decision.reason,
      completionDecision: {
        id: backend.completion.decision.id,
        digest: backend.completion.decision.digest
      },
      attempt: checkpoint.attempt
    }
  });
}

function coordinationBlocker(requirement) {
  if (requirement.action === BackendRunAction.REQUEST_CONTEXT) {
    return `Backend requires additional context before retry: ${requirement.contextNeeds.join(" | ")}`;
  }
  return `Backend escalation requires application resolution before retry: ${requirement.rationale}`;
}

function resolveCoordinationCheckpoint(checkpoint, { owner, rationale, additionalRequiredFiles }) {
  const requirement = checkpoint.coordination ?? null;
  invariant(requirement != null, "Backend coordination resolution requires an active requirement");
  const addedRequiredFiles = textArray(additionalRequiredFiles ?? [], "additionalRequiredFiles");
  if (requirement.action === BackendRunAction.REQUEST_CONTEXT) {
    invariant(addedRequiredFiles.length > 0, "REQUEST_CONTEXT resolution requires additionalRequiredFiles");
  }

  const backendObjective = BackendObjectiveSchema.parse({
    ...checkpoint.spec.backendObjective,
    requiredFiles: [...new Set([
      ...checkpoint.spec.backendObjective.requiredFiles,
      ...addedRequiredFiles
    ])]
  });

  return workflowCheckpoint({
    ...checkpoint,
    stage: requirement.resumeStage,
    spec: {
      ...checkpoint.spec,
      backendObjective
    },
    coordination: null,
    coordinationHistory: [
      ...(checkpoint.coordinationHistory ?? []),
      {
        action: requirement.action,
        resolvedBy: owner,
        rationale,
        addedRequiredFiles,
        completionDecision: requirement.completionDecision
      }
    ]
  });
}

function reviewRemediationCheckpoint(item) {
  const submission = item.submission;
  invariant(submission?.kind === WORKFLOW_KIND && submission?.stage === "QA_COMPLETED", `Blackboard item ${item.id} has no resumable Backend/QA review submission`);
  invariant(item.remainingWork.length > 0, `Blackboard item ${item.id} review remediation requires grounded remaining work`);
  return workflowCheckpoint({
    kind: WORKFLOW_KIND,
    version: WORKFLOW_VERSION,
    stage: BackendQaWorkflowStage.BACKEND_REMEDIATION_PENDING,
    spec: submission.workflowSpec,
    attempt: submission.workflowAttempt,
    acceptedBackend: {
      handoff: submission.acceptedBackendHandoff,
      completionDecision: submission.backendAcceptanceDecision,
      ...(submission.artifactManifestRef == null
        ? {}
        : { artifactManifestRef: submission.artifactManifestRef })
    },
    qaIssues: item.remainingWork,
    remediationObligations: item.remainingWork,
    backendRecoveryRequired: false
  });
}

function backendCheckpointForMode(checkpoint, recoveryRequired) {
  return workflowCheckpoint({
    ...checkpoint,
    backendRecoveryRequired: recoveryRequired
  });
}

function blockersFromRun(run, fallback) {
  const blockers = run?.result?.blockers ?? [];
  if (blockers.length > 0) return blockers;
  return [run?.decision?.reason || fallback];
}

function artifactRefsFromHandoff(handoff) {
  return handoff.artifacts.map((artifact) => artifact.ref);
}

function artifactRefsFromAcceptedBackend(acceptedBackend) {
  return [
    ...artifactRefsFromHandoff(acceptedBackend.handoff),
    ...(acceptedBackend.artifactManifestRef == null ? [] : [acceptedBackend.artifactManifestRef])
  ];
}

function normalizeArtifactManifestPublisher(publisher) {
  if (publisher == null) return null;
  invariant(
    typeof publisher.publishAcceptedBackendManifest === "function",
    "artifactManifestPublisher must expose publishAcceptedBackendManifest()"
  );
  return publisher;
}

function blockedWorkflowStage(checkpoint) {
  if (checkpoint?.stage === BackendQaWorkflowStage.BACKEND_COORDINATION_PENDING) {
    return BackendQaWorkflowStage.BACKEND_COORDINATION_PENDING;
  }
  return BackendQaWorkflowStage.BLOCKED;
}

function normalizeProjectAcceptance(projectAcceptance) {
  if (projectAcceptance == null) return null;
  invariant(
    typeof projectAcceptance.persistRoleCompletion === "function" &&
      typeof projectAcceptance.ensureRequirement === "function" &&
      typeof projectAcceptance.review === "function" &&
      typeof projectAcceptance.recoverReview === "function",
    "projectAcceptance must be a Backend/QA project acceptance controller"
  );
  return projectAcceptance;
}

export function createDurableBackendQaWorkflow({
  orchestrator,
  repositoryReader,
  artifactReader,
  backendWorker,
  qaWorker,
  backendCompletionPolicy = null,
  backendAdvisor = null,
  qaCompletionPolicy = null,
  projectAcceptance = null,
  artifactManifestPublisher = null
}) {
  invariant(
    orchestrator &&
      typeof orchestrator.readBlackboard === "function" &&
      typeof orchestrator.claim === "function" &&
      typeof orchestrator.recoverClaim === "function" &&
      typeof orchestrator.checkpoint === "function" &&
      typeof orchestrator.resolveBlockedCheckpoint === "function" &&
      typeof orchestrator.submit === "function" &&
      typeof orchestrator.resume === "function" &&
      typeof orchestrator.supersede === "function",
    "Durable Backend/QA workflow requires recovery-capable ApplicationOrchestrator"
  );
  const acceptance = normalizeProjectAcceptance(projectAcceptance);
  const manifestPublisher = normalizeArtifactManifestPublisher(artifactManifestPublisher);

  async function initialize({ itemId, owner, backendObjective, qaObjective }) {
    requireText(itemId, "itemId");
    requireText(owner, "owner");
    const existing = boardItem(await orchestrator.readBlackboard(), itemId);
    invariant(existing.status === BlackboardStatus.READY, `Backend/QA workflow initialize requires READY item; found ${existing.status}`);
    invariant(existing.checkpoint == null, `Backend/QA workflow item ${itemId} is already initialized`);
    invariant(existing.submission == null, `Backend/QA workflow item ${itemId} already has a submission`);
    const checkpoint = initialCheckpoint(backendObjective, qaObjective);
    const claimed = await orchestrator.claim({ itemId, owner });
    const generation = claimed.result.claimGeneration;
    const persisted = await orchestrator.checkpoint({
      itemId,
      owner,
      generation,
      checkpoint,
      remainingWork: [BACKEND_WORK]
    });
    return freezeClone({
      stage: BackendQaWorkflowStage.BACKEND_PENDING,
      item: persisted.result,
      checkpoint
    });
  }

  async function persistBackendPreparationFailure({
    itemId,
    owner,
    generation,
    checkpoint,
    error,
    recoveryRequired
  }) {
    const blockedCheckpoint = backendCheckpointForMode(checkpoint, recoveryRequired);
    const persisted = await orchestrator.checkpoint({
      itemId,
      owner,
      generation,
      checkpoint: blockedCheckpoint,
      status: BlackboardStatus.BLOCKED,
      blockers: [`Backend context preflight failed: ${error.message}`]
    });
    return freezeClone({
      stage: BackendQaWorkflowStage.BLOCKED,
      backend: null,
      qa: null,
      error: error.message,
      recoveryRequired,
      item: persisted.result
    });
  }

  async function prepareBackendStage({ itemId, owner, generation, checkpoint, recoveryRequired }) {
    try {
      const prepared = await prepareBackendObjective(backendObjectiveFor(checkpoint), { repositoryReader });
      return Object.freeze({ prepared });
    } catch (error) {
      return {
        blocked: await persistBackendPreparationFailure({
          itemId,
          owner,
          generation,
          checkpoint,
          error,
          recoveryRequired
        })
      };
    }
  }

  async function persistBackendRun({ itemId, owner, generation, checkpoint, backend }) {
    const currentWork = backendWorkFor(checkpoint);
    const executionCheckpoint = backendCheckpointForMode(checkpoint, false);

    if (acceptance != null) {
      await acceptance.persistRoleCompletion({
        decision: backend.completion.decision,
        evidence: backend.result.evidence,
        label: "Backend"
      });
    }

    if (backend.completion.action !== BackendCompletionAction.ACCEPT) {
      if ([BackendRunAction.REQUEST_CONTEXT, BackendRunAction.ESCALATE].includes(backend.decision.action)) {
        const nextCheckpoint = coordinationCheckpoint(executionCheckpoint, backend);
        const persisted = await orchestrator.checkpoint({
          itemId,
          owner,
          generation,
          checkpoint: nextCheckpoint,
          artifactRefs: backend.result.artifacts.map((artifact) => artifact.ref),
          evidenceRefs: [backend.completion.decision.id],
          status: BlackboardStatus.BLOCKED,
          blockers: [coordinationBlocker(nextCheckpoint.coordination)]
        });
        return freezeClone({
          stage: BackendQaWorkflowStage.BACKEND_COORDINATION_PENDING,
          backend,
          coordination: nextCheckpoint.coordination,
          qa: null,
          item: persisted.result
        });
      }

      const blocked = [BackendRunAction.BLOCK, BackendRunAction.FAIL].includes(backend.decision.action) ||
        [BackendCompletionAction.BLOCK, BackendCompletionAction.FAIL].includes(backend.completion.action);
      const persisted = await orchestrator.checkpoint({
        itemId,
        owner,
        generation,
        checkpoint: executionCheckpoint,
        artifactRefs: backend.result.artifacts.map((artifact) => artifact.ref),
        evidenceRefs: [backend.completion.decision.id],
        status: blocked ? BlackboardStatus.BLOCKED : BlackboardStatus.REOPENED,
        blockers: blocked ? blockersFromRun(backend, "Backend execution cannot continue") : []
      });
      return freezeClone({
        stage: blocked ? BackendQaWorkflowStage.BLOCKED : checkpoint.stage,
        backend,
        qa: null,
        item: persisted.result
      });
    }

    invariant(backend.decision.action === BackendRunAction.RETURN, "Accepted Backend completion must return to the workflow");
    let handoff = createQaHandoffFromBackendRun(backend);
    let completionDecision = backend.completion.decision;
    let artifactManifestRef = null;
    let artifactManifestReused = false;
    if (manifestPublisher != null) {
      try {
        const publication = await manifestPublisher.publishAcceptedBackendManifest({
          itemId,
          backendRun: backend,
          handoff
        });
        artifactManifestRef = requireText(
          publication?.manifestRef,
          "artifactManifestPublisher publication.manifestRef"
        );
        const publishedDecision = parseDecisionRef(
          publication?.manifest?.acceptanceDecision,
          "artifactManifestPublisher publication.manifest.acceptanceDecision"
        );
        completionDecision = publishedDecision;
        handoff = BackendQaHandoffSchema.parse({
          ...handoff,
          acceptanceDecision: publishedDecision
        });
        artifactManifestReused = publication?.reused === true;
      } catch (error) {
        const recoveryCheckpoint = backendCheckpointForMode(executionCheckpoint, true);
        const persisted = await orchestrator.checkpoint({
          itemId,
          owner,
          generation,
          checkpoint: recoveryCheckpoint,
          status: BlackboardStatus.BLOCKED,
          blockers: [`Backend artifact manifest publication failed: ${error?.message ?? String(error)}`]
        });
        return freezeClone({
          stage: BackendQaWorkflowStage.BLOCKED,
          backend,
          handoff,
          qa: null,
          artifactManifestRef: null,
          recoveryRequired: true,
          error: error?.message ?? String(error),
          item: persisted.result
        });
      }
    }

    const nextCheckpoint = backendCheckpointAfterAccept(
      executionCheckpoint,
      handoff,
      completionDecision,
      artifactManifestRef
    );
    const resolvedWork = checkpoint.stage === BackendQaWorkflowStage.BACKEND_REMEDIATION_PENDING
      ? checkpoint.remediationObligations
      : [currentWork];
    const acceptedArtifactRefs = artifactRefsFromAcceptedBackend(nextCheckpoint.acceptedBackend);
    const persisted = await orchestrator.checkpoint({
      itemId,
      owner,
      generation,
      checkpoint: nextCheckpoint,
      artifactRefs: acceptedArtifactRefs,
      evidenceRefs: [completionDecision.id],
      resolvedWork,
      remainingWork: [QA_WORK]
    });

    return freezeClone({
      stage: BackendQaWorkflowStage.QA_PENDING,
      backend,
      handoff,
      artifactManifestRef,
      artifactManifestReused,
      qa: null,
      item: persisted.result
    });
  }

  async function runBackendStage({ itemId, owner, generation, checkpoint }) {
    const recoveryRequired = checkpoint.backendRecoveryRequired === true;
    const preparation = await prepareBackendStage({
      itemId,
      owner,
      generation,
      checkpoint,
      recoveryRequired
    });
    if (preparation.blocked) return preparation.blocked;

    const options = {
      backendWorker,
      ...(backendCompletionPolicy == null ? {} : { completionPolicy: backendCompletionPolicy }),
      backendAdvisor
    };
    const backend = recoveryRequired
      ? await recoverPreparedBackendObjective(preparation.prepared, options)
      : await runPreparedBackendObjective(preparation.prepared, options);

    if (backend.result == null) {
      const recoveryCheckpoint = backendCheckpointForMode(checkpoint, true);
      const persisted = await orchestrator.checkpoint({
        itemId,
        owner,
        generation,
        checkpoint: recoveryCheckpoint,
        status: BlackboardStatus.BLOCKED,
        blockers: backend.recovery.blockers
      });
      return freezeClone({
        stage: BackendQaWorkflowStage.BLOCKED,
        backend,
        qa: null,
        recovery: backend.recovery,
        item: persisted.result
      });
    }

    const result = await persistBackendRun({ itemId, owner, generation, checkpoint, backend });
    return recoveryRequired ? freezeClone({ ...result, recovery: backend.recovery }) : result;
  }

  async function recoverBackendStage({ itemId, owner, generation, checkpoint }) {
    const recoveryCheckpoint = backendCheckpointForMode(checkpoint, true);
    const preparation = await prepareBackendStage({
      itemId,
      owner,
      generation,
      checkpoint: recoveryCheckpoint,
      recoveryRequired: true
    });
    if (preparation.blocked) return preparation.blocked;

    const backend = await recoverPreparedBackendObjective(preparation.prepared, {
      backendWorker,
      ...(backendCompletionPolicy == null ? {} : { completionPolicy: backendCompletionPolicy }),
      backendAdvisor
    });

    if (backend.result == null) {
      const persisted = await orchestrator.checkpoint({
        itemId,
        owner,
        generation,
        checkpoint: recoveryCheckpoint,
        status: BlackboardStatus.BLOCKED,
        blockers: backend.recovery.blockers
      });
      return freezeClone({
        stage: BackendQaWorkflowStage.BLOCKED,
        backend,
        qa: null,
        recovery: backend.recovery,
        item: persisted.result
      });
    }

    const result = await persistBackendRun({ itemId, owner, generation, checkpoint: recoveryCheckpoint, backend });
    return freezeClone({ ...result, recovery: backend.recovery });
  }

  async function runQaStage({ itemId, owner, generation, checkpoint }) {
    invariant(checkpoint.acceptedBackend != null, "QA stage requires accepted Backend provenance");
    const handoff = checkpoint.acceptedBackend.handoff;
    let qa;
    try {
      let qaArtifactReader = artifactReader;
      if (checkpoint.acceptedBackend.artifactManifestRef != null) {
        invariant(
          artifactReader && typeof artifactReader.forManifest === "function",
          "manifest-protected QA checkpoint requires artifactReader.forManifest()"
        );
        qaArtifactReader = artifactReader.forManifest(checkpoint.acceptedBackend.artifactManifestRef);
      }
      qa = await runQaObjective(checkpoint.spec.qaObjective, {
        handoff,
        artifactReader: qaArtifactReader,
        qaWorker,
        ...(qaCompletionPolicy == null ? {} : { completionPolicy: qaCompletionPolicy })
      });
    } catch (error) {
      const persisted = await orchestrator.checkpoint({
        itemId,
        owner,
        generation,
        checkpoint,
        status: BlackboardStatus.BLOCKED,
        blockers: [`QA context/execution failed: ${error.message}`]
      });
      return freezeClone({
        stage: BackendQaWorkflowStage.BLOCKED,
        backend: null,
        qa: null,
        error: error.message,
        item: persisted.result
      });
    }

    if (acceptance != null) {
      await acceptance.persistRoleCompletion({
        decision: qa.completion.decision,
        evidence: qa.result.evidence,
        label: "QA"
      });
    }

    if (qa.completion.action === QaCompletionAction.ACCEPT) {
      const artifactRefs = artifactRefsFromAcceptedBackend(checkpoint.acceptedBackend);
      const evidenceRefs = [
        checkpoint.acceptedBackend.completionDecision.id,
        qa.completion.decision.id
      ];
      if (acceptance != null) await acceptance.ensureRequirement({ itemId });
      const submitted = await orchestrator.submit({
        itemId,
        owner,
        generation,
        resolvedWork: [QA_WORK],
        submission: {
          kind: WORKFLOW_KIND,
          version: WORKFLOW_VERSION,
          stage: "QA_COMPLETED",
          acceptedRevision: handoff.revision,
          workflowSpec: checkpoint.spec,
          workflowAttempt: checkpoint.attempt,
          acceptedBackendHandoff: handoff,
          backendAcceptanceDecision: checkpoint.acceptedBackend.completionDecision,
          ...(checkpoint.acceptedBackend.artifactManifestRef == null
            ? {}
            : { artifactManifestRef: checkpoint.acceptedBackend.artifactManifestRef }),
          qaAcceptanceDecision: {
            id: qa.completion.decision.id,
            digest: qa.completion.decision.digest
          },
          artifactRefs,
          evidenceRefs
        }
      });
      return freezeClone({
        stage: BackendQaWorkflowStage.AWAITING_REVIEW,
        backend: null,
        qa,
        item: submitted.result
      });
    }

    if (qa.completion.action === QaCompletionAction.CONTINUE && qa.result.issues.length > 0) {
      const issues = [...qa.result.issues];
      const nextCheckpoint = remediationCheckpoint(checkpoint, issues);
      const persisted = await orchestrator.checkpoint({
        itemId,
        owner,
        generation,
        checkpoint: nextCheckpoint,
        evidenceRefs: [qa.completion.decision.id],
        resolvedWork: [QA_WORK],
        remainingWork: [remediationWork(issues)]
      });
      return freezeClone({
        stage: BackendQaWorkflowStage.BACKEND_REMEDIATION_PENDING,
        backend: null,
        qa,
        item: persisted.result
      });
    }

    const hardBlocked = [QaCompletionAction.BLOCK, QaCompletionAction.FAIL].includes(qa.completion.action);
    const persisted = await orchestrator.checkpoint({
      itemId,
      owner,
      generation,
      checkpoint,
      evidenceRefs: [qa.completion.decision.id],
      status: hardBlocked ? BlackboardStatus.BLOCKED : BlackboardStatus.REOPENED,
      blockers: hardBlocked ? blockersFromRun(qa, "QA execution cannot continue") : []
    });
    return freezeClone({
      stage: hardBlocked ? BackendQaWorkflowStage.BLOCKED : BackendQaWorkflowStage.QA_PENDING,
      backend: null,
      qa,
      item: persisted.result
    });
  }

  async function advance({ itemId, owner }) {
    requireText(itemId, "itemId");
    requireText(owner, "owner");
    const board = await orchestrator.readBlackboard();
    const item = boardItem(board, itemId);

    if (item.status === BlackboardStatus.SUPERSEDED) {
      return freezeClone({ stage: BackendQaWorkflowStage.CANCELED, item });
    }
    if ([BlackboardStatus.PENDING_REVIEW, BlackboardStatus.REVIEWING, BlackboardStatus.PENDING_RECONCILIATION, BlackboardStatus.DONE].includes(item.status)) {
      return freezeClone({ stage: BackendQaWorkflowStage.AWAITING_REVIEW, item });
    }

    if (item.status === BlackboardStatus.BLOCKED && item.checkpoint == null) {
      return freezeClone({ stage: BackendQaWorkflowStage.BLOCKED, item });
    }
    const checkpoint = item.checkpoint != null
      ? workflowCheckpoint(item.checkpoint)
      : reviewRemediationCheckpoint(item);
    if (item.status === BlackboardStatus.BLOCKED) {
      return freezeClone({
        stage: blockedWorkflowStage(checkpoint),
        coordination: checkpoint.coordination ?? null,
        item
      });
    }
    invariant(
      checkpoint.stage !== BackendQaWorkflowStage.BACKEND_COORDINATION_PENDING,
      `Blackboard item ${itemId} has unresolved Backend coordination but is not BLOCKED`
    );
    const claimed = await orchestrator.claim({ itemId, owner });
    const generation = claimed.result.claimGeneration;

    if ([BackendQaWorkflowStage.BACKEND_PENDING, BackendQaWorkflowStage.BACKEND_REMEDIATION_PENDING].includes(checkpoint.stage)) {
      return runBackendStage({ itemId, owner, generation, checkpoint });
    }
    return runQaStage({ itemId, owner, generation, checkpoint });
  }

  async function recoverInterrupted({ itemId, owner }) {
    requireText(itemId, "itemId");
    requireText(owner, "owner");
    const item = boardItem(await orchestrator.readBlackboard(), itemId);
    invariant(item.status === BlackboardStatus.CLAIMED, `Backend/QA interrupted recovery requires CLAIMED item; found ${item.status}`);
    invariant(item.checkpoint != null, `Blackboard item ${itemId} has no durable Backend/QA checkpoint`);
    const checkpoint = workflowCheckpoint(item.checkpoint);

    const recovered = await orchestrator.recoverClaim({
      itemId,
      owner,
      reason: `Recover interrupted ${checkpoint.stage} execution from durable workflow state`
    });
    const generation = recovered.result.claimGeneration;

    if ([BackendQaWorkflowStage.BACKEND_PENDING, BackendQaWorkflowStage.BACKEND_REMEDIATION_PENDING].includes(checkpoint.stage)) {
      return recoverBackendStage({ itemId, owner, generation, checkpoint });
    }

    invariant(checkpoint.stage === BackendQaWorkflowStage.QA_PENDING, `Unsupported interrupted recovery stage: ${checkpoint.stage}`);
    return runQaStage({
      itemId,
      owner,
      generation,
      checkpoint
    });
  }

  async function review({ itemId }) {
    invariant(acceptance != null, "Backend/QA project acceptance is not configured");
    const result = await acceptance.review({ itemId });
    return freezeClone({
      stage: result.item.status === BlackboardStatus.REOPENED
        ? BackendQaWorkflowStage.BACKEND_REMEDIATION_PENDING
        : BackendQaWorkflowStage.AWAITING_REVIEW,
      ...result
    });
  }

  async function recoverReview({ itemId, reason }) {
    invariant(acceptance != null, "Backend/QA project acceptance is not configured");
    const result = await acceptance.recoverReview({ itemId, reason });
    return freezeClone({
      stage: result.item.status === BlackboardStatus.REOPENED
        ? BackendQaWorkflowStage.BACKEND_REMEDIATION_PENDING
        : BackendQaWorkflowStage.AWAITING_REVIEW,
      ...result
    });
  }

  async function resolveBackendCoordination({ itemId, owner, rationale, additionalRequiredFiles = [] }) {
    requireText(itemId, "itemId");
    requireText(owner, "owner");
    requireText(rationale, "rationale");
    const board = await orchestrator.readBlackboard();
    const item = boardItem(board, itemId);
    invariant(item.status === BlackboardStatus.BLOCKED, `Backend coordination resolution requires BLOCKED item; found ${item.status}`);
    invariant(item.checkpoint != null, `Blackboard item ${itemId} has no Backend/QA checkpoint`);
    const checkpoint = workflowCheckpoint(item.checkpoint);
    invariant(
      checkpoint.stage === BackendQaWorkflowStage.BACKEND_COORDINATION_PENDING,
      `Backend coordination resolution requires ${BackendQaWorkflowStage.BACKEND_COORDINATION_PENDING}; found ${checkpoint.stage}`
    );
    const nextCheckpoint = resolveCoordinationCheckpoint(checkpoint, {
      owner,
      rationale,
      additionalRequiredFiles
    });

    const persisted = await orchestrator.resolveBlockedCheckpoint({
      itemId,
      checkpointedBy: owner,
      expectedCheckpoint: checkpoint,
      checkpoint: nextCheckpoint
    });
    const resolution = nextCheckpoint.coordinationHistory[nextCheckpoint.coordinationHistory.length - 1];
    return freezeClone({
      stage: nextCheckpoint.stage,
      coordination: null,
      resolution,
      item: persisted.result
    });
  }

  async function resume({ itemId }) {
    requireText(itemId, "itemId");
    const item = boardItem(await orchestrator.readBlackboard(), itemId);
    if (item.status === BlackboardStatus.BLOCKED && item.checkpoint != null) {
      const checkpoint = workflowCheckpoint(item.checkpoint);
      invariant(
        checkpoint.stage !== BackendQaWorkflowStage.BACKEND_COORDINATION_PENDING,
        `Blackboard item ${itemId} has unresolved Backend coordination; use resolveBackendCoordination(...)`
      );
    }
    const resumed = await orchestrator.resume({ itemId });
    return freezeClone({ item: resumed.result });
  }

  async function cancel({ itemId, reason }) {
    const canceled = await orchestrator.supersede({ itemId, reason });
    return freezeClone({ stage: BackendQaWorkflowStage.CANCELED, item: canceled.result });
  }

  async function current({ itemId }) {
    requireText(itemId, "itemId");
    const item = boardItem(await orchestrator.readBlackboard(), itemId);
    if (item.status === BlackboardStatus.BLOCKED) {
      if (item.checkpoint == null) {
        return freezeClone({ stage: BackendQaWorkflowStage.BLOCKED, item });
      }
      const checkpoint = workflowCheckpoint(item.checkpoint);
      return freezeClone({
        stage: blockedWorkflowStage(checkpoint),
        coordination: checkpoint.coordination ?? null,
        item
      });
    }
    if (item.status === BlackboardStatus.SUPERSEDED) return freezeClone({ stage: BackendQaWorkflowStage.CANCELED, item });
    if ([BlackboardStatus.PENDING_REVIEW, BlackboardStatus.REVIEWING, BlackboardStatus.PENDING_RECONCILIATION, BlackboardStatus.DONE].includes(item.status)) {
      return freezeClone({ stage: BackendQaWorkflowStage.AWAITING_REVIEW, item });
    }
    if (item.checkpoint == null && item.status === BlackboardStatus.REOPENED && item.submission?.stage === "QA_COMPLETED") {
      return freezeClone({ stage: BackendQaWorkflowStage.BACKEND_REMEDIATION_PENDING, item });
    }
    invariant(item.checkpoint != null, `Blackboard item ${itemId} has no durable Backend/QA checkpoint`);
    return freezeClone({ stage: workflowCheckpoint(item.checkpoint).stage, item });
  }

  return Object.freeze({ initialize, advance, recoverInterrupted, review, recoverReview, resolveBackendCoordination, resume, cancel, current });
}
