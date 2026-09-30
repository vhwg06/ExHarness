import { BackendContextSchema, parseBackendWorkOrder } from "./contracts.js";
import { QaContextSchema, parseQaWorkOrder } from "./qa-contracts.js";
import {
  readRepositorySources,
  readApplicationArtifacts,
  createSourceCatalog,
  createExactRepositoryProvider,
  createExactArtifactProvider,
  createRetrievalPlanner,
  createOracleContextResolver,
  assertConsumableContextResolution
} from "../../oracle/src/index.js";
import {
  OracleContextBlockedError,
  backendContextRequirement,
  qaContextRequirement,
  projectBackendContext,
  projectQaContext,
  withReaderErrorCodes
} from "./oracle-context-requirements.js";

// BB-089 D4/D5: per-call composition of the delivered Oracle facade over exactly one exact
// provider and an EXACT snapshot authority pinned to the order's accepted revision. EXACT
// mode claims no currentness. Anything other than a COMPLETE, consumable resolution blocks
// with OracleContextBlockedError before any Worker call.
async function resolveThroughOracle({ domain, requirement, provider, authority }) {
  const sourceCatalog = createSourceCatalog({ providers: [provider], snapshotAuthorities: [authority] });
  const retrievalPlanner = createRetrievalPlanner({ catalog: sourceCatalog });
  const resolver = createOracleContextResolver({ sourceCatalog, retrievalPlanner });
  const { resolution, failures } = await resolver.resolve(requirement);
  if (resolution.status !== "COMPLETE") {
    throw new OracleContextBlockedError({ domain, status: resolution.status, unresolved: resolution.unresolved, failures });
  }
  return assertConsumableContextResolution(resolution, requirement);
}

export async function resolveBackendContext(rawOrder, { repositoryReader, oracleResolution }) {
  const order = parseBackendWorkOrder(rawOrder);
  if (oracleResolution === undefined) {
    return BackendContextSchema.parse(await readRepositorySources(order, { repositoryReader }));
  }
  const requirement = backendContextRequirement(order, oracleResolution);
  const resolution = await resolveThroughOracle({
    domain: "BACKEND",
    requirement,
    provider: createExactRepositoryProvider({ repositoryReader: withReaderErrorCodes(repositoryReader, "readFile") }),
    authority: { sourceKind: "REPOSITORY", refPrefix: order.repositoryRef, observe: async () => ({ snapshotRef: order.revision }) }
  });
  return BackendContextSchema.parse(projectBackendContext(order, resolution));
}

export async function resolveQaContext(rawOrder, { artifactReader, oracleResolution }) {
  const order = parseQaWorkOrder(rawOrder);
  if (oracleResolution === undefined) {
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
  const requirement = qaContextRequirement(order, oracleResolution);
  const resolution = await resolveThroughOracle({
    domain: "QA",
    requirement,
    provider: createExactArtifactProvider({
      artifactReader: withReaderErrorCodes(artifactReader, "readArtifact"),
      producerWorkOrderId: order.upstream.workOrderId,
      acceptanceDecision: order.upstream.acceptanceDecision
    }),
    authority: { sourceKind: "APPLICATION_ARTIFACT", refPrefix: "", observe: async () => ({ snapshotRef: order.upstream.revision }) }
  });
  return QaContextSchema.parse(projectQaContext(order, resolution));
}
