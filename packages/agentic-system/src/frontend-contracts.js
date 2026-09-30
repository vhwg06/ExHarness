import { parseApplicationArtifactRef } from "./artifact-ref.js";

// Frontend domain contracts. They are independent of Backend stage, session and
// completion state: a Frontend objective carries only its own WHAT.
function invariant(condition, message) { if (!condition) throw new TypeError(message); }
function requireRecord(value, name) { invariant(value && typeof value === "object" && !Array.isArray(value), `${name} must be an object`); return value; }
function requireText(value, name) { invariant(typeof value === "string" && value.trim().length > 0, `${name} must be a non-empty string`); return value; }
function parseTextArray(value, name, { min = 0 } = {}) {
  invariant(Array.isArray(value), `${name} must be an array`);
  invariant(value.length >= min, `${name} must contain at least ${min} item(s)`);
  return value.map((item, index) => requireText(item, `${name}[${index}]`));
}
const freezeClone = (value) => Object.freeze(structuredClone(value));

export const FrontendWorkStatus = Object.freeze({ APPLIED: "APPLIED", BLOCKED: "BLOCKED", FAILED: "FAILED" });
export const FrontendEvidenceClaim = Object.freeze({ MUTATION: "frontend.mutation", TYPECHECK: "frontend.typecheck", TESTS: "frontend.tests" });
export const FrontendRunAction = Object.freeze({ RETURN: "RETURN", CONTINUE: "CONTINUE", BLOCK: "BLOCK", FAIL: "FAIL" });

function parseFrontendObjective(raw) {
  const value = requireRecord(raw, "FrontendObjective");
  const repository = requireRecord(value.repository, "FrontendObjective.repository");
  return freezeClone({
    id: requireText(value.id, "FrontendObjective.id"),
    task: requireText(value.task, "FrontendObjective.task"),
    repository: { ref: requireText(repository.ref, "FrontendObjective.repository.ref"), revision: requireText(repository.revision, "FrontendObjective.repository.revision") },
    requiredFiles: parseTextArray(value.requiredFiles, "FrontendObjective.requiredFiles", { min: 1 }),
    components: value.components == null ? [] : parseTextArray(value.components, "FrontendObjective.components"),
    constraints: value.constraints == null ? [] : parseTextArray(value.constraints, "FrontendObjective.constraints")
  });
}
export const FrontendObjectiveSchema = Object.freeze({ parse: parseFrontendObjective });
export const defineFrontendObjective = (raw) => FrontendObjectiveSchema.parse(raw);

export function makeFrontendWorkOrder(rawObjective) {
  const objective = FrontendObjectiveSchema.parse(rawObjective);
  return freezeClone({
    id: `${objective.id}:frontend`,
    objectiveId: objective.id,
    task: objective.task,
    repositoryRef: objective.repository.ref,
    revision: objective.repository.revision,
    requiredFiles: objective.requiredFiles,
    components: objective.components,
    constraints: objective.constraints
  });
}

export function parseFrontendWorkOrder(raw) {
  const value = requireRecord(raw, "FrontendWorkOrder");
  return freezeClone({
    id: requireText(value.id, "FrontendWorkOrder.id"),
    objectiveId: requireText(value.objectiveId, "FrontendWorkOrder.objectiveId"),
    task: requireText(value.task, "FrontendWorkOrder.task"),
    repositoryRef: requireText(value.repositoryRef, "FrontendWorkOrder.repositoryRef"),
    revision: requireText(value.revision, "FrontendWorkOrder.revision"),
    requiredFiles: parseTextArray(value.requiredFiles, "FrontendWorkOrder.requiredFiles", { min: 1 }),
    components: value.components == null ? [] : parseTextArray(value.components, "FrontendWorkOrder.components"),
    constraints: value.constraints == null ? [] : parseTextArray(value.constraints, "FrontendWorkOrder.constraints")
  });
}

function parseFrontendContext(raw) {
  const value = requireRecord(raw, "FrontendContext");
  const repository = requireRecord(value.repository, "FrontendContext.repository");
  invariant(Array.isArray(value.files) && value.files.length > 0, "FrontendContext.files must contain at least one file");
  return freezeClone({
    repository: { ref: requireText(repository.ref, "FrontendContext.repository.ref"), revision: requireText(repository.revision, "FrontendContext.repository.revision") },
    files: value.files.map((rawFile, index) => {
      const file = requireRecord(rawFile, `FrontendContext.files[${index}]`);
      invariant(typeof file.content === "string", `FrontendContext.files[${index}].content must be a string`);
      return { path: requireText(file.path, `FrontendContext.files[${index}].path`), content: file.content, sourceRef: requireText(file.sourceRef, `FrontendContext.files[${index}].sourceRef`) };
    })
  });
}
export const FrontendContextSchema = Object.freeze({ parse: parseFrontendContext });

function parseFrontendWorkResult(raw) {
  const value = requireRecord(raw, "FrontendWorkResult");
  invariant(Object.values(FrontendWorkStatus).includes(value.status), "FrontendWorkResult.status is invalid");
  for (const key of ["artifacts", "evidence", "gaps"]) invariant(Array.isArray(value[key] ?? []), `FrontendWorkResult.${key} must be an array`);
  const blockers = value.blockers == null ? [] : parseTextArray(value.blockers, "FrontendWorkResult.blockers");
  if (value.status === FrontendWorkStatus.BLOCKED) invariant(blockers.length > 0, "BLOCKED FrontendWorkResult requires at least one blocker");
  const revision = value.revision == null ? null : requireText(value.revision, "FrontendWorkResult.revision");
  if (value.status === FrontendWorkStatus.APPLIED) invariant(revision != null, "APPLIED FrontendWorkResult requires revision");
  return freezeClone({
    status: value.status,
    summary: requireText(value.summary, "FrontendWorkResult.summary"),
    revision,
    artifacts: (value.artifacts ?? []).map((artifact, index) => parseApplicationArtifactRef(artifact, `FrontendWorkResult.artifacts[${index}]`)),
    evidence: (value.evidence ?? []).map((artifact, index) => structuredClone(requireRecord(artifact, `FrontendWorkResult.evidence[${index}]`))),
    gaps: (value.gaps ?? []).map((gap, index) => {
      requireRecord(gap, `FrontendWorkResult.gaps[${index}]`);
      return { id: requireText(gap.id, `FrontendWorkResult.gaps[${index}].id`), summary: requireText(gap.summary, `FrontendWorkResult.gaps[${index}].summary`) };
    }),
    blockers
  });
}
export const FrontendWorkResultSchema = Object.freeze({ parse: parseFrontendWorkResult });
