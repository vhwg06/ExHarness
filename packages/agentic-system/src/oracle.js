import { BackendContextSchema, parseBackendWorkOrder } from "./contracts.js";
import { QaContextSchema, parseQaWorkOrder } from "./qa-contracts.js";

function invariant(condition, message) {
  if (!condition) throw new TypeError(message);
}

export async function resolveBackendContext(rawOrder, { repositoryReader }) {
  const order = parseBackendWorkOrder(rawOrder);
  invariant(repositoryReader && typeof repositoryReader.readFile === "function", "resolveBackendContext requires repositoryReader.readFile()");

  const files = [];
  for (const path of order.requiredFiles) {
    let resolved;
    try {
      resolved = await repositoryReader.readFile({
        repositoryRef: order.repositoryRef,
        revision: order.revision,
        path
      });
    } catch (error) {
      const detail = error?.message ?? String(error);
      throw new Error(
        `backend context resolution failed for ${path} from ${order.repositoryRef}@${order.revision}: ${detail}`,
        { cause: error }
      );
    }

    invariant(resolved && typeof resolved === "object", `repositoryReader.readFile() must return an object for ${path}`);
    files.push({
      path,
      content: resolved.content,
      sourceRef: resolved.sourceRef
    });
  }

  return BackendContextSchema.parse({
    repository: {
      ref: order.repositoryRef,
      revision: order.revision
    },
    files
  });
}

export async function resolveQaContext(rawOrder, { artifactReader }) {
  const order = parseQaWorkOrder(rawOrder);
  invariant(artifactReader && typeof artifactReader.readArtifact === "function", "resolveQaContext requires artifactReader.readArtifact()");

  const artifacts = [];
  for (const artifact of order.requiredArtifacts) {
    let resolved;
    try {
      resolved = await artifactReader.readArtifact({
        ref: artifact.ref,
        path: artifact.path ?? null,
        producerWorkOrderId: order.upstream.workOrderId,
        revision: order.upstream.revision,
        acceptanceDecision: order.upstream.acceptanceDecision
      });
    } catch (error) {
      const detail = error?.message ?? String(error);
      throw new Error(
        `qa context resolution failed for ${artifact.ref} from application artifact store: ${detail}`,
        { cause: error }
      );
    }

    invariant(resolved && typeof resolved === "object", `artifactReader.readArtifact() must return an object for ${artifact.ref}`);
    artifacts.push({
      ref: artifact.ref,
      ...(artifact.path == null ? {} : { path: artifact.path }),
      content: resolved.content,
      sourceRef: resolved.sourceRef,
      provenance: {
        sourceClass: "APPLICATION_ARTIFACT",
        producerWorkOrderId: order.upstream.workOrderId,
        acceptanceDecision: order.upstream.acceptanceDecision
      }
    });
  }

  return QaContextSchema.parse({
    upstream: order.upstream,
    artifacts,
    acceptanceCriteria: order.acceptanceCriteria
  });
}
