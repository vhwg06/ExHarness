// Append-only attempt ledger: STARTED before substrate execution, SETTLED with a sealed
// BENCHMARK_ATTEMPT_RECORD_V1. Retries are new attempts linked by retryOfAttemptId; nothing is overwritten.
import {
  CONTRACT_KINDS, OUTCOME_ENUMS, fail, seal, verifySeal, clone, digestOf, deepFreeze, withoutKey,
  requireExactKeys, requireId, requireString, requireDigest, requireEnum, requireTimestamp, requireNullableCount,
  requireNullableString, requireRelativeRef
} from './contracts.js';
import { assertExperimentRegistration } from './experiment.js';
import { assertBenchmarkUnit } from './unit.js';
import { assertAccounting } from './accounting.js';

const RECORD_FIELDS = ['kind', 'experimentId', 'cohortId', 'unitId', 'attemptId', 'retryOfAttemptId', 'protocolHash', 'task', 'runtime', 'producer',
  'budget', 'candidate', 'evidence', 'usage', 'timing', 'quality', 'termination', 'providerStatus', 'infrastructureStatus', 'failureFingerprint'];

function validateRecordBody(record) {
  requireExactKeys(record, 'record', RECORD_FIELDS, ['recordDigest']);
  if (record.kind !== CONTRACT_KINDS.ATTEMPT_RECORD) fail('SCHEMA', `record.kind must be ${CONTRACT_KINDS.ATTEMPT_RECORD}`);
  requireId(record.experimentId, 'record.experimentId');
  if (record.cohortId !== null) requireId(record.cohortId, 'record.cohortId');
  requireId(record.unitId, 'record.unitId');
  requireId(record.attemptId, 'record.attemptId');
  if (record.retryOfAttemptId !== null) requireId(record.retryOfAttemptId, 'record.retryOfAttemptId');
  requireDigest(record.protocolHash, 'record.protocolHash');
  requireExactKeys(record.task, 'record.task', ['id', 'bundleDigest', 'environmentIdentity', 'instructionDigest']);
  requireString(record.task.id, 'record.task.id');
  requireDigest(record.task.bundleDigest, 'record.task.bundleDigest');
  requireString(record.task.environmentIdentity, 'record.task.environmentIdentity');
  requireDigest(record.task.instructionDigest, 'record.task.instructionDigest');
  requireExactKeys(record.runtime, 'record.runtime', ['substrate', 'substrateVersion', 'substrateCommit', 'sourceSha', 'profileHash']);
  requireString(record.runtime.substrate, 'record.runtime.substrate');
  requireString(record.runtime.substrateVersion, 'record.runtime.substrateVersion');
  requireNullableString(record.runtime.substrateCommit, 'record.runtime.substrateCommit');
  requireString(record.runtime.sourceSha, 'record.runtime.sourceSha');
  requireDigest(record.runtime.profileHash, 'record.runtime.profileHash');
  requireExactKeys(record.producer, 'record.producer', ['kind', 'identity', 'model', 'provider']);
  requireString(record.producer.kind, 'record.producer.kind');
  requireString(record.producer.identity, 'record.producer.identity');
  requireNullableString(record.producer.model, 'record.producer.model');
  requireNullableString(record.producer.provider, 'record.producer.provider');
  requireExactKeys(record.budget, 'record.budget', ['wallMs', 'inputTokens', 'outputTokens', 'costUsd', 'toolCalls']);
  for (const key of Object.keys(record.budget)) requireNullableCount(record.budget[key], `record.budget.${key}`);
  requireExactKeys(record.candidate, 'record.candidate', ['artifactRef', 'artifactDigest', 'extractionStatus']);
  requireEnum(record.candidate.extractionStatus, 'record.candidate.extractionStatus', OUTCOME_ENUMS.extractionStatus);
  if (record.candidate.extractionStatus === 'EXTRACTED') {
    requireRelativeRef(record.candidate.artifactRef, 'record.candidate.artifactRef');
    requireDigest(record.candidate.artifactDigest, 'record.candidate.artifactDigest');
  } else if (record.candidate.artifactRef !== null || record.candidate.artifactDigest !== null) {
    fail('SCHEMA', `record.candidate has an artifact identity while ${record.candidate.extractionStatus}`);
  }
  requireExactKeys(record.evidence, 'record.evidence', ['substrateTrialRef', 'resultRef', 'trajectoryRef', 'verifierRefs', 'artifactManifestRef', 'manifestDigest']);
  requireString(record.evidence.substrateTrialRef, 'record.evidence.substrateTrialRef');
  requireRelativeRef(record.evidence.resultRef, 'record.evidence.resultRef');
  if (record.evidence.trajectoryRef !== null) requireRelativeRef(record.evidence.trajectoryRef, 'record.evidence.trajectoryRef');
  if (!Array.isArray(record.evidence.verifierRefs)) fail('SCHEMA', 'record.evidence.verifierRefs must be an array');
  record.evidence.verifierRefs.forEach((ref, index) => requireRelativeRef(ref, `record.evidence.verifierRefs[${index}]`));
  if (record.evidence.artifactManifestRef !== null) requireRelativeRef(record.evidence.artifactManifestRef, 'record.evidence.artifactManifestRef');
  requireDigest(record.evidence.manifestDigest, 'record.evidence.manifestDigest');
  assertAccounting(record.usage);
  requireExactKeys(record.timing, 'record.timing', ['startedAt', 'endedAt', 'elapsedMs', 'providerWaitMs', 'capabilityWaitMs']);
  requireTimestamp(record.timing.startedAt, 'record.timing.startedAt');
  requireTimestamp(record.timing.endedAt, 'record.timing.endedAt');
  requireNullableCount(record.timing.elapsedMs, 'record.timing.elapsedMs');
  requireNullableCount(record.timing.providerWaitMs, 'record.timing.providerWaitMs');
  requireNullableCount(record.timing.capabilityWaitMs, 'record.timing.capabilityWaitMs');
  requireExactKeys(record.quality, 'record.quality', ['verdict', 'evaluatorIdentity', 'evidenceRef']);
  requireEnum(record.quality.verdict, 'record.quality.verdict', OUTCOME_ENUMS.quality);
  requireString(record.quality.evaluatorIdentity, 'record.quality.evaluatorIdentity');
  requireNullableString(record.quality.evidenceRef, 'record.quality.evidenceRef');
  requireEnum(record.termination, 'record.termination', OUTCOME_ENUMS.termination);
  requireEnum(record.providerStatus, 'record.providerStatus', OUTCOME_ENUMS.providerStatus);
  requireEnum(record.infrastructureStatus, 'record.infrastructureStatus', OUTCOME_ENUMS.infrastructureStatus);
  if (['VERIFIER_ERROR', 'ARTIFACT_EXTRACTION'].includes(record.infrastructureStatus) && record.quality.verdict !== 'NOT_EVALUATED')
    fail('OUTCOME_CONFLICT', `${record.infrastructureStatus} cannot carry quality ${record.quality.verdict}`);
  requireNullableString(record.failureFingerprint, 'record.failureFingerprint');
}

