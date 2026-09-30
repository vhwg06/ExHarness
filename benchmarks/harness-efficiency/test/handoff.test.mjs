// BB081_HANDOFF: versioned comparison manifest/report contract, held-out
// manifest and preregistered future gate consumable on the same benchmark
// backbone without changing kernel semantics.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBaseline, scratchDir } from './helpers.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

let tmp;
test.before(() => { tmp = scratchDir('handoff'); assert.ok(fs.statSync(tmp).isDirectory()); });

test('handoff carries versioned comparison, held-out and gate on the same backbone', async () => {
  const { comparison, binding } = await runBaseline({ withRetry: true });
  const { buildHandoff } = await import('../handoff.mjs');
  const handoff = await buildHandoff({ binding, comparison });
  assert.equal(handoff.comparison.kind, 'BB077_COMPARISON_MANIFEST_V1');
  assert.equal(handoff.comparison.dataKind, 'OFFLINE_SCRIPTED_FIXTURE');
  assert.equal(handoff.comparison.liveBaseline, 'NOT_EXECUTED');
  assert.equal(handoff.heldOut.kind, 'BB077_HELD_OUT_V1');
  assert.equal(handoff.heldOutSetId, 'BB081-HELD-OUT-V1');
  assert.equal(handoff.gate.kind, 'BB077_FUTURE_GATE_V1');
  assert.equal(handoff.backbone.kernel, '@exharness/benchmark');
  assert.equal(handoff.backbone.importRule, 'package root only');
  assert.equal(handoff.backbone.substrateKind, 'BENCHMARK_SUBSTRATE_MANIFEST_V1');
  assert.equal(handoff.backbone.substrateDigest, binding.substrateDigest);
  assert.deepEqual(handoff.heldOut.tasks.map((task) => task.id), [
    'git-leak-recovery',
    'pypi-server',
    'kv-store-grpc',
    'sanitize-git-repo'
  ]);
  void tmp;
});

test('gate is preregistered with thresholds and no async verdict', async () => {
  const { futureGate } = await import('../handoff.mjs');
  const gate = await futureGate();
  assert.equal(gate.economics.medianNormalizedCostRatioLte, 0.85);
  assert.equal(gate.context.medianPromptInputTokenRatioLte, 0.9);
  assert.equal(gate.interaction.medianModelTurnRatioLte, 1.0);
  assert.equal(gate.latency.medianElapsedRatioLte, 1.1);
  assert.equal(gate.quality.acceptedTaskRateCandidateGteCoreSync, true);
  assert.match(gate.fallback, /INCONCLUSIVE/);
  const { comparison, binding } = await runBaseline({ withRetry: false });
  const { buildHandoff } = await import('../handoff.mjs');
  const handoff = await buildHandoff({ binding, comparison });
  assert.equal(handoff.asyncCandidates, 'NOT_EXECUTED');
  assert.equal(handoff.promotionVerdict, 'NOT_PUBLISHED');
  assert.ok(!('PROMOTE_ASYNC' in handoff) && !('KEEP_SYNC' in handoff));
});

test('materialized handoff fixtures match the builder output', async () => {
  const { comparison, binding } = await runBaseline({ withRetry: true });
  const { buildHandoff } = await import('../handoff.mjs');
  const handoff = await buildHandoff({ binding, comparison });
  const gateOnDisk = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests/gate.json'), 'utf8'));
  assert.deepEqual(gateOnDisk, handoff.gate);
  const comparisonOnDisk = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests/comparison.json'), 'utf8'));
  assert.equal(comparisonOnDisk.kind, handoff.comparison.kind);
  assert.equal(comparisonOnDisk.substrateDigest, binding.substrateDigest);
  assert.deepEqual(comparisonOnDisk.metricVector, handoff.comparison.metricVector);
});

test('handoff dependencies stay on the public kernel', async () => {
  const { importSpecifiers } = await import('./helpers.mjs');
  for (const name of ['handoff.mjs', 'report.mjs', 'reducer.mjs', 'protocol.mjs', 'cohort.mjs']) {
    const source = fs.readFileSync(path.join(ROOT, name), 'utf8');
    for (const spec of importSpecifiers(source)) {
      assert.ok(
        spec.startsWith('node:') || spec === '@exharness/benchmark' || spec.startsWith('./') || spec.startsWith('../'),
        `${name} depends on ${spec}`
      );
    }
  }
});
