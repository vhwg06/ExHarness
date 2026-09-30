// KERNEL_CONSUMER / BOUNDARY: the experiment consumes @exharness/benchmark only
// through the package root plus the delivered substrate manifest/port, and
// never reimplements generic ledger/evidence/accounting/audit or Harbor
// substrate behavior. Hermetic: reads repo sources only, writes nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEEP, importSpecifiers, scratchDir } from './helpers.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const IMPL = path.resolve(HERE, '..');
const REPO = path.resolve(HERE, '..', '..', '..');

let tmp;
test.before(() => { tmp = scratchDir('kernel-boundary'); assert.ok(fs.statSync(tmp).isDirectory()); });

function implSources() {
  const out = [];
  const collect = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        if (name === 'test' || name === 'manifests') continue;
        collect(full);
      } else if (name.endsWith('.mjs') && full !== path.join(HERE, 'helpers.mjs')) {
        out.push(full);
      }
    }
  };
  collect(IMPL);
  return out.sort();
}

test('kernel exposes the required public exports from the package root', async () => {
  const { loadKernel, REQUIRED_EXPORTS } = await import('../preflight.mjs');
  const kernel = await loadKernel();
  assert.deepEqual([...REQUIRED_EXPORTS].sort(), [
    'AttemptLedger',
    'assertSubstratePort',
    'auditAttempt',
    'createBenchmarkUnit',
    'createEvidenceManifest',
    'createExperimentRegistration',
    'normalizeAccounting',
    'normalizeOutcome'
  ]);
  for (const name of REQUIRED_EXPORTS) assert.notEqual(kernel[name], undefined, name);
});

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
}

test('implementation imports stay on the public package root', async () => {
  const files = implSources();
  assert.ok(files.length >= 8, `expected implementation files, found ${files.length}`);
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    for (const spec of importSpecifiers(source)) {
      assert.ok(
        spec.startsWith('node:') || spec === '@exharness/benchmark' || spec.startsWith('./') || spec.startsWith('../'),
        `${path.relative(REPO, file)} imports forbidden specifier ${spec}`
      );
      assert.ok(!spec.includes(DEEP), `${path.relative(REPO, file)} deep-imports benchmark internals`);
    }
    // Comments may name the forbidden pattern; only executable code counts.
    assert.ok(!stripComments(source).includes(DEEP), `${path.relative(REPO, file)} references benchmark internals`);
  }
});

test('Core is imported only through its public entry', async () => {
  const files = implSources();
  let coreUsers = 0;
  for (const file of files) {
    const code = stripComments(fs.readFileSync(file, 'utf8'));
    for (const spec of importSpecifiers(code)) {
      if (spec.includes('core-harness')) {
        assert.ok(spec.endsWith('packages/core-harness/src/index.js'),
          `${path.relative(REPO, file)} must import Core only via packages/core-harness/src/index.js`);
        coreUsers += 1;
      }
    }
    const deep = [...code.matchAll(/core-harness\/src\/([A-Za-z0-9_.-]+)/g)].map((match) => match[1]);
    for (const hit of deep) {
      assert.equal(hit, 'index.js', `${path.relative(REPO, file)} deep-imports Core file ${hit}`);
    }
  }
  assert.ok(coreUsers >= 3, 'both arm adapters and the executor fixture drive the public Core entry');
});

test('deep imports are detected and rejected', async () => {
  const { loadKernel } = await import('../preflight.mjs');
  await loadKernel();
  const hostile = `import { AttemptLedger } from '${DEEP}attempt-ledger.js';`;
  assert.ok(importSpecifiers(hostile).some((spec) => spec.includes(DEEP)));
  assert.ok(hostile.includes(DEEP));
});

test('local ledger, evidence, accounting or audit reimplementations are detected', async () => {
  const markers = [
    'class AttemptLedger',
    'function createEvidenceManifest',
    'function normalizeAccounting',
    'function auditAttempt',
    'function normalizeOutcome',
    'function createExperimentRegistration',
    'function createBenchmarkUnit'
  ];
  for (const file of implSources()) {
    const source = fs.readFileSync(file, 'utf8');
    for (const marker of markers) {
      assert.ok(!source.includes(marker), `${path.relative(REPO, file)} reimplements kernel truth (${marker})`);
    }
  }
  const hostile = 'class AttemptLedger { beginAttempt() {} }';
  assert.ok(markers.some((marker) => hostile.includes(marker)));
});

test('direct Harbor imports or spawns are detected', async () => {
  for (const file of implSources()) {
    const source = fs.readFileSync(file, 'utf8');
    assert.ok(!source.includes('benchmarks/substrate/harbor'), `${path.relative(REPO, file)} reaches into Harbor internals`);
    assert.ok(!/from\s+['"]harbor['"]/.test(source), `${path.relative(REPO, file)} imports harbor`);
    assert.ok(!source.includes('harbor_agent'), `${path.relative(REPO, file)} references the Harbor agent`);
  }
  const hostile = `import adapter from '../../substrate/harbor/adapter.mjs';`;
  assert.ok(hostile.includes('substrate/harbor'));
});

test('preflight fails closed on an incompatible substrate manifest', async () => {
  const { assertSubstrateCompatible, loadSubstrateManifest } = await import('../preflight.mjs');
  const { manifest } = await loadSubstrateManifest();
  assert.equal(assertSubstrateCompatible(manifest), manifest);
  assert.throws(() => assertSubstrateCompatible({ ...manifest, kind: 'OTHER' }), /SUBSTRATE_MANIFEST_KIND/);
  assert.throws(() => assertSubstrateCompatible({ ...manifest, status: 'DRAFT' }), /SUBSTRATE_MANIFEST_STATUS/);
  assert.throws(
    () => assertSubstrateCompatible({ ...manifest, harbor: { ...manifest.harbor, commit: 'deadbeef' } }),
    /SUBSTRATE_PIN/
  );
  await assert.rejects(loadSubstrateManifest({ manifestPath: path.join(tmp, 'missing.json') }), /SUBSTRATE_MANIFEST_MISSING/);
});

test('preflight requires BB-065 DONE and stops without fallback', async () => {
  const { assertUpstreamDone, PreflightError } = await import('../preflight.mjs');
  assert.equal(await assertUpstreamDone(), true);
  const clean = path.join(tmp, 'state-clean.md');
  fs.writeFileSync(clean, 'BB-065 [DONE] <- ROOT\n', 'utf8');
  assert.equal(await assertUpstreamDone({ statePath: clean }), true);
  const blocked = path.join(tmp, 'state-blocked.md');
  fs.writeFileSync(blocked, 'BB-065 [BLOCKED] <- ROOT\n', 'utf8');
  await assert.rejects(assertUpstreamDone({ statePath: blocked }), (error) => {
    assert.ok(error instanceof PreflightError);
    assert.match(error.message, /UPSTREAM_NOT_DONE/);
    return true;
  });
});

test('substrate descriptor validates through the kernel port contract only', async () => {
  const { loadKernel, loadSubstrateManifest, describeSubstratePort } = await import('../preflight.mjs');
  const kernel = await loadKernel();
  const { manifest } = await loadSubstrateManifest();
  const port = describeSubstratePort(manifest);
  assert.equal(kernel.assertSubstratePort(port), port);
  assert.deepEqual(port.identity(), { substrate: 'harbor', version: '0.23.0', commit: '1e5c5c6db929a10a140d05e606882c671ae20729' });
  assert.throws(() => port.execute(), /PRECONDITION/);
});
