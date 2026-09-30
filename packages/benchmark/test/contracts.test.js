import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as benchmark from '@exharness/benchmark';

const EXPORTS = ['AttemptLedger', 'CONTRACT_KINDS', 'OUTCOME_ENUMS', 'assertAttemptRecord', 'assertBenchmarkUnit', 'assertEvidenceManifest',
  'assertExperimentRegistration', 'assertSubstratePort', 'auditAttempt', 'createBenchmarkUnit', 'createEvidenceManifest',
  'createExperimentRegistration', 'normalizeAccounting', 'normalizeOutcome'];

test('package root exposes exactly the fourteen public exports', () => {
  assert.deepEqual(Object.keys(benchmark).sort(), EXPORTS);
});

test('package.json is private, root-export-only and free of runtime dependencies', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.name, '@exharness/benchmark');
  assert.equal(pkg.private, true);
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.engines.node, '>=20');
  assert.deepEqual(pkg.exports, { '.': './src/index.js' });
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies', 'bundleDependencies']) assert.equal(pkg[field], undefined, field);
});

test('deep imports are not part of the contract', async () => {
  await assert.rejects(() => import('@exharness/benchmark/src/attempt-ledger.js'), error => error.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED');
  await assert.rejects(() => import('@exharness/benchmark/package.json'), error => error.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED');
});

test('canonical schema kinds and outcome enums are exact and frozen', () => {
  assert.deepEqual(Object.values(benchmark.CONTRACT_KINDS), ['EXPERIMENT_REGISTRATION_V1', 'BENCHMARK_UNIT_V1', 'ATTEMPT_LEDGER_EVENT_V1',
    'BENCHMARK_ATTEMPT_RECORD_V1', 'EVIDENCE_MANIFEST_V1', 'ACCOUNTING_V1', 'BENCHMARK_AUDIT_V1']);
  assert.deepEqual(benchmark.OUTCOME_ENUMS.quality, ['ACCEPTED', 'REJECTED', 'NOT_EVALUATED']);
  assert.deepEqual(benchmark.OUTCOME_ENUMS.termination, ['COMPLETED', 'BUDGET_EXHAUSTED', 'AGENT_TIMEOUT', 'AGENT_ERROR', 'CANCELLED']);
  assert.deepEqual(benchmark.OUTCOME_ENUMS.providerStatus, ['NONE', 'RATE_LIMITED', 'PROVIDER_TIMEOUT', 'PROVIDER_5XX', 'ROUTE_MISMATCH', 'USAGE_UNKNOWN']);
  assert.deepEqual(benchmark.OUTCOME_ENUMS.infrastructureStatus, ['NONE', 'ENV_BUILD', 'ENV_RUNTIME', 'ADAPTER_SETUP', 'HARNESS_PROTOCOL', 'ARTIFACT_EXTRACTION', 'VERIFIER_ERROR']);
  assert.deepEqual(benchmark.OUTCOME_ENUMS.usageStatus, ['KNOWN', 'PARTIAL', 'UNKNOWN']);
  assert.ok(Object.isFrozen(benchmark.CONTRACT_KINDS) && Object.isFrozen(benchmark.OUTCOME_ENUMS.quality));
  assert.throws(() => { benchmark.OUTCOME_ENUMS.quality.push('MAYBE'); });
});

test('assertSubstratePort requires identity/prepare/execute/collect and a truthful identity', () => {
  const port = { identity: () => ({ substrate: 'fake', version: '1', commit: null }), prepare() {}, execute() {}, collect() {} };
  assert.equal(benchmark.assertSubstratePort(port), port);
  assert.throws(() => benchmark.assertSubstratePort({ ...port, collect: undefined }), /missing collect/);
  assert.throws(() => benchmark.assertSubstratePort({ ...port, identity: () => ({ substrate: 'fake' }) }), /identity/);
});
