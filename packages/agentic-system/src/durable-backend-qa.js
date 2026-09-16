import { BackendCompletionAction } from "./backend-completion.js";
import { runBackendObjective } from "./backend-application.js";
import {
  BlackboardStatus,
  ReviewRequirementSource
} from "./blackboard-orchestrator.js";
import { BackendObjectiveSchema } from "./contracts.js";
import {
  BackendQaHandoffSchema,
  QaObjectiveSchema
} from "./qa-contracts.js";
import {
  QaCompletionAction
} from "./qa-completion.js";
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

function freezeClone(value) {
  return Object.freeze(structuredClone(value));
}

const WORKFLOW_KIND = "BACKEND_QA_WORKFLOW";
const WORKFLOW_VERSION = 1;
const BACKEND_WORK = "Run Backend implementation and establish accepted revision provenance.";
const QA_WORK = "Run QA verification against the accepted Backend revision.";
const FINAL_REVIEW_KEY = "BACKEND_QA_APPLICATION_ACCEPTANCE";

export const BackendQaWorkflowStage = Object.freeze({
  BACKEND_PENDING: "BACKEND_PENDING",
  QA_PENDING: "QA_PENDING",
  BACKEND_REMEDIATION_PENDING: "BACKEND_REMEDIATION_PENDING",
  AWAITING_REVIEW: "AWAITING_REVIEW",
  BLOCKED: "BLOCKED",
  CANCELED: "CANCELED"
});

function workflowCheckpoint(raw) {
  invariant(raw && typeof raw === "object" && !Array.isArray(raw), "Backend/QA workflow checkpoint is required");
  invariant(raw.kind === WORKFLOW_KIND, `Backend/QA workflow checkpoint kind must be ${WORKFLOW_KIND}`);
  invariant(raw.version === WORKFLOW_VERSION, `Backend/QA workflow checkpoint version must be ${WORKFLOW_VERSION}`);
  invariant(
    [
      BackendQaWorkflowStage.BACKEND_PENDING,
      BackendQaWorkflowStage.QA_PENDING,
      BackendQaWorkflowStage.BACKEND_REMEDIATION_PENDING
    ].includes(raw.stage),
    "Backend/QA workflow checkpoint stage is invalid"
  );
  const spec = raw.spec;
  invariant(spec && typeof spec === "object" && !Array.isArray(spec), "Backend/QA workflow checkpoint spec is required");
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
      }
    }),
    qaIssues: Array.isArray(raw.qaIssues)
      ? raw.qaIssues.map((issue, index) => requireText(issue, `qaIssues[${index}]`))
      : []
  };
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
    qaIssues: []
  });
}

