import { createHash } from 'node:crypto';
import { readFile, lstat } from 'node:fs/promises';
import { resolve, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MINI_COMMIT = '04d809ceab9df28f9adaed044884180159172930';
export const NODE_VERSION = '24.19.0';
export const PLAYWRIGHT_VERSION = '1.63.0';
export const CALIBRATION_TASK_IDS = Object.freeze(['NORM-01', 'STATUS-01', 'ORDER-01']);
export const PROTOCOL = Object.freeze({
  schemaVersion: 1,
  id: 'delivery-value-baseline-v1',
  seed: 65074,
  pairs: 20,
  pairsPerContext: 10,
  heldoutPairs: ['P07', 'P08', 'P09', 'P10', 'P17', 'P18', 'P19', 'P20'],
  budgets: {
    maxWallSeconds: 1200,
    maxModelCalls: 100,
    maxTotalTokens: 100000,
    maxApiUsd: 5,
    maxToolCommandSeconds: 30,
    maxOutputTokensPerCall: 4096,
    maxInputTokensPerCall: 16384,
    maxAttemptsPerTask: 2
  },
  qualityWindowDays: 7,
  gates: { maxMedianPairedHumanRatio: 0.8, minAcceptedRateRelativeToDirect: 1, maxCostPerAcceptedRelativeToDirect: 1.1, maxCriticalEscaped: 0, maxExcessMajorEscaped: 0 }
});

export function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stable(child)]));
  return value;
}
export const canonical = value => JSON.stringify(stable(value));
export const sha256 = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : canonical(value)).digest('hex');
export const PROTOCOL_HASH = sha256(PROTOCOL);
const fail = message => { throw new Error(`BASELINE_CONTRACT_INVALID: ${message}`); };
const exactSha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const exactDigest = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const positive = value => Number.isFinite(value) && value > 0;
const nonnegative = value => Number.isFinite(value) && value >= 0;
const aliases = /(?:^|[\/-])(latest|auto|current|default)(?:$|[\/-])/i;

export async function directoryDigest(directory, names) {
  const root = resolve(directory);
  const rows = [];
  for (const name of [...names].sort()) {
    if (name.includes('..') || name.startsWith('/') || name.includes('\\')) fail('invalid digest path');
    const path = resolve(root, name);
    if (relative(root, path).startsWith('..') || relative(root, path).split(sep).includes('..')) fail('digest path escapes root');
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) fail(`digest source is not a plain file: ${name}`);
    rows.push({ name, hash: sha256(await readFile(path)) });
  }
  return `sha256:${sha256(rows)}`;
}

function shuffle(items, seed) {
  const output = [...items];
  let state = seed >>> 0;
  for (let index = output.length - 1; index > 0; index--) {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    const swap = (state >>> 0) % (index + 1);
    [output[index], output[swap]] = [output[swap], output[index]];
  }
  return output;
}
export function selectPilotPairs(contexts) {
  if (!Array.isArray(contexts) || contexts.length !== 2) fail('exactly two repository contexts required');
  const sorted = [...contexts].sort((a, b) => String(a.repositoryId).localeCompare(String(b.repositoryId)));
  if (new Set(sorted.map(item => item.repositoryId)).size !== 2) fail('duplicate repository context');
  const selected = [];
  for (const context of sorted) {
    if (!nonempty(context.repositoryId) || !exactSha(context.baseSha) || !exactSha(context.baseTree) || !nonempty(context.ownerDecisionRef))
      fail('context requires repository id, exact base and product-owner decision');
    const tasks = context.eligibleTasks;
    if (!Array.isArray(tasks) || tasks.length < 10) fail('at least ten eligible tasks per context required');
    if (tasks.some(task => !nonempty(task.id) || !nonempty(task.promptRef) || !exactDigest(task.acceptanceDigest))) fail('eligible task missing frozen identity');
    if (new Set(tasks.map(task => task.id)).size !== tasks.length) fail('duplicate eligible task');
    const ordered = [...tasks].sort((a, b) => a.id.localeCompare(b.id));
    selected.push(...shuffle(ordered, PROTOCOL.seed).slice(0, 10).map(task => ({ repositoryId: context.repositoryId, baseSha: context.baseSha, baseTree: context.baseTree, taskId: task.id, promptRef: task.promptRef, acceptanceDigest: task.acceptanceDigest })));
  }
  return selected.map((task, index) => {
    const pairNumber = index + 1;
    const pairId = `P${String(pairNumber).padStart(2, '0')}`;
    return { pairId, partition: PROTOCOL.heldoutPairs.includes(pairId) ? 'HELDOUT' : 'DEVELOPMENT', order: pairNumber % 2 ? ['DIRECT', 'EXHARNESS'] : ['EXHARNESS', 'DIRECT'], ...task };
  });
}

