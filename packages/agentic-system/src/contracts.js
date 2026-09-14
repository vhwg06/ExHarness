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

export const BackendWorkStatus = Object.freeze({
  APPLIED: "APPLIED",
  BLOCKED: "BLOCKED",
  FAILED: "FAILED"
});

export const BackendEvidenceClaim = Object.freeze({
  MUTATION: "backend.mutation",
  TYPECHECK: "backend.typecheck",
  TESTS: "backend.tests"
});

export const BackendRunAction = Object.freeze({
  RETURN: "RETURN",
  CONTINUE: "CONTINUE",
  BLOCK: "BLOCK",
  FAIL: "FAIL",
  RETRY: "RETRY",
  REQUEST_CONTEXT: "REQUEST_CONTEXT",
  ESCALATE: "ESCALATE"
});

function parseBackendObjective(raw) {
  const value = requireRecord(raw, "BackendObjective");
  const repository = requireRecord(value.repository, "BackendObjective.repository");

  return freezeClone({
    id: requireText(value.id, "BackendObjective.id"),
    task: requireText(value.task, "BackendObjective.task"),
    repository: {
      ref: requireText(repository.ref, "BackendObjective.repository.ref"),
      revision: requireText(repository.revision, "BackendObjective.repository.revision")
    },
    requiredFiles: parseTextArray(value.requiredFiles, "BackendObjective.requiredFiles", { min: 1 }),
    constraints: value.constraints == null
      ? []
      : parseTextArray(value.constraints, "BackendObjective.constraints")
  });
}

export const BackendObjectiveSchema = Object.freeze({
  parse: parseBackendObjective
});

export function defineBackendObjective(raw) {
  return BackendObjectiveSchema.parse(raw);
}

export function makeBackendWorkOrder(rawObjective) {
  const objective = BackendObjectiveSchema.parse(rawObjective);
  return freezeClone({
    id: `${objective.id}:backend`,
    objectiveId: objective.id,
    task: objective.task,
    repositoryRef: objective.repository.ref,
    revision: objective.repository.revision,
    requiredFiles: objective.requiredFiles,
    constraints: objective.constraints
  });
}

export function parseBackendWorkOrder(raw) {
  const value = requireRecord(raw, "BackendWorkOrder");
  return freezeClone({
    id: requireText(value.id, "BackendWorkOrder.id"),
    objectiveId: requireText(value.objectiveId, "BackendWorkOrder.objectiveId"),
    task: requireText(value.task, "BackendWorkOrder.task"),
    repositoryRef: requireText(value.repositoryRef, "BackendWorkOrder.repositoryRef"),
    revision: requireText(value.revision, "BackendWorkOrder.revision"),
    requiredFiles: parseTextArray(value.requiredFiles, "BackendWorkOrder.requiredFiles", { min: 1 }),
    constraints: value.constraints == null
      ? []
      : parseTextArray(value.constraints, "BackendWorkOrder.constraints")
  });
}

function parseBackendContext(raw) {
  const value = requireRecord(raw, "BackendContext");
  const repository = requireRecord(value.repository, "BackendContext.repository");
  invariant(Array.isArray(value.files) && value.files.length > 0, "BackendContext.files must contain at least one file");

  const files = value.files.map((rawFile, index) => {
    const file = requireRecord(rawFile, `BackendContext.files[${index}]`);
    return {
      path: requireText(file.path, `BackendContext.files[${index}].path`),
      content: typeof file.content === "string"
        ? file.content
        : (() => { throw new TypeError(`BackendContext.files[${index}].content must be a string`); })(),
      sourceRef: requireText(file.sourceRef, `BackendContext.files[${index}].sourceRef`)
    };
  });

  return freezeClone({
    repository: {
      ref: requireText(repository.ref, "BackendContext.repository.ref"),
      revision: requireText(repository.revision, "BackendContext.repository.revision")
    },
    files
  });
}

export const BackendContextSchema = Object.freeze({
  parse: parseBackendContext
});

function parseBackendArtifact(raw, index) {
  return parseApplicationArtifactRef(raw, `BackendWorkResult.artifacts[${index}]`);
}

function parseBackendGap(raw, index) {
  const gap = requireRecord(raw, `BackendWorkResult.gaps[${index}]`);
  return {
    id: requireText(gap.id, `BackendWorkResult.gaps[${index}].id`),
    summary: requireText(gap.summary, `BackendWorkResult.gaps[${index}].summary`),
    details: gap.details == null ? null : structuredClone(gap.details)
  };
}

function parseBackendWorkResult(raw) {
  const value = requireRecord(raw, "BackendWorkResult");
  invariant(Object.values(BackendWorkStatus).includes(value.status), "BackendWorkResult.status is invalid");
  invariant(Array.isArray(value.artifacts ?? []), "BackendWorkResult.artifacts must be an array");
  invariant(Array.isArray(value.evidence ?? []), "BackendWorkResult.evidence must be an array");
  invariant(Array.isArray(value.gaps ?? []), "BackendWorkResult.gaps must be an array");

  const blockers = value.blockers == null
    ? []
    : parseTextArray(value.blockers, "BackendWorkResult.blockers");

  if (value.status === BackendWorkStatus.BLOCKED) {
    invariant(blockers.length > 0, "BLOCKED BackendWorkResult requires at least one blocker");
  }

  const revision = value.revision == null
    ? null
    : requireText(value.revision, "BackendWorkResult.revision");

  if (value.status === BackendWorkStatus.APPLIED) {
    invariant(revision != null, "APPLIED BackendWorkResult requires revision");
  }

  return freezeClone({
    status: value.status,
    summary: requireText(value.summary, "BackendWorkResult.summary"),
    revision,
    artifacts: (value.artifacts ?? []).map(parseBackendArtifact),
    evidence: (value.evidence ?? []).map((artifact, index) => structuredClone(requireRecord(artifact, `BackendWorkResult.evidence[${index}]`))),
    gaps: (value.gaps ?? []).map(parseBackendGap),
    blockers
  });
}

export const BackendWorkResultSchema = Object.freeze({
  parse: parseBackendWorkResult
});

export function decideBackendResult(rawResult) {
  const result = BackendWorkResultSchema.parse(rawResult);
  if (result.status === BackendWorkStatus.APPLIED) {
    return freezeClone({ action: BackendRunAction.RETURN, reason: "backend change applied" });
  }
  if (result.status === BackendWorkStatus.BLOCKED) {
    return freezeClone({ action: BackendRunAction.BLOCK, reason: result.blockers.join("; ") });
  }
  return freezeClone({ action: BackendRunAction.FAIL, reason: result.summary });
}
