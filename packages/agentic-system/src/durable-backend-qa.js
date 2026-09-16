import { BackendCompletionAction } from "./backend-completion.js";
import {
  recoverBackendObjective,
  runBackendObjective
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
      completionDecision: parseDecisionRef(raw.acceptedBackend.completionDecision, "acceptedBackend.completionDecision")
    }),
    qaIssues: Array.isArray(raw.qaIssues)
      ? raw.qaIssues.map((issue, index) => requireText(issue, `qaIssues[${index}]`))
      : []
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
    qaIssues: []
  });
}

function boardItem(board, itemId) {
  const item = board.items.find((candidate) => candidate.id === itemId);
  invariant(item, `Blackboard item not found: ${itemId}`);
  return item;
}

function remediationWork(issues) {
  return `Remediate QA issues: ${issues.join(" | ")}`;
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

function backendCheckpointAfterAccept(checkpoint, handoff, completionDecision) {
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
      }
    },
    qaIssues: [],
    coordination: null
  });
}

function remediationCheckpoint(checkpoint, issues) {
  return workflowCheckpoint({
    ...checkpoint,
    stage: BackendQaWorkflowStage.BACKEND_REMEDIATION_PENDING,
    qaIssues: issues,
    coordination: null
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

function blockersFromRun(run, fallback) {
  const blockers = run?.result?.blockers ?? [];
  if (blockers.length > 0) return blockers;
  return [run?.decision?.reason || fallback];
}

function artifactRefsFromHandoff(handoff) {
  return handoff.artifacts.map((artifact) => artifact.ref);
}

function blockedWorkflowStage(checkpoint) {
  if (checkpoint?.stage === BackendQaWorkflowStage.BACKEND_COORDINATION_PENDING) {
    return BackendQaWorkflowStage.BACKEND_COORDINATION_PENDING;
  }
  return BackendQaWorkflowStage.BLOCKED;
}

export function createDurableBackendQaWorkflow({
  orchestrator,
  repositoryReader,
  artifactReader,
  backendWorker,
  qaWorker,
  backendCompletionPolicy = null,
  backendAdvisor = null,
  qaCompletionPolicy = null
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

  async function persistBackendRun({ itemId, owner, generation, checkpoint, backend }) {
    const currentWork = backendWorkFor(checkpoint);

    if (backend.completion.action !== BackendCompletionAction.ACCEPT) {
      if ([BackendRunAction.REQUEST_CONTEXT, BackendRunAction.ESCALATE].includes(backend.decision.action)) {
        const nextCheckpoint = coordinationCheckpoint(checkpoint, backend);
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
        checkpoint,
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
    const handoff = createQaHandoffFromBackendRun(backend);
    const nextCheckpoint = backendCheckpointAfterAccept(checkpoint, handoff, backend.completion.decision);
    const persisted = await orchestrator.checkpoint({
      itemId,
      owner,
      generation,
      checkpoint: nextCheckpoint,
      artifactRefs: artifactRefsFromHandoff(handoff),
      evidenceRefs: [backend.completion.decision.id],
      resolvedWork: [currentWork],
      remainingWork: [QA_WORK]
    });

    return freezeClone({
      stage: BackendQaWorkflowStage.QA_PENDING,
      backend,
      handoff,
      qa: null,
      item: persisted.result
    });
  }

  async function runBackendStage({ itemId, owner, generation, checkpoint }) {
    const backend = await runBackendObjective(backendObjectiveFor(checkpoint), {
      repositoryReader,
      backendWorker,
      ...(backendCompletionPolicy == null ? {} : { completionPolicy: backendCompletionPolicy }),
      backendAdvisor
    });
    return persistBackendRun({ itemId, owner, generation, checkpoint, backend });
  }

  async function recoverBackendStage({ itemId, owner, generation, checkpoint }) {
    const backend = await recoverBackendObjective(backendObjectiveFor(checkpoint), {
      repositoryReader,
      backendWorker,
      ...(backendCompletionPolicy == null ? {} : { completionPolicy: backendCompletionPolicy }),
      backendAdvisor
    });

    if (backend.result == null) {
      const persisted = await orchestrator.checkpoint({
        itemId,
        owner,
        generation,
        checkpoint,
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
    return freezeClone({ ...result, recovery: backend.recovery });
  }

  async function runQaStage({ itemId, owner, generation, checkpoint }) {
    invariant(checkpoint.acceptedBackend != null, "QA stage requires accepted Backend provenance");
    const handoff = checkpoint.acceptedBackend.handoff;
    let qa;
    try {
      qa = await runQaObjective(checkpoint.spec.qaObjective, {
        handoff,
        artifactReader,
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

    if (qa.completion.action === QaCompletionAction.ACCEPT) {
      const artifactRefs = artifactRefsFromHandoff(handoff);
      const evidenceRefs = [
        checkpoint.acceptedBackend.completionDecision.id,
        qa.completion.decision.id
      ];
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
          backendAcceptanceDecision: checkpoint.acceptedBackend.completionDecision,
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
    const item = boardItem(await orchestrator.readBlackboard(), itemId);

    if (item.status === BlackboardStatus.SUPERSEDED) {
      return freezeClone({ stage: BackendQaWorkflowStage.CANCELED, item });
    }
    if ([BlackboardStatus.PENDING_REVIEW, BlackboardStatus.REVIEWING, BlackboardStatus.PENDING_RECONCILIATION, BlackboardStatus.DONE].includes(item.status)) {
      return freezeClone({ stage: BackendQaWorkflowStage.AWAITING_REVIEW, item });
    }

    invariant(item.checkpoint != null, `Blackboard item ${itemId} has no durable Backend/QA checkpoint; initialize it first`);
    const checkpoint = workflowCheckpoint(item.checkpoint);
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
    invariant(
      checkpoint.stage !== BackendQaWorkflowStage.BACKEND_COORDINATION_PENDING,
      "Blocked Backend coordination is not an interrupted execution attempt"
    );

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
    return runQaStage({ itemId, owner, generation, checkpoint });
  }

  async function resolveBackendCoordination({ itemId, owner, rationale, additionalRequiredFiles = [] }) {
    requireText(itemId, "itemId");
    requireText(owner, "owner");
    requireText(rationale, "rationale");
    const item = boardItem(await orchestrator.readBlackboard(), itemId);
    invariant(item.status === BlackboardStatus.BLOCKED, `Backend coordination resolution requires BLOCKED item; found ${item.status}`);
    invariant(item.checkpoint != null, `Blackboard item ${itemId} has no Backend/QA checkpoint`);
    const checkpoint = workflowCheckpoint(item.checkpoint);
    invariant(
      checkpoint.stage === BackendQaWorkflowStage.BACKEND_COORDINATION_PENDING,
      `Backend coordination resolution requires ${BackendQaWorkflowStage.BACKEND_COORDINATION_PENDING}; found ${checkpoint.stage}`
    );
    const requirement = checkpoint.coordination ?? null;
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
      requirement,
      resolution,
      item: persisted.result
    });
  }

  async function resume({ itemId }) {
    requireText(itemId, "itemId");
    const item = boardItem(await orchestrator.readBlackboard(), itemId);
    if (item.checkpoint != null) {
      const checkpoint = workflowCheckpoint(item.checkpoint);
      invariant(
        checkpoint.stage !== BackendQaWorkflowStage.BACKEND_COORDINATION_PENDING,
        "Backend coordination must be resolved with resolveBackendCoordination() before resume"
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
    if (item.status === BlackboardStatus.SUPERSEDED) return freezeClone({ stage: BackendQaWorkflowStage.CANCELED, item });
    if ([BlackboardStatus.PENDING_REVIEW, BlackboardStatus.REVIEWING, BlackboardStatus.PENDING_RECONCILIATION, BlackboardStatus.DONE].includes(item.status)) {
      return freezeClone({ stage: BackendQaWorkflowStage.AWAITING_REVIEW, item });
    }
    invariant(item.checkpoint != null, `Blackboard item ${itemId} has no durable Backend/QA checkpoint`);
    const checkpoint = workflowCheckpoint(item.checkpoint);
    if (item.status === BlackboardStatus.BLOCKED) {
      return freezeClone({
        stage: blockedWorkflowStage(checkpoint),
        coordination: checkpoint.coordination ?? null,
        item
      });
    }
    return freezeClone({ stage: checkpoint.stage, coordination: checkpoint.coordination ?? null, item });
  }

  return Object.freeze({
    initialize,
    advance,
    recoverInterrupted,
    resolveBackendCoordination,
    resume,
    cancel,
    current
  });
}
