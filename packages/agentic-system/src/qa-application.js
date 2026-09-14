import { BackendCompletionAction } from "./backend-completion.js";
import { resolveQaContext } from "./oracle.js";
import {
  BackendQaHandoffSchema,
  QaObjectiveSchema,
  QaRunAction,
  makeQaWorkOrder
} from "./qa-contracts.js";
import {
  QaCompletionAction,
  assessQaCompletion,
  defineQaCompletionPolicy
} from "./qa-completion.js";

function invariant(condition, message) {
  if (!condition) throw new TypeError(message);
}

export function createQaHandoffFromBackendRun(backendRun) {
  invariant(backendRun && typeof backendRun === "object", "Backend run is required for QA handoff");
  invariant(backendRun.completion?.action === BackendCompletionAction.ACCEPT, "QA handoff requires an ACCEPTED Backend completion");
  invariant(backendRun.result?.revision != null, "QA handoff requires Backend result revision");
  invariant(backendRun.completion?.decision?.id && backendRun.completion?.decision?.digest, "QA handoff requires Backend acceptance decision provenance");

  return BackendQaHandoffSchema.parse({
    producerWorkOrderId: backendRun.order.id,
    revision: backendRun.result.revision,
    acceptanceDecision: {
      id: backendRun.completion.decision.id,
      digest: backendRun.completion.decision.digest
    },
    artifacts: backendRun.result.artifacts
  });
}

function decideQaCompletion(completion) {
  if (completion.action === QaCompletionAction.ACCEPT) {
    return Object.freeze({ action: QaRunAction.RETURN, reason: "QA completion policy accepted grounded evidence" });
  }
  if (completion.action === QaCompletionAction.BLOCK) {
    return Object.freeze({ action: QaRunAction.BLOCK, reason: completion.reasons.join("; ") });
  }
  if (completion.action === QaCompletionAction.FAIL) {
    return Object.freeze({ action: QaRunAction.FAIL, reason: completion.reasons.join("; ") });
  }
  return Object.freeze({ action: QaRunAction.CONTINUE, reason: completion.reasons.join("; ") });
}

export async function runQaObjective(rawObjective, {
  handoff,
  artifactReader,
  qaWorker,
  completionPolicy = defineQaCompletionPolicy()
}) {
  const objective = QaObjectiveSchema.parse(rawObjective);
  invariant(qaWorker && typeof qaWorker.execute === "function", "runQaObjective requires qaWorker.execute()");

  const order = makeQaWorkOrder(objective, handoff);
  const context = await resolveQaContext(order, { artifactReader });
  const result = await qaWorker.execute(order, context);
  const completion = assessQaCompletion(result, { policy: completionPolicy });
  const decision = decideQaCompletion(completion);

  return Object.freeze({
    objectiveId: objective.id,
    order,
    context,
    result,
    completion,
    decision
  });
}
