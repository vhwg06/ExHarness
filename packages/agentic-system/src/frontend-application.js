import { isDeepStrictEqual } from "node:util";
import { readRepositorySources } from "../../oracle/src/index.js";
import { FrontendContextSchema, FrontendObjectiveSchema, FrontendRunAction, makeFrontendWorkOrder, parseFrontendWorkOrder } from "./frontend-contracts.js";
import { FrontendCompletionAction, assessFrontendCompletion, defineFrontendCompletionPolicy } from "./frontend-completion.js";
import { FrontendRecoveryAction } from "./frontend-worker.js";

// Frontend application: prepare/run/recover a Frontend objective on its own worker and
// completion policy. There is no Backend stage, session or completion dependency.
function invariant(condition, message) { if (!condition) throw new TypeError(message); }

function decide(completion) {
  const reason = completion.reasons.join("; ");
  if (completion.action === FrontendCompletionAction.ACCEPT) return Object.freeze({ action: FrontendRunAction.RETURN, reason: "frontend completion policy accepted grounded evidence" });
  if (completion.action === FrontendCompletionAction.BLOCK) return Object.freeze({ action: FrontendRunAction.BLOCK, reason });
  if (completion.action === FrontendCompletionAction.FAIL) return Object.freeze({ action: FrontendRunAction.FAIL, reason });
  return Object.freeze({ action: FrontendRunAction.CONTINUE, reason });
}

function requirePrepared(prepared) {
  invariant(prepared && typeof prepared === "object" && !Array.isArray(prepared), "prepared Frontend objective is required");
  const objective = FrontendObjectiveSchema.parse(prepared.objective);
  const order = parseFrontendWorkOrder(prepared.order);
  invariant(isDeepStrictEqual(order, makeFrontendWorkOrder(objective)), "prepared Frontend WorkOrder must match the prepared objective");
  return Object.freeze({ objective, order, context: FrontendContextSchema.parse(prepared.context) });
}

const complete = ({ objective, order, context, result, completionPolicy, recovery = null }) => {
  const completion = assessFrontendCompletion(result, { policy: completionPolicy });
  return Object.freeze({ objectiveId: objective.id, order, context, result, completion, decision: decide(completion), recovery });
};

export async function prepareFrontendObjective(rawObjective, { repositoryReader }) {
  const objective = FrontendObjectiveSchema.parse(rawObjective);
  const order = makeFrontendWorkOrder(objective);
  const context = FrontendContextSchema.parse(await readRepositorySources(order, { repositoryReader }));
  return Object.freeze({ objective, order, context });
}

export async function runPreparedFrontendObjective(rawPrepared, { frontendWorker, completionPolicy = defineFrontendCompletionPolicy() }) {
  invariant(frontendWorker && typeof frontendWorker.execute === "function", "runPreparedFrontendObjective requires frontendWorker.execute()");
  const { objective, order, context } = requirePrepared(rawPrepared);
  return complete({ objective, order, context, result: await frontendWorker.execute(order, context), completionPolicy });
}

export async function recoverPreparedFrontendObjective(rawPrepared, { frontendWorker, completionPolicy = defineFrontendCompletionPolicy() }) {
  invariant(frontendWorker && typeof frontendWorker.execute === "function" && typeof frontendWorker.recover === "function", "recoverPreparedFrontendObjective requires frontendWorker.execute()/recover()");
  const { objective, order, context } = requirePrepared(rawPrepared);
  const recovery = await frontendWorker.recover(order, context);
  if (recovery.action === FrontendRecoveryAction.BLOCKED) {
    return Object.freeze({ objectiveId: objective.id, order, context, result: null, completion: null, decision: Object.freeze({ action: FrontendRunAction.BLOCK, reason: recovery.blockers.join("; ") }), recovery });
  }
  const result = recovery.action === FrontendRecoveryAction.RETRY_EXECUTION ? await frontendWorker.execute(order, context) : recovery.result;
  invariant(result != null, `Frontend recovery ${recovery.action} requires a FrontendWorkResult`);
  return complete({ objective, order, context, result, completionPolicy, recovery });
}
