// Shared CLI helpers for the benchmark substrate (paths, git, JSON, Harbor binaries).
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export const SUBSTRATE_ROOT = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(SUBSTRATE_ROOT, '..', '..');
export const HARBOR = Object.freeze({ bin: process.env.HARBOR_BIN || 'harbor', python: process.env.HARBOR_PYTHON || 'python3' });

export const fileDigest = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
export const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
export const pretty = value => `${JSON.stringify(value, null, 2)}\n`;

export function git(args, { cwd = REPO_ROOT, allowFailure = false } = {}) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (result.status !== 0 && !allowFailure) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.status === 0 ? result.stdout : null;
}

export function outputRoot(mode) {
  if (process.env.BENCHMARK_SUBSTRATE_OUTPUT) return resolve(process.env.BENCHMARK_SUBSTRATE_OUTPUT);
  return join(tmpdir(), 'exharness-benchmark-substrate', `${mode}-${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`);
}

export function sourceIdentity() {
  const head = git(['rev-parse', 'HEAD']).trim();
  return { head, sourceIdentity: `git:${head}` };
}
