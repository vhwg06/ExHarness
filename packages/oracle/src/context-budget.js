import { createHash } from 'node:crypto';

// Model-aware context budget profiles: an additive derivation layer over the
// delivered ContextRequirement budget contract. This module never imports
// Core and never resolves context; it only validates a profile, derives the
// exact requirement/next-step budgets from it, and reports token counts only
// under a declared exact tokenizer identity.

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
function fail(message) { throw new TypeError(message); }
function record(value, fields, label, required = fields) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) fail(`${label} must be a plain object`);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !fields.includes(key)) fail(`${label} has unknown field ${String(key)}`);
  }
  for (const key of required) if (!own(value, key)) fail(`${label}.${key} is required`);
  return value;
}
function text(value, label) { if (typeof value !== 'string' || !value.trim()) fail(`${label} must be nonempty text`); return value; }
function positiveInt(value, label) { if (!Number.isSafeInteger(value) || value < 1) fail(`${label} must be positive integer`); return value; }
function nonNegativeInt(value, label) { if (!Number.isSafeInteger(value) || value < 0) fail(`${label} must be nonnegative integer`); return value; }
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
function hash(value) { return createHash('sha256').update(canonical(value)).digest('hex'); }
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }

const PROFILE_FIELDS = ['kind', 'version', 'profileId', 'modelProfileRef', 'renderedCharCeiling', 'reservedChars', 'blockEnvelopeChars', 'maxItems', 'maxProviderCalls', 'maxResolutionSteps', 'tokenizer'];
const TOKENIZER_FIELDS = ['id', 'version'];

function tokenizerBody(raw) {
  if (raw === null) return null;
  const t = record(raw, TOKENIZER_FIELDS, 'profile.tokenizer');
  return { id: text(t.id, 'tokenizer.id'), version: text(t.version, 'tokenizer.version') };
}

function profileBody(raw) {
  const r = record(raw, PROFILE_FIELDS, 'ContextBudgetProfile', PROFILE_FIELDS.filter((k) => k !== 'profileId'));
  if (own(r, 'kind') && r.kind !== 'CONTEXT_BUDGET_PROFILE') fail('ContextBudgetProfile.kind is invalid');
  if (own(r, 'version') && r.version !== 1) fail('ContextBudgetProfile.version is invalid');
  const tokenizer = tokenizerBody(r.tokenizer);
  return {
    kind: 'CONTEXT_BUDGET_PROFILE',
    version: 1,
    modelProfileRef: text(r.modelProfileRef, 'profile.modelProfileRef'),
    renderedCharCeiling: positiveInt(r.renderedCharCeiling, 'profile.renderedCharCeiling'),
    reservedChars: positiveInt(r.reservedChars, 'profile.reservedChars'),
    blockEnvelopeChars: positiveInt(r.blockEnvelopeChars, 'profile.blockEnvelopeChars'),
    maxItems: positiveInt(r.maxItems, 'profile.maxItems'),
    maxProviderCalls: positiveInt(r.maxProviderCalls, 'profile.maxProviderCalls'),
    maxResolutionSteps: positiveInt(r.maxResolutionSteps, 'profile.maxResolutionSteps'),
    tokenizer,
  };
}

export function defineContextBudgetProfile(raw) {
  const body = profileBody(raw);
  const profileId = hash(body);
  if (own(raw, 'profileId') && raw.profileId !== profileId) fail('profileId mismatch');
  return freeze({ ...body, profileId });
}

function materializedBytesFor(body) {
  const maxMaterializedBytes = body.renderedCharCeiling - body.reservedChars - body.blockEnvelopeChars;
  if (!Number.isSafeInteger(maxMaterializedBytes) || maxMaterializedBytes < 1) fail('derived maxMaterializedBytes must be positive integer');
  return maxMaterializedBytes;
}

export function deriveRequirementBudget(profile) {
  const body = profileBody(profile);
  if (own(profile, 'profileId') && profile.profileId !== hash(body)) fail('profileId mismatch');
  return freeze({
    maxItems: body.maxItems,
    maxMaterializedBytes: materializedBytesFor(body),
    maxProviderCalls: body.maxProviderCalls,
    maxResolutionSteps: body.maxResolutionSteps,
  });
}

const CONSUMED_FIELDS = ['items', 'materializedBytes', 'providerCalls', 'resolutionSteps'];
function consumedOf(resolution) {
  if (!resolution || typeof resolution !== 'object') fail('previousResolution must be a plain object');
  const c = record(resolution.consumed, CONSUMED_FIELDS, 'previousResolution.consumed');
  return {
    items: nonNegativeInt(c.items, 'consumed.items'),
    materializedBytes: nonNegativeInt(c.materializedBytes, 'consumed.materializedBytes'),
    providerCalls: nonNegativeInt(c.providerCalls, 'consumed.providerCalls'),
    resolutionSteps: nonNegativeInt(c.resolutionSteps, 'consumed.resolutionSteps'),
  };
}

export function deriveNextStepBudget(profile, previousResolution) {
  const body = profileBody(profile);
  if (own(profile, 'profileId') && profile.profileId !== hash(body)) fail('profileId mismatch');
  const derived = deriveRequirementBudget(body);
  const consumed = consumedOf(previousResolution);
  const remaining = {
    maxItems: derived.maxItems - consumed.items,
    maxMaterializedBytes: derived.maxMaterializedBytes - consumed.materializedBytes,
    maxProviderCalls: derived.maxProviderCalls - consumed.providerCalls,
    maxResolutionSteps: derived.maxResolutionSteps - consumed.resolutionSteps,
  };
  for (const [key, value] of Object.entries(remaining)) {
    if (!Number.isSafeInteger(value) || value < 1) fail(`next-step budget exhausted: ${key}`);
  }
  return freeze(remaining);
}

export const TOKEN_UNKNOWN = 'UNKNOWN';
export const TOKEN_MEASURED = 'MEASURED';

export function measureTokens(profile, textContent, tokenizerImpl = null) {
  const body = profileBody(profile);
  if (typeof textContent !== 'string') fail('measureTokens text must be a string');
  const declared = body.tokenizer;
  if (declared === null) return freeze({ tokens: null, status: TOKEN_UNKNOWN });
  if (!tokenizerImpl || typeof tokenizerImpl !== 'object') return freeze({ tokens: null, status: TOKEN_UNKNOWN });
  if (tokenizerImpl.id !== declared.id || tokenizerImpl.version !== declared.version) return freeze({ tokens: null, status: TOKEN_UNKNOWN });
  if (typeof tokenizerImpl.countTokens !== 'function') return freeze({ tokens: null, status: TOKEN_UNKNOWN });
  const counted = tokenizerImpl.countTokens(textContent);
  if (!Number.isSafeInteger(counted) || counted < 0) fail('tokenizer countTokens must report a nonnegative integer');
  return freeze({ tokens: counted, status: TOKEN_MEASURED });
}
