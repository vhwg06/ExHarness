// S0 — Upstream contract preflight. Fail-closed: missing or incompatible upstream
// artifacts stop execution. No local fallback implementation lives here.
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SUBSTRATE_MANIFEST_KIND, SUBSTRATE_PIN } from './constants.mjs';

export const REQUIRED_EXPORTS = Object.freeze([
  'createExperimentRegistration',
  'createBenchmarkUnit',
  'AttemptLedger',
  'normalizeOutcome',
  'createEvidenceManifest',
  'normalizeAccounting',
  'auditAttempt',
  'assertSubstratePort'
]);

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');

export function substrateManifestPath() {
  return resolve(REPO_ROOT, 'benchmarks/substrate/manifests/terminal-bench-2.1.json');
}

export class PreflightError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = 'PreflightError';
    this.code = code;
  }
}

// Loads @exharness/benchmark only through its package root. Never deep-imports
// packages/benchmark/src/**.
export async function loadKernel() {
  let kernel;
  try {
    kernel = await import('@exharness/benchmark');
  } catch (error) {
    throw new PreflightError('KERNEL_MISSING', `cannot load @exharness/benchmark from the package root: ${error.message}`);
  }
  const absent = REQUIRED_EXPORTS.filter((name) => kernel[name] === undefined);
  if (absent.length) {
    throw new PreflightError('KERNEL_EXPORTS', `missing public exports: ${absent.join(', ')}`);
  }
  if (typeof kernel.AttemptLedger !== 'function') {
    throw new PreflightError('KERNEL_EXPORTS', 'AttemptLedger must be a constructor');
  }
  return kernel;
}

export async function loadSubstrateManifest({ manifestPath = substrateManifestPath() } = {}) {
  let raw;
  try {
    raw = await readFile(manifestPath, 'utf8');
  } catch (error) {
    throw new PreflightError('SUBSTRATE_MANIFEST_MISSING', `cannot read substrate manifest: ${error.message}`);
  }
  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch {
    throw new PreflightError('SUBSTRATE_MANIFEST_INVALID', 'substrate manifest is not JSON');
  }
  assertSubstrateCompatible(manifest);
  return { manifest, raw };
}

export function assertSubstrateCompatible(manifest) {
  if (manifest?.kind !== SUBSTRATE_MANIFEST_KIND) {
    throw new PreflightError('SUBSTRATE_MANIFEST_KIND', `expected ${SUBSTRATE_MANIFEST_KIND}, found ${manifest?.kind ?? 'none'}`);
  }
  if (manifest?.schemaVersion !== 1) {
    throw new PreflightError('SUBSTRATE_MANIFEST_VERSION', `unsupported substrate schemaVersion ${manifest?.schemaVersion ?? 'none'}`);
  }
  if (manifest?.status !== 'SEALED') {
    throw new PreflightError('SUBSTRATE_MANIFEST_STATUS', `substrate manifest is not SEALED (found ${manifest?.status ?? 'none'})`);
  }
  const harbor = manifest?.harbor;
  if (harbor?.version !== SUBSTRATE_PIN.version || harbor?.commit !== SUBSTRATE_PIN.commit) {
    throw new PreflightError('SUBSTRATE_PIN', `substrate pin drifted: expected harbor ${SUBSTRATE_PIN.version}/${SUBSTRATE_PIN.commit}`);
  }
  return manifest;
}

// Asserts the BB-065 work-graph task reached DONE. Reads only Blackboard state;
// never mutates it.
export async function assertUpstreamDone({ statePath = resolve(REPO_ROOT, 'docs/blackboard/state.md') } = {}) {
  const text = await readFile(statePath, 'utf8').catch((error) => {
    throw new PreflightError('UPSTREAM_STATE_MISSING', `cannot read Blackboard state: ${error.message}`);
  });
  if (!/^BB-065 \[DONE\]/m.test(text)) {
    throw new PreflightError('UPSTREAM_NOT_DONE', 'BB-065 is not DONE; refusing to execute');
  }
  return true;
}

export async function preflight({ manifestPath } = {}) {
  const kernel = await loadKernel();
  const { manifest, raw } = await loadSubstrateManifest({ manifestPath });
  await assertUpstreamDone();
  // Validate the delivered substrate port contract shape through the kernel's
  // own assertion using a descriptor port (no Harbor process is spawned here).
  kernel.assertSubstratePort(describeSubstratePort(manifest));
  return { kernel, manifest, raw };
}

// Descriptor port: proves the manifest pin through the kernel port contract.
// prepare/execute/collect intentionally refuse: real execution goes through the
// shared AttemptLedger plus the delivered substrate, never a local Harbor spawn.
export function describeSubstratePort(manifest) {
  return {
    identity() {
      return { substrate: manifest.harbor.substrate, version: manifest.harbor.version, commit: manifest.harbor.commit };
    },
    prepare() {
      throw new Error('PRECONDITION: prepare is owned by the delivered substrate adapter');
    },
    execute() {
      throw new Error('PRECONDITION: execute is owned by the delivered substrate adapter');
    },
    collect() {
      throw new Error('PRECONDITION: collect is owned by the delivered substrate adapter');
    }
  };
}

export function resolvePackageRoot() {
  const require = createRequire(import.meta.url);
  return require.resolve('@exharness/benchmark/package.json');
}
