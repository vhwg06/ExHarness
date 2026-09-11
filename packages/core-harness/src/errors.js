export const ExHarnessErrorCode = Object.freeze({
  STORE_CONFLICT: "STORE_CONFLICT",
  SCHEMA_UNSUPPORTED: "SCHEMA_UNSUPPORTED",
  RECOVERY_REQUIRED: "RECOVERY_REQUIRED",
  EXECUTION_FAILED: "EXECUTION_FAILED",
  EXECUTION_TIMED_OUT: "EXECUTION_TIMED_OUT",
  EXECUTION_ABORTED: "EXECUTION_ABORTED",
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

export class ExecutionError extends ExHarnessError {
  constructor(code, message, details = null, cause = null) {
    super(code, message, { details, cause });
    this.name = "ExecutionError";
  }
}
