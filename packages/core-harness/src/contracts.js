export const EvaluationValidity = Object.freeze({
  VALID: "VALID",
  INVALID: "INVALID",
  INCONCLUSIVE: "INCONCLUSIVE"
});

export const EvaluationVerdict = Object.freeze({
  PASS: "PASS",
  GAP: "GAP",
  BLOCKED: "BLOCKED"
});

export const KnowledgeKind = Object.freeze({
  HYPOTHESIS: "HYPOTHESIS",
  FINDING: "FINDING",
  FAILED_DIRECTION: "FAILED_DIRECTION",
  DECISION: "DECISION"
});

export const ImplementationStatus = Object.freeze({
  BASELINE: "BASELINE",
  WORKING: "WORKING",
  PROMOTED: "PROMOTED"
});

export const CorePractice = Object.freeze({
  CONTEXT_PROJECTION: "CONTEXT_PROJECTION",
  SUPERVISION: "SUPERVISION"
});

export function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

export function requireText(value, label) {
  invariant(typeof value === "string" && value.trim().length > 0, `${label} must be non-empty text`);
  return value;
}

export function normalizeCandidate(candidate) {
  invariant(candidate && typeof candidate === "object", "candidate is required");
  const id = requireText(candidate.id, "candidate.id");
  const version = requireText(candidate.version, "candidate.version");
  return Object.freeze({ id, version });
}

export function candidateKey(candidate) {
  const normalized = normalizeCandidate(candidate);
  return `${normalized.id}@${normalized.version}`;
}

export function sameCandidate(left, right) {
  if (!left || !right) return false;
  return candidateKey(left) === candidateKey(right);
}

export function validateEvaluation(result) {
  invariant(result && typeof result === "object", "evaluation result is required");
  invariant(Object.values(EvaluationValidity).includes(result.validity), "evaluation validity is invalid");

  if (result.validity === EvaluationValidity.VALID) {
    invariant(Object.values(EvaluationVerdict).includes(result.verdict), "valid evaluation requires a verdict");
  } else {
    invariant(result.verdict == null, "invalid or inconclusive evaluation must not certify a verdict");
  }

  return Object.freeze({
    validity: result.validity,
    verdict: result.verdict ?? null,
    findings: Object.freeze([...(result.findings ?? [])]),
    evidence: Object.freeze([...(result.evidence ?? [])])
  });
}

export function validateKnowledgeRecord(record) {
  invariant(record && typeof record === "object", "knowledge record is required");
  invariant(Object.values(KnowledgeKind).includes(record.kind), "knowledge kind is invalid");
  const statement = requireText(record.statement, "knowledge.statement");
  const evidence = [...(record.evidence ?? [])];

  if (record.kind === KnowledgeKind.FINDING || record.kind === KnowledgeKind.FAILED_DIRECTION) {
    invariant(evidence.length > 0, `${record.kind.toLowerCase()} requires evidence`);
  }

  return Object.freeze({
    kind: record.kind,
    statement,
    evidence: Object.freeze(evidence),
    scope: record.scope ?? null
  });
}

export function validateSupervisorIntervention(value) {
  if (value == null) return null;
  invariant(value && typeof value === "object", "supervisor intervention must be an object or null");
  invariant(value.verdict == null, "supervisor cannot issue correctness verdicts");
  invariant(value.candidate == null && value.mutated == null && value.mutation == null, "supervisor cannot mutate candidate state");

  return Object.freeze({
    reason: requireText(value.reason, "supervisor intervention reason"),
    guidance: structuredClone(value.guidance ?? null)
  });
}

export function validateDoseDecision(value) {
  invariant(value && typeof value === "object", "dosage decision is required");
  invariant(typeof value.enabled === "boolean", "dosage decision requires enabled boolean");
  const reason = requireText(value.reason, "dosage decision reason");

  if (value.enabled) {
    invariant(value.dose != null, "enabled practice requires an explicit dose");
  }

  return Object.freeze({
    enabled: value.enabled,
    dose: value.enabled ? structuredClone(value.dose) : null,
    reason
  });
}

export function assertPort(port, method, label) {
  invariant(port && typeof port[method] === "function", `${label} requires ${method}()`);
}
