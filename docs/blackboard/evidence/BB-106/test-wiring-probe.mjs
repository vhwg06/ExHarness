#!/usr/bin/env node
// Credential-free probe: delivered regression tests omitted from npm test / verify / kernel CI.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const scripts = pkg.scripts;
const scriptBlob = Object.entries(scripts).map(([k, v]) => `${k}=${v}`).join('\n');
const ci = ['.github/workflows/test.yml', '.github/workflows/push-test.yml']
  .map((rel) => fs.readFileSync(path.join(root, rel), 'utf8')).join('\n');
const files = [
  'test/blackboard-objective-supersession.test.mjs',
  'test/oracle-facade-accounting.test.mjs',
  'test/oracle-context-contract-boundary.test.mjs',
  'test/oracle-context-graph-boundary.test.mjs',
  'test/oracle-context-intelligence-foundation.test.mjs',
  'test/oracle-context-intelligence-benchmark-contract.test.mjs',
  'test/oracle-context-resolution-durability.test.mjs',
  'test/oracle-provider-boundary.test.mjs',
  'test/oracle-context-intelligence-architecture.test.mjs'
];
const named = (rel) => scriptBlob.includes(rel) || scriptBlob.includes(path.basename(rel));
const rows = Object.fromEntries(files.map((rel) => [rel, {
  exists: fs.existsSync(path.join(root, rel)),
  inNpmScripts: named(rel),
  inKernelCiFiles: ci.includes(rel) || ci.includes(path.basename(rel))
}]));
const omittedFromStandingScripts = files.filter((rel) => rows[rel].exists && !rows[rel].inNpmScripts);
const result = {
  kind: 'BB106_TEST_WIRING_PROBE_RESULT',
  version: 1,
  npmTest: scripts.test,
  testOracle: scripts['test:oracle'],
  testBlackboardJev: scripts['test:blackboard-jev'],
  testBlackboardWorkGraph: scripts['test:blackboard-work-graph'],
  verifyStartsWithNpmTest: String(scripts.verify).startsWith('npm test'),
  kernelCiRunsVerify: /npm run verify/.test(ci),
  testDeliveryDirExists: fs.existsSync(path.join(root, 'test/delivery')),
  rows,
  omittedFromStandingScripts,
  architectureIsWired: rows['test/oracle-context-intelligence-architecture.test.mjs'].inNpmScripts === true,
  defect: omittedFromStandingScripts.length > 0
};
fs.writeFileSync(path.join(here, 'test-wiring-probe-result.json'), JSON.stringify(result) + '\n');
console.log(JSON.stringify({ defect: result.defect, omitted: omittedFromStandingScripts.length, architectureWired: result.architectureIsWired, deliveryDir: result.testDeliveryDirExists }));
