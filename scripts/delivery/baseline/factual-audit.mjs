import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from './contract.mjs';
import { foldResourceJournal, readResourceJournal } from './resource-state.mjs';
import { loadValueProtocol, validateStudyManifest } from './study.mjs';
import { auditControlledTrials, auditQualificationProbes } from './controlled-audit.mjs';
import { buildStageOnePayload } from './jev-value.mjs';
import { validateControlledTrials } from './controlled-trials.mjs';

const fail = (message, code = 2) => {
  const error = new Error(`BASELINE_FACTUAL_AUDIT_INVALID: ${message}`);
  error.exitCode = code;
  throw error;
};
const option = (args, name) => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
const plainJson = path => readFile(path, 'utf8').then(JSON.parse);
const hashBody = value => `sha256:${sha256(value)}`;

async function readLedgerRows(ledgerPath) {
  const body = await readFile(ledgerPath, 'utf8').catch(error => {
    if (error.code === 'ENOENT') return '';
    throw error;
  });
  return body.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
}

function foldLedger(rows) {
  const settled = rows.filter(row => row.kind === 'SETTLED');
  const unknown = rows.filter(row => row.kind === 'UNKNOWN');
  return {
    wireRequests: rows.filter(row => row.kind === 'RESERVE').length,
    settled: settled.length,
    unknown: unknown.length,
    inputTokens: settled.reduce((sum, row) => sum + (row.inputTokens ?? 0), 0),
    outputTokens: settled.reduce((sum, row) => sum + (row.outputTokens ?? 0), 0),
    apiUsd: settled.reduce((sum, row) => sum + (row.costUsd ?? 0), 0)
  };
}

export async function runFactualAudit({ output, allowDeterministic = false, requireComplete = true } = {}) {
  if (!output) fail('output is required');
  const directory = resolve(output);
  const checks = [];
  const manifest = await plainJson(join(directory, 'manifest.json'));
  const value = await loadValueProtocol(manifest.protocolId === 'CORE_VALUE_V2' ? 'CORE_VALUE_V2' : 'FIXTURE_VALUE_V1');
  validateStudyManifest(manifest, { protocol: value, profileHash: manifest.profileHash,
    candidateSha: manifest.candidateSha, candidateTree: manifest.candidateTree });
  checks.push('manifest');
  const report = await plainJson(join(directory, 'report.json'));
  const metrics = await plainJson(join(directory, 'metrics.json'));
  if (report.studyId !== manifest.studyId || metrics.studyId !== manifest.studyId ||
      !Array.isArray(metrics.executions) || metrics.executions.length !== 12)
    fail('factual audit requires twelve registered live executions');
  checks.push('twelve-executions');
  if (requireComplete && !report.complete) fail('factual audit requires a complete twelve-execution factual report');
  if (!report.complete && !allowDeterministic) fail('production Jev input requires a complete twelve-execution factual report');
  if (!allowDeterministic && report.evidenceClass !== 'LIVE') fail('production Jev input must be live evidence');
  checks.push('report-complete');
  for (const row of metrics.executions) {
    if (row.profileHash !== manifest.profileHash) fail(`execution is not bound to the registered profile: ${row.executionId}`);
    const ledger = foldLedger(await readLedgerRows(join(directory, 'executions',
      row.executionId.replaceAll(':', '__'), 'provider-ledger.jsonl')));
    for (const field of ['wireRequests', 'inputTokens', 'outputTokens', 'apiUsd']) {
      if (ledger[field] !== (row.provider?.[field] ?? null) && !(ledger[field] === 0 && row.provider?.[field] == null))
        fail(`execution ledger total differs from metrics: ${row.executionId}.${field}`);
    }
    if (!allowDeterministic && ledger.unknown > 0) fail(`execution has unresolved provider usage: ${row.executionId}`);
  }
  checks.push('execution-ledgers');
  const events = await readResourceJournal(join(directory, 'events.jsonl')).catch(() => null);
  if (!events) fail('factual audit requires the hash-bound resource journal');
  const resourceState = foldResourceJournal(events, { experimentId: manifest.studyId });
  checks.push('resource-journal');
  let canary = null;
  if (value.protocolId === 'CORE_VALUE_V2') {
    canary = await plainJson(join(directory, 'canary', 'canary.json')).catch(() => null);
    if (!canary || canary.digest !== hashBody(Object.fromEntries(Object.entries(canary).filter(([key]) => key !== 'digest'))))
      fail('factual audit requires the recorded runtime-readiness canary');
    if (canary.profileHash !== manifest.profileHash || manifest.canaryHash !== canary.digest)
      fail('canary record is not bound to the registered cohort');
    if (!allowDeterministic && canary.status !== 'PASS') fail(`production Jev input requires a passing canary: ${canary.status}`);
    checks.push('canary');
    await auditQualificationProbes({ output: directory });
    checks.push('qualification-probes');
    const controlled = await plainJson(join(directory, 'controlled-trials.json')).catch(() => null);
    if (!controlled) fail('factual audit requires twenty-four controlled trials');
    validateControlledTrials({ artifact: controlled, manifest, value });
    await auditControlledTrials({ output: directory });
    checks.push('controlled-trials');
  }
  const setupProbes = await plainJson(join(directory, 'setup', 'probes.json')).catch(() => null);
  const controlledTrials = value.protocolId === 'CORE_VALUE_V2'
    ? await plainJson(join(directory, 'controlled-trials.json')) : null;
  const resourceSummary = { journalHash: hashBody(events), counters: resourceState.counters,
    cohortTerminalReason: resourceState.cohortTerminalReason ?? null };
  const payload = buildStageOnePayload({ manifest, report, metrics, protocol: value,
    setupProbes, controlledTrials, canary, resourceSummary, allowDeterministic });
  if (payload.state.study.canary == null && value.protocolId === 'CORE_VALUE_V2')
    fail('Jev stage-one observations omit the canary record');
  if (payload.state.study.resource == null) fail('Jev stage-one observations omit the ledger summary');
  checks.push('jev-observations-within-bound');
  return { mode: 'factual-audit', checks, exitCode: 0 };
}

export async function main(args = process.argv.slice(2)) {
  const output = option(args, '--output');
  if (!output) fail('--output is required');
  return runFactualAudit({ output: resolve(output) });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await main())); }
  catch (error) { console.error(error.message); process.exitCode = error.exitCode ?? 4; }
}
