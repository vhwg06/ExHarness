export const ExHarnessErrorCode = Object.freeze({
  STORE_CONFLICT: "STORE_CONFLICT",
  SCHEMA_UNSUPPORTED: "SCHEMA_UNSUPPORTED",
  RECOVERY_REQUIRED: "RECOVERY_REQUIRED",
  SEARCH_INVESTMENT_STOPPED: "SEARCH_INVESTMENT_STOPPED",
  SEARCH_INVESTMENT_ESCALATION_REQUIRED: "SEARCH_INVESTMENT_ESCALATION_REQUIRED",
  CONTEXT_LIMIT_EXCEEDED: "CONTEXT_LIMIT_EXCEEDED",
  RESOURCE_REF_INVALID: "RESOURCE_REF_INVALID",
  RESOURCE_REVOKED: "RESOURCE_REVOKED",
  RESOURCE_EXPIRED: "RESOURCE_EXPIRED",
  RESOURCE_ACCESS_DENIED: "RESOURCE_ACCESS_DENIED",
  RESOURCE_OPERATION_NOT_ALLOWED: "RESOURCE_OPERATION_NOT_ALLOWED",
  RESOURCE_LIMIT_EXCEEDED: "RESOURCE_LIMIT_EXCEEDED",
  EXECUTION_FAILED: "EXECUTION_FAILED",
  EXECUTION_TIMED_OUT: "EXECUTION_TIMED_OUT",
  EXECUTION_ABORTED: "EXECUTION_ABORTED",
  PREDICT_VALIDATION_EXHAUSTED: "PREDICT_VALIDATION_EXHAUSTED",
  CODEACT_PROTOCOL_ERROR: "CODEACT_PROTOCOL_ERROR",
  CODEACT_TEXT_RESPONSE: "CODEACT_TEXT_RESPONSE",
  CODEACT_TURN_LIMIT_EXCEEDED: "CODEACT_TURN_LIMIT_EXCEEDED",
  CODEACT_ACTION_BUDGET_EXCEEDED: "CODEACT_ACTION_BUDGET_EXCEEDED",
  CODEACT_TIME_BUDGET_EXCEEDED: "CODEACT_TIME_BUDGET_EXCEEDED",
  CONTRACT_VIOLATION: "CONTRACT_VIOLATION"
});

export class ExHarnessError extends Error {
  constructor(code, message, { details = null, cause = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "ExHarnessError";
    this.code = code;
    this.details = details == null ? null : structuredClone(details);
  }
}

export class StoreConflictError extends ExHarnessError {
  constructor({ sessionId, expectedRevision, actualRevision }) {
    super(
      ExHarnessErrorCode.STORE_CONFLICT,
      `session revision conflict: ${sessionId}`,
      { details: { sessionId, expectedRevision, actualRevision } }
    );
    this.name = "StoreConflictError";
  }
}

export class SchemaUnsupportedError extends ExHarnessError {
  constructor({ sessionId, schemaVersion, supportedVersion }) {
    super(
      ExHarnessErrorCode.SCHEMA_UNSUPPORTED,
      `unsupported session schema version: ${schemaVersion}`,
      { details: { sessionId, schemaVersion, supportedVersion } }
    );
    this.name = "SchemaUnsupportedError";
  }
}

export class RecoveryRequiredError extends ExHarnessError {
  constructor({ sessionId, variationId, lastActivityAt }) {
    super(
      ExHarnessErrorCode.RECOVERY_REQUIRED,
      `session has an interrupted or still-running variation: ${variationId}`,
      { details: { sessionId, variationId, lastActivityAt } }
    );
    this.name = "RecoveryRequiredError";
  }
}

export class SearchInvestmentBoundaryError extends ExHarnessError {
  constructor({ sessionId, decision }) {
    const escalation = decision?.action === "ESCALATE";
    const code = escalation
      ? ExHarnessErrorCode.SEARCH_INVESTMENT_ESCALATION_REQUIRED
      : ExHarnessErrorCode.SEARCH_INVESTMENT_STOPPED;
    super(
      code,
      escalation
        ? "search investment policy requires escalation before another variation"
        : "search investment policy stopped further variation",
      {
        details: {
          sessionId,
          decisionId: decision?.id ?? null,
          state: decision?.state ?? null,
          action: decision?.action ?? null,
          rationale: decision?.rationale ?? null
        }
      }
    );
    this.name = "SearchInvestmentBoundaryError";
    this.decision = decision == null ? null : structuredClone(decision);
  }
}

export class ContextLimitExceededError extends ExHarnessError {
  constructor({ limit, maximum, actual }) {
    super(
      ExHarnessErrorCode.CONTEXT_LIMIT_EXCEEDED,
      `context limit exceeded: ${limit}`,
      { details: { limit, maximum, actual } }
    );
    this.name = "ContextLimitExceededError";
  }
}

export class ResourceAccessError extends ExHarnessError {
  constructor(code, message, details = null) {
    super(code, message, { details });
    this.name = "ResourceAccessError";
  }
}

export class ExecutionError extends ExHarnessError {
  constructor(code, message, details = null, cause = null) {
    super(code, message, { details, cause });
    this.name = "ExecutionError";
  }
}

export class PredictValidationError extends ExHarnessError {
  constructor({ attempts, lastValidationError = null }) {
    super(
      ExHarnessErrorCode.PREDICT_VALIDATION_EXHAUSTED,
      `predict output failed validation after ${attempts} attempt${attempts === 1 ? "" : "s"}`,
      { details: { attempts, lastValidationError } }
    );
    this.name = "PredictValidationError";
  }
}

export class CodeActBoundaryError extends ExHarnessError {
  constructor(code, message, details = null, cause = null) {
    super(code, message, { details, cause });
    this.name = "CodeActBoundaryError";
  }
}
