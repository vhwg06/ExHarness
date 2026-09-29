// Deterministic probe: does the delivered Agentic Backend -> QA path execute against a real
// repository, real processes and a real model, or only against injected fixtures?
// Usage from repository root: node docs/blackboard/evidence/BB-096/real-execution-probe.mjs
// Writes docs/blackboard/evidence/BB-096/real-execution-probe-result.json.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');
const rel = (p) => path.relative(root, p).split(path.sep).join('/');
const list = (dir, re) => fs.readdirSync(path.join(root, dir)).filter((f) => re.test(f)).map((f) => `${dir}/${f}`);
const read = (ref) => fs.readFileSync(path.join(root, ref), 'utf8');
const matching = (refs, re) => refs.filter((ref) => re.test(read(ref)));

// 1. Static source inventory (DELIVERED_TRUTH at the probed commit).
const packageSrc = ['core-harness', 'agentic-system', 'oracle'].flatMap((p) => list(`packages/${p}/src`, /\.js$/));
const agenticSrc = list('packages/agentic-system/src', /\.js$/);
const agenticTests = list('packages/agentic-system/test', /\.test\.js$/);
const providerPattern = /\bfetch\(|openai|anthropic|bedrock|typesafe|apiKey|process\.env/i;
const processPattern = /node:child_process|\bspawn\(|\bexecFile\(/;
const realStrategyPattern = /createJavaScriptCodeActStrategy|createCodeActStrategy|createPredictStrategy/;
const scriptedStrategyPattern = /async run\(\{[^}]*invoke[^}]*\}\)/g;
const manifests = ['package.json', 'packages/core-harness/package.json', 'packages/agentic-system/package.json', 'packages/oracle/package.json']
  .filter((ref) => fs.existsSync(path.join(root, ref)));
const backendWorkerSource = read('packages/agentic-system/src/backend-worker.js');
const qaWorkerSource = read('packages/agentic-system/src/qa-worker.js');

const inventory = {
  packageSourceFiles: packageSrc.length,
  providerAdapterFiles: matching(packageSrc, providerPattern),
  agenticSourceFiles: agenticSrc.length,
  agenticProcessExecutionFiles: matching(agenticSrc, processPattern),
  agenticTestFiles: agenticTests.length,
  agenticTestsUsingCoreModelStrategies: matching(agenticTests, realStrategyPattern),
  agenticInlineScriptedStrategies: agenticTests.reduce((n, ref) => n + (read(ref).match(scriptedStrategyPattern) ?? []).length, 0),
  backendWorkerRequiresInjectedStrategy: backendWorkerSource.includes('BackendWorker requires strategy.run()'),
  backendWorkerRequiresInjectedWorkspace: backendWorkerSource.includes('BackendWorker requires workspace.act()'),
  qaWorkerUsesInjectedVerifiers: /verifiers/.test(qaWorkerSource),
  manifestsWithBin: manifests.filter((ref) => JSON.parse(read(ref)).bin != null)
};

// 2. Discriminating experiment: a real git repository whose real test fails.
// Drive the delivered Backend path with the same injected shapes the delivered tests use.
const core = await import(pathToFileURL(path.join(root, 'packages/core-harness/src/index.js')).href);
const app = await import(pathToFileURL(path.join(root, 'packages/agentic-system/src/index.js')).href);
const { AVOCapability, EvaluationVerdict, VerificationStatus, verificationCapabilityName } = core;
const { BackendEvidenceClaim, BackendWorkStatus, createBackendWorker, defineBackendObjective, runBackendObjective } = app;

const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'bb096-probe-'));
const git = (...args) => spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
let experiment;
try {
  fs.mkdirSync(path.join(repo, 'src'));
  fs.mkdirSync(path.join(repo, 'test'));
  fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ type: 'module', scripts: { test: 'node --test test/' } }));
  fs.writeFileSync(path.join(repo, 'src/server.js'), 'export function health() { return null; }\n');
  fs.writeFileSync(path.join(repo, 'test/server.test.js'),
    "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { health } from '../src/server.js';\n" +
    "test('GET /health returns ok', () => { assert.deepEqual(health(), { status: 'ok' }); });\n");
  git('init', '-q');
  git('-c', 'user.email=probe@example.invalid', '-c', 'user.name=probe', 'add', '.');
  git('-c', 'user.email=probe@example.invalid', '-c', 'user.name=probe', 'commit', '-q', '-m', 'fixture');
  const headBefore = git('rev-parse', 'HEAD').stdout.trim();
  const realTestsBefore = spawnSync(process.execPath, ['--test', 'test/'], { cwd: repo, encoding: 'utf8' }).status;

  let verifierProcessesSpawned = 0;
  const verifier = (name, claim) => ({
    name,
    async verify() { return { claim, status: VerificationStatus.PASS, evidence: [`${name}:pass`], summary: `${name} pass` }; }
  });
  const backendWorker = createBackendWorker({
    strategy: {
      async run({ invoke }) {
        const action = await invoke(AVOCapability.ACT, { kind: 'APPLY_BACKEND_CHANGE' });
        await invoke(verificationCapabilityName('backend-typecheck'));
        await invoke(verificationCapabilityName('backend-tests'));
        const evaluation = await invoke(AVOCapability.EVALUATE);
        if (evaluation.verdict !== EvaluationVerdict.PASS) throw new Error('probe evaluation did not pass');
        await invoke(AVOCapability.PROMOTE);
        return {
          status: BackendWorkStatus.APPLIED, summary: 'Applied Backend change.', revision: action.candidate.version,
          artifacts: action.result.artifacts, gaps: [], blockers: []
        };
      }
    },
    workspace: {
      async act({ candidate }) {
        return {
          mutated: true,
          candidate: { id: candidate.id, version: 'rev-2' },
          result: { artifacts: [{ ref: 'workspace://rev-2/src/server.js', path: 'src/server.js' }] }
        };
      }
    },
    verifiers: [verifier('backend-typecheck', BackendEvidenceClaim.TYPECHECK), verifier('backend-tests', BackendEvidenceClaim.TESTS)]
  });
  const run = await runBackendObjective(defineBackendObjective({
    id: 'health-endpoint',
    task: 'Make GET /health return { status: "ok" }.',
    repository: { ref: `file://${repo}`, revision: 'rev-1' },
    requiredFiles: ['src/server.js', 'test/server.test.js'],
    constraints: []
  }), {
    repositoryReader: {
      async readFile({ repositoryRef, revision, filePath, path: p }) {
        const target = p ?? filePath;
        return { content: fs.readFileSync(path.join(repo, target), 'utf8'), sourceRef: `${repositoryRef}@${revision}:${target}` };
      }
    },
    backendWorker
  });

  const headAfter = git('rev-parse', 'HEAD').stdout.trim();
  const realTestsAfter = spawnSync(process.execPath, ['--test', 'test/'], { cwd: repo, encoding: 'utf8' }).status;
  experiment = {
    fixture: 'temporary git repository with one failing node:test',
    completionAction: run.completion.action,
    runDecision: run.decision.action,
    resultRevision: run.result.revision,
    repositoryHeadUnchanged: headBefore === headAfter,
    repositoryWorkingTreeClean: git('status', '--porcelain').stdout.trim() === '',
    realTestExitBefore: realTestsBefore,
    realTestExitAfter: realTestsAfter,
    verifierProcessesSpawned,
    evidence: run.result.evidence.map((e) => ({ kind: e.kind, claim: e.metadata?.claim ?? null, status: e.metadata?.verificationStatus ?? null, subjectType: e.subject?.type ?? null })),
    mutationEvidenceAfterRevision: run.result.evidence.find((e) => e.metadata?.claim === 'backend.mutation')?.content?.afterRevision ?? null,
    acceptedWithoutRealMutationOrPassingTests:
      run.completion.action === 'ACCEPT' && headBefore === headAfter && realTestsAfter !== 0 && verifierProcessesSpawned === 0
  };
} finally {
  fs.rmSync(repo, { recursive: true, force: true });
}

