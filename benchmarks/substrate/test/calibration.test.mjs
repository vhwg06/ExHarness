// Local calibration matrix: structural validation and per-case comparison (the Harbor/Docker run
// itself is the `calibration` verification: `node benchmarks/substrate/run.mjs --mode local-calibration`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EXPECT_KEYS, compareCase, observe, validateCalibrationManifest } from '../calibration.mjs';
import { SUBSTRATE_ROOT } from '../common.mjs';

const load = async ref => JSON.parse(await readFile(join(SUBSTRATE_ROOT, ref), 'utf8'));

test('the sealed calibration manifest is valid, model-free and covers every fixture', async () => {
  const manifest = await load('calibration/manifest.json');
  const fixtures = await load('fixtures/manifest.json');
  assert.deepEqual(validateCalibrationManifest(manifest, fixtures), []);
  assert.equal(manifest.codingModelCalls, 0);
  assert.equal(fixtures.credentialFree, true);
  assert.equal(fixtures.modelFree, true);
});

test('the matrix contains the plan truth-table rows', async () => {
  const manifest = await load('calibration/manifest.json');
  const byCase = Object.fromEntries(manifest.cases.map(item => [item.caseId, item]));
  const expect = (caseId, fields) => { assert.ok(byCase[caseId], caseId); for (const [key, value] of Object.entries(fields)) assert.equal(byCase[caseId].expect[key], value, `${caseId}.${key}`); };
  expect('REJECT-PRODUCER-SUCCESS', { quality: 'REJECTED', producerStatus: 'SUCCESS', termination: 'COMPLETED' });
  expect('FAILURE-BUDGET-VALID', { quality: 'ACCEPTED', termination: 'BUDGET_EXHAUSTED' });
  expect('FAILURE-PROVIDER-TIMEOUT', { quality: 'NOT_EVALUATED', providerStatus: 'PROVIDER_TIMEOUT' });
  assert.equal(byCase['FAILURE-RETRY-AFTER-TIMEOUT'].retryOfCaseId, 'FAILURE-PROVIDER-TIMEOUT');
  for (const item of manifest.cases.filter(entry => ['ORACLE', 'NOP'].includes(entry.producer.kind))) assert.equal(item.expect.usageStatus, 'UNKNOWN', `${item.caseId} usage stays UNKNOWN`);
  const infra = new Set(manifest.cases.map(item => item.expect.infrastructureStatus));
  for (const status of ['NONE', 'VERIFIER_ERROR', 'ARTIFACT_EXTRACTION', 'ADAPTER_SETUP']) assert.ok(infra.has(status), status);
});

test('structural defects are reported before anything runs', async () => {
  const manifest = await load('calibration/manifest.json');
  const fixtures = await load('fixtures/manifest.json');
  const clone = () => JSON.parse(JSON.stringify(manifest));
  const withModel = clone(); withModel.cases[0].producer.kind = 'CODING_MODEL';
  assert.match(validateCalibrationManifest(withModel, fixtures).join('\n'), /not model-free/);
  const duplicate = clone(); duplicate.cases.push(duplicate.cases[0]);
  assert.match(validateCalibrationManifest(duplicate, fixtures).join('\n'), /duplicate case/);
  const retryFirst = clone(); const retry = retryFirst.cases.find(item => item.retryOfCaseId); retryFirst.cases = [retry, ...retryFirst.cases.filter(item => item !== retry)];
  assert.match(validateCalibrationManifest(retryFirst, fixtures).join('\n'), /must run earlier/);
  const unknownKey = clone(); unknownKey.cases[0].expect.verdictGuess = 'PASS';
  assert.match(validateCalibrationManifest(unknownKey, fixtures).join('\n'), /unknown expectation/);
  const calls = clone(); calls.codingModelCalls = 1;
  assert.match(validateCalibrationManifest(calls, fixtures).join('\n'), /zero coding-model calls/);
  const uncovered = clone(); uncovered.cases = uncovered.cases.filter(item => item.fixture !== fixtures.fixtures[0].id);
  assert.match(validateCalibrationManifest(uncovered, fixtures).join('\n'), /has no case/);
});

test('compareCase reports every mismatching dimension and nothing else', () => {
  const observed = { quality: 'REJECTED', termination: 'COMPLETED', providerStatus: 'NONE', infrastructureStatus: 'NONE', extractionStatus: 'EXTRACTED', usageStatus: 'UNKNOWN', producerStatus: 'SUCCESS', artifactFiles: 1 };
  assert.deepEqual(compareCase({ quality: 'REJECTED', usageStatus: 'UNKNOWN' }, observed), []);
  assert.deepEqual(compareCase({ quality: 'ACCEPTED', usageStatus: 'KNOWN' }, observed), [
    { key: 'quality', expected: 'ACCEPTED', observed: 'REJECTED' }, { key: 'usageStatus', expected: 'KNOWN', observed: 'UNKNOWN' }]);
  assert.deepEqual(Object.keys(observed).sort(), [...EXPECT_KEYS].sort());
});

test('observe reads quality from the settled record and producer status from the normalization input', () => {
  const record = { quality: { verdict: 'ACCEPTED' }, termination: 'BUDGET_EXHAUSTED', providerStatus: 'NONE', infrastructureStatus: 'NONE', candidate: { extractionStatus: 'EXTRACTED' }, usage: { status: 'PARTIAL' } };
  assert.deepEqual(observe(record, { outcomeInput: { producerStatus: 'BUDGET_STOP' }, artifactFiles: 1 }), {
    quality: 'ACCEPTED', termination: 'BUDGET_EXHAUSTED', providerStatus: 'NONE', infrastructureStatus: 'NONE', extractionStatus: 'EXTRACTED', usageStatus: 'PARTIAL', producerStatus: 'BUDGET_STOP', artifactFiles: 1 });
});
