import test from 'node:test';
import assert from 'node:assert/strict';
import { CALIBRATION_TASK_IDS, MINI_COMMIT, NODE_VERSION, PLAYWRIGHT_VERSION, PROTOCOL, PROTOCOL_HASH, fixtureIdentities, registrationManifest, selectPilotPairs, sha256, validateProfile } from '../../scripts/delivery/baseline/contract.mjs';

const digest = letter => `sha256:${letter.repeat(64)}`;
function profile(identities) {
  const model = { snapshot: 'provider/model-2026-09-24', reasoningEffort: 'none', endpointOrigin: 'https://api.example.invalid', apiBaseUrl: 'https://api.example.invalid/v1', credentialEnv: 'OPENAI_API_KEY', tokenizer: 'litellm:provider/model-2026-09-24', maxContextTokens: 30000, pricingDate: '2026-09-24', pricingSource: 'https://example.invalid/pricing', inputUsdPerMillion: 1, cachedInputUsdPerMillion: 0.1, outputUsdPerMillion: 2 };
  const tool = { model, nodeVersion: NODE_VERSION, miniCommit: MINI_COMMIT, agentImageDigest: digest('d'), budgets: PROTOCOL.budgets };
  const armHash = sha256(tool);
  return {
    schemaVersion: 1, experimentId: 'fixture-registration', operatorId: 'operator-1', reviewerId: 'reviewer-2', protocolHash: PROTOCOL_HASH,
    candidateSha: 'a'.repeat(40), candidateTree: 'b'.repeat(40),
    ...identities, nodeVersion: NODE_VERSION, playwrightVersion: PLAYWRIGHT_VERSION, miniCommit: MINI_COMMIT,
    pythonExecutable: 'C:/pinned/python.exe', pythonVersion: '3.12.13',
    nodeImageDigest: digest('a'), browserDigest: digest('b'), pythonLockDigest: digest('c'), agentImageDigest: digest('d'),
    agentImage: `node:24.19.0-bookworm-slim@${digest('d')}`,
    model, calibrationTaskIds: [...CALIBRATION_TASK_IDS], budgets: structuredClone(PROTOCOL.budgets),
    contexts: ['repo-a', 'repo-b'].map((repositoryId, index) => ({
      repositoryId, baseSha: String(index + 1).repeat(40), baseTree: String(index + 3).repeat(40), ownerDecisionRef: `decision-${repositoryId}`,
      eligibleTasks: Array.from({ length: 12 }, (_, task) => ({ id: `T${String(task + 1).padStart(2, '0')}`, promptRef: `prompts/${repositoryId}/T${task + 1}.md`, acceptanceDigest: digest('e') }))
    })),
    armProfileHashes: { DIRECT: armHash, EXHARNESS: armHash }
  };
}

test('registration freezes balanced pairs, heldout partition, order and exact identities', async () => {
  const identities = await fixtureIdentities();
  const value = profile(identities);
  const result = validateProfile(value, identities);
  assert.equal(result.pairs.length, 20);
  assert.equal(result.pairs.filter(pair => pair.partition === 'HELDOUT').length, 8);
  assert.deepEqual(result.pairs[0].order, ['DIRECT', 'EXHARNESS']);
  assert.deepEqual(result.pairs[1].order, ['EXHARNESS', 'DIRECT']);
  assert.deepEqual(selectPilotPairs(value.contexts), result.pairs);
  const manifest = registrationManifest(value, identities);
  assert.equal(manifest.digest, `sha256:${sha256(Object.fromEntries(Object.entries(manifest).filter(([key]) => key !== 'digest')))}`);
  assert.ok(!JSON.stringify(manifest).includes('OPENAI_API_KEY='));
});

test('calibration registers only the three frozen fixture tasks before pilot context selection', async () => {
  const identities = await fixtureIdentities();
  const value = profile(identities);
  value.contexts = [];
  const calibration = registrationManifest(value, identities, { calibration: true });
  assert.equal(calibration.registrationKind, 'CALIBRATION');
  assert.deepEqual(calibration.pairs, []);
  assert.deepEqual(calibration.calibrationTaskIds, CALIBRATION_TASK_IDS);
  assert.throws(() => validateProfile(value, identities), /two repository contexts/);
  const pilot = profile(identities);
  assert.throws(() => registrationManifest(pilot, identities, { calibration: true }), /cannot claim a selected pilot cohort/);
});

test('preflight rejects mutable protocol, floating profiles, insufficient samples and arm drift', async () => {
  const identities = await fixtureIdentities();
  const mutate = change => { const value = profile(identities); change(value); return value; };
  assert.throws(() => validateProfile(mutate(value => { value.protocolHash = digest('f').slice(7); }), identities), /protocol hash/);
  assert.throws(() => validateProfile(mutate(value => { value.model.snapshot = 'provider/model-latest'; }), identities), /model snapshot/);
  assert.throws(() => validateProfile(mutate(value => { value.model.reasoningEffort = 'medium'; }), identities), /model snapshot/);
  assert.throws(() => validateProfile(mutate(value => { value.contexts[0].eligibleTasks.length = 9; }), identities), /ten eligible/);
  assert.throws(() => validateProfile(mutate(value => { value.armProfileHashes.EXHARNESS = 'wrong'; }), identities), /arm profile/);
  assert.throws(() => validateProfile(mutate(value => { value.budgets.maxApiUsd = 50; }), identities), /budgets changed/);
  assert.throws(() => validateProfile(mutate(value => { value.model.apiKey = 'must-never-be-stored'; }), identities), /secrets/);
  assert.throws(() => validateProfile(profile(identities), { ...identities, fixtureDigest: digest('0') }), /fixture digest/);
});
