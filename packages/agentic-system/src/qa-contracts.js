import { parseApplicationArtifactRef } from "./artifact-ref.js";

function invariant(condition, message) {
  if (!condition) throw new TypeError(message);
}

function requireRecord(value, name) {
  invariant(value && typeof value === "object" && !Array.isArray(value), `${name} must be an object`);
  return value;
}

function requireText(value, name) {
  invariant(typeof value === "string" && value.trim().length > 0, `${name} must be a non-empty string`);
  return value;
}

function parseTextArray(value, name, { min = 0 } = {}) {
  invariant(Array.isArray(value), `${name} must be an array`);
  invariant(value.length >= min, `${name} must contain at least ${min} item(s)`);
  return value.map((item, index) => requireText(item, `${name}[${index}]`));
}

function freezeClone(value) {
  return Object.freeze(structuredClone(value));
}

function parseDecisionRef(raw, label) {
  const value = requireRecord(raw, label);
  return {
    id: requireText(value.id, `${label}.id`),
    digest: requireText(value.digest, `${label}.digest`)
  };
}

export const QaWorkStatus = Object.freeze({
  VERIFIED: "VERIFIED",
  ISSUES_FOUND: "ISSUES_FOUND",
  BLOCKED: "BLOCKED",
  FAILED: "FAILED"
});

export const QaEvidenceClaim = Object.freeze({
  BEHAVIOR: "qa.behavior",
  REGRESSION: "qa.regression"
});

export const QaRunAction = Object.freeze({
  RETURN: "RETURN",
  CONTINUE: "CONTINUE",
  BLOCK: "BLOCK",
  FAIL: "FAIL"
});

function parseQaObjective(raw) {
  const value = requireRecord(raw, "QaObjective");
  return freezeClone({
    id: requireText(value.id, "QaObjective.id"),
    task: requireText(value.task, "QaObjective.task"),
    requiredArtifactPaths: parseTextArray(value.requiredArtifactPaths, "QaObjective.requiredArtifactPaths", { min: 1 }),
    acceptanceCriteria: parseTextArray(value.acceptanceCriteria, "QaObjective.acceptanceCriteria", { min: 1 })
  });
}

export const QaObjectiveSchema = Object.freeze({ parse: parseQaObjective });

export function defineQaObjective(raw) {
  return QaObjectiveSchema.parse(raw);
}

function parseBackendQaHandoff(raw) {
  const value = requireRecord(raw, "BackendQaHandoff");
  invariant(Array.isArray(value.artifacts) && value.artifacts.length > 0, "BackendQaHandoff.artifacts must contain at least one artifact ref");
  return freezeClone({
    producerWorkOrderId: requireText(value.producerWorkOrderId, "BackendQaHandoff.producerWorkOrderId"),
    revision: requireText(value.revision, "BackendQaHandoff.revision"),
    acceptanceDecision: parseDecisionRef(value.acceptanceDecision, "BackendQaHandoff.acceptanceDecision"),
    artifacts: value.artifacts.map((artifact, index) => parseApplicationArtifactRef(artifact, `BackendQaHandoff.artifacts[${index}]`))
  });
}

export const BackendQaHandoffSchema = Object.freeze({ parse: parseBackendQaHandoff });

export function makeQaWorkOrder(rawObjective, rawHandoff) {
  const objective = QaObjectiveSchema.parse(rawObjective);
  const handoff = BackendQaHandoffSchema.parse(rawHandoff);
  const requiredArtifacts = objective.requiredArtifactPaths.map((path) => {
    const artifact = handoff.artifacts.find((item) => item.path === path);
    invariant(artifact, `QA handoff missing required artifact path: ${path}`);
    return artifact;
  });

  return freezeClone({
    id: `${objective.id}:qa`,
    objectiveId: objective.id,
    task: objective.task,
    upstream: {
      workOrderId: handoff.producerWorkOrderId,
      revision: handoff.revision,
      acceptanceDecision: handoff.acceptanceDecision
    },
    requiredArtifacts,
    acceptanceCriteria: objective.acceptanceCriteria
  });
}

export function parseQaWorkOrder(raw) {
  const value = requireRecord(raw, "QaWorkOrder");
  const upstream = requireRecord(value.upstream, "QaWorkOrder.upstream");
  invariant(Array.isArray(value.requiredArtifacts) && value.requiredArtifacts.length > 0, "QaWorkOrder.requiredArtifacts must contain at least one artifact ref");
  return freezeClone({
    id: requireText(value.id, "QaWorkOrder.id"),
    objectiveId: requireText(value.objectiveId, "QaWorkOrder.objectiveId"),
    task: requireText(value.task, "QaWorkOrder.task"),
    upstream: {
      workOrderId: requireText(upstream.workOrderId, "QaWorkOrder.upstream.workOrderId"),
      revision: requireText(upstream.revision, "QaWorkOrder.upstream.revision"),
      acceptanceDecision: parseDecisionRef(upstream.acceptanceDecision, "QaWorkOrder.upstream.acceptanceDecision")
    },
    requiredArtifacts: value.requiredArtifacts.map((artifact, index) => parseApplicationArtifactRef(artifact, `QaWorkOrder.requiredArtifacts[${index}]`)),
    acceptanceCriteria: parseTextArray(value.acceptanceCriteria, "QaWorkOrder.acceptanceCriteria", { min: 1 })
  });
}

