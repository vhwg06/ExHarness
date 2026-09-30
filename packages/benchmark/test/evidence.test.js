import test from 'node:test';
import assert from 'node:assert/strict';
import { createEvidenceManifest, assertEvidenceManifest } from '@exharness/benchmark';
import { sha } from './fixtures.js';

const entry = (role, ref) => ({ role, ref, digest: sha(ref), bytes: ref.length });
const base = () => ({ experimentId: 'EXP-FIXTURE-01', unitId: 'UNIT-A', attemptId: 'A-1',
  entries: [entry('NORMALIZATION', 'normalization.json'), entry('RAW_RESULT', 'raw/result.json'), entry('USAGE_OBSERVATION', 'usage.json'), entry('RESET_IDENTITY', 'reset.json')] });

test('manifest binds sorted path/digest identities and is deterministic', () => {
  const a = createEvidenceManifest(base());
  const b = createEvidenceManifest({ ...base(), entries: [...base().entries].reverse() });
  assert.equal(a.kind, 'EVIDENCE_MANIFEST_V1');
  assert.equal(a.manifestDigest, b.manifestDigest);
  assert.deepEqual(a.entries.map(e => e.ref), ['normalization.json', 'raw/result.json', 'reset.json', 'usage.json']);
  assert.equal(assertEvidenceManifest(a), a);
});

test('a modified manifest entry fails assertion', () => {
  const manifest = JSON.parse(JSON.stringify(createEvidenceManifest(base())));
  manifest.entries[0].digest = sha('tampered');
  assert.throws(() => assertEvidenceManifest(manifest), /TAMPERED/);
});

test('required roles, normalized refs and unique refs are enforced', () => {
  assert.throws(() => createEvidenceManifest({ ...base(), entries: base().entries.filter(e => e.role !== 'RAW_RESULT') }), /MISSING_EVIDENCE: manifest has no RAW_RESULT/);
  assert.throws(() => createEvidenceManifest({ ...base(), entries: [...base().entries, entry('ARTIFACT', '../escape.txt')] }), /normalized relative ref/);
  assert.throws(() => createEvidenceManifest({ ...base(), entries: [...base().entries, entry('ARTIFACT', '/abs/path')] }), /normalized relative ref/);
  assert.throws(() => createEvidenceManifest({ ...base(), entries: [...base().entries, entry('ARTIFACT', 'usage.json')] }), /appears twice/);
  assert.throws(() => createEvidenceManifest({ ...base(), entries: [...base().entries, { ...entry('ARTIFACT', 'a.txt'), digest: 'md5:1' }] }), /sha256/);
  assert.throws(() => createEvidenceManifest({ ...base(), entries: [...base().entries, entry('SUMMARY', 'summary.json')] }), /role must be one of/);
});