export function assertAttemptRecord(record, { registration, unit } = {}) {
  validateRecordBody(record);
  requireDigest(record.recordDigest, 'record.recordDigest');
  verifySeal(record, 'recordDigest', 'TAMPERED');
  if (registration) {
    if (record.experimentId !== registration.experimentId) fail('IDENTITY', `record ${record.attemptId} belongs to another experiment`);
    if (record.protocolHash !== registration.protocol.hash) fail('FIXED_FACTOR_DRIFT', `record ${record.attemptId} protocol hash drifted`);
  }
  if (unit) assertRecordMatchesUnit(record, unit);
  return record;
}

function assertRecordMatchesUnit(record, unit) {
  if (record.unitId !== unit.unitId) fail('IDENTITY', `record ${record.attemptId} is not for unit ${unit.unitId}`);
  const drift = [];
  if (record.task.id !== unit.task.id) drift.push('task.id');
  if (record.task.bundleDigest !== unit.task.bundleDigest) drift.push('task.bundleDigest');
  if (record.task.environmentIdentity !== unit.environmentIdentity) drift.push('task.environmentIdentity');
  if (record.task.instructionDigest !== unit.instructionDigest) drift.push('task.instructionDigest');
  if (drift.length) fail('FIXED_FACTOR_DRIFT', `record ${record.attemptId} changed fixed factors: ${drift.join(', ')}`);
}

export class AttemptLedger {
  #registration;
  #units = new Map();
  #events = [];
  #attempts = new Map();

  constructor({ registration } = {}) {
    this.#registration = deepFreeze(clone(assertExperimentRegistration(registration)));
  }

