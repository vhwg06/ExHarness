// Research probes only: deterministic local fixtures, no provider calls or host secrets.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createLocalCommandVerifier } from '../../../../packages/agentic-system/src/local-command-verifier.js';
import { codexTool, defineAgentTool } from '../../../../packages/agent-tools/src/tool-adapters.js';
import { parseCodexJsonl, parseGrokJson } from '../../../../packages/agent-tools/src/output-parsers.js';
import { runSupervisedTask, resumeSupervisedTask } from '../../../../packages/agent-tools/src/supervisor.js';
import { readAgentToolRunHandle, disposeRecoverableRun } from '../../../../packages/agent-tools/src/recovery.js';
import { runDeliverSlice, validateDeliverSlice } from '../../../../packages/agent-tools/src/deliver-slice.js';
const root = resolve(import.meta.dirname, '../../../..');
const baselineSha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
const scratch = mkdtempSync(join(tmpdir(), 'exharness-roadmap-audit-'));
const gitEnv = { ...process.env, GIT_AUTHOR_NAME: 'probe', GIT_AUTHOR_EMAIL: 'probe@localhost.invalid', GIT_COMMITTER_NAME: 'probe', GIT_COMMITTER_EMAIL: 'probe@localhost.invalid', GIT_CONFIG_NOSYSTEM: '1' };
function git(cwd, ...args) { const r = spawnSync('git', args, { cwd, env: gitEnv, encoding: 'utf8', shell: false }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); }
function repo(name) {
  const dir = join(scratch, name); mkdirSync(dir);
  git(dir, 'init', '-q');
  writeFileSync(join(dir, 'sum.mjs'), 'export const sum = (a,b) => a-b;\n');
  writeFileSync(join(dir, 'sum.test.mjs'), 'import assert from "node:assert/strict"; import {sum} from "./sum.mjs"; assert.equal(sum(2,3),5);\n');
  git(dir, 'add', '-A'); git(dir, '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture');
  return { dir, base: git(dir, 'rev-parse', 'HEAD') };
}
const checks = [{ name: 'unit', command: process.execPath, args: ['sum.test.mjs'], timeoutMs: 3000 }];
const fake = defineAgentTool(codexTool, { command: process.execPath, prefixArgs: [join(root, 'packages/agent-tools/test/fixtures/fake-agent.mjs')] });
function task(r) { return { id: 'roadmap-probe', repositoryRoot: r.dir, baseRevision: r.base, prompt: 'Fix sum so it adds.', verifications: checks }; }
function save(id, facts, classification = 'EXECUTED_LOCAL_PROBE') {
  const dir = join(root, 'docs/blackboard/evidence', id); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'discovery.json'), JSON.stringify({ kind: 'ROADMAP_DISCOVERY_EVIDENCE', classification, baselineSha, providerCalls: 0, facts }, null, 2) + '\n');
  console.log(JSON.stringify({ id, facts }));
}
try {
  const r = repo('env');
  const key = 'EXHARNESS_ROADMAP_PLANTED_SECRET'; const prior = process.env[key]; process.env[key] = 'nonsecret-fixture-value';
  try {
    const verifier = createLocalCommandVerifier({ ...checks[0], claim: 'env', root: r.dir, command: process.execPath, args: ['-e', 'process.stdout.write(String(Object.hasOwn(process.env,"EXHARNESS_ROADMAP_PLANTED_SECRET")))'] });
    const out = await verifier.verify({ candidate: { version: r.base } });
    save('BB-123', { plantedVariableInheritedByVerifier: out.summary.endsWith('true'), verifierStatus: out.status, actualHostSecretRead: false });
    assert.ok(out.summary.endsWith('true'));
  } finally { if (prior === undefined) delete process.env[key]; else process.env[key] = prior; }
  const partial = parseCodexJsonl('{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":2}}\n', { truncated: true });
  const missing = parseGrokJson('{"usage":{"input_tokens":10,"output_tokens":2},"total_cost_usd":null}');
  save('BB-124', { truncatedCodexUsageReportedComplete: partial.usage.unavailableReason === null, partialInputTokens: partial.usage.inputTokens, grokNullCostReportedZero: missing.usage.totalCostUsd === 0 });
  assert.equal(partial.usage.unavailableReason, null); assert.equal(missing.usage.totalCostUsd, 0);
  const recoveryRepo = repo('resume'); const recoveryDir = join(scratch, 'recovery');
  try {
    await runSupervisedTask({ tool: fake, task: task(recoveryRepo), recoveryDir, maxAttempts: 3, env: { FAKE_AGENT_SCENARIO: 'NEVER_FIX' }, onHandleWrite(handle) { if (handle.phase === 'ACT_COMPLETED') throw new Error('PROBE_INTERRUPT'); } });
  } catch (e) { assert.match(e.message, /PROBE_INTERRUPT/); }
  const handle = await readAgentToolRunHandle(recoveryDir);
  const changed = { ...task(recoveryRepo), prompt: 'Different intent under the same id.', verifications: [{ ...checks[0], args: ['-e', 'process.exit(0)'] }] };
  const resumed = await resumeSupervisedTask(handle, { tool: fake, task: changed, env: { FAKE_AGENT_SCENARIO: 'NEVER_FIX' } });
  save('BB-125', { sameIdChangedPromptAndVerifierAccepted: resumed.status === 'ACCEPTED', status: resumed.status, candidateStillSubtracts: git(recoveryRepo.dir, 'show', `${resumed.acceptedSha}:sum.mjs`).includes('a - b'), handleHasTaskDigest: Object.hasOwn(handle, 'taskDigest') });
  assert.equal(resumed.status, 'ACCEPTED'); await disposeRecoverableRun(await readAgentToolRunHandle(recoveryDir));
  const retryRepo = repo('retry');
  const retry = await runSupervisedTask({ tool: fake, task: task(retryRepo), maxAttempts: 3, env: { FAKE_AGENT_SCENARIO: 'CLAIM_SUCCESS_NO_EDIT' } });
  save('BB-126', { status: retry.status, attempts: retry.attempts.length, identicalCandidateCount: new Set(retry.attempts.map(a => a.candidateSha)).size, verificationExecutions: retry.attempts.reduce((n,a) => n+a.verification.length,0) });
  assert.equal(retry.attempts.length, 3);
  const tamperRepo = repo('tamper'); const tamperCli = join(scratch, 'tamper.mjs');
  writeFileSync(tamperCli, 'import {writeFileSync} from "node:fs"; if(process.argv.includes("--version")) {console.log("fixture 1");} else {writeFileSync("sum.test.mjs","// acceptance check removed by agent\\n"); console.log(JSON.stringify({type:"thread.started",thread_id:"fixture"}));}\n');
  const tamperTool = defineAgentTool(codexTool, { command: process.execPath, prefixArgs: [tamperCli] });
  const slice = { id: 'tamper-slice', tool: 'codex', repositoryRoot: tamperRepo.dir, baseRevision: tamperRepo.base, prompt: 'Fix sum.', backendVerifications: checks, qaVerifications: checks };
  const delivered = await runDeliverSlice(slice, { tool: tamperTool, maxAttempts: 1 });
  save('BB-127', { status: delivered.status, editedAcceptanceTestPassesFreshQa: delivered.status === 'ACCEPTED', candidateStillSubtracts: git(tamperRepo.dir, 'show', `${delivered.backendSha}:sum.mjs`).includes('a-b'), trustBoundary: 'Trusted local commands do not protect test content from prior agent edits; this probe is not a sandbox exploit.' });
  assert.equal(delivered.status, 'ACCEPTED');
  const grokSlice = { ...slice, tool: 'grok' }; let grokRejected = false;
  try { validateDeliverSlice(grokSlice); } catch { grokRejected = true; }
  save('BB-128', { grokRegistered: /grok:\s*grokTool/.test(readFileSync(join(root, 'packages/agent-tools/src/tool-adapters.js'), 'utf8')), grokRejectedByDeliverManifest: grokRejected, openCodeInput: 'PLANNED_CONTRACT BB-122' });
  const refs = git(tamperRepo.dir, 'for-each-ref', '--contains', delivered.backendSha);
  save('BB-129', { acceptedCandidateHasNamedRetentionRef: refs.length > 0, resultHasPatchOrBundle: Object.keys(delivered).some(k => /patch|bundle|review/i.test(k)), shaStillReadableBeforeGc: true, lossAfterGc: 'NOT_EXECUTED; unreachable object risk, not observed data loss' });
} finally { rmSync(scratch, { recursive: true, force: true }); }
