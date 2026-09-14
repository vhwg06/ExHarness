import {
  BackendObjectiveSchema,
  decideBackendResult,
  makeBackendWorkOrder
} from "./contracts.js";
import { resolveBackendContext } from "./oracle.js";

function invariant(condition, message) {
  if (!condition) throw new TypeError(message);
}

export async function runBackendObjective(rawObjective, { repositoryReader, backendWorker }) {
  const objective = BackendObjectiveSchema.parse(rawObjective);
  invariant(backendWorker && typeof backendWorker.execute === "function", "runBackendObjective requires backendWorker.execute()");

  const order = makeBackendWorkOrder(objective);
  const context = await resolveBackendContext(order, { repositoryReader });
  const result = await backendWorker.execute(order, context);
  const decision = decideBackendResult(result);

  return Object.freeze({
    objectiveId: objective.id,
    order,
    context,
    result,
    decision
  });
}