export function validateProfile(profile, { fixtureDigest, acceptanceDigest, requireLive = false, requirePilot = true } = {}) {
  if (profile?.schemaVersion !== 1 || !nonempty(profile.experimentId) || !nonempty(profile.operatorId) || !nonempty(profile.reviewerId)) fail('experiment/operator/reviewer identity required');
  if (profile.operatorId === profile.reviewerId) fail('independent reviewer identity required');
  if (profile.protocolHash !== PROTOCOL_HASH) fail('protocol hash changed');
  if (!exactSha(profile.candidateSha) || !exactSha(profile.candidateTree)) fail('exact candidate SHA/tree required');
  if (!exactDigest(profile.fixtureDigest) || profile.fixtureDigest !== fixtureDigest) fail('fixture digest mismatch');
  if (!exactDigest(profile.acceptanceDigest) || profile.acceptanceDigest !== acceptanceDigest) fail('acceptance digest mismatch');
  if (profile.nodeVersion !== NODE_VERSION || profile.playwrightVersion !== PLAYWRIGHT_VERSION || profile.miniCommit !== MINI_COMMIT) fail('tool versions must be pinned');
  if (!nonempty(profile.pythonExecutable) || !/^3\.12\.\d+$/.test(profile.pythonVersion ?? '')) fail('pinned Python 3.12 executable/version required');
  if (![profile.nodeImageDigest, profile.browserDigest, profile.pythonLockDigest, profile.agentImageDigest].every(exactDigest)) fail('runtime/image/lock digests required');
  if (!nonempty(profile.agentImage) || !profile.agentImage.endsWith(`@${profile.agentImageDigest}`)) fail('agent image is not pinned to declared digest');
  const model = profile.model;
  if (!model || !nonempty(model.snapshot) || aliases.test(model.snapshot) || model.reasoningEffort !== 'none' ||
      model.tokenizer !== `litellm:${model.snapshot}` ||
      !positive(model.maxContextTokens) || !/^https:\/\/[^/]+$/.test(model.endpointOrigin ?? '') ||
      !nonempty(model.apiBaseUrl) || !model.apiBaseUrl.startsWith(`${model.endpointOrigin}/`) ||
      !['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY'].includes(model.credentialEnv) || !/^\d{4}-\d{2}-\d{2}$/.test(model.pricingDate ?? '') ||
      !nonempty(model.pricingSource) || !nonnegative(model.inputUsdPerMillion) || !nonnegative(model.cachedInputUsdPerMillion) ||
      model.cachedInputUsdPerMillion > model.inputUsdPerMillion || !nonnegative(model.outputUsdPerMillion)) fail('model snapshot, endpoint, pricing and credential reference required');
  if (model.credentialEnv === 'OPENROUTER_API_KEY' &&
      (model.endpointOrigin !== 'https://openrouter.ai' || model.apiBaseUrl !== 'https://openrouter.ai/api/v1' ||
       model.snapshot !== `openrouter/${model.providerModelId}` || !/^nvidia\/nemotron-3-ultra-550b-a55b-20260604:free$/.test(model.resolvedModelId ?? '') ||
       model.releaseDate !== '2026-06-04' || model.maxContextTokens !== 1000000 ||
       model.inputUsdPerMillion !== 0 || model.cachedInputUsdPerMillion !== 0 || model.outputUsdPerMillion !== 0))
    fail('OpenRouter free model identity or price changed');
  if (Object.keys(model).some(key => /(?:apiKey|secret|password|credentialValue)/i.test(key))) fail('secrets must not be in profile');
  if (model.maxContextTokens < PROTOCOL.budgets.maxInputTokensPerCall + PROTOCOL.budgets.maxOutputTokensPerCall) fail('model context below reservation bound');
  if (profile.budgets && canonical(profile.budgets) !== canonical(PROTOCOL.budgets)) fail('budgets changed');
  if (!requirePilot && (!Array.isArray(profile.contexts) || profile.contexts.length !== 0)) fail('calibration cannot claim a selected pilot cohort');
  const pairs = requirePilot ? selectPilotPairs(profile.contexts) : [];
  if (canonical(profile.calibrationTaskIds) !== canonical(CALIBRATION_TASK_IDS)) fail('calibration task set changed');
  const armHash = sha256({ model, nodeVersion: profile.nodeVersion, miniCommit: profile.miniCommit, agentImageDigest: profile.agentImageDigest, budgets: PROTOCOL.budgets });
  if (profile.armProfileHashes?.DIRECT !== armHash || profile.armProfileHashes?.EXHARNESS !== armHash) fail('matched arm profile mismatch');
  if (requireLive && !process.env[model.credentialEnv]) fail(`missing credential environment variable ${model.credentialEnv}`);
  return { pairs, armHash, profileHash: sha256(profile) };
}

export function registrationManifest(profile, identities, { calibration = false } = {}) {
  const { pairs, armHash, profileHash } = validateProfile(profile, { ...identities, requirePilot: !calibration });
  const manifest = {
    schemaVersion: 1, experimentId: profile.experimentId, registrationKind: calibration ? 'CALIBRATION' : 'PILOT', protocolHash: PROTOCOL_HASH,
    profileHash, armHash, candidateSha: profile.candidateSha, candidateTree: profile.candidateTree,
    fixtureDigest: profile.fixtureDigest, acceptanceDigest: profile.acceptanceDigest,
    operatorId: profile.operatorId, reviewerId: profile.reviewerId,
    calibrationTaskIds: [...CALIBRATION_TASK_IDS], pairs, budgets: PROTOCOL.budgets,
    evidenceClass: 'LIVE_REGISTRATION'
  };
  return { ...manifest, digest: `sha256:${sha256(manifest)}` };
}

export async function fixtureIdentities() {
  const root = fileURLToPath(new URL('./fixture/', import.meta.url));
  const fixtureDigest = await directoryDigest(root, ['server.mjs', 'index.html', 'client.js', 'tasks.json']);
  const acceptanceDigest = await directoryDigest(root, ['acceptance.mjs']);
  return { fixtureDigest, acceptanceDigest };
}
