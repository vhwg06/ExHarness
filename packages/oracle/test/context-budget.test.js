import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { defineContextBudgetProfile, deriveRequirementBudget, deriveNextStepBudget, measureTokens } from '../src/context-budget.js';

const base = () => ({
  kind: 'CONTEXT_BUDGET_PROFILE',
  version: 1,
  modelProfileRef: 'test-model-v1',
  renderedCharCeiling: 8192,
  reservedChars: 512,
  blockEnvelopeChars: 512,
  maxItems: 4,
  maxProviderCalls: 4,
  maxResolutionSteps: 3,
  tokenizer: null,
});

test('budget profile validates and carries a deterministic profileId', () => {
  const first = defineContextBudgetProfile(base());
  assert.equal(first.kind, 'CONTEXT_BUDGET_PROFILE');
  assert.equal(first.version, 1);
  assert.equal(first.modelProfileRef, 'test-model-v1');
  assert.match(first.profileId, /^[a-f0-9]{64}$/);
  assert.ok(Object.isFrozen(first));
  const second = defineContextBudgetProfile(base());
  assert.equal(second.profileId, first.profileId);
  assert.equal(second.profileId, defineContextBudgetProfile(structuredClone({ ...base(), tokenizer: null })).profileId);
  const other = defineContextBudgetProfile({ ...base(), modelProfileRef: 'other-model-v1' });
  assert.notEqual(other.profileId, first.profileId);
  assert.throws(() => defineContextBudgetProfile({ ...base(), profileId: 'deadbeef' }), /profileId mismatch/);
  assert.throws(() => defineContextBudgetProfile({ ...base(), kind: 'WRONG' }), /kind is invalid/);
  assert.throws(() => defineContextBudgetProfile({ ...base(), version: 2 }), /version is invalid/);
  assert.throws(() => defineContextBudgetProfile({ ...base(), modelProfileRef: '  ' }), /modelProfileRef/);
  assert.throws(() => defineContextBudgetProfile({ ...base(), extra: 1 }), /unknown field/);
  assert.throws(() => defineContextBudgetProfile({ ...base(), tokenizer: { id: 't' } }), /tokenizer\.version is required/);
});

test('budget profile rejects non-positive counters', () => {
  for (const field of ['renderedCharCeiling', 'reservedChars', 'blockEnvelopeChars', 'maxItems', 'maxProviderCalls', 'maxResolutionSteps']) {
    assert.throws(() => defineContextBudgetProfile({ ...base(), [field]: 0 }), /must be positive integer/, field);
    assert.throws(() => defineContextBudgetProfile({ ...base(), [field]: -3 }), /must be positive integer/, field);
    assert.throws(() => defineContextBudgetProfile({ ...base(), [field]: 1.5 }), /must be positive integer/, field);
  }
});

test('budget derivation rejects a maxMaterializedBytes at or below zero', () => {
  const tight = defineContextBudgetProfile({ ...base(), renderedCharCeiling: 1000, reservedChars: 600, blockEnvelopeChars: 500 });
  assert.throws(() => deriveRequirementBudget(tight), /maxMaterializedBytes/);
  const exact = defineContextBudgetProfile({ ...base(), renderedCharCeiling: 1000, reservedChars: 600, blockEnvelopeChars: 400 });
  assert.throws(() => deriveRequirementBudget(exact), /maxMaterializedBytes/);
  const ok = defineContextBudgetProfile({ ...base(), renderedCharCeiling: 1000, reservedChars: 600, blockEnvelopeChars: 399 });
  assert.equal(deriveRequirementBudget(ok).maxMaterializedBytes, 1);
});

test('deriveRequirementBudget derives the exact requirement budget', () => {
  const profile = defineContextBudgetProfile(base());
  const derived = deriveRequirementBudget(profile);
  assert.deepEqual(derived, { maxItems: 4, maxMaterializedBytes: 8192 - 512 - 512, maxProviderCalls: 4, maxResolutionSteps: 3 });
  assert.equal(derived.maxMaterializedBytes, 7168);
  assert.ok(Object.isFrozen(derived));
  assert.throws(() => deriveRequirementBudget({ ...base(), maxItems: 0 }), /must be positive integer/);
});

