// Harbor adapter boundary: pure failure mapping, usage extraction, and the adapter's process /
// trial / reset / artifact / verifier handling against a fake Harbor binary (no Docker, no model).
import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { normalizeOutcome, normalizeAccounting, assertSubstratePort } from '@exharness/benchmark';
import { FAILURE_MAPPING, mapHarborResult, usageFromHarbor, createHarborSubstrate, EVALUATOR_IDENTITY } from '../harbor/adapter.mjs';
import { HARBOR_PIN } from '../harbor/identity.mjs';
import { fakeSubstrate, registeredExperiment, tempDir, sealedFixture } from './helpers.mjs';

const t = second => `2026-01-01T00:00:${String(second).padStart(2, '0')}Z`;
const base = (overrides = {}) => ({
  id: 'uuid', trial_name: 'x', agent_info: { name: 'oracle' },
  agent_setup: { started_at: t(1) }, agent_execution: { started_at: t(2) }, verifier: { started_at: t(6) },
  agent_result: { metadata: {} }, verifier_result: { rewards: { reward: 1 } }, exception_info: null, ...overrides
});
const withException = (type, occurred = 4, extra = {}) => base({ exception_info: { exception_type: type, exception_message: type, occurred_at: t(occurred) }, ...extra });
const outcomeOf = (result, extractionStatus = 'EXTRACTED') => normalizeOutcome(mapHarborResult(result, { extractionStatus, verifierEvidenceRef: 'verifier/reward.txt' }));

test('Harbor pin is the reviewed v0.23.0 commit', () => {
  assert.equal(HARBOR_PIN.version, '0.23.0');
  assert.equal(HARBOR_PIN.commit, '1e5c5c6db929a10a140d05e606882c671ae20729');
});

test('failure mapping truth table: every Harbor exception maps to exactly one normalized dimension', () => {
  const rows = [
    ['verifier reward 1', base(), { quality: 'ACCEPTED', termination: 'COMPLETED', providerStatus: 'NONE', infrastructureStatus: 'NONE' }],
    ['producer SUCCESS + verifier reward 0', base({ agent_result: { metadata: { producerStatus: 'SUCCESS' } }, verifier_result: { rewards: { reward: 0 } } }), { quality: 'REJECTED', termination: 'COMPLETED' }],
    ['budget exhausted but verified artifact', base({ agent_result: { metadata: { producerStatus: 'BUDGET_STOP', termination: 'BUDGET_EXHAUSTED' } } }), { quality: 'ACCEPTED', termination: 'BUDGET_EXHAUSTED' }],
    ['environment start timeout', withException('EnvironmentStartTimeoutError', 0, { agent_setup: null, agent_execution: null }), { quality: 'NOT_EVALUATED', infrastructureStatus: 'ENV_BUILD' }],
    ['sandbox build failed', withException('SandboxBuildFailedError', 0, { agent_setup: null, agent_execution: null }), { quality: 'NOT_EVALUATED', infrastructureStatus: 'ENV_BUILD' }],
    ['healthcheck failure at runtime', withException('HealthcheckError'), { quality: 'NOT_EVALUATED', infrastructureStatus: 'ENV_RUNTIME' }],
    ['custom agent bootstrap failure', withException('RuntimeError', 1, { agent_execution: null }), { quality: 'NOT_EVALUATED', infrastructureStatus: 'ADAPTER_SETUP' }],
    ['agent setup timeout', withException('AgentSetupTimeoutError', 1, { agent_execution: null }), { quality: 'NOT_EVALUATED', infrastructureStatus: 'ADAPTER_SETUP' }],
    ['agent wall timeout with verified artifact', withException('AgentTimeoutError'), { quality: 'ACCEPTED', termination: 'AGENT_TIMEOUT', infrastructureStatus: 'NONE' }],
    ['provider rate limit, no artifact', withException('ApiRateLimitError'), { quality: 'NOT_EVALUATED', providerStatus: 'RATE_LIMITED', termination: 'AGENT_ERROR' }, 'NOT_PRODUCED'],
    ['provider stalled response, no artifact', withException('ApiResponseStalledError'), { quality: 'NOT_EVALUATED', providerStatus: 'PROVIDER_TIMEOUT' }, 'NOT_PRODUCED'],
    ['provider 5xx, no artifact', withException('ApiInternalServerError'), { quality: 'NOT_EVALUATED', providerStatus: 'PROVIDER_5XX' }, 'NOT_PRODUCED'],
    ['provider 5xx with extracted artifact is still judged', withException('ApiInternalServerError'), { quality: 'ACCEPTED', providerStatus: 'PROVIDER_5XX' }],
    ['verifier timeout (crash)', withException('VerifierTimeoutError', 7, { verifier_result: null }), { quality: 'NOT_EVALUATED', infrastructureStatus: 'VERIFIER_ERROR' }],
    ['reward file missing', withException('RewardFileNotFoundError', 7, { verifier_result: null }), { quality: 'NOT_EVALUATED', infrastructureStatus: 'VERIFIER_ERROR' }],
    ['unlisted exception after verifier start', withException('ValueError', 7, { verifier_result: null }), { quality: 'NOT_EVALUATED', infrastructureStatus: 'VERIFIER_ERROR' }],
    ['unlisted exception during execution', withException('ValueError', 3), { quality: 'ACCEPTED', termination: 'AGENT_ERROR' }],
    ['artifact extraction failure', base(), { quality: 'NOT_EVALUATED', infrastructureStatus: 'ARTIFACT_EXTRACTION' }, 'FAILED']
  ];
  for (const [name, result, expected, extraction] of rows) {
    const outcome = outcomeOf(result, extraction);
    const observed = { quality: outcome.quality.verdict, termination: outcome.termination, providerStatus: outcome.providerStatus, infrastructureStatus: outcome.infrastructureStatus };
    for (const [key, value] of Object.entries(expected)) assert.equal(observed[key], value, `${name}: ${key}`);
  }
  for (const [dimension, table] of Object.entries(FAILURE_MAPPING)) assert.ok(Object.isFrozen(table), `${dimension} table is frozen`);
});

