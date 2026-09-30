// S2 — Cohort materialization helpers. Manifest JSON files under manifests/
// are the preregistered artifacts; this module builds and reads them.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { developmentManifest, heldOutManifest } from './protocol.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

export function manifestPaths({ root = HERE } = {}) {
  return Object.freeze({
    development: resolve(root, 'manifests/development.json'),
    heldOut: resolve(root, 'manifests/held-out.json')
  });
}

export async function writeCohortManifests({ binding, root = HERE } = {}) {
  const paths = manifestPaths({ root });
  await mkdir(dirname(paths.development), { recursive: true });
  const development = developmentManifest({ binding });
  const heldOut = heldOutManifest();
  const pretty = (value) => `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(paths.development, pretty(development), 'utf8');
  await writeFile(paths.heldOut, pretty(heldOut), 'utf8');
  return { paths, development, heldOut };
}

export async function readCohortManifests({ root = HERE } = {}) {
  const paths = manifestPaths({ root });
  const development = JSON.parse(await readFile(paths.development, 'utf8'));
  const heldOut = JSON.parse(await readFile(paths.heldOut, 'utf8'));
  return { paths, development, heldOut };
}
