#!/usr/bin/env node
// Benchmark substrate CLI. Every mode prints one JSON summary and exits non-zero unless it passes.
import { outputRoot } from './common.mjs';

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) throw new Error(`unexpected argument ${key}`);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) args[key.slice(2)] = true;
    else { args[key.slice(2)] = next; index += 1; }
  }
  return args;
}

const MODES = {
  'local-calibration': async () => (await import('./calibration.mjs')).runLocalCalibration({ outputRoot: outputRoot('local-calibration') }),
  audit: async args => {
    if (!args.input) throw new Error('--input <experiment dir> is required');
    return (await import('./audit-experiment.mjs')).auditExperiment(args.input);
  },
  'external-preflight': async args => {
    const module = await import('./external-sanity.mjs');
    return args.execute ? module.executeExternalPreflight({ outputRoot: outputRoot('external-preflight') }) : module.verifyExternalPreflight();
  },
  'verify-legacy-retirement': async () => (await import('./legacy-retirement.mjs')).verifyLegacyRetirement(),
  'verify-downstream': async args => (await import('./downstream/verify.mjs')).verifyDownstream({ consumer: args.consumer }),
  'verify-product-boundary': async () => (await import('./product-boundary.mjs')).verifyProductBoundary()
};

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const mode = MODES[args.mode];
  if (!mode) throw new Error(`--mode must be one of ${Object.keys(MODES).join(', ')}`);
  const summary = await mode(args);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  return summary.status === 'PASS' || summary.status === 'SEALED' ? 0 : 1;
}

main().then(code => { process.exitCode = code; }, error => {
  process.stdout.write(`${JSON.stringify({ status: 'FAIL', error: error.message }, null, 2)}\n`);
  process.exitCode = 1;
});