  get registration() { return this.#registration; }

  registerUnit(unit) {
    if (this.#events.length) fail('IDENTITY_FROZEN', 'units cannot be registered after execution has started');
    assertBenchmarkUnit(unit, { registration: this.#registration });
    if (this.#units.has(unit.unitId)) fail('IDENTITY', `unit ${unit.unitId} is already registered`);
    this.#units.set(unit.unitId, deepFreeze(clone(unit)));
    return this.#units.get(unit.unitId);
  }

  unit(unitId) {
    const unit = this.#units.get(unitId);
    if (!unit) fail('UNREGISTERED_UNIT', `unit ${unitId} is not registered`);
    return unit;
  }

  units() { return [...this.#units.values()]; }

  #append(event) {
    const previous = this.#events.at(-1);
    const body = {
      kind: CONTRACT_KINDS.ATTEMPT_LEDGER_EVENT,
      sequence: this.#events.length,
      registrationDigest: this.#registration.registrationDigest,
      previousEventDigest: previous ? previous.eventDigest : null,
      ...event
    };
    const sealed = seal(body, 'eventDigest');
    this.#events.push(sealed);
    return sealed;
  }

  beginAttempt({ unitId, attemptId, retryOfAttemptId = null, startedAt }) {
    const unit = this.unit(unitId);
    requireId(attemptId, 'attemptId');
    requireTimestamp(startedAt, 'startedAt');
    if (this.#attempts.has(attemptId)) fail('DUPLICATE_ATTEMPT', `attempt ${attemptId} already exists; a retry needs a new attemptId`);
    if (retryOfAttemptId !== null) {
      const prior = this.#attempts.get(retryOfAttemptId);
      if (!prior) fail('INVALID_RETRY', `retryOfAttemptId ${retryOfAttemptId} is unknown`);
      if (prior.unitId !== unitId) fail('INVALID_RETRY', `retry ${attemptId} targets a different unit`);
      if (prior.status !== 'SETTLED') fail('INVALID_RETRY', `attempt ${retryOfAttemptId} must settle before it is retried`);
    }
    for (const unit of this.#units.values()) assertBenchmarkUnit(unit, { registration: this.#registration });
    const event = this.#append({ type: 'STARTED', experimentId: this.#registration.experimentId, unitId, attemptId, retryOfAttemptId,
      unitDigest: unit.unitDigest, fixedFactorDigest: unit.fixedFactorDigest, at: startedAt, recordDigest: null });
    this.#attempts.set(attemptId, { attemptId, unitId, retryOfAttemptId, status: 'STARTED', record: null });
    return event;
  }

  settleAttempt(recordInput, { settledAt } = {}) {
    requireTimestamp(settledAt, 'settledAt');
    const body = { kind: CONTRACT_KINDS.ATTEMPT_RECORD, ...clone(recordInput) };
    if ('recordDigest' in body) fail('IDENTITY', 'recordDigest is computed, not supplied');
    const attempt = this.#attempts.get(body.attemptId);
    if (!attempt) fail('UNSTARTED_ATTEMPT', `attempt ${body.attemptId} was never started`);
    if (attempt.status === 'SETTLED') fail('APPEND_ONLY', `attempt ${body.attemptId} is already settled and cannot be overwritten`);
    if (body.unitId !== attempt.unitId || body.retryOfAttemptId !== attempt.retryOfAttemptId) fail('IDENTITY', `record ${body.attemptId} does not match its STARTED event`);
    validateRecordBody(body);
    const record = seal(body, 'recordDigest');
    assertAttemptRecord(record, { registration: this.#registration, unit: this.unit(attempt.unitId) });
    const event = this.#append({ type: 'SETTLED', experimentId: this.#registration.experimentId, unitId: attempt.unitId, attemptId: attempt.attemptId,
      retryOfAttemptId: attempt.retryOfAttemptId, unitDigest: this.unit(attempt.unitId).unitDigest,
      fixedFactorDigest: this.unit(attempt.unitId).fixedFactorDigest, at: settledAt, recordDigest: record.recordDigest });
    this.#attempts.set(attempt.attemptId, { ...attempt, status: 'SETTLED', record });
    return { event, record };
  }

  events() { return [...this.#events]; }

  attempts() {
    return [...this.#attempts.values()].map(attempt => Object.freeze({ ...attempt }));
  }

  attempt(attemptId) {
    const attempt = this.#attempts.get(attemptId);
    return attempt ? Object.freeze({ ...attempt }) : null;
  }

  // Rebuild a ledger from materialized units, events and records; every event and record must replay exactly.
  static replay({ registration, units, events, records = [] }) {
    const ledger = new AttemptLedger({ registration });
    for (const unit of units) ledger.registerUnit(unit);
    const recordByDigest = new Map(records.map(record => [record.recordDigest, record]));
    for (const event of events) {
      requireExactKeys(event, 'event', ['kind', 'sequence', 'registrationDigest', 'previousEventDigest', 'type', 'experimentId', 'unitId', 'attemptId',
        'retryOfAttemptId', 'unitDigest', 'fixedFactorDigest', 'at', 'recordDigest', 'eventDigest']);
      verifySeal(event, 'eventDigest', 'TAMPERED');
      requireEnum(event.type, 'event.type', OUTCOME_ENUMS.ledgerEvent);
      let replayed;
      if (event.type === 'STARTED') {
        replayed = ledger.beginAttempt({ unitId: event.unitId, attemptId: event.attemptId, retryOfAttemptId: event.retryOfAttemptId, startedAt: event.at });
      } else {
        const record = recordByDigest.get(event.recordDigest);
        if (!record) fail('MISSING_EVIDENCE', `record ${event.recordDigest} for attempt ${event.attemptId} is missing`);
        verifySeal(record, 'recordDigest', 'TAMPERED');
        replayed = ledger.settleAttempt(withoutKey(withoutKey(record, 'recordDigest'), 'kind'), { settledAt: event.at }).event;
      }
      if (replayed.eventDigest !== event.eventDigest) fail('TAMPERED', `ledger event ${event.sequence} does not replay (${replayed.eventDigest} != ${event.eventDigest})`);
    }
    return ledger;
  }
}

export function ledgerDigest(ledger) {
  return digestOf(ledger.events().map(event => event.eventDigest));
}
