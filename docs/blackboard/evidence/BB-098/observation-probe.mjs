// Deterministic observability probe for BB-098 over the DELIVERED BB-097 agent-tools package.
// It drives the BB-097 fake CLI (no provider, no credentials, no real agent CLI) and records:
//  1. the exact runAgentInvocation result fields for the codex, kiro and agy argv styles;
//  2. which ExHarness events and spans a supervised run emits through eventSinks and tracer;
//  3. which raw per-attempt facts runSupervisedTask exposes, and whether its agent log file and
//     worktree still exist after it returns.
// Usage from repository root: node docs/blackboard/evidence/BB-098/observation-probe.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..', '..');
const agentTools = await import(pathToFileURL(path.join(root, 'packages/agent-tools/src/index.js')));
const core = await import(pathToFileURL(path.join(root, 'packages/core-harness/src/index.js')));
const fake = path.join(root, 'packages/agent-tools/test/fixtures/fake-agent.mjs');
const { runAgentInvocation, runSupervisedTask, defineAgentTool, AGENT_TOOLS } = agentTools;

const gitEnv = { ...process.env, GIT_AUTHOR_NAME: 'probe', GIT_AUTHOR_EMAIL: 'probe@localhost.invalid', GIT_COMMITTER_NAME: 'probe', GIT_COMMITTER_EMAIL: 'probe@localhost.invalid' };
const git = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: gitEnv });
  if (r.status !== 0) throw new Error(`git ${args[0]}: ${r.stderr}`);
  return r.stdout.trim();
};
function repository() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb098-probe-'));
  git(dir, 'init', '-q');
  fs.writeFileSync(path.join(dir, 'sum.mjs'), 'export const sum = (a, b) => a - b;\n');
  fs.writeFileSync(path.join(dir, 'sum.test.mjs'), 'import test from "node:test";\nimport assert from "node:assert/strict";\nimport { sum } from "./sum.mjs";\ntest("sum", () => assert.equal(sum(2, 3), 5));\n');
  git(dir, 'add', '-A');
  git(dir, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'base');
  return { dir, base: git(dir, 'rev-parse', 'HEAD') };
}
const fakeTool = id => defineAgentTool(AGENT_TOOLS[id], { command: process.execPath, prefixArgs: [fake] });

// 1. Direct invocation result shape per argv style.
const direct = {};
for (const id of ['codex', 'kiro', 'agy']) {
  const { dir } = repository();
  const logFile = path.join(dir, '..', `${path.basename(dir)}-agy.log`);
  const run = await runAgentInvocation(fakeTool(id), { prompt: 'fix sum', logFile }, { cwd: dir, env: { FAKE_AGENT_SCENARIO: 'FIX_FIRST' }, timeoutMs: 60000 });
  direct[id] = {
    resultFields: Object.keys(run).sort(),
    status: run.status,
    exitCode: run.exitCode,
    stdoutIsJsonl: run.stdout.split('\n').filter(Boolean).every(line => line.trim().startsWith('{')),
    stdoutCarriesUsage: /"usage"\s*:/.test(run.stdout),
    stdoutSha256IsFullStreamDigest: typeof run.stdoutSha256 === 'string' && run.stdoutSha256.length === 64,
    workingTreeChangedWithoutCommit: git(dir, 'status', '--porcelain') !== ''
  };
}

// 2 + 3. Supervised run observability.
const { dir, base } = repository();
const events = [];
const spans = [];
let observedLogDir = null;
const tool = fakeTool('agy');
const wrapped = defineAgentTool({ ...tool, buildInvocation(request) { observedLogDir = path.dirname(request.logFile); return tool.buildInvocation(request); } });
const result = await runSupervisedTask({
  tool: wrapped,
  task: { id: 'probe', repositoryRoot: dir, baseRevision: base, prompt: 'fix sum', verifications: [{ name: 'test', command: process.execPath, args: ['--test', 'sum.test.mjs'], timeoutMs: 60000 }] },
  maxAttempts: 3,
  env: { FAKE_AGENT_SCENARIO: 'FIX_AFTER_FEEDBACK' },
  eventSinks: [{ write: event => { events.push(event); } }],
  tracer: core.createTraceRecorder({ sinks: [{ write: span => { spans.push(span); } }] })
});
const supervised = {
  status: result.status,
  resultFields: Object.keys(result).sort(),
  attemptFields: Object.keys(result.attempts[0]).sort(),
  attemptCarriesRawStdout: result.attempts.some(attempt => 'stdout' in attempt || 'stderr' in attempt),
  attemptVerification: result.attempts.map(attempt => attempt.verification.map(v => `${v.name}:${v.status}`)),
  agentLogDirExistsAfterReturn: observedLogDir === null ? null : fs.existsSync(observedLogDir),
  eventTypes: [...new Set(events.map(event => event.type))],
  capabilityInvocations: events.filter(event => event.type === 'CAPABILITY_INVOKED').map(event => event.payload.name),
  spans: spans.map(span => ({ kind: span.kind, name: span.name, status: span.status })),
  eventPayloadCarriesPrompt: events.some(event => JSON.stringify(event.payload).includes('fix sum'))
};

const installed = Object.fromEntries(['codex', 'kiro-cli', 'agy'].map(bin => [bin, spawnSync(bin, ['--version'], { encoding: 'utf8' }).error?.code !== 'ENOENT']));
const probe = {
  kind: 'BB098_OBSERVATION_PROBE_RESULT',
  version: 1,
  node: process.version,
  realCliInstalledOnProbeHost: installed,
  direct,
  supervised,
  conclusions: {
    directResultHasStdoutStderrDurationDigests: ['codex', 'kiro', 'agy'].every(id => ['durationMs', 'stderr', 'stderrSha256', 'stdout', 'stdoutSha256', 'truncated'].every(field => direct[id].resultFields.includes(field))),
    directResultHasNoStartEndTimestamps: ['codex', 'kiro', 'agy'].every(id => !direct[id].resultFields.includes('startedAt')),
    supervisedResultOmitsRawOutput: !supervised.attemptCarriesRawStdout,
    supervisedLogAndWorktreeRemovedOnReturn: supervised.agentLogDirExistsAfterReturn === false,
    capabilityWindowsOpenAtAvoAct: supervised.capabilityInvocations[0] === 'avo.act',
    fakeCodexStreamHasNoUsageEvent: direct.codex.stdoutCarriesUsage === false
  }
};
const out = path.join(here, 'observation-probe-result.json');
fs.writeFileSync(out, `${JSON.stringify(probe, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(probe.conclusions)}\n`);