// 3. Planned roadmap coverage (PLANNED_CONTRACT): which READY delivery plans already own real
// execution, and whether any of them owns the delivered BackendWorker/BackendCompletion path or
// the README/Living claim of delivered mutation/typecheck/tests evidence.
const graph = JSON.parse(read('docs/blackboard/work-graph.json'));
const roadmapCoverage = ['BB-066', 'BB-067', 'BB-068', 'BB-069'].map((id) => {
  const task = graph.tasks.find((t) => t.id === id);
  const planText = read(task.contract.planRef);
  const plan = JSON.parse(planText);
  return {
    id,
    title: task.title,
    lane: task.lane,
    planStatus: plan.status,
    mentionsBackendWorker: /BackendWorker|createBackendWorker|backend-worker\.js/.test(planText),
    mentionsBackendCompletion: /BackendCompletion|backend-completion\.js/.test(planText),
    mentionsQaWorker: /QaWorker|qa-worker\.js/.test(planText),
    writesBackendPath: plan.sourceScope.write.some((w) => /backend-(worker|completion|application)\.js/.test(w)),
    writesRootReadme: plan.sourceScope.write.includes('README.md'),
    writesAgenticState: plan.sourceScope.write.includes('docs/living/system/agentic-application/state.md')
  };
});
const readme = read('README.md');

const result = {
  kind: 'BB096_REAL_EXECUTION_PROBE_RESULT',
  version: 1,
  evidenceClass: 'DETERMINISTIC_SOURCE_INVENTORY_AND_FIXTURE_EXPERIMENT',
  probeRef: rel(fileURLToPath(import.meta.url)),
  inventory,
  experiment,
  roadmapCoverage,
  readmeClaimsDeliveredBackendEvidence: readme.includes('-> mutation + typecheck + tests evidence'),
  conclusions: {
    noModelProviderInProductSource: inventory.providerAdapterFiles.length === 0,
    noProcessExecutionInAgenticSource: inventory.agenticProcessExecutionFiles.length === 0,
    noAgenticTestUsesCoreModelStrategy: inventory.agenticTestsUsingCoreModelStrategies.length === 0,
    noRunnableEntrypoint: inventory.manifestsWithBin.length === 0,
    acceptanceIsNotBoundToRepositoryState: experiment.acceptedWithoutRealMutationOrPassingTests,
    realExecutionAlreadyPlannedOutsideBackendWorker: roadmapCoverage.every((r) => r.planStatus === 'READY'),
    backendWorkerPathOwnedByNoPlan: roadmapCoverage.every((r) => !r.mentionsBackendWorker && !r.mentionsBackendCompletion && !r.writesBackendPath),
    deliveredClaimOwnedByNoPlan: roadmapCoverage.every((r) => !r.writesRootReadme && !r.writesAgenticState)
  }
};
const out = path.join(here, 'real-execution-probe-result.json');
fs.writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result.conclusions));
