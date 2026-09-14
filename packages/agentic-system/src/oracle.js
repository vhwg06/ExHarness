import { BackendContextSchema, parseBackendWorkOrder } from "./contracts.js";

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
