// Canonical benchmark contract kinds, outcome enumerations and pure identity helpers.
// Node built-ins only; no product runtime, substrate or provider dependency.
import { createHash } from 'node:crypto';

export const CONTRACT_KINDS = deepFreeze({
  EXPERIMENT_REGISTRATION: 'EXPERIMENT_REGISTRATION_V1',
  BENCHMARK_UNIT: 'BENCHMARK_UNIT_V1',
  ATTEMPT_LEDGER_EVENT: 'ATTEMPT_LEDGER_EVENT_V1',
  ATTEMPT_RECORD: 'BENCHMARK_ATTEMPT_RECORD_V1',
  EVIDENCE_MANIFEST: 'EVIDENCE_MANIFEST_V1',
  ACCOUNTING: 'ACCOUNTING_V1',
  AUDIT: 'BENCHMARK_AUDIT_V1'
});

export const OUTCOME_ENUMS = deepFreeze({
  quality: ['ACCEPTED', 'REJECTED', 'NOT_EVALUATED'],
  termination: ['COMPLETED', 'BUDGET_EXHAUSTED', 'AGENT_TIMEOUT', 'AGENT_ERROR', 'CANCELLED'],
  providerStatus: ['NONE', 'RATE_LIMITED', 'PROVIDER_TIMEOUT', 'PROVIDER_5XX', 'ROUTE_MISMATCH', 'USAGE_UNKNOWN'],
  infrastructureStatus: ['NONE', 'ENV_BUILD', 'ENV_RUNTIME', 'ADAPTER_SETUP', 'HARNESS_PROTOCOL', 'ARTIFACT_EXTRACTION', 'VERIFIER_ERROR'],
  usageStatus: ['KNOWN', 'PARTIAL', 'UNKNOWN'],
  extractionStatus: ['EXTRACTED', 'NOT_PRODUCED', 'NOT_DECLARED', 'FAILED'],
  evaluatorVerdict: ['PASS', 'FAIL', 'ERROR', 'NOT_RUN'],
  ledgerEvent: ['STARTED', 'SETTLED'],
  auditStatus: ['PASS', 'FAIL']
});

export const PROVIDER_FAILURES = Object.freeze(['RATE_LIMITED', 'PROVIDER_TIMEOUT', 'PROVIDER_5XX']);

export class BenchmarkContractError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = 'BenchmarkContractError';
    this.code = code;
  }
}

export function fail(code, message) {
  throw new BenchmarkContractError(code, message);
}

export function canonical(value) {
  if (value === undefined) fail('NON_CANONICAL', 'undefined is not canonical');
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) fail('NON_CANONICAL', 'non-finite number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}

export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function digestBytes(bytes) {
  return `sha256:${sha256Hex(bytes)}`;
}

export function digestOf(value) {
  return digestBytes(canonical(value));
}

export function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

export function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

export function withoutKey(value, key) {
  const { [key]: _omitted, ...rest } = value;
  return rest;
}

// Seal: attach a digest over every other field, then deep-freeze.
export function seal(value, digestKey) {
  const body = clone(value);
  return deepFreeze({ ...body, [digestKey]: digestOf(body) });
}

export function verifySeal(value, digestKey, code) {
  const expected = digestOf(withoutKey(value, digestKey));
  if (value[digestKey] !== expected) fail(code, `${digestKey} does not match content (expected ${expected})`);
}

// ---- field validators ----------------------------------------------------
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/+-]{0,199}$/;

export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function requireObject(value, name, code = 'SCHEMA') {
  if (!isPlainObject(value)) fail(code, `${name} must be an object`);
  return value;
}

export function requireExactKeys(value, name, required, optional = [], code = 'SCHEMA') {
  requireObject(value, name, code);
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail(code, `${name}.${key} is not part of the contract`);
  for (const key of required) if (!(key in value)) fail(code, `${name}.${key} is required`);
  return value;
}

export function requireString(value, name, code = 'SCHEMA') {
  if (typeof value !== 'string' || value.length === 0) fail(code, `${name} must be a non-empty string`);
  return value;
}

export function requireId(value, name, code = 'SCHEMA') {
  if (typeof value !== 'string' || !ID.test(value)) fail(code, `${name} must be a stable identifier`);
  return value;
}

export function requireDigest(value, name, code = 'SCHEMA') {
  if (typeof value !== 'string' || !DIGEST.test(value)) fail(code, `${name} must be sha256:<64 hex>`);
  return value;
}

export function requireEnum(value, name, allowed, code = 'SCHEMA') {
  if (!allowed.includes(value)) fail(code, `${name} must be one of ${allowed.join('|')}`);
  return value;
}

export function requireTimestamp(value, name, code = 'SCHEMA') {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) fail(code, `${name} must be an ISO timestamp`);
  return value;
}

export function requireNullableCount(value, name, code = 'SCHEMA') {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) fail(code, `${name} must be null or a non-negative finite number`);
  return value;
}

export function requireNullableString(value, name, code = 'SCHEMA') {
  if (value === null) return null;
  return requireString(value, name, code);
}

export function requireRelativeRef(value, name, code = 'SCHEMA') {
  requireString(value, name, code);
  if (value.startsWith('/') || /^[A-Za-z]:/.test(value) || value.includes('\\') || value.split('/').some(part => part === '..' || part === '.' || part === ''))
    fail(code, `${name} must be a normalized relative ref`);
  return value;
}
