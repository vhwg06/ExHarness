import test from 'node:test';
import assert from 'node:assert/strict';
import { AttemptLedger, assertAttemptRecord, createBenchmarkUnit } from '@exharness/benchmark';
import { setup, materializeAttempt, outcomeInput, unitInput, sha, T0, T1 } from './fixtures.js';

function ledgerWithUnits() {
  const { registration, units } = setup();
  const ledger = new AttemptLedger({ registration });
  units.forEach(unit => ledger.registerUnit(unit));
  return { registration, units, ledger };
}

test('STARTED is appended before execution and SETTLED seals the record; events are hash-chained', () => {
  const { units, ledger } = ledgerWithUnits();
  const started = ledger.beginAttempt({ unitId: 'UNIT-A', attemptId: 'A-1', startedAt: T0 });
  assert.equal(started.type, 'STARTED');
  assert.equal(started.previousEventDigest, null);
  const { record } = materializeAttempt({ unit: units[0], attemptId: 'A-1' });
  const { event, record: sealed } = ledger.settleAttempt(record, { settledAt: T1 });
  assert.equal(event.type, 'SETTLED');
  assert.equal(event.previousEventDigest, started.eventDigest);
  assert.equal(event.recordDigest, sealed.recordDigest);
  assert.equal(sealed.kind, 'BENCHMARK_ATTEMPT_RECORD_V1');
  assert.equal(assertAttemptRecord(sealed), sealed);
  assert.deepEqual(ledger.events().map(e => `${e.sequence}:${e.type}`), ['0:STARTED', '1:SETTLED']);
});

test('a retry is a new attempt linked by retryOfAttemptId and the failed attempt stays auditable', () => {
  const { units, ledger } = ledgerWithUnits();
  ledger.beginAttempt({ unitId: 'UNIT-A', attemptId: 'A-1', startedAt: T0 });
  const failed = materializeAttempt({ unit: units[0], attemptId: 'A-1', outcome: outcomeInput({ producerStatus: 'ERROR', termination: 'AGENT_ERROR', providerStatus: 'PROVIDER_TIMEOUT',
    candidate: { extractionStatus: 'NOT_PRODUCED', evaluable: false }, evaluator: { verdict: 'NOT_RUN', identity: 'fixture-verifier@1', evidenceRef: null } }) });
  const first = ledger.settleAttempt(failed.record, { settledAt: T1 }).record;
  assert.throws(() => ledger.beginAttempt({ unitId: 'UNIT-A', attemptId: 'A-1', startedAt: T1 }), /DUPLICATE_ATTEMPT/);
  ledger.beginAttempt({ unitId: 'UNIT-A', attemptId: 'A-2', retryOfAttemptId: 'A-1', startedAt: T1 });
  const retry = materializeAttempt({ unit: units[0], attemptId: 'A-2', retryOfAttemptId: 'A-1' });
  ledger.settleAttempt(retry.record, { settledAt: T1 });
  const attempts = ledger.attempts();
  assert.deepEqual(attempts.map(a => [a.attemptId, a.retryOfAttemptId, a.status, a.record.quality.verdict]), [['A-1', null, 'SETTLED', 'NOT_EVALUATED'], ['A-2', 'A-1', 'SETTLED', 'ACCEPTED']]);
  assert.equal(ledger.attempt('A-1').record.recordDigest, first.recordDigest);
  assert.equal(ledger.events().length, 4);
});

test('settled attempts cannot be overwritten and there is no delete or mutation API', () => {
  const { units, ledger } = ledgerWithUnits();
  ledger.beginAttempt({ unitId: 'UNIT-A', attemptId: 'A-1', startedAt: T0 });
  const { record } = materializeAttempt({ unit: units[0], attemptId: 'A-1' });
  ledger.settleAttempt(record, { settledAt: T1 });
  assert.throws(() => ledger.settleAttempt(record, { settledAt: T1 }), /APPEND_ONLY/);
  assert.throws(() => ledger.settleAttempt({ ...record, attemptId: 'NEVER' }, { settledAt: T1 }), /UNSTARTED_ATTEMPT/);
  const events = ledger.events();
  events.pop();
  assert.equal(ledger.events().length, 2);
  assert.throws(() => { ledger.events()[0].type = 'SETTLED'; });
  for (const name of ['deleteAttempt', 'removeAttempt', 'replaceAttempt', 'overwrite', 'reset']) assert.equal(typeof ledger[name], 'undefined');
});