test('quality is never synthesized: no reward means ERROR, never FAIL or PASS', () => {
  const mapped = mapHarborResult(base({ verifier_result: null }), { extractionStatus: 'EXTRACTED', verifierEvidenceRef: 'verifier/exception.json' });
  assert.equal(mapped.evaluator.verdict, 'ERROR');
  assert.equal(normalizeOutcome(mapped).quality.verdict, 'NOT_EVALUATED');
  const notRun = mapHarborResult(withException('ApiRateLimitError'), { extractionStatus: 'NOT_PRODUCED', verifierEvidenceRef: 'verifier/reward.txt' });
  assert.equal(notRun.evaluator.verdict, 'NOT_RUN');
  assert.equal(notRun.evaluator.evidenceRef, null, 'no verifier evidence is referenced for a candidate that was not judged');
});

test('usage comes only from fields Harbor reported; missing fields stay UNKNOWN, never zero', () => {
  const missing = normalizeAccounting(usageFromHarbor(base()));
  assert.equal(missing.status, 'UNKNOWN');
  for (const field of ['inputTokens', 'outputTokens', 'cachedTokens', 'cacheWriteTokens', 'providerCostUsd', 'normalizedCostUsd']) assert.equal(missing[field], null, field);
  const partial = usageFromHarbor(base({ agent_result: { n_input_tokens: 10, n_output_tokens: 2 } }));
  assert.deepEqual(partial.reportedFields, ['inputTokens', 'outputTokens']);
  assert.equal(partial.values.cachedTokens, undefined);
  const zero = usageFromHarbor(base({ agent_result: { n_input_tokens: 0, n_output_tokens: 0, n_cache_tokens: 0, cost_usd: 0 } }));
  assert.deepEqual(zero.reportedFields, ['inputTokens', 'outputTokens', 'cachedTokens', 'providerCostUsd'], 'reported zero is kept as reported');
});

test('adapter satisfies SubstratePort and exposes the pinned identity', async () => {
  const substrate = createHarborSubstrate({ outputRoot: await tempDir('bench-port-') });
  assertSubstratePort(substrate);
  assert.deepEqual(substrate.identity(), { substrate: 'harbor', version: HARBOR_PIN.version, commit: HARBOR_PIN.commit });
});

