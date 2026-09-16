import {
  BackendObjectiveSchema,
  BackendRunAction,
  makeBackendWorkOrder
} from "./contracts.js";
import {
  BackendCompletionAction,
  BackendCompletionReason,
  assessBackendCompletion,
  defineBackendCompletionPolicy
} from "./backend-completion.js";
import {
  BackendAdvisorAction,
  assessBackendContinuation
} from "./backend-advisor.js";
import { BackendRecoveryAction } from "./backend-worker.js";
import { resolveBackendContext } from "./oracle.js";

function invariant(condition, message) {
  if (!condition) throw new TypeError(message);
}

function deterministicDecision(completion) {
  if (completion.action === BackendCompletionAction.ACCEPT) {
    return Object.freeze({ action: BackendRunAction.RETURN, reason: "backend completion policy accepted grounded evidence" });
  }
  if (completion.action === BackendCompletionAction.BLOCK) {
    return Object.freeze({ action: BackendRunAction.BLOCK, reason: completion.reasons.join("; ") });
  }
  if (completion.action === BackendCompletionAction.FAIL) {
    return Object.freeze({ action: BackendRunAction.FAIL, reason: completion.reasons.join("; ") });
  }
  return Object.freeze({ action: BackendRunAction.CONTINUE, reason: completion.reasons.join("; ") });
}

function applyAdvisorProposal(proposal) {
  if (proposal.action === BackendAdvisorAction.RETRY_IMPLEMENTATION) {
    return Object.freeze({ action: BackendRunAction.RETRY, reason: proposal.rationale });
  }
  if (proposal.action === BackendAdvisorAction.REQUEST_CONTEXT) {
    return Object.freeze({ action: BackendRunAction.REQUEST_CONTEXT, reason: proposal.rationale });
  }
  return Object.freeze({ action: BackendRunAction.ESCALATE, reason: proposal.rationale });
}

async function completeBackendRun({
  objective,
  order,
  context,
  result,
  completionPolicy,
  backendAdvisor,
  recovery = null
}) {
  const completion = assessBackendCompletion(result, { policy: completionPolicy });

  let advisory = null;
  let decision = deterministicDecision(completion);

  const unresolvedGaps = completion.action === BackendCompletionAction.CONTINUE &&
    completion.reasons.includes(BackendCompletionReason.UNRESOLVED_GAPS);

  if (unresolvedGaps && backendAdvisor != null) {
    advisory = await assessBackendContinuation({
      advisor: backendAdvisor,
      objective,
      order,
      result,
      completion
    });
    decision = applyAdvisorProposal(advisory);
  }

  return Object.freeze({
    objectiveId: objective.id,
    order,
    context,
    result,
    completion,
    advisory,
    decision,
    recovery
  });
}

export async function runBackendObjective(rawObjective, {
  repositoryReader,
  backendWorker,
  completionPolicy = defineBackendCompletionPolicy(),
  backendAdvisor = null
}) {
  const objective = BackendObjectiveSchema.parse(rawObjective);
  invariant(backendWorker && typeof backendWorker.execute === "function", "runBackendObjective requires backendWorker.execute()");

  const order = makeBackendWorkOrder(objective);
  const context = await resolveBackendContext(order, { repositoryReader });
  const result = await backendWorker.execute(order, context);
  return completeBackendRun({
    objective,
    order,
    context,
    result,
    completionPolicy,
    backendAdvisor
  });
}

export async function recoverBackendObjective(rawObjective, {
  repositoryReader,
  backendWorker,
  completionPolicy = defineBackendCompletionPolicy(),
  backendAdvisor = null
}) {
  const objective = BackendObjectiveSchema.parse(rawObjective);
  invariant(backendWorker && typeof backendWorker.execute === "function", "recoverBackendObjective requires backendWorker.execute()");
  invariant(backendWorker && typeof backendWorker.recover === "function", "recoverBackendObjective requires backendWorker.recover()");

  const order = makeBackendWorkOrder(objective);
  const context = await resolveBackendContext(order, { repositoryReader });
  const recovery = await backendWorker.recover(order, context);

  if (recovery.action === BackendRecoveryAction.BLOCKED) {
    return Object.freeze({
      objectiveId: objective.id,
      order,
      context,
      result: null,
      completion: null,
      advisory: null,
      decision: Object.freeze({
        action: BackendRunAction.BLOCK,
        reason: recovery.blockers.join("; ")
      }),
      recovery
    });
  }

  const result = recovery.action === BackendRecoveryAction.RETRY_EXECUTION
    ? await backendWorker.execute(order, context)
    : recovery.result;

  invariant(result != null, `Backend recovery ${recovery.action} requires a BackendWorkResult`);
  return completeBackendRun({
    objective,
    order,
    context,
    result,
    completionPolicy,
    backendAdvisor,
    recovery
  });
}
