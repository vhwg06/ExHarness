import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAccounting } from '@exharness/benchmark';
import { usageObservation } from './fixtures.js';

const ALL = { inputTokens: 120, outputTokens: 30, cachedTokens: 0, cacheWriteTokens: 0, providerCostUsd: 0.001, normalizedCostUsd: 0.001 };

test('fully reported usage is KNOWN, including reported zeros', () => {
  const accounting = normalizeAccounting(usageObservation(ALL));
  assert.equal(accounting.kind, 'ACCOUNTING_V1');
  assert.equal(accounting.status, 'KNOWN');
  assert.equal(accounting.cachedTokens, 0);
  assert.match(accounting.accountingDigest, /^sha256:/);
});

test('partially reported usage is PARTIAL and keeps the unreported fields null', () => {
  const accounting = normalizeAccounting(usageObservation({ inputTokens: 120, outputTokens: 30 }));
  assert.equal(accounting.status, 'PARTIAL');
  assert.deepEqual(accounting.observedFields, ['inputTokens', 'outputTokens']);
  for (const field of ['cachedTokens', 'cacheWriteTokens', 'providerCostUsd', 'normalizedCostUsd']) assert.equal(accounting[field], null, field);
});

test('absent usage is UNKNOWN with every numeric field null', () => {
  const accounting = normalizeAccounting(usageObservation({}));
  assert.equal(accounting.status, 'UNKNOWN');
  for (const field of Object.keys(ALL)) assert.equal(accounting[field], null, field);
});

test('a zero written for an unreported field is rejected as zero-fill', () => {
  assert.throws(() => normalizeAccounting(usageObservation({ inputTokens: 0, outputTokens: 0 }, [])), /ZERO_FILL/);
  assert.throws(() => normalizeAccounting(usageObservation({ inputTokens: 5, cachedTokens: 0 }, ['inputTokens'])), /ZERO_FILL: accounting.cachedTokens/);
  assert.throws(() => normalizeAccounting(usageObservation({ inputTokens: null }, ['inputTokens'])), /reported but null/);
  assert.throws(() => normalizeAccounting(usageObservation({ inputTokens: -1 })), /non-negative/);
});

test('accounting is deterministic and frozen', () => {
  const a = normalizeAccounting(usageObservation({ inputTokens: 1 }));
  const b = normalizeAccounting(usageObservation({ inputTokens: 1 }));
  assert.equal(a.accountingDigest, b.accountingDigest);
  assert.throws(() => { a.inputTokens = 0; });
});
