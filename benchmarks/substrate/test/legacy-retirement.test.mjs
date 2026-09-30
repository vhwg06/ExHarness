// Legacy retirement: the sealed inventory and migration matrix, checked against the repository.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LEGACY_MANIFEST, SCAN_ALLOWLIST, verifyLegacyRetirement } from '../legacy-retirement.mjs';

test('the retirement manifest gives every retired capability an explicit disposition', async () => {
  const manifest = JSON.parse(await readFile(LEGACY_MANIFEST, 'utf8'));
  assert.equal(manifest.kind, 'BENCHMARK_LEGACY_RETIREMENT_V1');
  const dispositions = new Set(['DROP', 'REIMPLEMENT_GENERIC', 'REQUALIFY', 'DOWNSTREAM_OWNER']);
  for (const row of manifest.matrix) assert.ok(dispositions.has(row.disposition), row.legacy);
  assert.deepEqual(manifest.retiredRoots, ['scripts/delivery/baseline', 'test/delivery']);
  for (const entry of manifest.equivalence) assert.ok(entry.tests.length > 0, entry.legacy);
});

test('the repository passes every retirement check', async () => {
  const result = await verifyLegacyRetirement();
  const failed = result.checks.filter(item => item.status !== 'PASS');
  assert.deepEqual(failed, []);
  for (const name of ['baseline-recoverable', 'inventory-complete', 'no-product-runtime-dependency', 'root-entrypoints-cut', 'forbidden-reference-scan', 'living-state-not-current'])
    assert.ok(result.checks.some(item => item.name === name && item.status === 'PASS'), name);
});

test('only the policing files may name the retired paths', () => {
  assert.ok(SCAN_ALLOWLIST.every(path => /legacy-retirement|dependency-boundary/.test(path)));
});
