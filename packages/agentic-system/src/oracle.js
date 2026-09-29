import { BackendContextSchema, parseBackendWorkOrder } from "./contracts.js";
import { QaContextSchema, parseQaWorkOrder } from "./qa-contracts.js";
import { readRepositorySources, readApplicationArtifacts } from "../../oracle/src/index.js";

export async function resolveBackendContext(rawOrder, { repositoryReader }) {
  const order = parseBackendWorkOrder(rawOrder);
  return BackendContextSchema.parse(await readRepositorySources(order, { repositoryReader }));
}

export async function resolveQaContext(rawOrder, { artifactReader }) {
  const order = parseQaWorkOrder(rawOrder);
  const { artifacts } = await readApplicationArtifacts({
    requiredArtifacts: order.requiredArtifacts,
    producerWorkOrderId: order.upstream.workOrderId,
    revision: order.upstream.revision,
    acceptanceDecision: order.upstream.acceptanceDecision
  }, { artifactReader });

  return QaContextSchema.parse({
    upstream: order.upstream,
    artifacts,
    acceptanceCriteria: order.acceptanceCriteria
  });
}
