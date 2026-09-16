import { isDeepStrictEqual } from "node:util";
import {
  BackendContextSchema,
  BackendObjectiveSchema,
  BackendRunAction,
  makeBackendWorkOrder,
  parseBackendWorkOrder
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

function requirePreparedBackend(prepared) {
  invariant(prepared && typeof prepared === "object" && !Array.isArray(prepared), "prepared Backend objective is required");
  const objective = BackendObjectiveSchema.parse(prepared.objective);
  const order = parseBackendWorkOrder(prepared.order);
  const expectedOrder = makeBackendWorkOrder(objective);
  invariant(isDeepStrictEqual(order, expectedOrder), "prepared Backend WorkOrder must match the prepared objective");
  const context = BackendContextSchema.parse(prepared.context);
  return Object.freeze({ objective, order, context });
}

export async function prepareBackendObjective(rawObjective, { repositoryReader }) {
  const objective = BackendObjectiveSchema.parse(rawObjective);
  const order = makeBackendWorkOrder(objective);
  const context = await resolveBackendContext(order, { repositoryReader });
  return Object.freeze({ objective, order, context });
}

export async function runPreparedBackendObjective(rawPrepared, {
  backendWorker,
  completionPolicy = defineBackendCompletionPolicy(),
  backendAdvisor = null
}) {
  invariant(backendWorker && typeof backendWorker.execute === "function", "runPreparedBackendObjective requires backendWorker.execute()");
  const { objective, order, context } = requirePreparedBackend(rawPrepared);
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

export async function recoverPreparedBackendObjective(rawPrepared, {
  backendWorker,
  completionPolicy = defineBackendCompletionPolicy(),
  backendAdvisor = null
}) {
  invariant(backendWorker && typeof backendWorker.execute === "function", "recoverPreparedBackendObjective requires backendWorker.execute()");
  invariant(backendWorker && typeof backendWorker.recover === "function", "recoverPreparedBackendObjective requires backendWorker.recover()");
  const { objective, order, context } = requirePreparedBackend(rawPrepared);
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

export async function runBackendObjective(rawObjective, {
  repositoryReader,
  backendWorker,
  completionPolicy = defineBackendCompletionPolicy(),
  backendAdvisor = null
}) {
  const prepared = await prepareBackendObjective(rawObjective, { repositoryReader });
  return runPreparedBackendObjective(prepared, {
    backendWorker,
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
  const prepared = await prepareBackendObjective(rawObjective, { repositoryReader });
  return recoverPreparedBackendObjective(prepared, {
    backendWorker,
    completionPolicy,
    backendAdvisor
  });
}