test('deriveNextStepBudget returns the remaining per-counter budget', () => {
  const profile = defineContextBudgetProfile(base());
  const remaining = deriveNextStepBudget(profile, { consumed: { items: 1, materializedBytes: 500, providerCalls: 1, resolutionSteps: 1 } });
  assert.deepEqual(remaining, { maxItems: 3, maxMaterializedBytes: 6668, maxProviderCalls: 3, maxResolutionSteps: 2 });
  assert.ok(Object.isFrozen(remaining));
});

test('deriveNextStepBudget rejects any exhausted counter', () => {
  const profile = defineContextBudgetProfile(base());
  const consumed = { items: 1, materializedBytes: 500, providerCalls: 1, resolutionSteps: 1 };
  assert.throws(() => deriveNextStepBudget(profile, { consumed: { ...consumed, items: 4 } }), /exhausted/);
  assert.throws(() => deriveNextStepBudget(profile, { consumed: { ...consumed, materializedBytes: 7168 } }), /exhausted/);
  assert.throws(() => deriveNextStepBudget(profile, { consumed: { ...consumed, providerCalls: 4 } }), /exhausted/);
  assert.throws(() => deriveNextStepBudget(profile, { consumed: { ...consumed, resolutionSteps: 3 } }), /exhausted/);
  assert.throws(() => deriveNextStepBudget(profile, { consumed: { ...consumed, items: 99 } }), /exhausted/);
  assert.throws(() => deriveNextStepBudget(profile, { consumed: { items: 0, materializedBytes: 0 } }), /consumed/);
});

test('measureTokens reports UNKNOWN without a declared tokenizer', () => {
  const profile = defineContextBudgetProfile(base());
  assert.equal(profile.tokenizer, null);
  const result = measureTokens(profile, 'hello world, this is long text', { id: 'tok', version: '1', countTokens: (t) => t.length });
  assert.deepEqual(result, { tokens: null, status: 'UNKNOWN' });
  assert.equal(result.tokens, null);
});

test('measureTokens reports UNKNOWN on tokenizer identity mismatch', () => {
  const profile = defineContextBudgetProfile({ ...base(), tokenizer: { id: 'tok-a', version: '3' } });
  const text = 'x'.repeat(200);
  assert.deepEqual(measureTokens(profile, text, null), { tokens: null, status: 'UNKNOWN' });
  assert.deepEqual(measureTokens(profile, text, { id: 'tok-b', version: '3', countTokens: (t) => t.length }), { tokens: null, status: 'UNKNOWN' });
  assert.deepEqual(measureTokens(profile, text, { id: 'tok-a', version: '4', countTokens: (t) => t.length }), { tokens: null, status: 'UNKNOWN' });
  assert.deepEqual(measureTokens(profile, text, { id: 'tok-a', version: '3' }), { tokens: null, status: 'UNKNOWN' });
  for (const result of [
    measureTokens(profile, text, { id: 'tok-b', version: '3', countTokens: () => 1 }),
    measureTokens(profile, text, { id: 'tok-a', version: '9', countTokens: () => 1 }),
  ]) {
    assert.equal(result.tokens, null);
    assert.notEqual(typeof result.tokens, 'number');
  }
});

test('measureTokens reports the injected count under an exact tokenizer identity', () => {
  const profile = defineContextBudgetProfile({ ...base(), tokenizer: { id: 'tok-a', version: '3' } });
  const text = 'x'.repeat(200);
  const result = measureTokens(profile, text, { id: 'tok-a', version: '3', countTokens: (t) => Math.ceil(t.length / 4) });
  assert.equal(result.tokens, 50);
  assert.equal(result.status, 'MEASURED');
  assert.notEqual(result.tokens, Buffer.byteLength(text, 'utf8'));
  assert.throws(() => measureTokens(profile, 42, { id: 'tok-a', version: '3', countTokens: () => 1 }), /must be a string/);
});

test('oracle budget source imports no Core module', () => {
  const dir = new URL('../src/', import.meta.url);
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.js')) continue;
    const source = fs.readFileSync(new URL(name, dir), 'utf8');
    assert.doesNotMatch(source, /core-harness/, `${name} must not import Core`);
    assert.doesNotMatch(source, /from\s*["'][^"']*agentic-system/, `${name} must not import application authority`);
  }
  const budget = fs.readFileSync(new URL('../src/context-budget.js', import.meta.url), 'utf8');
  assert.match(budget, /defineContextBudgetProfile/);
  assert.match(budget, /deriveRequirementBudget/);
  assert.match(budget, /deriveNextStepBudget/);
  assert.match(budget, /measureTokens/);
});
