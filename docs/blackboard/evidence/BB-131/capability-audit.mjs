import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { validateDeliverSlice } from '../../../../packages/agent-tools/src/deliver-slice.js';

const baselineSha = 'e9007f861fd95c678c0c4048bb3d82626855bda1';
const source = (ref) => execFileSync('git', ['show', `${baselineSha}:${ref}`], { encoding: 'utf8' });
const refs = ['packages/agent-tools/src/deliver-slice.js', 'packages/agentic-system/src/product-qa.js', 'packages/agentic-system/src/local-command-verifier.js'];
execFileSync('git', ['diff', '--exit-code', baselineSha, '--', ...refs]);
const normalized = validateDeliverSlice({
  id: 'discovery-only', repositoryRoot: '/synthetic/repository', baseRevision: 'a'.repeat(40),
  prompt: 'Create a request and retain it after reload', tool: 'codex',
  backendVerifications: [{ name: 'build', command: 'node', args: ['--version'], timeoutMs: 1000 }],
  qaVerifications: [{ name: 'qa', command: 'node', args: ['--version'], timeoutMs: 1000 }],
  preview: { services: ['web', 'database'], readiness: 'http' },
  browserJourneys: [{ id: 'create-and-reload', steps: ['create', 'reload', 'observe'] }],
  compatibility: { priorSchema: 'operator-pinned', persistedRecords: 'operator-pinned' }
});
const graph = JSON.parse(source('docs/blackboard/work-graph.json'));
const ownerIds = ['BB-054', 'BB-067', 'BB-069', 'BB-070', 'BB-071', 'BB-073', 'BB-074', 'BB-075', 'BB-099', 'BB-126', 'BB-127', 'BB-129'];
const result = {
  kind: 'ROADMAP_CAPABILITY_AUDIT', baselineSha, providerCalls: 0, serviceLaunches: 0,
  sourceDigests: Object.fromEntries(refs.map(ref => [ref, createHash('sha256').update(source(ref)).digest('hex')])),
  observed: {
    normalizedLocalSliceFields: Object.keys(normalized),
    proposedPreviewDescriptorConsumed: Object.hasOwn(normalized, 'preview'),
    proposedBrowserDescriptorConsumed: Object.hasOwn(normalized, 'browserJourneys'),
    proposedCompatibilityDescriptorConsumed: Object.hasOwn(normalized, 'compatibility'),
    productQaRequiresInjectedCriterionVerifier: source(refs[1]).includes('criterionVerifier.verify()'),
    localCommandVerifierIsGenericProcessRunner: source(refs[2]).includes('spawn(command, args')
  },
  existingOwners: ownerIds.map(id => {
    const task = graph.tasks.find(task => task.id === id);
    return { id, title: task.title, status: task.status, objectiveRef: task.contract.objectiveRef };
  }),
  limits: [
    'Ignored synthetic descriptors identify an unimplemented local manifest profile, not a product correctness defect.',
    'Generic command checks and injected criterion verifiers can already host caller-authored browser/API tests.',
    'No browser, container, database, live provider, false-acceptance trial or productivity experiment was run.',
    'The new tasks package concrete preview/evaluator profiles; existing authority, lifecycle and pilot owners remain binding.'
  ]
};
process.stdout.write(JSON.stringify(result, null, 2) + '\n');
