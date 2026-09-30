// BB-089: exact Oracle requirements and projections for declared Backend/QA context.
// The Application decides what context is required (BackendWorkOrder.requiredFiles and
// QaWorkOrder.requiredArtifacts). This module only maps that declaration to an exact
// @exharness/oracle ContextRequirement and projects a COMPLETE resolution back to the
// unchanged Backend/QA context shapes. It never adds, drops or reorders declared context.
import { defineContextRequirement } from "../../oracle/src/index.js";

function invariant(condition, message) {
  if (!condition) throw new TypeError(message);
}

function budgetBytes(options) {
  const value = options?.maxMaterializedBytes;
  invariant(Number.isSafeInteger(value) && value > 0, "oracleResolution.maxMaterializedBytes must be a positive safe integer");
  return value;
}

function budget(count, maxMaterializedBytes) {
  return { maxItems: count, maxProviderCalls: count, maxResolutionSteps: 1, maxMaterializedBytes };
}

export class OracleContextBlockedError extends Error {
  constructor({ domain, status, unresolved = [], failures = [] }) {
    const reasons = unresolved.map((u) => `${u.evidenceId}:${u.reason}`);
    const details = failures.map((f) => `${f.evidenceId}:${f.reason}: ${f.detail}`);
    super(`${domain} Oracle context blocked (${status}): ${[...reasons, ...details].join("; ") || "no consumable resolution"}`);
    this.name = "OracleContextBlockedError";
    this.domain = domain;
    this.status = status;
    this.unresolved = Object.freeze(unresolved.map((u) => Object.freeze({ ...u })));
    this.failures = Object.freeze(failures.map((f) => Object.freeze({ ...f })));
  }
}

// D2: one REQUIRED EXACT REPOSITORY evidence per declared file, in declared order.
export function backendContextRequirement(order, options) {
  const maxMaterializedBytes = budgetBytes(options);
  invariant(Array.isArray(order?.requiredFiles) && order.requiredFiles.length > 0, "BackendWorkOrder.requiredFiles must be declared");
  return defineContextRequirement({
    consumerRef: `backend-work-order:${order.id}`,
    semanticNeed: `Declared Backend context for ${order.id}`,
    evidence: order.requiredFiles.map((path, index) => ({
      id: `file-${index}`,
      necessity: "REQUIRED",
      need: `Declared required file ${path}`,
      source: { kind: "REPOSITORY", ref: order.repositoryRef, snapshot: { mode: "EXACT", ref: order.revision }, itemRefs: [path] }
    })),
    budget: budget(order.requiredFiles.length, maxMaterializedBytes)
  });
}

// D3: one REQUIRED EXACT APPLICATION_ARTIFACT evidence per declared path-bearing artifact.
export function qaContextRequirement(order, options) {
  const maxMaterializedBytes = budgetBytes(options);
  invariant(Array.isArray(order?.requiredArtifacts) && order.requiredArtifacts.length > 0, "QaWorkOrder.requiredArtifacts must be declared");
  for (const [index, artifact] of order.requiredArtifacts.entries()) {
    invariant(typeof artifact.path === "string" && artifact.path.length > 0,
      `Oracle QA context requires a declared path for QaWorkOrder.requiredArtifacts[${index}] (${artifact.ref}); pathless artifacts are supported only on the compatibility path`);
  }
  return defineContextRequirement({
    consumerRef: `qa-work-order:${order.id}`,
    semanticNeed: `Declared QA context for ${order.id}`,
    evidence: order.requiredArtifacts.map((artifact, index) => ({
      id: `artifact-${index}`,
      necessity: "REQUIRED",
      need: `Declared required artifact ${artifact.ref} at ${artifact.path}`,
      source: { kind: "APPLICATION_ARTIFACT", ref: artifact.ref, snapshot: { mode: "EXACT", ref: order.upstream.revision }, itemRefs: [artifact.path] },
      requiredProvenance: [
        { kind: "PRODUCER_WORK_ORDER", ref: order.upstream.workOrderId },
        { kind: "ACCEPTANCE_DECISION", ref: order.upstream.acceptanceDecision.id, digest: order.upstream.acceptanceDecision.digest }
      ]
    })),
    budget: budget(order.requiredArtifacts.length, maxMaterializedBytes)
  });
}

