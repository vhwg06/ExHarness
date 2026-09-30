// Shared hermetic helpers for the harness-efficiency suites: per-file scratch
// dirs, upstream loading, and deterministic baseline execution. Never writes
// into the repo or the shared /tmp root.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function scratchDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `bb077-${prefix}-`));
}

export async function loadUpstream() {
  const preflight = await import('../preflight.mjs');
  return preflight.preflight();
}

export async function runBaseline({ kernel, manifest, raw, ...opts } = {}) {
  const run = await import('../run.mjs');
  const upstream = kernel ? { kernel, manifest, rawManifest: raw } : await loadUpstream().then((pre) => ({
    kernel: pre.kernel,
    manifest: pre.manifest,
    rawManifest: pre.raw
  }));
  const out = await run.runCohort({ ...upstream, ...opts });
  return { ...out, kernel: upstream.kernel };
}

export function memoryStore(files) {
  return {
    async read(ref) {
      if (!files.has(ref)) throw new Error(`missing ${ref}`);
      return files.get(ref);
    }
  };
}

// Static import scanner (no module execution). Returns specifiers.
export function importSpecifiers(source) {
  const specifiers = new Set();
  for (const match of source.matchAll(/\bimport\s+(?:[^'"()]*?\s+from\s+)?['"]([^'"]+)['"]/g)) specifiers.add(match[1]);
  for (const match of source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) specifiers.add(match[1]);
  return [...specifiers].sort();
}

export const DEEP = ['packages', 'benchmark', 'src'].join('/') + '/';