test('invalid retries are rejected', () => {
  const { ledger } = ledgerWithUnits();
  assert.throws(() => ledger.beginAttempt({ unitId: 'UNIT-A', attemptId: 'A-2', retryOfAttemptId: 'A-1', startedAt: T0 }), /INVALID_RETRY/);
  ledger.beginAttempt({ unitId: 'UNIT-A', attemptId: 'A-1', startedAt: T0 });
  assert.throws(() => ledger.beginAttempt({ unitId: 'UNIT-A', attemptId: 'A-2', retryOfAttemptId: 'A-1', startedAt: T0 }), /must settle/);
  assert.throws(() => ledger.beginAttempt({ unitId: 'UNIT-B', attemptId: 'B-2', retryOfAttemptId: 'A-1', startedAt: T0 }), /INVALID_RETRY/);
});

test('experiment, unit and fixed-factor identity cannot change after the first STARTED attempt', () => {
  const { registration, units, ledger } = ledgerWithUnits();
  assert.throws(() => ledger.registerUnit(units[0]), /already registered/);
  ledger.beginAttempt({ unitId: 'UNIT-A', attemptId: 'A-1', startedAt: T0 });
  assert.throws(() => ledger.registerUnit(createBenchmarkUnit(unitInput('UNIT-B', { arm: 'LATE' }), { registration })), /IDENTITY_FROZEN/);
  assert.throws(() => { ledger.registration.evaluatorIdentity = 'swapped'; });
  assert.throws(() => { ledger.unit('UNIT-A').task.bundleDigest = sha('swapped'); });
  const { record } = materializeAttempt({ unit: units[0], attemptId: 'A-1' });
  assert.throws(() => ledger.settleAttempt({ ...record, task: { ...record.task, bundleDigest: sha('drifted-bundle') } }, { settledAt: T1 }), /FIXED_FACTOR_DRIFT/);
  assert.throws(() => ledger.settleAttempt({ ...record, protocolHash: sha('other-protocol') }, { settledAt: T1 }), /FIXED_FACTOR_DRIFT/);
  assert.throws(() => ledger.beginAttempt({ unitId: 'UNIT-Z', attemptId: 'Z-1', startedAt: T0 }), /UNREGISTERED_UNIT/);
});

test('a fresh ledger replays materialized events exactly and rejects tampered events or records', () => {
  const { registration, units, ledger } = ledgerWithUnits();
  ledger.beginAttempt({ unitId: 'UNIT-A', attemptId: 'A-1', startedAt: T0 });
  const { record } = materializeAttempt({ unit: units[0], attemptId: 'A-1' });
  const sealed = ledger.settleAttempt(record, { settledAt: T1 }).record;
  ledger.beginAttempt({ unitId: 'UNIT-B', attemptId: 'B-1', startedAt: T1 });
  const events = JSON.parse(JSON.stringify(ledger.events()));
  const records = [JSON.parse(JSON.stringify(sealed))];
  const replayed = AttemptLedger.replay({ registration, units, events, records });
  assert.deepEqual(replayed.events().map(e => e.eventDigest), ledger.events().map(e => e.eventDigest));
  assert.equal(replayed.attempt('B-1').status, 'STARTED');
  const tamperedEvents = JSON.parse(JSON.stringify(events));
  tamperedEvents[0].at = T1;
  assert.throws(() => AttemptLedger.replay({ registration, units, events: tamperedEvents, records }), /TAMPERED/);
  const tamperedRecord = [{ ...records[0], quality: { ...records[0].quality, verdict: 'REJECTED' } }];
  assert.throws(() => AttemptLedger.replay({ registration, units, events, records: tamperedRecord }), /TAMPERED|MISSING_EVIDENCE/);
  assert.throws(() => AttemptLedger.replay({ registration, units, events: events.slice(1), records }), /UNSTARTED_ATTEMPT/);
});