function remediationCheckpoint(checkpoint, issues) {
  return workflowCheckpoint({
    ...checkpoint,
    stage: BackendQaWorkflowStage.BACKEND_REMEDIATION_PENDING,
    qaIssues: issues
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
      typeof orchestrator.checkpoint === "function" &&
      typeof orchestrator.submit === "function" &&
      typeof orchestrator.resume === "function" &&
      typeof orchestrator.supersede === "function",
    "Durable Backend/QA workflow requires checkpoint-capable ApplicationOrchestrator"
  );

  async function initialize({ itemId, owner, backendObjective, qaObjective }) {
    requireText(itemId, "itemId");
    requireText(owner, "owner");
    const existing = boardItem(await orchestrator.readBlackboard(), itemId);
    invariant(existing.status === BlackboardStatus.READY, `Backend/QA workflow initialize requires READY item; found ${existing.status}`);
    invariant(existing.checkpoint == null, `Backend/QA workflow item ${itemId} is already initialized`);
    invariant(existing.submission == null, `Backend/QA workflow item ${itemId} already has a submission`);
    const checkpoint = initialCheckpoint(backendObjective, qaObjective);
    await orchestrator.claim({ itemId, owner });
    const persisted = await orchestrator.checkpoint({
      itemId,
      owner,
      checkpoint,
      remainingWork: [BACKEND_WORK]
    });
    return freezeClone({
      stage: BackendQaWorkflowStage.BACKEND_PENDING,
      item: persisted.result,
      checkpoint
    });
  }

  async function runBackendStage({ itemId, owner, checkpoint }) {
    const isRemediation = checkpoint.stage === BackendQaWorkflowStage.BACKEND_REMEDIATION_PENDING;
    const objective = isRemediation
      ? deriveRemediationObjective(checkpoint)
      : checkpoint.spec.backendObjective;
    const currentWork = isRemediation ? remediationWork(checkpoint.qaIssues) : BACKEND_WORK;

    const backend = await runBackendObjective(objective, {
      repositoryReader,
      backendWorker,
      ...(backendCompletionPolicy == null ? {} : { completionPolicy: backendCompletionPolicy }),
      backendAdvisor
    });

    if (backend.completion.action !== BackendCompletionAction.ACCEPT) {
      const blocked = [BackendCompletionAction.BLOCK, BackendCompletionAction.FAIL].includes(backend.completion.action);
      const persisted = await orchestrator.checkpoint({
        itemId,
        owner,
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

    const handoff = createQaHandoffFromBackendRun(backend);
    const nextCheckpoint = backendCheckpointAfterAccept(checkpoint, handoff, backend.completion.decision);
    const persisted = await orchestrator.checkpoint({
      itemId,
      owner,
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

  async function runQaStage({ itemId, owner, checkpoint }) {
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
        },
        reviewRequests: [{
          key: FINAL_REVIEW_KEY,
          source: ReviewRequirementSource.WORKER,
          reason: "Backend -> QA workflow completed and requires independent application acceptance."
        }]
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

    if (item.status === BlackboardStatus.BLOCKED) {
      return freezeClone({ stage: BackendQaWorkflowStage.BLOCKED, item });
    }
    if (item.status === BlackboardStatus.SUPERSEDED) {
      return freezeClone({ stage: BackendQaWorkflowStage.CANCELED, item });
    }
    if ([BlackboardStatus.PENDING_REVIEW, BlackboardStatus.REVIEWING, BlackboardStatus.PENDING_RECONCILIATION, BlackboardStatus.DONE].includes(item.status)) {
      return freezeClone({ stage: BackendQaWorkflowStage.AWAITING_REVIEW, item });
    }

    invariant(item.checkpoint != null, `Blackboard item ${itemId} has no durable Backend/QA checkpoint; initialize it first`);
    const checkpoint = workflowCheckpoint(item.checkpoint);
    await orchestrator.claim({ itemId, owner });

    if ([BackendQaWorkflowStage.BACKEND_PENDING, BackendQaWorkflowStage.BACKEND_REMEDIATION_PENDING].includes(checkpoint.stage)) {
      return runBackendStage({ itemId, owner, checkpoint });
    }
    return runQaStage({ itemId, owner, checkpoint });
  }

  async function resume({ itemId }) {
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
    if (item.status === BlackboardStatus.BLOCKED) return freezeClone({ stage: BackendQaWorkflowStage.BLOCKED, item });
    if (item.status === BlackboardStatus.SUPERSEDED) return freezeClone({ stage: BackendQaWorkflowStage.CANCELED, item });
    if ([BlackboardStatus.PENDING_REVIEW, BlackboardStatus.REVIEWING, BlackboardStatus.PENDING_RECONCILIATION, BlackboardStatus.DONE].includes(item.status)) {
      return freezeClone({ stage: BackendQaWorkflowStage.AWAITING_REVIEW, item });
    }
    invariant(item.checkpoint != null, `Blackboard item ${itemId} has no durable Backend/QA checkpoint`);
    return freezeClone({ stage: workflowCheckpoint(item.checkpoint).stage, item });
  }

  return Object.freeze({ initialize, advance, resume, cancel, current });
}