function itemsInDeclaredOrder(declared, resolution) {
  invariant(resolution && resolution.status === "COMPLETE" && Array.isArray(resolution.items), "Oracle projection requires a COMPLETE resolution");
  invariant(resolution.items.length === declared.length, "Oracle resolution must hold exactly the declared items");
  return declared.map(({ evidenceId, itemRef }) => {
    const items = resolution.items.filter((item) => item.evidenceId === evidenceId);
    invariant(items.length === 1, `Oracle resolution must hold exactly one item for ${evidenceId}`);
    const [item] = items;
    invariant(item.source.itemRef === itemRef, `Oracle resolution item for ${evidenceId} is not the declared item`);
    const sourceRefs = item.provenance.filter((p) => p.kind === "SOURCE_REF");
    invariant(sourceRefs.length === 1, `Oracle resolution item for ${evidenceId} must carry one SOURCE_REF provenance`);
    invariant(typeof item.content === "string", `Oracle resolution item for ${evidenceId} must carry string content`);
    return { item, sourceRef: sourceRefs[0].ref };
  });
}

// D6: project a COMPLETE Backend resolution to the readRepositorySources shape.
export function projectBackendContext(order, resolution) {
  const declared = order.requiredFiles.map((path, index) => ({ evidenceId: `file-${index}`, itemRef: path }));
  return {
    repository: { ref: order.repositoryRef, revision: order.revision },
    files: itemsInDeclaredOrder(declared, resolution).map(({ item, sourceRef }) => ({ path: item.source.itemRef, content: item.content, sourceRef }))
  };
}

// D6: project a COMPLETE QA resolution to the readApplicationArtifacts + QaContext shape.
export function projectQaContext(order, resolution) {
  const declared = order.requiredArtifacts.map((artifact, index) => ({ evidenceId: `artifact-${index}`, itemRef: artifact.path }));
  const { workOrderId: producerWorkOrderId, acceptanceDecision } = order.upstream;
  const artifacts = itemsInDeclaredOrder(declared, resolution).map(({ item, sourceRef }, index) => {
    const artifact = order.requiredArtifacts[index];
    const producer = item.provenance.find((p) => p.kind === "PRODUCER_WORK_ORDER");
    const acceptance = item.provenance.find((p) => p.kind === "ACCEPTANCE_DECISION");
    invariant(producer?.ref === producerWorkOrderId, `Oracle artifact ${artifact.ref} producer provenance mismatch`);
    invariant(acceptance?.ref === acceptanceDecision.id && acceptance?.digest === acceptanceDecision.digest, `Oracle artifact ${artifact.ref} acceptance provenance mismatch`);
    return {
      ref: artifact.ref,
      path: artifact.path,
      content: item.content,
      sourceRef,
      provenance: { sourceClass: "APPLICATION_ARTIFACT", producerWorkOrderId, acceptanceDecision }
    };
  });
  return { upstream: order.upstream, artifacts, acceptanceCriteria: order.acceptanceCriteria };
}

// The delivered planner records only error.message for provider failures. Readers such as
// createManifestArtifactReader carry their typed failure in error.code, so the Oracle path
// delegates each read one-for-one and prefixes that code to the message it rethrows (with
// the original error as cause). No read is added, skipped, retried or altered.
export function withReaderErrorCodes(reader, method) {
  invariant(reader && typeof reader[method] === "function", `Oracle context path requires ${method}()`);
  const read = reader[method].bind(reader);
  return {
    async [method](request) {
      try {
        return await read(request);
      } catch (error) {
        const code = typeof error?.code === "string" && error.code ? error.code : null;
        const message = error?.message ?? String(error);
        if (!code || message.includes(code)) throw error;
        const wrapped = new Error(`${code}: ${message}`, { cause: error });
        wrapped.code = code;
        throw wrapped;
      }
    }
  };
}
