// ACCOUNTING_V1: nullable, status-qualified usage and cost. Absent observations stay null;
// a value the source did not report can never be written as observed (no zero-fill).
import { CONTRACT_KINDS, fail, seal, verifySeal, requireExactKeys, requireNullableCount, requireEnum, requireDigest, OUTCOME_ENUMS } from './contracts.js';

export const ACCOUNTING_FIELDS = Object.freeze(['inputTokens', 'outputTokens', 'cachedTokens', 'cacheWriteTokens', 'providerCostUsd', 'normalizedCostUsd']);

function statusFor(observed) {
  if (observed.length === ACCOUNTING_FIELDS.length) return 'KNOWN';
  return observed.length === 0 ? 'UNKNOWN' : 'PARTIAL';
}

// observation: { source, reportedFields: string[], values: { <field>: number|null } }
export function normalizeAccounting(observation) {
  requireExactKeys(observation, 'accounting observation', ['source', 'reportedFields', 'values']);
  if (typeof observation.source !== 'string' || !observation.source) fail('SCHEMA', 'accounting observation.source must be a non-empty string');
  if (!Array.isArray(observation.reportedFields)) fail('SCHEMA', 'accounting observation.reportedFields must be an array');
  const reported = new Set(observation.reportedFields);
  for (const field of reported) if (!ACCOUNTING_FIELDS.includes(field)) fail('SCHEMA', `unknown accounting field ${field}`);
  requireExactKeys(observation.values, 'accounting observation.values', [], ACCOUNTING_FIELDS);
  const values = {};
  for (const field of ACCOUNTING_FIELDS) {
    const raw = field in observation.values ? observation.values[field] : null;
    const value = requireNullableCount(raw, `accounting.${field}`);
    if (!reported.has(field) && value !== null) fail('ZERO_FILL', `accounting.${field} was not reported by ${observation.source} but carries ${value}`);
    if (reported.has(field) && value === null) fail('SCHEMA', `accounting.${field} is reported but null`);
    values[field] = value;
  }
  const observed = ACCOUNTING_FIELDS.filter(field => values[field] !== null);
  return seal({ kind: CONTRACT_KINDS.ACCOUNTING, source: observation.source, ...values, status: statusFor(observed), observedFields: observed }, 'accountingDigest');
}

export function assertAccounting(value) {
  requireExactKeys(value, 'accounting', ['kind', 'source', ...ACCOUNTING_FIELDS, 'status', 'observedFields', 'accountingDigest']);
  if (value.kind !== CONTRACT_KINDS.ACCOUNTING) fail('SCHEMA', `accounting.kind must be ${CONTRACT_KINDS.ACCOUNTING}`);
  requireEnum(value.status, 'accounting.status', OUTCOME_ENUMS.usageStatus);
  for (const field of ACCOUNTING_FIELDS) requireNullableCount(value[field], `accounting.${field}`);
  const observed = ACCOUNTING_FIELDS.filter(field => value[field] !== null);
  if (JSON.stringify(observed) !== JSON.stringify(value.observedFields)) fail('ZERO_FILL', 'accounting.observedFields does not match the non-null fields');
  if (statusFor(observed) !== value.status) fail('ZERO_FILL', `accounting.status ${value.status} does not match its observed fields`);
  requireDigest(value.accountingDigest, 'accounting.accountingDigest');
  verifySeal(value, 'accountingDigest', 'IDENTITY_DRIFT');
  return value;
}