function parseQaContext(raw) {
  const value = requireRecord(raw, "QaContext");
  const upstream = requireRecord(value.upstream, "QaContext.upstream");
  invariant(Array.isArray(value.artifacts) && value.artifacts.length > 0, "QaContext.artifacts must contain at least one resolved artifact");

  const artifacts = value.artifacts.map((rawArtifact, index) => {
    const artifact = requireRecord(rawArtifact, `QaContext.artifacts[${index}]`);
    const provenance = requireRecord(artifact.provenance, `QaContext.artifacts[${index}].provenance`);
    invariant(provenance.sourceClass === "APPLICATION_ARTIFACT", `QaContext.artifacts[${index}].provenance.sourceClass must be APPLICATION_ARTIFACT`);
    const parsed = {
      ref: requireText(artifact.ref, `QaContext.artifacts[${index}].ref`),
      content: typeof artifact.content === "string"
        ? artifact.content
        : (() => { throw new TypeError(`QaContext.artifacts[${index}].content must be a string`); })(),
      sourceRef: requireText(artifact.sourceRef, `QaContext.artifacts[${index}].sourceRef`),
      provenance: {
        sourceClass: "APPLICATION_ARTIFACT",
        producerWorkOrderId: requireText(provenance.producerWorkOrderId, `QaContext.artifacts[${index}].provenance.producerWorkOrderId`),
        acceptanceDecision: parseDecisionRef(provenance.acceptanceDecision, `QaContext.artifacts[${index}].provenance.acceptanceDecision`)
      }
    };
    if (artifact.path != null) parsed.path = requireText(artifact.path, `QaContext.artifacts[${index}].path`);
    return parsed;
  });

  return freezeClone({
    upstream: {
      workOrderId: requireText(upstream.workOrderId, "QaContext.upstream.workOrderId"),
      revision: requireText(upstream.revision, "QaContext.upstream.revision"),
      acceptanceDecision: parseDecisionRef(upstream.acceptanceDecision, "QaContext.upstream.acceptanceDecision")
    },
    artifacts,
    acceptanceCriteria: parseTextArray(value.acceptanceCriteria, "QaContext.acceptanceCriteria", { min: 1 })
  });
}

export const QaContextSchema = Object.freeze({ parse: parseQaContext });

function parseQaWorkResult(raw) {
  const value = requireRecord(raw, "QaWorkResult");
  invariant(Object.values(QaWorkStatus).includes(value.status), "QaWorkResult.status is invalid");
  invariant(Array.isArray(value.evidence ?? []), "QaWorkResult.evidence must be an array");
  invariant(Array.isArray(value.inspectedArtifacts ?? []), "QaWorkResult.inspectedArtifacts must be an array");

  const blockers = value.blockers == null ? [] : parseTextArray(value.blockers, "QaWorkResult.blockers");
  const issues = value.issues == null ? [] : parseTextArray(value.issues, "QaWorkResult.issues");
  if (value.status === QaWorkStatus.BLOCKED) invariant(blockers.length > 0, "BLOCKED QaWorkResult requires at least one blocker");
  if (value.status === QaWorkStatus.ISSUES_FOUND) invariant(issues.length > 0, "ISSUES_FOUND QaWorkResult requires at least one issue");

  const verifiedRevision = value.verifiedRevision == null ? null : requireText(value.verifiedRevision, "QaWorkResult.verifiedRevision");
  if (value.status === QaWorkStatus.VERIFIED || value.status === QaWorkStatus.ISSUES_FOUND) {
    invariant(verifiedRevision != null, `${value.status} QaWorkResult requires verifiedRevision`);
    invariant(value.inspectedArtifacts.length > 0, `${value.status} QaWorkResult requires inspectedArtifacts`);
  }

  return freezeClone({
    status: value.status,
    summary: requireText(value.summary, "QaWorkResult.summary"),
    verifiedRevision,
    inspectedArtifacts: (value.inspectedArtifacts ?? []).map((artifact, index) => parseApplicationArtifactRef(artifact, `QaWorkResult.inspectedArtifacts[${index}]`)),
    evidence: (value.evidence ?? []).map((artifact, index) => structuredClone(requireRecord(artifact, `QaWorkResult.evidence[${index}]`))),
    issues,
    blockers
  });
}

export const QaWorkResultSchema = Object.freeze({ parse: parseQaWorkResult });
