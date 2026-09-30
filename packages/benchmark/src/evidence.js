// EVIDENCE_MANIFEST_V1: immutable path/digest identities for every materialized attempt evidence file.
import {
  CONTRACT_KINDS, fail, seal, verifySeal, clone, requireExactKeys, requireId, requireEnum, requireDigest, requireRelativeRef
} from './contracts.js';

export const EVIDENCE_ROLES = Object.freeze(['RAW_RESULT', 'STDOUT', 'STDERR', 'TRAJECTORY', 'ARTIFACT', 'ARTIFACT_MANIFEST',
  'VERIFIER_OUTPUT', 'USAGE_OBSERVATION', 'RESET_IDENTITY', 'NORMALIZATION', 'SUBSTRATE_RECORD']);
export const REQUIRED_ROLES = Object.freeze(['RAW_RESULT', 'USAGE_OBSERVATION', 'RESET_IDENTITY', 'NORMALIZATION']);

function validateEntries(entries) {
  if (!Array.isArray(entries) || entries.length === 0) fail('SCHEMA', 'manifest.entries must be a non-empty array');
  const refs = new Set();
  entries.forEach((entry, index) => {
    requireExactKeys(entry, `manifest.entries[${index}]`, ['role', 'ref', 'digest', 'bytes']);
    requireEnum(entry.role, `manifest.entries[${index}].role`, EVIDENCE_ROLES);
    requireRelativeRef(entry.ref, `manifest.entries[${index}].ref`);
    requireDigest(entry.digest, `manifest.entries[${index}].digest`);
    if (!Number.isInteger(entry.bytes) || entry.bytes < 0) fail('SCHEMA', `manifest.entries[${index}].bytes must be a non-negative integer`);
    if (refs.has(entry.ref)) fail('IDENTITY', `manifest ref ${entry.ref} appears twice`);
    refs.add(entry.ref);
  });
  for (const role of REQUIRED_ROLES) if (!entries.some(entry => entry.role === role)) fail('MISSING_EVIDENCE', `manifest has no ${role} entry`);
}

function validateBody(value) {
  requireExactKeys(value, 'manifest', ['kind', 'experimentId', 'unitId', 'attemptId', 'entries'], ['manifestDigest']);
  if (value.kind !== CONTRACT_KINDS.EVIDENCE_MANIFEST) fail('SCHEMA', `manifest.kind must be ${CONTRACT_KINDS.EVIDENCE_MANIFEST}`);
  requireId(value.experimentId, 'manifest.experimentId');
  requireId(value.unitId, 'manifest.unitId');
  requireId(value.attemptId, 'manifest.attemptId');
  validateEntries(value.entries);
}

export function createEvidenceManifest(input) {
  const body = { kind: CONTRACT_KINDS.EVIDENCE_MANIFEST, ...clone(input) };
  if ('manifestDigest' in body) fail('IDENTITY', 'manifestDigest is computed, not supplied');
  validateBody(body);
  body.entries = [...body.entries].sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));
  return seal(body, 'manifestDigest');
}

export function assertEvidenceManifest(value) {
  validateBody(value);
  requireDigest(value.manifestDigest, 'manifest.manifestDigest');
  verifySeal(value, 'manifestDigest', 'TAMPERED');
  return value;
}

export function entriesFor(manifest, role) {
  return manifest.entries.filter(entry => entry.role === role);
}
