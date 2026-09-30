// Pinned Harbor and Terminal-Bench identities plus exact identity helpers for the substrate adapter.
// Harbor-specific; lives outside packages/benchmark.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir, lstat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

export const HARBOR_PIN = Object.freeze({
  package: 'harbor',
  version: '0.23.0',
  tag: 'v0.23.0',
  tagObject: '3c305dc5611e3600afc3c818735a82322f0264f8',
  commit: '1e5c5c6db929a10a140d05e606882c671ae20729',
  license: 'Apache-2.0',
  // Tree digest of the harbor Python package (src/harbor at the pinned commit), __pycache__ excluded.
  sourceTreeDigest: 'sha256:c2ade5874e901c2d36fc44ae9cb01db2450adf44b111fe18b598c743a6a79134'
});

export const TERMINAL_BENCH_PIN = Object.freeze({
  dataset: 'terminal-bench/terminal-bench-2-1',
  repository: 'https://github.com/harbor-framework/terminal-bench-2-1.git',
  sourceCommit: '7131e4375048a0e408a8fb404b5f499d726b695b'
});

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const digest = bytes => `sha256:${sha256(bytes)}`;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options });
  if (result.error) throw result.error;
  return result;
}

// Deterministic digest of a directory tree: sorted "relpath\0sha256\n" lines, like Harbor's packager.
export async function treeDigest(root, { exclude = name => name === '__pycache__' } = {}) {
  const lines = [];
  async function walk(dir) {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (exclude(entry.name)) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) lines.push(`${relative(root, path).split(sep).join('/')}\0${sha256(await readFile(path))}\n`);
      else throw new Error(`unsupported tree entry ${path}`);
    }
  }
  await walk(root);
  lines.sort();
  return digest(lines.join(''));
}

// Resolve the installed Harbor and prove it is the pinned release.
export async function resolveHarborIdentity({ harborBin = 'harbor', pythonBin = 'python3', env = process.env } = {}) {
  const version = run(harborBin, ['--version'], { env });
  if (version.status !== 0) throw new Error(`harbor --version failed: ${version.stderr}`);
  const probe = run(pythonBin, ['-c', 'import harbor, importlib.metadata as m, json; print(json.dumps({"path": harbor.__path__[0], "version": m.version("harbor")}))'], { env });
  if (probe.status !== 0) throw new Error(`cannot import harbor with ${pythonBin}: ${probe.stderr}`);
  const installed = JSON.parse(probe.stdout.trim());
  const treeDigestValue = await treeDigest(installed.path);
  const identity = {
    substrate: 'harbor',
    version: version.stdout.trim(),
    distributionVersion: installed.version,
    commit: HARBOR_PIN.commit,
    tag: HARBOR_PIN.tag,
    sourceTreeDigest: treeDigestValue
  };
  const problems = [];
  if (identity.version !== HARBOR_PIN.version) problems.push(`harbor CLI version ${identity.version} != ${HARBOR_PIN.version}`);
  if (identity.distributionVersion !== HARBOR_PIN.version) problems.push(`harbor distribution ${identity.distributionVersion} != ${HARBOR_PIN.version}`);
  if (treeDigestValue !== HARBOR_PIN.sourceTreeDigest) problems.push(`installed harbor tree ${treeDigestValue} != pinned ${HARBOR_PIN.sourceTreeDigest}`);
  return { identity, pinned: problems.length === 0, problems };
}

// Harbor's own task content hash (Packager.compute_content_hash), i.e. the immutable bundle digest.
export function taskBundleDigests(taskDirs, { pythonBin = 'python3', env = process.env } = {}) {
  const script = 'import sys, json\nfrom pathlib import Path\nfrom harbor.publisher.packager import Packager\n'
    + 'print(json.dumps({p: "sha256:" + Packager.compute_content_hash(Path(p))[0] for p in sys.argv[1:]}))';
  const result = run(pythonBin, ['-c', script, ...taskDirs], { env });
  if (result.status !== 0) throw new Error(`bundle digest failed: ${result.stderr}`);
  return JSON.parse(result.stdout.trim());
}

export async function instructionDigest(taskDir) {
  return digest(await readFile(join(taskDir, 'instruction.md')));
}

// Minimal reader for the task.toml keys the adapter needs (declared artifacts and docker image).
export async function readTaskDeclaration(taskDir) {
  const text = await readFile(join(taskDir, 'task.toml'), 'utf8');
  const artifactsLine = text.match(/^artifacts\s*=\s*\[(.*)\]\s*$/m);
  const artifacts = artifactsLine ? [...artifactsLine[1].matchAll(/"([^"]+)"/g)].map(match => match[1]) : [];
  const image = text.match(/^docker_image\s*=\s*"([^"]+)"\s*$/m)?.[1] ?? null;
  const name = text.match(/^name\s*=\s*"([^"]+)"\s*$/m)?.[1] ?? null;
  return { name, artifacts, dockerImage: image };
}

// Environment identity: a pinned docker image digest, or the digest of the task's environment build context.
export async function environmentIdentity(taskDir, { dockerBin = 'docker', pull = false } = {}) {
  const declaration = await readTaskDeclaration(taskDir);
  if (declaration.dockerImage) {
    if (pull) {
      const pulled = run(dockerBin, ['pull', '-q', declaration.dockerImage]);
      if (pulled.status !== 0) throw new Error(`docker pull ${declaration.dockerImage} failed: ${pulled.stderr}`);
    }
    const inspect = run(dockerBin, ['image', 'inspect', '--format', '{{json .RepoDigests}}', declaration.dockerImage]);
    if (inspect.status !== 0) throw new Error(`docker image ${declaration.dockerImage} is not available locally`);
    const repoDigest = JSON.parse(inspect.stdout.trim()).find(value => value.includes('@sha256:'));
    if (!repoDigest) throw new Error(`docker image ${declaration.dockerImage} has no repo digest`);
    return `docker-image:${declaration.dockerImage}@${repoDigest.split('@')[1]}`;
  }
  return `docker-build-context:${await treeDigest(join(taskDir, 'environment'))}`;
}

export async function isRegularTree(root) {
  const problems = [];
  const files = [];
  async function walk(dir) {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const path = join(dir, entry.name);
      const info = await lstat(path);
      if (info.isSymbolicLink()) problems.push(`${relative(root, path)} is a symlink`);
      else if (info.isDirectory()) await walk(path);
      else if (info.isFile()) files.push(path);
      else problems.push(`${relative(root, path)} is not a regular file`);
    }
  }
  await walk(root);
  return { files, problems };
}