test('one fresh Harbor trial per attempt with explicit task, trials dir and trial name; raw evidence captured', async () => {
  const outputRoot = await tempDir('bench-adapter-');
  const log = join(outputRoot, 'invocations.jsonl');
  const experiment = await registeredExperiment({ unitIds: ['U1'] });
  const substrate = fakeSubstrate(outputRoot, { mode: 'pass', log });
  const first = await substrate.prepare(experiment.units[0], { attemptId: 'A1', taskDir: experiment.fixture.dir });
  const second = await substrate.prepare(experiment.units[0], { attemptId: 'A2', taskDir: experiment.fixture.dir });
  assert.notEqual(first.trialName, second.trialName);
  assert.notEqual(first.attemptRoot, second.attemptRoot);
  assert.deepEqual(first.preexisting, [], 'attempt output root starts empty');
  const collected = await substrate.collect(await substrate.execute(first, { kind: 'ORACLE', identity: 'harbor-oracle@test' }));
  const [invocation] = (await readFile(log, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(invocation.argv, ['trials', 'start', '-p', experiment.fixture.dir, '-a', 'oracle', '--trials-dir', first.trialsDir, '--trial-name', first.trialName]);
  const roles = collected.entries.map(entry => `${entry.role}:${entry.ref}`).sort();
  for (const expected of ['STDOUT:stdout.txt', 'STDERR:stderr.txt', 'RAW_RESULT:raw/result.json', 'SUBSTRATE_RECORD:raw/harbor-artifacts-manifest.json',
    'ARTIFACT:artifacts/app/out/result.txt', 'ARTIFACT:artifacts/app/out/nested/part.txt', 'ARTIFACT_MANIFEST:artifacts/manifest.json',
    'VERIFIER_OUTPUT:verifier/reward.txt', 'RESET_IDENTITY:reset.json', 'USAGE_OBSERVATION:usage.json', 'NORMALIZATION:normalization.json']) assert.ok(roles.includes(expected), expected);
  assert.equal(collected.candidate.extractionStatus, 'EXTRACTED');
  assert.equal(collected.outcomeInput.evaluator.verdict, 'PASS');
  assert.equal(collected.outcomeInput.evaluator.evidenceRef, 'verifier/reward.txt');
  assert.equal(collected.evidence.substrateTrialRef, first.trialName);
  const reset = JSON.parse(await readFile(join(first.evidenceDir, 'reset.json'), 'utf8'));
  assert.equal(reset.trialId, first.trialName);
  assert.equal(reset.environmentDelete, true);
  assert.equal(reset.harborTrialUuid, collected.harborTrialUuid);
  assert.equal(reset.taskBundleDigest, experiment.fixture.bundleDigest);
});

test('RESET_REUSED: the same attempt output root or trial cannot be prepared twice, even by a new adapter', async () => {
  const outputRoot = await tempDir('bench-reset-');
  const experiment = await registeredExperiment();
  const substrate = fakeSubstrate(outputRoot);
  await substrate.prepare(experiment.units[0], { attemptId: 'A1', taskDir: experiment.fixture.dir });
  await assert.rejects(substrate.prepare(experiment.units[0], { attemptId: 'A1', taskDir: experiment.fixture.dir }), /RESET_REUSED/);
  await assert.rejects(fakeSubstrate(outputRoot).prepare(experiment.units[0], { attemptId: 'A1', taskDir: experiment.fixture.dir }), /RESET_REUSED/);
});

test('FIXED_FACTOR_DRIFT: a task bundle or instruction that differs from the registered unit is refused', async () => {
  const outputRoot = await tempDir('bench-drift-');
  const experiment = await registeredExperiment();
  const copy = join(outputRoot, 'task-copy');
  await cp(experiment.fixture.dir, copy, { recursive: true });
  await writeFile(join(copy, 'instruction.md'), `${await readFile(join(copy, 'instruction.md'), 'utf8')}\nextra\n`);
  await assert.rejects(fakeSubstrate(outputRoot).prepare(experiment.units[0], { attemptId: 'A1', taskDir: copy }), /FIXED_FACTOR_DRIFT/);
  const other = await sealedFixture('SUBSTRATE-PASS-01');
  await assert.rejects(fakeSubstrate(outputRoot).prepare(experiment.units[0], { attemptId: 'A2', taskDir: other.dir }), /FIXED_FACTOR_DRIFT/);
});

async function collectMode(mode) {
  const outputRoot = await tempDir(`bench-${mode}-`);
  const experiment = await registeredExperiment();
  const substrate = fakeSubstrate(outputRoot, { mode });
  const prepared = await substrate.prepare(experiment.units[0], { attemptId: 'A1', taskDir: experiment.fixture.dir });
  const collected = await substrate.collect(await substrate.execute(prepared, { kind: 'ORACLE', identity: 'harbor-oracle@test' }));
  return { collected, prepared, outcome: normalizeOutcome(collected.outcomeInput) };
}

test('missing, malformed or foreign trial result is HARNESS_PROTOCOL and NOT_EVALUATED', async () => {
  for (const mode of ['no-result', 'malformed', 'foreign-trial']) {
    const { collected, outcome } = await collectMode(mode);
    assert.equal(outcome.infrastructureStatus, 'HARNESS_PROTOCOL', mode);
    assert.equal(outcome.quality.verdict, 'NOT_EVALUATED', mode);
    assert.equal(collected.evidence.verifierRefs.length, 0, `${mode}: verifier output is not read`);
    assert.match(collected.failureFingerprint, /^HARNESS_PROTOCOL:/);
  }
});

test('a symlinked artifact is ARTIFACT_EXTRACTION, not a verifier judgement', async () => {
  const { collected, outcome } = await collectMode('symlink');
  assert.equal(collected.candidate.extractionStatus, 'FAILED');
  assert.equal(outcome.infrastructureStatus, 'ARTIFACT_EXTRACTION');
  assert.equal(outcome.quality.verdict, 'NOT_EVALUATED');
  assert.equal(collected.candidate.artifactDigest, null);
});

test('verifier crash is NOT_EVALUATED + VERIFIER_ERROR with the raw exception persisted', async () => {
  const { collected, prepared, outcome } = await collectMode('verifier-crash');
  assert.equal(outcome.quality.verdict, 'NOT_EVALUATED');
  assert.equal(outcome.infrastructureStatus, 'VERIFIER_ERROR');
  const exception = JSON.parse(await readFile(join(prepared.evidenceDir, 'verifier', 'exception.json'), 'utf8'));
  assert.equal(exception.exception_type, 'VerifierTimeoutError');
});

test('provider rate limit with no artifact is NOT_EVALUATED and usage stays UNKNOWN', async () => {
  const { collected, outcome } = await collectMode('rate-limit');
  assert.equal(outcome.providerStatus, 'RATE_LIMITED');
  assert.equal(outcome.quality.verdict, 'NOT_EVALUATED');
  assert.equal(normalizeAccounting(collected.usageObservation).status, 'UNKNOWN');
});

test('producer SUCCESS + verifier reward 0 is REJECTED and reported usage is kept without filling the rest', async () => {
  const reject = await collectMode('reject');
  assert.equal(reject.outcome.quality.verdict, 'REJECTED');
  const usage = await collectMode('usage');
  assert.equal(usage.outcome.quality.verdict, 'ACCEPTED');
  const accounting = normalizeAccounting(usage.collected.usageObservation);
  assert.equal(accounting.inputTokens, 100);
  assert.equal(accounting.cachedTokens, 0, 'a reported zero stays a reported zero');
  assert.equal(accounting.providerCostUsd, 0.25);
  assert.equal(accounting.cacheWriteTokens, null, 'an unreported field is not zero-filled');
  assert.equal(accounting.status, 'PARTIAL');
});

test('evaluator identity is the pinned Harbor task verifier', () => {
  assert.equal(EVALUATOR_IDENTITY, `harbor-task-verifier@${HARBOR_PIN.version}`);
});
