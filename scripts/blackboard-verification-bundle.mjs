import fs from 'node:fs';
import path from 'node:path';
import { hash, fail, localPath } from './blackboard-delivery-contract.mjs';

const SAFE_BASENAME = /^[-A-Za-z0-9._]+\.txt$/;

// Pure union of every verification run log plus every claim observation.
// No I/O here; callers inject loadBody / filesystem access.
export function bundleRefs(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) fail('invalid result for bundle refs');
  if (!Array.isArray(result.verificationRuns) || !Array.isArray(result.claims)) fail('invalid result for bundle refs');
  const refs = [];
  for (const run of result.verificationRuns) {
    if (!run || typeof run.logRef !== 'string' || !run.logRef) fail('invalid verification run logRef');
    refs.push(run.logRef);
  }
  for (const claim of result.claims) {
    if (!claim || !Array.isArray(claim.evidenceRefs)) fail('invalid claim evidenceRefs');
    for (const ref of claim.evidenceRefs) {
      if (typeof ref !== 'string' || !ref) fail('invalid evidence ref');
      refs.push(ref);
    }
  }
  return [...new Set(refs)].sort();
}

// Pair each union ref with its exact body bytes, in bundleRefs order.
// Throws fail-closed on an empty body for a non-empty bound hash.
export function buildBundle(result, loadBody) {
  if (typeof loadBody !== 'function') fail('loadBody required');
  const refs = bundleRefs(result);
  const emptyHash = hash('');
  const runsByRef = new Map();
  for (const run of result.verificationRuns) {
    if (!runsByRef.has(run.logRef)) runsByRef.set(run.logRef, []);
    runsByRef.get(run.logRef).push(run);
  }
  const files = refs.map(ref => {
    const body = loadBody(ref);
    if (typeof body !== 'string') fail(`missing bundle body: ${ref}`);
    if (body.length === 0) {
      const bound = runsByRef.get(ref) ?? [];
      if (bound.some(run => run.logHash !== emptyHash)) fail(`empty bundle body for non-empty log: ${ref}`);
    }
    return { ref, body };
  });
  return { result, files };
}

// Validate safe refs and digests before any write or provider call,
// then install union files in deterministic bundleRefs order.
export function installBundle(root, id, bundle) {
  if (!/^BB-\d+$/.test(id ?? '')) fail('invalid work id for bundle install');
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) fail('invalid bundle');
  if (!bundle.result || !Array.isArray(bundle.files)) fail('invalid bundle shape');
  const refs = bundleRefs(bundle.result);
  const byRef = new Map();
  for (const file of bundle.files) {
    if (!file || typeof file.ref !== 'string' || typeof file.body !== 'string') fail('invalid bundled file');
    if (byRef.has(file.ref)) {
      if (byRef.get(file.ref) !== file.body) fail(`duplicate bundle ref with different bytes: ${file.ref}`);
      continue;
    }
    byRef.set(file.ref, file.body);
  }
  const emptyHash = hash('');
  // Validate everything before writing anything.
  for (const ref of refs) {
    if (!byRef.has(ref)) fail(`missing bundle entry: ${ref}`);
    if (path.posix.dirname(ref) !== `docs/blackboard/evidence/${id}`) fail(`noncanonical bundled evidence ref: ${ref}`);
    if (!SAFE_BASENAME.test(path.posix.basename(ref))) fail(`unsafe bundled evidence basename: ${ref}`);
    const body = byRef.get(ref);
    if (body.length === 0) {
      const bound = bundle.result.verificationRuns.filter(v => v.logRef === ref);
      if (bound.some(run => run.logHash !== emptyHash)) fail(`empty bundle body for non-empty log: ${ref}`);
    }
    for (const run of bundle.result.verificationRuns.filter(v => v.logRef === ref)) {
      if (hash(body) !== run.logHash) fail(`bundled log digest mismatch: ${ref}`);
    }
  }
  for (const extra of byRef.keys()) {
    if (refs.includes(extra)) continue;
    if (path.posix.dirname(extra) !== `docs/blackboard/evidence/${id}` || !SAFE_BASENAME.test(path.posix.basename(extra))) fail(`noncanonical extra bundle ref: ${extra}`);
  }
  const resolved = path.resolve(root);
  for (const ref of refs) {
    const body = byRef.get(ref);
    const destination = localPath(resolved, ref);
    if (path.dirname(destination) !== path.join(resolved, 'docs/blackboard/evidence', id)) fail('bundled evidence escapes task');
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, body);
  }
}
